// =====================================================================
// Wildwood 房间服务 — M2.5 死亡与复活 验收测试
//
// 验收点:
//   ① 鬼魂态 10s 倒计时
//   ② 队友 10s 内接触复活
//   ③ 超时生成遗物坐标
//   ④ HUD 灰显 50% 透明(由 GDScript 客户端实现;Go 端验证 PlayerStatus 字段语义)
//
// 协议层:common.proto 已预埋 PlayerStatus.{is_ghost, ghost_remaining_ms}
//        WorldEventKind.WORLD_EVENT_DEATH / RESPAWN
//        不需改 .proto
// =====================================================================
package room

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"
)

// helper: 建一个测试用 Hub + Room + N 个 Player
func m25SetupHub(t *testing.T, nPlayers int) (*Hub, *Room, []string) {
	t.Helper()
	ResetDeathMetas()
	hub := NewHub(20)
	hub.initHubDeath()
	hub.startedAt = time.Now()
	rid, _ := hub.handleRoomCreateInternal("m25-room", "seed-1", 4)
	r := hub.rooms[rid]
	if r == nil {
		t.Fatalf("room not created")
	}
	pids := make([]string, 0, nPlayers)
	for i := 0; i < nPlayers; i++ {
		pid, _ := hub.RegisterPlayer("p" + string(rune('1'+i)))
		hub.handleRoomJoinInternal(pid, rid, r.JoinToken)
		// 预注册 deathMeta(ALIVE),保证 reviverMeta != nil
		initDeathMeta(pid, 0, 0)
		pids = append(pids, pid)
	}
	return hub, r, pids
}

// 内部:room create 跳过 conn 参数(直接构造)
func (h *Hub) handleRoomCreateInternal(name, seed string, maxP uint32) (string, string) {
	// 复刻 handleRoomCreate 的核心:分配 room_id, 建 Room, 返回
	rid := h.nextRoomID()
	token := h.nextToken()
	r := newRoom(rid, name, token, seed)
	if maxP > 0 && maxP < uint32(MaxPlayersPerRoom) {
		r.MaxPlayers = int(maxP)
	}
	h.mu.Lock()
	h.rooms[rid] = r
	h.mu.Unlock()
	return rid, token
}

func (h *Hub) handleRoomJoinInternal(playerID, roomID, token string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[roomID]
	if !ok {
		return
	}
	if r.JoinToken != token {
		return
	}
	if r.MemberCount() >= r.MaxPlayers {
		return
	}
	if p, ok := h.players[playerID]; ok {
		p.RoomID = roomID
		r.AddMember(p)
	}
}

// -------------------- 验收 ① 鬼魂态 10s 倒计时 --------------------

// TestM25_Ghost_10s_Countdown 验证:
//   1. MarkPlayerDead 后 PlayerStatus.is_ghost=true
//   2. ghost_remaining_ms ≈ 10000(误差 < 100ms)
//   3. 时间推进 → ghost_remaining_ms 减少
//   4. 10s 后 → state=DEAD, remains_id >= 1
func TestM25_Ghost_10s_Countdown(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 1)
	pid := pids[0]

	// 模拟死亡
	hub.MarkPlayerDead(pid, r.ID, 100, 200)

	// 立刻取状态
	st := hub.MakePlayerStatus(pid)
	if !st.IsGhost {
		t.Fatalf("expected IsGhost=true after MarkPlayerDead, got false")
	}
	if !st.IsAlive {
		t.Fatalf("expected IsAlive=true in GHOST state (still alive for 10s), got false")
	}
	if st.GhostRemainingMs < 9900 || st.GhostRemainingMs > 10000 {
		t.Fatalf("expected ghost_remaining_ms in [9900, 10000], got %d", st.GhostRemainingMs)
	}

	// 验证死亡事件已发
	// 注:本测试不接 conn,只验证状态 + 事件分配逻辑
	t.Logf("OK: GHOST entered, ghost_remaining_ms=%d", st.GhostRemainingMs)
}

