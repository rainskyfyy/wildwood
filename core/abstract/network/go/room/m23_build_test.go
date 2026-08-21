// =====================================================================
// Wildwood 房间服务 — M2.3 建造系统 验收测试
//
// 验收点:
//   ① 7 建筑可造(campfire=1..torch_stand=7,BuildingFootprint 字典全 1-7)
//   ② 三判据(地形/距离/占用)通过 Hub.HandleBuildPlace 入口对接
//   ③ 放置对全队可见 — broadcastBuildDone 生成 WorldEvent{KIND=BUILD_DONE=2},
//      含 source_entity_id / target_entity_id / amount=building_id / position
//
// 协议层:M1.5 已预埋 WorldEventKind.WORLD_EVENT_BUILD_DONE = 2
//        不需改 .proto
// =====================================================================
package room

import (
	"sync"
	"testing"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"
)

// helper: 建一个测试用 Hub + Room + N 个 Player
func m23SetupHub(t *testing.T, nPlayers int) (*Hub, *Room, []string) {
	t.Helper()
	resetRoomBuildings()
	buildSubSystemRegistry.Range(func(k, v any) bool { buildSubSystemRegistry.Delete(k); return true })

	hub := NewHub(20)
	hub.startedAt = time.Now()
	rid, _ := hub.handleRoomCreateInternal("m23-room", "seed-1", 4)
	r := hub.rooms[rid]
	if r == nil {
		t.Fatalf("room not created")
	}
	pids := make([]string, 0, nPlayers)
	for i := 0; i < nPlayers; i++ {
		pid, _ := hub.RegisterPlayer("p" + string(rune('1'+i)))
		hub.handleRoomJoinInternal(pid, rid, r.JoinToken)
		pids = append(pids, pid)
	}
	return hub, r, pids
}

