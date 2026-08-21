// Package tests: 消息大小预算测试 — 验证方案 §3.4 "同步包 < 4 KB/tick"
package tests

import (
	"fmt"
	"testing"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"
)

const SizeBudgetBytes = 4 * 1024 // 4 KB

// TestWorldDelta_EmptyDelta 验证空 WorldDelta 的"地板"大小
func TestWorldDelta_EmptyDelta(t *testing.T) {
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:   1,
		ServerTimeMs: 1,
	}
	data, err := proto.Marshal(delta)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("empty WorldDelta = %d bytes (budget %d)", len(data), SizeBudgetBytes)
	if len(data) > SizeBudgetBytes {
		t.Errorf("empty WorldDelta exceeds budget: %d > %d", len(data), SizeBudgetBytes)
	}
}

// TestWorldDelta_Full4PersonRoom 模拟 4 人满员 + 200 实体的极端 WorldDelta
func TestWorldDelta_Full4PersonRoom(t *testing.T) {
	const (
		numPlayers   = 4
		numMonsters  = 20
		numResources = 60
		numBuildings = 20
		numEvents    = 30
		numAcks      = 8
	)
	players := make([]*wildwoodv1.PlayerStatus, numPlayers)
	for i := 0; i < numPlayers; i++ {
		players[i] = &wildwoodv1.PlayerStatus{
			PlayerId:  fmt.Sprintf("p-%d", i),
			HpPct:     100,
			HungerPct: 80,
			SanityPct: 100,
			TempPct:   60,
			IsAlive:   true,
		}
	}
	entities := make([]*wildwoodv1.EntityState, 0, numMonsters+numResources+numBuildings)
	for i := 0; i < numMonsters; i++ {
		entities = append(entities, &wildwoodv1.EntityState{
			EntityId:  uint32(1000 + i),
			Kind:      wildwoodv1.EntityKind_ENTITY_KIND_MONSTER,
			Position:  &wildwoodv1.Vec2F{X: float32(i * 32), Y: float32(i * 16)},
			Facing:    0,
			Hp:        50,
			MaxHp:     50,
			PrefabId:  1,
		})
	}
	for i := 0; i < numResources; i++ {
		entities = append(entities, &wildwoodv1.EntityState{
			EntityId: uint32(2000 + i),
			Kind:     wildwoodv1.EntityKind_ENTITY_KIND_RESOURCE,
			Position: &wildwoodv1.Vec2F{X: float32(i * 8), Y: float32(i * 8)},
			Hp:       10, MaxHp: 10,
			PrefabId: 2,
		})
	}
	for i := 0; i < numBuildings; i++ {
		entities = append(entities, &wildwoodv1.EntityState{
			EntityId: uint32(3000 + i),
			Kind:     wildwoodv1.EntityKind_ENTITY_KIND_BUILDING,
			Position: &wildwoodv1.Vec2F{X: float32(i * 64), Y: 0},
			Hp:       100, MaxHp: 100,
			PrefabId: 20,
		})
	}
	events := make([]*wildwoodv1.WorldEvent, numEvents)
	for i := 0; i < numEvents; i++ {
		events[i] = &wildwoodv1.WorldEvent{
			EventId:        uint32(i),
			EventKind:      wildwoodv1.WorldEventKind_WORLD_EVENT_GATHER_DONE,
			TargetEntityId: uint32(2000 + i%numResources),
			Amount:         1,
			Position:       &wildwoodv1.Vec2F{X: 0, Y: 0},
		}
	}
	acks := make([]uint32, numAcks)
	for i := 0; i < numAcks; i++ {
		acks[i] = uint32(i + 1)
	}
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:       1234,
		ServerTimeMs:     999_999_999_999,
		AckedInputSeqs:   acks,
		EntityUpdates:    entities,
		PlayerStatus:     players,
		Events:           events,
	}
	data, err := proto.Marshal(delta)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("worst-case WorldDelta = %d bytes (budget %d, headroom %.1f%%)",
		len(data), SizeBudgetBytes, 100*(1-float64(len(data))/float64(SizeBudgetBytes)))
	if len(data) > SizeBudgetBytes {
		t.Errorf("WorldDelta exceeds budget: %d > %d", len(data), SizeBudgetBytes)
	}
}

// TestAllMessages_UnderBudget 单条消息大小自检(WorldDelta 由上两条覆盖)
func TestAllMessages_UnderBudget(t *testing.T) {
	for name, msg := range fixtureInputs() {
		data, err := proto.Marshal(msg)
		if err != nil {
			t.Errorf("%s: marshal err: %v", name, err)
			continue
		}
		t.Logf("%-25s %5d bytes", name, len(data))
		if len(data) > SizeBudgetBytes {
			t.Errorf("%s: %d > budget %d", name, len(data), SizeBudgetBytes)
		}
	}
}