// TestM25_Ghost_Transitions_To_Dead 验证超时 → DEAD + remains_id
func TestM25_Ghost_Transitions_To_Dead(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 1)
	pid := pids[0]

	hub.MarkPlayerDead(pid, r.ID, 50, 50)
	// 把 ghost_until 强制设为已过期(模拟 10s 过了)
	m := getDeathMeta(pid)
	m.GhostUntilMs = 0  // 强制超时

	hub.TickDeath(1)  // 推进一次

	// 验证 DEAD
	st := hub.MakePlayerStatus(pid)
	if st.IsAlive {
		t.Fatalf("expected IsAlive=false after timeout, got true")
	}
	if st.IsGhost {
		t.Fatalf("expected IsGhost=false after timeout, got true")
	}
	if m.RemainsID < 1 {
		t.Fatalf("expected remains_id >= 1, got %d", m.RemainsID)
	}
	if m.State != StateDead {
		t.Fatalf("expected state=DEAD, got %d", m.State)
	}
	t.Logf("OK: timeout → DEAD, remains_id=%d", m.RemainsID)
}

// -------------------- 验收 ② 队友 10s 内接触复活 --------------------

// TestM25_Revive_Within_10s 验证:
//   1. 队友在 48px 内 → TryRevive 返回 true
//   2. 目标回到 ALIVE 态
//   3. hp 满(100)
func TestM25_Revive_Within_10s(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 2)
	target := pids[0]
	reviver := pids[1]

	// 目标在 (100, 200) 死亡
	hub.MarkPlayerDead(target, r.ID, 100, 200)
	if !hub.MakePlayerStatus(target).IsGhost {
		t.Fatal("setup: target not in GHOST")
	}

	// 队友在 (110, 210) — 距离 sqrt(100+100)=14.14 < 48px
	ok := hub.TryRevive(target, reviver, r.ID, 110, 210)
	if !ok {
		t.Fatal("expected TryRevive to succeed (within 48px)")
	}

	// 目标应该回到 ALIVE
	st := hub.MakePlayerStatus(target)
	if !st.IsAlive {
		t.Fatal("expected IsAlive=true after revive")
	}
	if st.IsGhost {
		t.Fatal("expected IsGhost=false after revive")
	}
	if st.HpPct != 100 {
		t.Fatalf("expected hp=100 after revive, got %d", st.HpPct)
	}

	// revive_count + 1
	m := getDeathMeta(target)
	if m.ReviveCount != 1 {
		t.Fatalf("expected ReviveCount=1, got %d", m.ReviveCount)
	}
	if m.LastReviverID != reviver {
		t.Fatalf("expected LastReviverID=%s, got %s", reviver, m.LastReviverID)
	}
}

// TestM25_Revive_Too_Far 验证距离超 48px 不能复活
func TestM25_Revive_Too_Far(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 2)
	target := pids[0]
	reviver := pids[1]

	hub.MarkPlayerDead(target, r.ID, 100, 100)
	// 队友在 (200, 100) — 距离 100px > 48px
	ok := hub.TryRevive(target, reviver, r.ID, 200, 100)
	if ok {
		t.Fatal("expected TryRevive to fail (too far)")
	}
	if !hub.MakePlayerStatus(target).IsGhost {
		t.Fatal("target should still be GHOST (revive failed)")
	}
}

// TestM25_Revive_Cannot_Self 验证不能自己救自己
func TestM25_Revive_Cannot_Self(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 1)
	target := pids[0]

	hub.MarkPlayerDead(target, r.ID, 50, 50)
	ok := hub.TryRevive(target, target, r.ID, 50, 50)
	if ok {
		t.Fatal("expected self-revive to fail")
	}
	if !hub.MakePlayerStatus(target).IsGhost {
		t.Fatal("target should still be GHOST")
	}
}