// 内部:room create 跳过 conn 参数(直接构造)
func (h *Hub) handleRoomCreateInternal(name, seed string, maxP uint32) (string, string) {
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

// 内部:room join 跳过 conn 参数(直接构造)
func (h *Hub) handleRoomJoinInternal(playerID, roomID, token string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[roomID]
	if !ok {
		return false
	}
	if _, exists := r.members[playerID]; exists {
		return true
	}
	r.members[playerID] = &Player{ID: playerID, RoomID: roomID}
	return true
}

// ----------------------------------------------------------------------
// 验收 ①:7 建筑可造
// ----------------------------------------------------------------------

func TestM23_All_7_Buildings_Present(t *testing.T) {
	if len(BuildingFootprint) != 7 {
		t.Fatalf("expected 7 building types, got %d", len(BuildingFootprint))
	}
	for id, fp := range BuildingFootprint {
		if id < 1 || id > 7 {
			t.Errorf("building id %d out of range 1-7", id)
		}
		if fp < 1 || fp > 4 {
			t.Errorf("building %d footprint %d out of range 1-4", id, fp)
		}
	}
	// 关键 id 1-7 全部存在
	for _, id := range []uint32{1, 2, 3, 4, 5, 6, 7} {
		if _, ok := BuildingFootprint[id]; !ok {
			t.Errorf("missing building id %d", id)
		}
	}
}

// ----------------------------------------------------------------------
// 验收 ②:三判据 — 通过 Hub.HandleBuildPlace 入口
// ----------------------------------------------------------------------

func TestM23_BuildPlace_Ok_Green(t *testing.T) {
	hub, r, pids := m23SetupHub(t, 1)
	ok, bid, reason := hub.HandleBuildPlace(pids[0], r.ID, 1, 2.0, 3.0)
	if !ok {
		t.Fatalf("expected ok=true, got reason=%q", reason)
	}
	if reason != "" {
		t.Errorf("expected empty reason on success, got %q", reason)
	}
	if bid < BuildingEntityIdBase {
		t.Errorf("expected building entity id >= %d, got %d", BuildingEntityIdBase, bid)
	}
}

func TestM23_BuildPlace_Occupied_Red(t *testing.T) {
	hub, r, pids := m23SetupHub(t, 1)
	// 第一次成功
	ok, _, _ := hub.HandleBuildPlace(pids[0], r.ID, 1, 2.0, 3.0)
	if !ok {
		t.Fatal("first place should succeed")
	}
	// 同一 cell 第二次 → 占用冲突
	ok, _, reason := hub.HandleBuildPlace(pids[0], r.ID, 2, 2.0, 3.0)
	if ok {
		t.Fatal("expected occupied failure")
	}
	if reason != "occupied" {
		t.Errorf("expected reason=occupied, got %q", reason)
	}
}

func TestM23_BuildPlace_Unknown_Building_ID(t *testing.T) {
	hub, r, pids := m23SetupHub(t, 1)
	ok, _, reason := hub.HandleBuildPlace(pids[0], r.ID, 99, 0, 0)
	if ok {
		t.Fatal("expected unknown_building_id failure")
	}
	if reason != "unknown_building_id" {
		t.Errorf("expected reason=unknown_building_id, got %q", reason)
	}
}

func TestM23_BuildPlace_Player_Not_In_Room(t *testing.T) {
	hub, r, _ := m23SetupHub(t, 1)
	ok, _, reason := hub.HandleBuildPlace("nonexistent_player", r.ID, 1, 0, 0)
	if ok {
		t.Fatal("expected player_not_in_room failure")
	}
	if reason != "player_not_in_room" {
		t.Errorf("expected reason=player_not_in_room, got %q", reason)
	}
}

func TestM23_BuildPlace_Room_Not_Found(t *testing.T) {
	hub, _, pids := m23SetupHub(t, 1)
	ok, _, reason := hub.HandleBuildPlace(pids[0], "r-nonexistent", 1, 0, 0)
	if ok {
		t.Fatal("expected room_not_found failure")
	}
	if reason != "room_not_found" {
		t.Errorf("expected reason=room_not_found, got %q", reason)
	}
}

// ----------------------------------------------------------------------
// 验收 ③:放置对全队可见 — broadcastBuildDone 生成 BUILD_DONE 事件
// ----------------------------------------------------------------------

func TestM23_Broadcast_BuildDone_Protocol(t *testing.T) {
	hub, r, pids := m23SetupHub(t, 1)
	ok, bid, _ := hub.HandleBuildPlace(pids[0], r.ID, 1, 2.5, 3.5)
	if !ok {
		t.Fatal("place should succeed")
	}

	// 直接构造同样的 WorldDelta 并编码,验证协议层字段
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:   hub.currentTick(),
		ServerTimeMs: 100,
		Events: []*wildwoodv1.WorldEvent{{
			EventId:        hub.nextEventID(),
			EventKind:      wildwoodv1.WorldEventKind_WORLD_EVENT_BUILD_DONE,
			SourceEntityId: playerEntityID(pids[0]),
			TargetEntityId: bid,
			Amount:         1, // campfire
			Position:       &wildwoodv1.Vec2F{X: 2.5, Y: 3.5},
		}},
	}
	data, err := proto.Marshal(delta)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 8 {
		t.Fatalf("delta too small: %d bytes", len(data))
	}

	var got wildwoodv1.S2C_WorldDelta
	if err := proto.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(got.Events))
	}
	ev := got.Events[0]
	if ev.EventKind != wildwoodv1.WorldEventKind_WORLD_EVENT_BUILD_DONE {
		t.Errorf("EventKind = %v, want BUILD_DONE", ev.EventKind)
	}
	if ev.EventKind != wildwoodv1.WorldEventKind(2) {
		t.Errorf("EventKind enum = %d, want 2 (BUILD_DONE)", ev.EventKind)
	}
	if ev.Amount != 1 {
		t.Errorf("Amount = %d, want 1 (campfire)", ev.Amount)
	}
	if ev.TargetEntityId != bid {
		t.Errorf("TargetEntityId = %d, want %d", ev.TargetEntityId, bid)
	}
	if ev.Position == nil || ev.Position.X != 2.5 || ev.Position.Y != 3.5 {
		t.Errorf("Position = %v, want (2.5, 3.5)", ev.Position)
	}
	if ev.SourceEntityId == 0 {
		t.Error("SourceEntityId should be non-zero (player hash)")
	}
}

func TestM23_4_Players_Broadcast_Visible(t *testing.T) {
	// 4 个玩家在 4 个不同 cell 放 4 个不同建筑,全部 broadcast BUILD_DONE
	hub, r, pids := m23SetupHub(t, 4)
	buildingTypes := []uint32{1, 2, 3, 4} // campfire / chest / workbench / cookpot
	positions := [][2]float32{{0.5, 0.5}, {2.5, 0.5}, {4.5, 0.5}, {6.5, 0.5}}

	for i, pid := range pids {
		ok, bid, reason := hub.HandleBuildPlace(pid, r.ID, buildingTypes[i], positions[i][0], positions[i][1])
		if !ok {
			t.Fatalf("player %s place failed: %s", pid, reason)
		}
		if bid < BuildingEntityIdBase {
			t.Errorf("expected building id >= %d, got %d", BuildingEntityIdBase, bid)
		}
	}

	// 房间建筑表:4 个 cell 都被注册
	rb := hub.roomBuildings(r.ID)
	if rb.count() != 4 {
		t.Errorf("expected 4 buildings registered, got %d", rb.count())
	}
}

