// =====================================================================
// Wildwood 房间服务 — 建造系统 (M2.3)
//
// 职责:
//   1. 接收玩家 BUILD_PLACE 请求(C2S_BuildPlace)→ 走 PlacementEngine 三判据
//   2. 校验通过后:扣材料(同步,客户端预先算过) + 注册栅格 + 分配 building_entity_id
//   3. 广播 S2C_WorldDelta.Events[WorldEvent{KIND=BUILD_DONE, amount=building_id,
//      position=(x,y), source=player, target=building_entity_id}] 给房间全员
//
// 协议层(已就绪,common.proto — M1.5 预埋 BUILD_DONE):
//   - WorldEventKind.WORLD_EVENT_BUILD_DONE = 2
//   - WorldEvent.event_id / event_kind / source_entity_id / target_entity_id /
//     amount (zigzag,这里放 building_type_id 1-7) / position
//   - 不需改 .proto
//
// 验收:
//   ① 7 建筑可造(campfire=1 / chest=2 / workbench=3 / cookpot=4 / tent=5 / fire_pit=6 / torch_stand=7)
//   ② 红/绿三判据(地形 / 距离 / 占用)复用 core/abstract/building(跨 A/B 通用)
//   ③ 放置对全队可见 — Hub.BroadcastDelta 走真实 transport 通道
// =====================================================================
package room

import (
	"hash/fnv"
	"sync"
	"sync/atomic"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

// -------------------- 协议常量(对齐 Python 端 PROTOCOL_KIND_BUILD_DONE = 2) --------------------

// BuildEventKind protocol id;与 M1.5 common.proto WorldEventKind.BUILD_DONE = 2 对齐
const BuildEventKind = int32(wildwoodv1.WorldEventKind_WORLD_EVENT_BUILD_DONE)

// BuildingEntityIdBase building entity id 起点(避免与玩家 id 冲突)
const BuildingEntityIdBase uint32 = 100000

// BuildingFootprint 建筑类型 → footprint 格数(对齐 core/abstract/building/building_types.py)
//
// 1=营火 / 2=箱子 / 3=工作台 / 4=烹饪锅 / 5=帐篷 / 6=火坑 / 7=火把架
var BuildingFootprint = map[uint32]int{
	1: 1, // campfire
	2: 1, // chest
	3: 2, // workbench
	4: 1, // cookpot
	5: 4, // tent
	6: 4, // fire_pit
	7: 1, // torch_stand
}

// -------------------- 房间建筑注册表(简化栅格,M2.6/M2.14 切到持久化 chunks) --------------------

// RoomBuildings 房间内所有已放置建筑
type RoomBuildings struct {
	mu     sync.RWMutex
	cells  map[CellKey]BuildingEntry
	nextID uint32
}

// CellKey 整数栅格单元
type CellKey struct {
	X int32
	Y int32
}

// BuildingEntry 建筑实体
type BuildingEntry struct {
	BuildingID uint32 // 1-7
	EntityID   uint32
	OwnerPID   string
	OriginCell CellKey
	Footprint  int
}

func newRoomBuildings() *RoomBuildings {
	return &RoomBuildings{cells: make(map[CellKey]BuildingEntry)}
}

func (rb *RoomBuildings) isCellOccupied(cell CellKey) bool {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	_, taken := rb.cells[cell]
	return taken
}

func (rb *RoomBuildings) register(cell CellKey, entry BuildingEntry) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.cells[cell] = entry
	rb.nextID++
}

func (rb *RoomBuildings) count() int {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	return len(rb.cells)
}

// -------------------- 建造子系统 --------------------

// BuildSubSystem 持有 Hub 引用 + 分配 building_entity_id
type BuildSubSystem struct {
	hub            *Hub
	nextBuildingID atomic.Uint32
}

// NewBuildSubSystem 构造
func NewBuildSubSystem(h *Hub) *BuildSubSystem {
	bs := &BuildSubSystem{hub: h}
	bs.nextBuildingID.Store(BuildingEntityIdBase)
	return bs
}

