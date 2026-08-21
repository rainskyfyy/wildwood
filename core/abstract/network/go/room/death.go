// =====================================================================
// Wildwood 房间服务 — 死亡与复活 (M2.5)
//
// 职责:
//   1. 跟踪每个玩家的状态(ALIVE / GHOST / DEAD)
//   2. 鬼魂 10s 倒计时:Hub.TickDeath 每次推进,到 0 → DEAD + 遗物
//   3. 队友接触复活:Hub.TryRevive 距离 ≤ 48px → ALIVE
//   4. 遗物坐标广播:超时时 WorldDelta.player_status 标 DEAD + remains_id
//
// 协议层(已就绪,common.proto):
//   - PlayerState.is_alive
//   - PlayerStatus.{is_alive, is_ghost, ghost_remaining_ms}
//   - WorldEventKind.WORLD_EVENT_DEATH / WORLD_EVENT_RESPAWN
//   - InputAction.INPUT_ACTION_RESPAWN (C2S_PlayerInput.action)
//   不需改 .proto, M2.5 在现有字段里流通
//
// 验收:
//   ① 鬼魂态 10s 倒计时 → PlayerStatus.is_ghost=true, ghost_remaining_ms 10000→0
//   ② 队友 10s 内接触复活 → GHOST 玩家收到 RESPAWN + 距离 ≤ 48px → ALIVE
//   ③ 超时生成遗物坐标 → DEAD + remains_id 分配 + WorldDelta 广播
//   ④ HUD 灰显 50% 透明 → 客户端 GDScript 侧(本文件无关)
// =====================================================================
package room