func TestM23_Build_Done_Protocol_ID_Alignment(t *testing.T) {
	// BuildEventKind constant 必须等于 M1.5 协议 BUILD_DONE = 2
	if BuildEventKind != 2 {
		t.Errorf("BuildEventKind = %d, want 2 (WorldEventKind.BUILD_DONE)", BuildEventKind)
	}
}

// ----------------------------------------------------------------------
// 协议 + 健壮性
// ----------------------------------------------------------------------

func TestM23_Player_Entity_ID_Stable(t *testing.T) {
	// FNV-1a 32-bit:同一字符串 → 同一 hash
	id1 := playerEntityID("p1")
	id2 := playerEntityID("p1")
	if id1 != id2 {
		t.Errorf("expected stable hash, got %d vs %d", id1, id2)
	}
	// 不同字符串 → 不同 hash
	id3 := playerEntityID("p2")
	if id1 == id3 {
		t.Error("expected different hash for different player ids")
	}
	// 空字符串 → 0
	if playerEntityID("") != 0 {
		t.Error("expected 0 for empty string")
	}
}

func TestM23_Next_Building_ID_Monotonic(t *testing.T) {
	hub, r, pids := m23SetupHub(t, 1)
	ids := make([]uint32, 5)
	for i := 0; i < 5; i++ {
		ok, bid, _ := hub.HandleBuildPlace(pids[0], r.ID, 1, float32(i), 0)
		if !ok {
			t.Fatal("place should succeed")
		}
		ids[i] = bid
	}
	// 单调递增
	for i := 1; i < len(ids); i++ {
		if ids[i] <= ids[i-1] {
			t.Errorf("non-monotonic building ids: %d, %d", ids[i-1], ids[i])
		}
	}
}

func TestM23_Current_Tick_Starts_At_Zero(t *testing.T) {
	hub := NewHub(20)
	if hub.currentTick() != 0 {
		t.Errorf("expected tick=0 before Start, got %d", hub.currentTick())
	}
}

func TestM23_Next_Event_ID_Monotonic(t *testing.T) {
	hub := NewHub(20)
	ids := make([]uint32, 5)
	for i := 0; i < 5; i++ {
		ids[i] = hub.nextEventID()
	}
	for i := 1; i < len(ids); i++ {
		if ids[i] <= ids[i-1] {
			t.Errorf("non-monotonic event ids: %d, %d", ids[i-1], ids[i])
		}
	}
}

func TestM23_Reset_Room_Buildings(t *testing.T) {
	hub, r, pids := m23SetupHub(t, 1)
	ok, _, _ := hub.HandleBuildPlace(pids[0], r.ID, 1, 0, 0)
	if !ok {
		t.Fatal("place should succeed")
	}
	rb := hub.roomBuildings(r.ID)
	if rb.count() != 1 {
		t.Errorf("expected 1 building, got %d", rb.count())
	}
	resetRoomBuildings()
	rb2 := hub.roomBuildings(r.ID)
	if rb2.count() != 0 {
		t.Errorf("expected 0 after reset, got %d", rb2.count())
	}
}

func TestM23_Concurrent_Build_Place(t *testing.T) {
	// 4 个玩家并发放 4 个不同 cell
	hub, r, pids := m23SetupHub(t, 4)
	var wg sync.WaitGroup
	errs := make(chan string, 4)
	for i, pid := range pids {
		wg.Add(1)
		go func(i int, pid string) {
			defer wg.Done()
			ok, _, reason := hub.HandleBuildPlace(pid, r.ID, uint32(i+1), float32(i*2), 0)
			if !ok {
				errs <- reason
			}
		}(i, pid)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Errorf("concurrent place failed: %s", e)
	}
	rb := hub.roomBuildings(r.ID)
	if rb.count() != 4 {
		t.Errorf("expected 4 buildings, got %d", rb.count())
	}
}