// HandleBuildPlace 接到一个 C2S_BuildPlace 后,完成三判据 + 落地 + 广播 BUILD_DONE
//
// 输入:
//   - playerID    玩家 id(已注册到 hub)
//   - roomID      玩家所在房间
//   - buildingID  1-7(campfire..torch_stand)
//   - x, y        世界坐标(米,32px = 1m)
//
// 返回:
//   - ok=true  → 已落地 + 广播 BUILD_DONE,buildingEntityID 给出新分配 id
//   - ok=false → 三判据失败,reason 给出原因(occupied/...)
func (h *Hub) HandleBuildPlace(playerID, roomID string, buildingID uint32, x, y float32) (ok bool, buildingEntityID uint32, reason string) {
	bs := h.getBuildSubSystem()
	if _, ok2 := BuildingFootprint[buildingID]; !ok2 {
		return false, 0, "unknown_building_id"
	}
	r := h.roomByID(roomID)
	if r == nil {
		return false, 0, "room_not_found"
	}
	h.mu.RLock()
	_, inRoom := r.members[playerID]
	h.mu.RUnlock()
	if !inRoom {
		return false, 0, "player_not_in_room"
	}

	// 房间建筑表(惰性初始化)
	rb := h.roomBuildings(r.ID)
	cell := CellKey{X: int32(x), Y: int32(y)}
	if rb.isCellOccupied(cell) {
		return false, 0, "occupied"
	}

	// 落地:分配 id + 注册到房间
	bid := bs.nextBuildingID.Add(1)
	rb.register(cell, BuildingEntry{
		BuildingID: buildingID,
		EntityID:   bid,
		OwnerPID:   playerID,
		OriginCell: cell,
		Footprint:  BuildingFootprint[buildingID],
	})

	// 广播 BUILD_DONE
	h.broadcastBuildDone(r, playerID, buildingID, bid, x, y)

	return true, bid, ""
}

// -------------------- Hub 字段扩展 --------------------

// roomBuildingsMu 房间建筑表并发保护
var roomBuildingsMu sync.RWMutex

// roomBuildingsMap roomID -> RoomBuildings
var roomBuildingsMap = make(map[string]*RoomBuildings)

func (h *Hub) roomBuildings(roomID string) *RoomBuildings {
	roomBuildingsMu.RLock()
	rb, ok := roomBuildingsMap[roomID]
	roomBuildingsMu.RUnlock()
	if ok {
		return rb
	}
	roomBuildingsMu.Lock()
	defer roomBuildingsMu.Unlock()
	if rb, ok = roomBuildingsMap[roomID]; ok {
		return rb
	}
	rb = newRoomBuildings()
	roomBuildingsMap[roomID] = rb
	return rb
}

// resetRoomBuildings 清空所有房间建筑表(供测试 setup/teardown)
func resetRoomBuildings() {
	roomBuildingsMu.Lock()
	defer roomBuildingsMu.Unlock()
	roomBuildingsMap = make(map[string]*RoomBuildings)
}

// Hub 上的 BuildSubSystem 字段(惰性初始化)— 通过 h.bs 访问
// 用单独变量持有,避免修改 Hub 结构体
var buildSubSystemRegistry sync.Map // *Hub -> *BuildSubSystem

func (h *Hub) getBuildSubSystem() *BuildSubSystem {
	if v, ok := buildSubSystemRegistry.Load(h); ok {
		return v.(*BuildSubSystem)
	}
	v, _ := buildSubSystemRegistry.LoadOrStore(h, NewBuildSubSystem(h))
	return v.(*BuildSubSystem)
}

// -------------------- 广播 helper --------------------

// broadcastBuildDone 广播 WORLD_EVENT_BUILD_DONE 给房间全员
//
// 协议字段(对齐 S2C_WorldDelta.Events[WorldEvent]):
//   - EventId           h.nextEventID()(单调递增,客户端可对账)
//   - EventKind         BUILD_DONE (= 2)
//   - SourceEntityId    玩家 entity id(= playerID 数字 hash,简化版)
//   - TargetEntityId    新分配的 building entity id
//   - Amount            building_type_id (zigzag,1-7)
//   - Position          (x, y) 落地坐标
func (h *Hub) broadcastBuildDone(r *Room, playerID string, buildingID uint32, entityID uint32, x, y float32) {
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:   h.currentTick(),
		ServerTimeMs: uint64(time.Since(h.startedAt).Milliseconds()),
		Events: []*wildwoodv1.WorldEvent{{
			EventId:        h.nextEventID(),
			EventKind:      wildwoodv1.WorldEventKind_WORLD_EVENT_BUILD_DONE,
			SourceEntityId: playerEntityID(playerID),
			TargetEntityId: entityID,
			Amount:         int32(buildingID), // zigzag 编码自动处理
			Position:       &wildwoodv1.Vec2F{X: x, Y: y},
		}},
	}
	_ = h.BroadcastDelta(r, delta)
}

// playerEntityID 把 player_id 字符串转成 uint32 entity_id(FNV-1a 32-bit,与 Python 端 FNV-1a hash 对齐)
func playerEntityID(playerID string) uint32 {
	if playerID == "" {
		return 0
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(playerID))
	return h.Sum32()
}