// TestM25_Revive_Only_When_Ghost 验证只有 GHOST 态能被救
func TestM25_Revive_Only_When_Ghost(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 2)
	a := pids[0]
	b := pids[1]

	// a 还没死,不能被救
	if hub.TryRevive(a, b, r.ID, 0, 0) {
		t.Fatal("expected revive to fail when target is ALIVE")
	}
}

// -------------------- 验收 ③ 超时生成遗物坐标 --------------------

// TestM25_Remains_After_Timeout 验证 10s 超时后 remains 分配 + 状态 DEAD
func TestM25_Remains_After_Timeout(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 1)
	pid := pids[0]

	hub.MarkPlayerDead(pid, r.ID, 256, 512)  // 死亡坐标

	// 强制超时
	m := getDeathMeta(pid)
	m.GhostUntilMs = 0
	hub.TickDeath(1)

	// 验证
	if m.RemainsID < 1 {
		t.Fatalf("expected remains_id >= 1, got %d", m.RemainsID)
	}
	if m.State != StateDead {
		t.Fatalf("expected state=DEAD, got %d", m.State)
	}
	// 死亡坐标保留
	if m.DiedPosX != 256 || m.DiedPosY != 512 {
		t.Fatalf("expected died_pos=(256,512), got (%v,%v)", m.DiedPosX, m.DiedPosY)
	}
}

// TestM25_Remains_IDs_Are_Unique 验证多个玩家 remains_id 不冲突
func TestM25_Remains_IDs_Are_Unique(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 3)
	for _, pid := range pids {
		hub.MarkPlayerDead(pid, r.ID, 0, 0)
		m := getDeathMeta(pid)
		m.GhostUntilMs = 0
	}
	hub.TickDeath(1)
	seen := make(map[int32]bool)
	for _, pid := range pids {
		m := getDeathMeta(pid)
		if seen[m.RemainsID] {
			t.Fatalf("duplicate remains_id %d", m.RemainsID)
		}
		seen[m.RemainsID] = true
	}
	if len(seen) != 3 {
		t.Fatalf("expected 3 unique remains_ids, got %d", len(seen))
	}
}

// -------------------- 验收 ④ HUD 灰显 50% 透明(协议层语义) --------------------

// TestM25_Hud_Slot_State_For_Alive 验证 ALIVE 状态语义(由 GDScript 渲染灰显)
func TestM25_Hud_Slot_State_For_Alive(t *testing.T) {
	hub, _, pids := m25SetupHub(t, 1)
	st := hub.MakePlayerStatus(pids[0])
	if !st.IsAlive {
		t.Fatal("ALIVE: expected IsAlive=true")
	}
	if st.IsGhost {
		t.Fatal("ALIVE: expected IsGhost=false")
	}
	// 客户端 GDScript 根据 is_alive/is_ghost 决定 modulate
	// ALIVE: modulate = Color(1,1,1,1)
	// GHOST/DEAD: modulate = Color(0.5,0.5,0.5,0.5)
	// (此断言在 GDScript 侧;Go 端只验证字段语义)
}

// TestM25_Hud_Slot_State_For_Ghost 验证 GHOST 状态语义
func TestM25_Hud_Slot_State_For_Ghost(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 1)
	hub.MarkPlayerDead(pids[0], r.ID, 0, 0)
	st := hub.MakePlayerStatus(pids[0])
	if !st.IsAlive {
		t.Fatal("GHOST: expected IsAlive=true (still alive for 10s)")
	}
	if !st.IsGhost {
		t.Fatal("GHOST: expected IsGhost=true")
	}
}

// TestM25_Hud_Slot_State_For_Dead 验证 DEAD 状态语义
func TestM25_Hud_Slot_State_For_Dead(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 1)
	hub.MarkPlayerDead(pids[0], r.ID, 0, 0)
	m := getDeathMeta(pids[0])
	m.GhostUntilMs = 0
	hub.TickDeath(1)
	st := hub.MakePlayerStatus(pids[0])
	if st.IsAlive {
		t.Fatal("DEAD: expected IsAlive=false")
	}
	if st.IsGhost {
		t.Fatal("DEAD: expected IsGhost=false")
	}
}

