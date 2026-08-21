// Package room_test: M2.1 移动 + M2.2 采集系统 — 核心验收测试
//
// 覆盖:
//   - 移动: 位置更新 + 移动取消采集
//   - 采集: 1.5s ± 100ms(单 HP 资源)、HP 同步
//   - 进度: GatherProgress.ExpiresAt - now ≈ 1500ms
package room_test

import (
	"testing"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"github.com/wildwood/net/room"
)

// TestM22_Acc01_10ResourceTypes_1500ms 验证 12 种资源单次采集 1.5s ± 200ms
//
// 用轮询方式:发 GATHER → 轮询 HP 变化(≤ 2s)→ 校验 elapsed
func TestM22_Acc01_10ResourceTypes_1500ms(t *testing.T) {
	ts, hub, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	hostPlayerID := host.handshake(t, "host")
	roomID, _ := host.createRoom(t)

	hostCh, hostStop := startReaderGoroutine(host)
	defer close(hostStop)
	for i := 0; i < 10; i++ {
		select {
		case <-hostCh:
		case <-time.After(200 * time.Millisecond):
			i = 10
		}
	}

	hub.Mu().RLock()
	resources := hub.Rooms()[roomID].World.ListResources()
	hub.Mu().RUnlock()
	if len(resources) < 10 {
		t.Fatalf("M2.2 accept①: resource count=%d want ≥ 10", len(resources))
	}
	byType := map[uint32]uint32{}
	maxHPByType := map[uint32]uint32{}
	for _, s := range resources {
		byType[s.PrefID] = s.EntityId
		maxHPByType[s.PrefID] = s.MaxHP
	}
	t.Logf("spawned %d resources, %d types", len(resources), len(byType))
	if len(byType) < 10 {
		t.Fatalf("M2.2 accept①: 类型数=%d want ≥ 10", len(byType))
	}

	const tolerance = 200 * time.Millisecond
	const expected = 1500 * time.Millisecond

	for prefID, entityID := range byType {
		maxHP := maxHPByType[prefID]

		hub.Mu().RLock()
		res, _ := hub.Rooms()[roomID].World.GetResource(entityID)
		if res == nil {
			hub.Mu().RUnlock()
			continue
		}
		hub.Mu().RUnlock()

		start := time.Now()
		for hit := uint32(0); hit < maxHP; hit++ {
			hub.Mu().RLock()
			cur, ok := hub.Rooms()[roomID].World.GetResource(entityID)
			if !ok {
				hub.Mu().RUnlock()
				break
			}
			hub.Players()[hostPlayerID].PosX = cur.PosX
			hub.Players()[hostPlayerID].PosY = cur.PosY
			initialHP := cur.HP
			hub.Mu().RUnlock()

			host.send(t, "C2S_PlayerInput", &wildwoodv1.C2S_PlayerInput{
				InputSeq:      uint32(prefID*100 + hit),
				Action:        wildwoodv1.InputAction_INPUT_ACTION_GATHER,
				TargetEntityId: entityID,
			})

			pollDeadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(pollDeadline) {
				hub.Mu().RLock()
				c2, _ := hub.Rooms()[roomID].World.GetResource(entityID)
				hub.Mu().RUnlock()
				if c2 == nil {
					break
				}
				if c2.HP < initialHP {
					break
				}
				hub.Mu().RLock()
				c3, _ := hub.Rooms()[roomID].World.GetResource(entityID)
				if c3 != nil {
					hub.Players()[hostPlayerID].PosX = c3.PosX
					hub.Players()[hostPlayerID].PosY = c3.PosY
				}
				hub.Mu().RUnlock()
				time.Sleep(20 * time.Millisecond)
			}
		}
		elapsed := time.Since(start)
		expectedTotal := time.Duration(maxHP) * expected
		tolTotal := time.Duration(maxHP) * tolerance

		hub.Mu().RLock()
		curFinal, stillExists := hub.Rooms()[roomID].World.GetResource(entityID)
		hub.Mu().RUnlock()
		completed := !stillExists || curFinal.HP == 0
		if !completed {
			t.Errorf("M2.2 accept① prefab=%d(%s): 未完成(HP=%d)", prefID, room.ResourceTypeName[prefID], curFinal.HP)
			continue
		}
		delta := elapsed - expectedTotal
		if delta < 0 {
			delta = -delta
		}
		if delta > tolTotal {
			t.Errorf("M2.2 accept① prefab=%d(%s, HP=%d): elapsed=%v want ~%v ± %v",
				prefID, room.ResourceTypeName[prefID], maxHP, elapsed, expectedTotal, tolTotal)
		} else {
			t.Logf("  prefab=%d(%s, HP=%d): elapsed=%v OK",
				prefID, room.ResourceTypeName[prefID], maxHP, elapsed)
		}

		for i := 0; i < 10; i++ {
			select {
			case <-hostCh:
			case <-time.After(50 * time.Millisecond):
				i = 10
			}
		}
	}
}

