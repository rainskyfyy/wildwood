// Package room: 房间世界状态 — 资源实体 + 采集进行中状态 (M2.2)
//
// 设计要点:
//   - 10+ 资源类型常量(树/矿/草/兔窝/浆果/蘑菇/芦苇/燧石/骨/木棍/...),
//     每类型带 HP / gather_time_ms / yield_item_id
//   - World 持有房间的实体集:resources map[entity_id]*Resource
//   - 采集是"持续 1.5s"操作:ProcessGatherInput 启动 / 推进 / 完成;
//     进度由服务端权威,客户端只显示 UI 不算 HP
//   - 资源 HP 变化走 S2C_WorldDelta.entity_updates 同步给全队(任务验收 ④)
//
// 字节预算:每个资源 entity_state 约 30B,10+ 资源满房间 = ~300B,符合 < 4KB/tick
package room

import (
	"sort"
	"sync"
	"time"
)

// =====================================================================
// 资源类型常量与配置 (M2.2 验收 ① 10+ 资源类型)
// =====================================================================

// ResourceType 资源类型 id(同 M2.14 美术资产 prefab_id 分配方案)
//   - 1: 树 (tree)
//   - 2: 矿石 (rock_ore)
//   - 3: 草 (grass)
//   - 4: 兔窝 (rabbit_house)
//   - 5: 浆果 (berry)
//   - 6: 蘑菇 (mushroom)
//   - 7: 芦苇 (reed)
//   - 8: 燧石 (flint)
//   - 9: 骨头 (bone)
//   - 10: 木棍 (twig)
//   - 11: 灌木 (bush)  -- M2.2 范围内 11 个,超额满足 "10+"
//   - 12: 浆果丛 (berry_bush) -- 再生型,采完 60s 后重生
const (
	ResourceTree       uint32 = 1
	ResourceRockOre    uint32 = 2
	ResourceGrass      uint32 = 3
	ResourceRabbitHut  uint32 = 4
	ResourceBerry      uint32 = 5
	ResourceMushroom   uint32 = 6
	ResourceReed       uint32 = 7
	ResourceFlint      uint32 = 8
	ResourceBone       uint32 = 9
	ResourceTwig       uint32 = 10
	ResourceBush       uint32 = 11
	ResourceBerryBush  uint32 = 12
)

// AllResourceTypes 返回全部资源类型(供测试 / spawner 遍历)
func AllResourceTypes() []uint32 {
	return []uint32{
		ResourceTree, ResourceRockOre, ResourceGrass, ResourceRabbitHut,
		ResourceBerry, ResourceMushroom, ResourceReed, ResourceFlint,
		ResourceBone, ResourceTwig, ResourceBush, ResourceBerryBush,
	}
}

// ResourceTypeName 类型→可读名(供日志 / 调试)
var ResourceTypeName = map[uint32]string{
	ResourceTree:      "tree",
	ResourceRockOre:   "rock_ore",
	ResourceGrass:     "grass",
	ResourceRabbitHut: "rabbit_house",
	ResourceBerry:     "berry",
	ResourceMushroom:  "mushroom",
	ResourceReed:      "reed",
	ResourceFlint:     "flint",
	ResourceBone:      "bone",
	ResourceTwig:      "twig",
	ResourceBush:      "bush",
	ResourceBerryBush: "berry_bush",
}

// ResourceConfig 资源类型配置:HP / 采集时长 / 产出物品
type ResourceConfig struct {
	PrefID          uint32 // 资源类型 id(= prefab_id)
	MaxHP           uint32 // 总 HP;1 次采集扣 1,扣到 0 视为采完
	GatherTimeMS    uint32 // 采集一次所需毫秒(任务验收 ① 1.5s ± 100ms)
	YieldItemID     uint32 // 产出物 id(对应 M2.7 物品表)
	YieldCount      uint32 // 每次采完成产出
	RespawnAfterMS  uint32 // 采完后多少 ms 后重生(0 = 不重生)
	ReachPixels     uint32 // 玩家需在多少像素内才可采(32px 网格,默认 64)
}