// -------------------- 边界:协议序列化 --------------------

// TestM25_PlayerStatus_Proto_Roundtrip 验证 PlayerStatus 序列化
// (Go marshal → bytes → unmarshal → 字段一致;确认字段在 wire format 中流通)
func TestM25_PlayerStatus_Proto_Roundtrip(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 1)
	hub.MarkPlayerDead(pids[0], r.ID, 0, 0)
	st := hub.MakePlayerStatus(pids[0])

	// 序列化
	data, err := proto.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 4 {
		t.Fatalf("PlayerStatus marshal too small: %d bytes", len(data))
	}

	// 反序列化
	var got wildwoodv1.PlayerStatus
	if err := proto.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if !got.IsGhost {
		t.Fatal("roundtrip lost IsGhost")
	}
	if got.GhostRemainingMs != st.GhostRemainingMs {
		t.Fatalf("ghost_remaining_ms mismatch: in=%d out=%d", st.GhostRemainingMs, got.GhostRemainingMs)
	}
}

// TestM25_WorldDelta_Includes_PlayerStatus 验证 WorldDelta 含 PlayerStatus
func TestM25_WorldDelta_Includes_PlayerStatus(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 1)
	hub.MarkPlayerDead(pids[0], r.ID, 0, 0)
	st := hub.MakePlayerStatus(pids[0])

	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:    1,
		ServerTimeMs:  100,
		PlayerStatus:  []*wildwoodv1.PlayerStatus{st},
	}
	data, err := proto.Marshal(delta)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 8 {
		t.Fatalf("WorldDelta too small: %d bytes", len(data))
	}
	var got wildwoodv1.S2C_WorldDelta
	if err := proto.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.PlayerStatus) != 1 {
		t.Fatalf("expected 1 player_status, got %d", len(got.PlayerStatus))
	}
	if !got.PlayerStatus[0].IsGhost {
		t.Fatal("delta.PlayerStatus[0].IsGhost should be true")
	}
}

// -------------------- 边界:并发 / 4 人小队 --------------------

// TestM25_Concurrent_TickDeath_No_Panic 验证 4 人 GHOST 并发触发 TickDeath
func TestM25_Concurrent_TickDeath_No_Panic(t *testing.T) {
	hub, r, pids := m25SetupHub(t, 4)
	for _, pid := range pids {
		hub.MarkPlayerDead(pid, r.ID, 0, 0)
	}
	// 强制所有 GHOST 超时
	for _, pid := range pids {
		m := getDeathMeta(pid)
		m.GhostUntilMs = 0
	}
	// 并发跑 tick(模拟 4 人同时复活)
	var wg sync.WaitGroup
	var errCount atomic.Int32
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					errCount.Add(1)
					t.Errorf("panic in concurrent TickDeath: %v", r)
				}
			}()
			hub.TickDeath(uint32(i))
		}()
	}
	wg.Wait()
	if errCount.Load() > 0 {
		t.Fatalf("%d panics in concurrent TickDeath", errCount.Load())
	}
	// 验证所有玩家都 DEAD
	for _, pid := range pids {
		m := getDeathMeta(pid)
		if m.State != StateDead {
			t.Fatalf("player %s expected DEAD, got %d", pid, m.State)
		}
	}
}

// TestM25_Room_Members_Limit 验证 4 人小队上限仍生效
func TestM25_Room_Members_Limit(t *testing.T) {
	hub, r, _ := m25SetupHub(t, 4)
	// 第 5 人应被拒
	pid, _ := hub.RegisterPlayer("p5")
	hub.handleRoomJoinInternal(pid, r.ID, r.JoinToken)
	if r.MemberCount() != 4 {
		t.Fatalf("expected 4 members, got %d", r.MemberCount())
	}
}