import (
	"sync"
	"sync/atomic"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

// -------------------- 状态常量(对齐 GDScript 端) --------------------

const (
	StateAlive int32 = 0
	StateGhost int32 = 1
	StateDead  int32 = 2
)

// 鬼魂态总窗口 10s(方案 §2.1 / §5.4)
const GhostWindowMs int64 = 10_000

// 队友接触复活的距离阈值(像素,32px = 1 网格)
const ReviveTouchPx float32 = 48.0

// 遗物存续时间 5 分钟
const RemainsLifetimeMs int64 = 5 * 60_000

// HP 桥接常量(对齐 death_constants.gd)
const (
	DefaultMaxHP   = 100
	ReviveInvulnMs = 1_500
)

// -------------------- 死亡子系统 --------------------

// DeathSubSystem 持有一个 Hub 引用 + 分配 remains_id
type DeathSubSystem struct {
	hub       *Hub
	nextRemID atomic.Uint32
}

// NewDeathSubSystem 创建子系统
func NewDeathSubSystem(h *Hub) *DeathSubSystem {
	return &DeathSubSystem{hub: h}
}

// -------------------- Player 扩展字段 --------------------

// deathMeta 是 Player 的扩展字段(全局 map 形式挂,避免改 Player 结构体)
type deathMeta struct {
	State         int32
	HP            int
	MaxHP         int
	GhostUntilMs  int64
	InvulnUntilMs int64
	DiedAtMs      int64
	DiedPosX      float32
	DiedPosY      float32
	SpawnX        float32
	SpawnY        float32
	RemainsID     int32
	ReviveCount   int
	LastReviverID string
}

var (
	deathMetasMu sync.RWMutex
	deathMetas   = make(map[string]*deathMeta)
)

func initDeathMeta(playerID string, spawnX, spawnY float32) *deathMeta {
	deathMetasMu.Lock()
	defer deathMetasMu.Unlock()
	if m, ok := deathMetas[playerID]; ok {
		return m
	}
	m := &deathMeta{
		State:     StateAlive,
		HP:        DefaultMaxHP,
		MaxHP:     DefaultMaxHP,
		SpawnX:    spawnX,
		SpawnY:    spawnY,
		RemainsID: -1,
	}
	deathMetas[playerID] = m
	return m
}

func getDeathMeta(playerID string) *deathMeta {
	deathMetasMu.RLock()
	defer deathMetasMu.RUnlock()
	return deathMetas[playerID]
}

func clearDeathMeta(playerID string) {
	deathMetasMu.Lock()
	delete(deathMetas, playerID)
	deathMetasMu.Unlock()
}

// ResetDeathMetas 清空全局(仅测试用)
func ResetDeathMetas() {
	deathMetasMu.Lock()
	deathMetas = make(map[string]*deathMeta)
	deathMetasMu.Unlock()
}

// -------------------- 公共 API --------------------

// MarkPlayerDead 外部把玩家置为 GHOST 态(由 M2.4 真实 HP 系统调,或测试调)
//
// 该函数:
//   1. 设 state=GHOST, 记录 died_at_ms + died_pos
//   2. 记 ghost_until_ms = now + GhostWindowMs
//   3. 广播 S2C_WorldDelta: 玩家 status.is_ghost=true, ghost_remaining_ms=10000
//   4. 广播 S2C_WorldEvent: WORLD_EVENT_DEATH
//
// 重复调用安全(已经在 GHOST / DEAD 时不重复)
func (h *Hub) MarkPlayerDead(playerID, roomID string, posX, posY float32) {
	m := initDeathMeta(playerID, 0, 0)
	if m.State != StateAlive {
		return
	}
	nowMs := h.serverTimeMs()
	m.State = StateGhost
	m.HP = 0
	m.DiedAtMs = nowMs
	m.GhostUntilMs = nowMs + GhostWindowMs
	m.InvulnUntilMs = 0
	m.DiedPosX = posX
	m.DiedPosY = posY
	m.RemainsID = -1

	r := h.rooms[roomID]
	if r == nil {
		return
	}
	h.broadcastStatus(r, playerID)
	h.broadcastDeathEvent(r, m.DiedPosX, m.DiedPosY, nowMs)
}

// TryRevive 队友接触复活(INPUT_ACTION_RESPAWN 路径)
//
// 规则:
//   1. 目标必须在 GHOST 态
//   2. reviver 必须 ALIVE
//   3. 距离 ≤ ReviveTouchPx (48px)
//   4. reviver 不能是目标自己
//   5. 成功: 目标 state=ALIVE, HP=MaxHP, invuln 1.5s, 广播 S2C_WorldDelta + WorldEvent.RESPAWN
func (h *Hub) TryRevive(targetID, reviverID, roomID string, reviverX, reviverY float32) bool {
	if targetID == reviverID {
		return false
	}
	m := getDeathMeta(targetID)
	if m == nil || m.State != StateGhost {
		return false
	}
	reviverMeta := getDeathMeta(reviverID)
	if reviverMeta == nil || reviverMeta.State != StateAlive {
		return false
	}
	dx := reviverX - m.DiedPosX
	dy := reviverY - m.DiedPosY
	if dx*dx+dy*dy > ReviveTouchPx*ReviveTouchPx {
		return false
	}

	nowMs := h.serverTimeMs()
	m.State = StateAlive
	m.HP = m.MaxHP
	m.InvulnUntilMs = nowMs + ReviveInvulnMs
	m.GhostUntilMs = 0
	m.ReviveCount++
	m.LastReviverID = reviverID

	r := h.rooms[roomID]
	if r == nil {
		return false
	}
	h.broadcastStatus(r, targetID)
	h.broadcastRespawnEvent(r, m.DiedPosX, m.DiedPosY, nowMs)
	return true
}

// TickDeath 推进鬼魂倒计时(由 Hub.tickLoop 调, 频率 20Hz)
//
// 行为:
//   - 任何 GHOST 玩家, server_time_ms >= ghost_until_ms → 触发 MakeRemains
//   - MakeRemains 设 state=DEAD, 分配 remains_id, 广播
func (h *Hub) TickDeath(_ uint32) {
	nowMs := h.serverTimeMs()
	deathMetasMu.RLock()
	pids := make([]string, 0)
	for pid, m := range deathMetas {
		if m.State == StateGhost && nowMs >= m.GhostUntilMs {
			pids = append(pids, pid)
		}
	}
	deathMetasMu.RUnlock()
	for _, pid := range pids {
		roomID := h.roomOf(pid)
		if roomID == "" {
			continue
		}
		h.makeRemains(pid, roomID, nowMs)
	}
}

// makeRemains 内部: GHOST 超时 → DEAD + 遗物广播
func (h *Hub) makeRemains(playerID, roomID string, nowMs int64) {
	m := getDeathMeta(playerID)
	if m == nil || m.State != StateGhost {
		return
	}
	r := h.rooms[roomID]
	if r == nil {
		return
	}
	rid := int32(h.ds.nextRemID.Add(1))
	m.State = StateDead
	m.RemainsID = rid
	h.broadcastStatus(r, playerID)
	h.broadcastDeathEvent(r, m.DiedPosX, m.DiedPosY, nowMs)
}

// -------------------- 状态快照(协议层序列化) --------------------

// MakePlayerStatus 构造 PlayerStatus(对齐 common.proto)
//
// 字段语义:
//   - IsAlive: ALIVE=true, GHOST=true(还活着), DEAD=false
//   - IsGhost: 仅 GHOST=true
//   - GhostRemainingMs: GHOST 时剩余 ms, 其它 0
func (h *Hub) MakePlayerStatus(playerID string) *wildwoodv1.PlayerStatus {
	return h.makePlayerStatus(playerID)
}

func (h *Hub) makePlayerStatus(playerID string) *wildwoodv1.PlayerStatus {
	m := getDeathMeta(playerID)
	if m == nil {
		return &wildwoodv1.PlayerStatus{
			PlayerId: playerID,
			HpPct:    100,
			IsAlive:  true,
		}
	}
	var hpPct uint32
	if m.MaxHP > 0 {
		hpPct = uint32(m.HP * 100 / m.MaxHP)
	}
	var ghostMs uint32
	if m.State == StateGhost {
		now := h.serverTimeMs()
		if m.GhostUntilMs > now {
			ghostMs = uint32(m.GhostUntilMs - now)
		}
	}
	return &wildwoodv1.PlayerStatus{
		PlayerId:         playerID,
		HpPct:            hpPct,
		HungerPct:        100,
		SanityPct:        100,
		TempPct:          100,
		IsAlive:          m.State != StateDead,
		IsGhost:          m.State == StateGhost,
		GhostRemainingMs: ghostMs,
	}
}

// -------------------- 内部辅助 --------------------

func (h *Hub) roomOf(playerID string) string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if p, ok := h.players[playerID]; ok {
		return p.RoomID
	}
	return ""
}