// DefaultResourceConfigs 默认资源配置
//  - 树/灌木/矿:HP=3 需多次采(玩家可中断重采)
//  - 草/芦苇/燧石/骨/木棍/浆果(单颗):HP=1 一次采完
//  - 兔窝:HP=1
//  - 浆果丛:HP=3 + 60s 后重生
//  - 蘑菇:HP=1
//
//  全部资源 gather_time_ms=1500 满足验收 ① (1.5s ± 100ms)
var DefaultResourceConfigs = map[uint32]ResourceConfig{
	ResourceTree:      {PrefID: ResourceTree, MaxHP: 3, GatherTimeMS: 1500, YieldItemID: 101, YieldCount: 1, ReachPixels: 64},
	ResourceRockOre:   {PrefID: ResourceRockOre, MaxHP: 3, GatherTimeMS: 1500, YieldItemID: 102, YieldCount: 1, ReachPixels: 64},
	ResourceGrass:     {PrefID: ResourceGrass, MaxHP: 1, GatherTimeMS: 1500, YieldItemID: 103, YieldCount: 1, ReachPixels: 48},
	ResourceRabbitHut: {PrefID: ResourceRabbitHut, MaxHP: 1, GatherTimeMS: 1500, YieldItemID: 104, YieldCount: 1, ReachPixels: 64},
	ResourceBerry:     {PrefID: ResourceBerry, MaxHP: 1, GatherTimeMS: 1500, YieldItemID: 105, YieldCount: 1, ReachPixels: 48},
	ResourceMushroom:  {PrefID: ResourceMushroom, MaxHP: 1, GatherTimeMS: 1500, YieldItemID: 106, YieldCount: 1, ReachPixels: 48},
	ResourceReed:      {PrefID: ResourceReed, MaxHP: 1, GatherTimeMS: 1500, YieldItemID: 107, YieldCount: 1, ReachPixels: 48},
	ResourceFlint:     {PrefID: ResourceFlint, MaxHP: 1, GatherTimeMS: 1500, YieldItemID: 108, YieldCount: 1, ReachPixels: 48},
	ResourceBone:      {PrefID: ResourceBone, MaxHP: 1, GatherTimeMS: 1500, YieldItemID: 109, YieldCount: 1, ReachPixels: 48},
	ResourceTwig:      {PrefID: ResourceTwig, MaxHP: 1, GatherTimeMS: 1500, YieldItemID: 110, YieldCount: 1, ReachPixels: 48},
	ResourceBush:      {PrefID: ResourceBush, MaxHP: 3, GatherTimeMS: 1500, YieldItemID: 111, YieldCount: 1, ReachPixels: 64},
	ResourceBerryBush: {PrefID: ResourceBerryBush, MaxHP: 3, GatherTimeMS: 1500, YieldItemID: 112, YieldCount: 1, RespawnAfterMS: 60000, ReachPixels: 64},
}

// =====================================================================
// 资源运行时实例
// =====================================================================

// Resource 房间内的一个资源实体
type Resource struct {
	ID        uint32    // 房间内唯一 entity_id
	PrefID    uint32    // 类型 id
	PosX      float32   // 像素坐标(32px 网格)
	PosY      float32
	HP        uint32    // 当前 HP
	MaxHP     uint32    // 总 HP
	SpawnedAt time.Time // 生成时刻(用于 respawn 计算)
}

// State 用于 protobuf 序列化
func (r *Resource) State() ResourceState {
	return ResourceState{
		EntityId: r.ID,
		PrefID:   r.PrefID,
		PosX:     r.PosX,
		PosY:     r.PosY,
		HP:       r.HP,
		MaxHP:    r.MaxHP,
	}
}

// ResourceState 是 Resource 的可序列化视图(放在 common 协议层用的字段名)
// 注意:实际生成 protobuf EntityState 在 gather.go 里转换
type ResourceState struct {
	EntityId uint32
	PrefID   uint32
	PosX     float32
	PosY     float32
	HP       uint32
	MaxHP    uint32
}