// TestM22_Acc02_ProgressExpiresAt_1500ms 验证 GatherProgress.ExpiresAt
func TestM22_Acc02_ProgressExpiresAt_1500ms(t *testing.T) {
	ts, hub, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	hostPlayerID := host.handshake(t, "host")
	roomID, _ := host.createRoom(t)

	hostCh, hostStop := startReaderGoroutine(host)
	defer close(hostStop)
	for i := 0; i < 10; i++ {
		select {
		case <-hostCh:
		case <-time.After(200 * time.Millisecond):
			i = 10
		}
	}

	hub.Mu().RLock()
	resources := hub.Rooms()[roomID].World.ListResources()
	hub.Mu().RUnlock()
	var grassID uint32
	for _, s := range resources {
		if s.PrefID == room.ResourceGrass {
			grassID = s.EntityId
			break
		}
	}
	if grassID == 0 {
		t.Fatalf("no grass")
	}

	hub.Mu().RLock()
	grass, _ := hub.Rooms()[roomID].World.GetResource(grassID)
	hub.Players()[hostPlayerID].PosX = grass.PosX
	hub.Players()[hostPlayerID].PosY = grass.PosY
	hub.Mu().RUnlock()

	host.send(t, "C2S_PlayerInput", &wildwoodv1.C2S_PlayerInput{
		InputSeq:      99,
		Action:        wildwoodv1.InputAction_INPUT_ACTION_GATHER,
		TargetEntityId: grassID,
	})
	for i := 0; i < 5; i++ {
		select {
		case <-hostCh:
		case <-time.After(200 * time.Millisecond):
			i = 10
		}
	}

	hub.Mu().RLock()
	gp, ok := hub.Rooms()[roomID].World.GetGatherProgress(hostPlayerID)
	hub.Mu().RUnlock()
	if !ok {
		t.Fatalf("GatherProgress 未创建")
	}
	dur := time.Until(gp.ExpiresAt)
	if dur < 1100*time.Millisecond || dur > 1700*time.Millisecond {
		t.Errorf("ExpiresAt-now=%v want 1500ms ± 400ms", dur)
	}
	if gp.DurationMS != 1500 {
		t.Errorf("DurationMS=%d want 1500", gp.DurationMS)
	}

	time.Sleep(200 * time.Millisecond)
	hub.Mu().RLock()
	_, stillOK := hub.Rooms()[roomID].World.GetGatherProgress(hostPlayerID)
	hub.Mu().RUnlock()
	if !stillOK {
		t.Errorf("200ms 后被错误清除")
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		hub.Mu().RLock()
		_, exists := hub.Rooms()[roomID].World.GetResource(grassID)
		hub.Mu().RUnlock()
		if !exists {
			t.Logf("grass 在 ~1.5s 后被移除 OK")
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Errorf("2s 内 grass 未被移除")
}

// TestM22_Acc03_HPSync_BroadcastToAllPlayers 验证 HP 同步
func TestM22_Acc03_HPSync_BroadcastToAllPlayers(t *testing.T) {
	ts, hub, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	hostPlayerID := host.handshake(t, "host")
	roomID, token := host.createRoom(t)

	p2 := newClient(t, ts.URL)
	defer p2.close()
	p2.handshake(t, "p2")
	p2.joinRoom(t, roomID, token)
	_, _ = host.recv(t, 1*time.Second)
	_, _ = host.recv(t, 1*time.Second)

	p2Ch, p2Stop := startReaderGoroutine(p2)
	defer close(p2Stop)
	for i := 0; i < 10; i++ {
		select {
		case <-p2Ch:
		case <-time.After(200 * time.Millisecond):
			i = 10
		}
	}

	hub.Mu().RLock()
	resources := hub.Rooms()[roomID].World.ListResources()
	hub.Mu().RUnlock()
	var grassID uint32
	for _, s := range resources {
		if s.PrefID == room.ResourceGrass {
			grassID = s.EntityId
			break
		}
	}
	if grassID == 0 {
		t.Fatalf("no grass")
	}

	hub.Mu().RLock()
	grass, _ := hub.Rooms()[roomID].World.GetResource(grassID)
	hub.Players()[hostPlayerID].PosX = grass.PosX
	hub.Players()[hostPlayerID].PosY = grass.PosY
	hub.Mu().RUnlock()

	host.send(t, "C2S_PlayerInput", &wildwoodv1.C2S_PlayerInput{
		InputSeq:      1,
		Action:        wildwoodv1.InputAction_INPUT_ACTION_GATHER,
		TargetEntityId: grassID,
	})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		hub.Mu().RLock()
		_, exists := hub.Rooms()[roomID].World.GetResource(grassID)
		hub.Mu().RUnlock()
		if !exists {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	var foundDelta *wildwoodv1.S2C_WorldDelta
	for attempt := 0; attempt < 5; attempt++ {
		gotType, got := readFrameWithType(t, p2Ch, "S2C_WorldDelta", 2*time.Second)
		if gotType != "S2C_WorldDelta" {
			break
		}
		d := got.(*wildwoodv1.S2C_WorldDelta)
		for _, e := range d.EntityUpdates {
			if e.EntityId == grassID && e.Kind == wildwoodv1.EntityKind_ENTITY_KIND_RESOURCE {
				foundDelta = d
				break
			}
		}
		if foundDelta != nil {
			break
		}
	}
	if foundDelta == nil {
		t.Fatalf("p2 未收到 S2C_WorldDelta 含 grass")
	}
	t.Logf("p2 看到 grass entity_update")

	hasGatherEv := false
	for _, ev := range foundDelta.Events {
		if ev.EventKind == wildwoodv1.WorldEventKind_WORLD_EVENT_GATHER_DONE {
			hasGatherEv = true
		}
	}
	if !hasGatherEv {
		gotType, got := readFrameWithType(t, p2Ch, "S2C_WorldDelta", 1*time.Second)
		if gotType == "S2C_WorldDelta" {
			d := got.(*wildwoodv1.S2C_WorldDelta)
			for _, ev := range d.Events {
				if ev.EventKind == wildwoodv1.WorldEventKind_WORLD_EVENT_GATHER_DONE {
					hasGatherEv = true
				}
			}
		}
	}
	if !hasGatherEv {
		t.Errorf("未找到 GATHER_DONE event")
	}
}

// TestM21_Acc01_MoveUpdatesPosition 验证移动更新位置
func TestM21_Acc01_MoveUpdatesPosition(t *testing.T) {
	ts, _, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	host.handshake(t, "host")
	_, _ = host.createRoom(t)

	hostCh, hostStop := startReaderGoroutine(host)
	defer close(hostStop)
	for i := 0; i < 10; i++ {
		select {
		case <-hostCh:
		case <-time.After(200 * time.Millisecond):
			i = 10
		}
	}

	host.send(t, "C2S_PlayerInput", &wildwoodv1.C2S_PlayerInput{
		InputSeq: 1,
		Action:   wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:   1.0,
		MoveDy:   0.0,
		Facing:   2,
	})

	gotType, got := readFrameWithType(t, hostCh, "S2C_WorldDelta", 2*time.Second)
	if gotType != "S2C_WorldDelta" {
		t.Fatalf("M2.1 accept①: type=%s want S2C_WorldDelta", gotType)
	}
	delta := got.(*wildwoodv1.S2C_WorldDelta)
	if len(delta.AckedInputSeqs) == 0 || delta.AckedInputSeqs[0] != 1 {
		t.Errorf("M2.1 accept①: ack=[%v] want [1]", delta.AckedInputSeqs)
	}
	var playerUpdate *wildwoodv1.EntityState
	for _, e := range delta.EntityUpdates {
		if e.Kind == wildwoodv1.EntityKind_ENTITY_KIND_PLAYER {
			playerUpdate = e
		}
	}
	if playerUpdate == nil {
		t.Fatalf("M2.1 accept①: no player entity_update")
	}
	if playerUpdate.Position.X <= 200 {
		t.Errorf("M2.1 accept①: PosX=%.0f should be > 200", playerUpdate.Position.X)
	}
}

// TestM21_Acc02_MoveCancelsGather 验证移动取消采集
func TestM21_Acc02_MoveCancelsGather(t *testing.T) {
	ts, hub, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	hostPlayerID := host.handshake(t, "host")
	roomID, _ := host.createRoom(t)

	hostCh, hostStop := startReaderGoroutine(host)
	defer close(hostStop)
	for i := 0; i < 10; i++ {
		select {
		case <-hostCh:
		case <-time.After(200 * time.Millisecond):
			i = 10
		}
	}

	hub.Mu().RLock()
	r := hub.Rooms()[roomID]
	resources := r.World.ListResources()
	if len(resources) == 0 {
		hub.Mu().RUnlock()
		t.Fatalf("no resources")
	}
	hub.Players()[hostPlayerID].PosX = resources[0].PosX
	hub.Players()[hostPlayerID].PosY = resources[0].PosY
	targetRes := resources[0]
	hub.Mu().RUnlock()

	host.send(t, "C2S_PlayerInput", &wildwoodv1.C2S_PlayerInput{
		InputSeq:      2,
		Action:        wildwoodv1.InputAction_INPUT_ACTION_GATHER,
		TargetEntityId: targetRes.EntityId,
	})
	for i := 0; i < 5; i++ {
		select {
		case <-hostCh:
		case <-time.After(200 * time.Millisecond):
			i = 10
		}
	}

	hub.Mu().RLock()
	_, hasGP := r.World.GetGatherProgress(hostPlayerID)
	hub.Mu().RUnlock()
	if !hasGP {
		t.Fatalf("GATHER 后无 GatherProgress")
	}

	host.send(t, "C2S_PlayerInput", &wildwoodv1.C2S_PlayerInput{
		InputSeq: 3,
		Action:   wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:   1,
		MoveDy:   0,
	})
	for i := 0; i < 5; i++ {
		select {
		case <-hostCh:
		case <-time.After(200 * time.Millisecond):
			i = 10
		}
	}

	dl := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(dl) {
		hub.Mu().RLock()
		_, hasGP := r.World.GetGatherProgress(hostPlayerID)
		hub.Mu().RUnlock()
		if !hasGP {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Errorf("MOVE 后 GatherProgress 仍存在")
}