// serverTimeMs 相对 server start 的毫秒(对齐 PlayerStatus.ghost_remaining_ms 协议)
func (h *Hub) serverTimeMs() int64 {
	if h.startedAt.IsZero() {
		return time.Now().UnixMilli()
	}
	return time.Since(h.startedAt).Milliseconds()
}

// -------------------- 广播 helper --------------------

// broadcastStatus 广播某个玩家最新 PlayerStatus 给房间全员
func (h *Hub) broadcastStatus(r *Room, playerID string) {
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:   h.currentTick(),
		ServerTimeMs: uint64(h.serverTimeMs()),
		PlayerStatus: []*wildwoodv1.PlayerStatus{h.makePlayerStatus(playerID)},
	}
	h.broadcastDelta(r, delta)
}

// broadcastDeathEvent 广播 WORLD_EVENT_DEATH
func (h *Hub) broadcastDeathEvent(r *Room, x, y float32, nowMs int64) {
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:   h.currentTick(),
		ServerTimeMs: uint64(nowMs),
		Events: []*wildwoodv1.WorldEvent{{
			EventId:   h.nextEventID(),
			EventKind: wildwoodv1.WorldEventKind_WORLD_EVENT_DEATH,
			Position:  &wildwoodv1.Vec2F{X: x, Y: y},
		}},
	}
	h.broadcastDelta(r, delta)
}

// broadcastRespawnEvent 广播 WORLD_EVENT_RESPAWN
func (h *Hub) broadcastRespawnEvent(r *Room, x, y float32, nowMs int64) {
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:   h.currentTick(),
		ServerTimeMs: uint64(nowMs),
		Events: []*wildwoodv1.WorldEvent{{
			EventId:   h.nextEventID(),
			EventKind: wildwoodv1.WorldEventKind_WORLD_EVENT_RESPAWN,
			Position:  &wildwoodv1.Vec2F{X: x, Y: y},
		}},
	}
	h.broadcastDelta(r, delta)
}

// broadcastDelta 内部: 调 hub.BroadcastDelta 走真实 transport 通道
func (h *Hub) broadcastDelta(r *Room, delta *wildwoodv1.S2C_WorldDelta) {
	_ = h.BroadcastDelta(r, delta)
}