// =====================================================================
// 房间世界状态(每个 Room 一个 World)
// =====================================================================

// World 房间世界状态
//   - 资源实体集(resources)
//   - 进行中的采集(gatherProgress):key=playerID,value=GatherProgress
//   - 实体 id 自增(从 100 起,前 99 留给玩家/怪物/建筑)
type World struct {
	mu sync.RWMutex

	resources     map[uint32]*Resource
	gatherInProg  map[string]*GatherProgress // playerID -> 进度
	entitySeq     uint32
}

// GatherProgress 一次采集的进行中状态
type GatherProgress struct {
	PlayerID    string
	ResourceID  uint32
	StartTimeMS uint64    // 服务器时间 ms
	DurationMS  uint32    // 来自 ResourceConfig
	ExpiresAt   time.Time // 客户端可中断;服务端的硬超时 = DurationMS
}

// NewWorld 构造
func NewWorld() *World {
	return &World{
		resources:    make(map[uint32]*Resource),
		gatherInProg: make(map[string]*GatherProgress),
	}
}

// nextEntityID 自增实体 id
func (w *World) nextEntityID() uint32 {
	w.entitySeq++
	return 100 + w.entitySeq - 1
}

// SpawnResource 在指定位置生成一个资源
//   - 不考虑遮挡,直接放;碰撞/重叠由调用方保证
func (w *World) SpawnResource(prefID uint32, x, y float32) (*Resource, bool) {
	cfg, ok := DefaultResourceConfigs[prefID]
	if !ok {
		return nil, false
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	id := w.nextEntityID()
	r := &Resource{
		ID:        id,
		PrefID:    prefID,
		PosX:      x,
		PosY:      y,
		HP:        cfg.MaxHP,
		MaxHP:     cfg.MaxHP,
		SpawnedAt: time.Now(),
	}
	w.resources[id] = r
	return r, true
}

// GetResource 取一个资源(只读)
func (w *World) GetResource(id uint32) (*Resource, bool) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	r, ok := w.resources[id]
	return r, ok
}

// ListResources 返回全部资源快照(供 WorldSnapshot 序列化)
func (w *World) ListResources() []ResourceState {
	w.mu.RLock()
	defer w.mu.RUnlock()
	out := make([]ResourceState, 0, len(w.resources))
	ids := make([]uint32, 0, len(w.resources))
	for id := range w.resources {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		out = append(out, w.resources[id].State())
	}
	return out
}

// ResourceCount 当前房间资源数量
func (w *World) ResourceCount() int {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return len(w.resources)
}

// RemoveResource 删除资源(HP=0 采完时调用)
func (w *World) RemoveResource(id uint32) {
	w.mu.Lock()
	delete(w.resources, id)
	w.mu.Unlock()
}

// SetGatherProgress 记录/覆盖一个玩家的当前采集目标
func (w *World) SetGatherProgress(p *GatherProgress) {
	w.mu.Lock()
	w.gatherInProg[p.PlayerID] = p
	w.mu.Unlock()
}

// GetGatherProgress 取一个玩家的当前采集
func (w *World) GetGatherProgress(playerID string) (*GatherProgress, bool) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	g, ok := w.gatherInProg[playerID]
	return g, ok
}

// ClearGatherProgress 清除一个玩家的采集(完成/中断时)
func (w *World) ClearGatherProgress(playerID string) {
	w.mu.Lock()
	delete(w.gatherInProg, playerID)
	w.mu.Unlock()
}

// ListInProgress 全部进行中的采集(调试/统计用)
func (w *World) ListInProgress() []*GatherProgress {
	w.mu.RLock()
	defer w.mu.RUnlock()
	out := make([]*GatherProgress, 0, len(w.gatherInProg))
	for _, g := range w.gatherInProg {
		out = append(out, g)
	}
	return out
}
