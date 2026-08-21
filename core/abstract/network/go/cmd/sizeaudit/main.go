// Package main: 命令行工具,打印每条消息的 wire 字节数与 4KB 预算对比
// 用法: go run ./cmd/sizeaudit
package main

import (
	"fmt"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"
)

const Budget = 4 * 1024

func main() {
	now := uint64(time.Now().UnixMilli())
	rows := []struct {
		name string
		msg  proto.Message
	}{
		{"C2S_Handshake", &wildwoodv1.C2S_Handshake{ClientVersion: "0.1.0", PlayerName: "Alice", AuthToken: "tok-abc"}},
		{"C2S_Heartbeat", &wildwoodv1.C2S_Heartbeat{ClientTimeMs: now, PingSeq: 1}},
		{"C2S_Disconnect", &wildwoodv1.C2S_Disconnect{Reason: "user_quit"}},
		{"C2S_RoomCreate", &wildwoodv1.C2S_RoomCreate{RoomName: "Room", WorldSeed: "42", MaxPlayers: 4}},
		{"C2S_RoomJoin", &wildwoodv1.C2S_RoomJoin{RoomId: "r-00001", JoinToken: "t-00001"}},
		{"C2S_RoomLeave", &wildwoodv1.C2S_RoomLeave{RoomId: "r-00001"}},
		{"C2S_RoomList", &wildwoodv1.C2S_RoomList{Page: 0, PageSize: 16}},
		{"C2S_PlayerInput", &wildwoodv1.C2S_PlayerInput{InputSeq: 1, Action: wildwoodv1.InputAction_INPUT_ACTION_MOVE, MoveDx: 0.5, MoveDy: -0.3, Facing: 1.57, ClientTimeMs: now}},
		{"C2S_ChatMsg", &wildwoodv1.C2S_ChatMsg{Channel: wildwoodv1.ChatChannel_CHAT_CHANNEL_TEAM, Text: "今晚开会", ClientTimeMs: now}},
		{"S2C_HandshakeAck", &wildwoodv1.S2C_HandshakeAck{ServerVersion: "0.1.0", PlayerId: "p-001", SessionToken: "session-xyz", ServerTickRate: 20, MaxRoomPlayers: 4}},
		{"S2C_HeartbeatAck", &wildwoodv1.S2C_HeartbeatAck{ClientTimeMs: now, PingSeq: 1, ServerTimeMs: now + 30}},
		{"S2C_RoomCreated", &wildwoodv1.S2C_RoomCreated{RoomId: "r-00001", JoinToken: "t-00001", MaxPlayers: 4}},
		{"S2C_RoomLeft", &wildwoodv1.S2C_RoomLeft{RoomId: "r-00001", Reason: "user_quit"}},
		{"S2C_PlayerJoined", &wildwoodv1.S2C_PlayerJoined{RoomId: "r-00001", Player: &wildwoodv1.PlayerState{PlayerId: "p-001", PlayerName: "Alice", Position: &wildwoodv1.Vec2F{X: 0, Y: 0}, ColorRgb: 0xc89058, IsAlive: true}}},
		{"S2C_PlayerLeft", &wildwoodv1.S2C_PlayerLeft{RoomId: "r-00001", PlayerId: "p-001", Reason: "leave"}},
		{"S2C_RoomState", &wildwoodv1.S2C_RoomState{RoomId: "r-00001", CurrentPlayers: 2, MaxPlayers: 4, IsOpen: true}},
		{"S2C_RoomList", &wildwoodv1.S2C_RoomList{Rooms: []*wildwoodv1.S2C_RoomState{{RoomId: "r-00001", CurrentPlayers: 1, MaxPlayers: 4, IsOpen: true}}, Total: 1}},
		{"S2C_ChatBroadcast", &wildwoodv1.S2C_ChatBroadcast{Channel: wildwoodv1.ChatChannel_CHAT_CHANNEL_TEAM, SenderId: "p-001", SenderName: "Alice", Text: "hi", ServerTimeMs: now}},
		{"S2C_Error", &wildwoodv1.S2C_Error{Code: wildwoodv1.RoomErrorCode_ROOM_ERROR_FULL, Message: "room is full", Context: "r-00001"}},
	}
	fmt.Println("==== Wildwood M1.5 消息大小自检 (预算 4 KB / tick) ====")
	fmt.Printf("%-25s %8s  %s\n", "MESSAGE", "BYTES", "BUDGET")
	for _, r := range rows {
		data, err := proto.Marshal(r.msg)
		if err != nil {
			fmt.Printf("%-25s  ERR: %v\n", r.name, err)
			continue
		}
		ok := "OK"
		if len(data) > Budget {
			ok = "OVER BUDGET"
		}
		fmt.Printf("%-25s %8d  %s\n", r.name, len(data), ok)
	}

	// 极端 WorldDelta
	delta := makeWorstCaseDelta(now)
	data, _ := proto.Marshal(delta)
	fmt.Println("---- 极端 WorldDelta(4 人 + 100 实体 + 30 事件 + 8 ack) ----")
	fmt.Printf("%-25s %8d  budget=4096\n", "S2C_WorldDelta (worst)", len(data))

	// 帧字节(含 type+length 包装)
	frame := struct {
		typ     string
		payload []byte
	}{"S2C_WorldDelta", data}
	fmt.Printf("  -> frame(total)=%d bytes(type+len+payload)\n", 2+len(frame.typ)+len(data))
}

func makeWorstCaseDelta(now uint64) *wildwoodv1.S2C_WorldDelta {
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
			PlayerId: fmt.Sprintf("p-%d", i), HpPct: 100, HungerPct: 80, SanityPct: 100, TempPct: 60, IsAlive: true,
		}
	}
	entities := make([]*wildwoodv1.EntityState, 0, numMonsters+numResources+numBuildings)
	for i := 0; i < numMonsters; i++ {
		entities = append(entities, &wildwoodv1.EntityState{
			EntityId: uint32(1000 + i), Kind: wildwoodv1.EntityKind_ENTITY_KIND_MONSTER,
			Position: &wildwoodv1.Vec2F{X: float32(i * 32), Y: float32(i * 16)},
			Hp: 50, MaxHp: 50, PrefabId: 1,
		})
	}
	for i := 0; i < numResources; i++ {
		entities = append(entities, &wildwoodv1.EntityState{
			EntityId: uint32(2000 + i), Kind: wildwoodv1.EntityKind_ENTITY_KIND_RESOURCE,
			Position: &wildwoodv1.Vec2F{X: float32(i * 8), Y: float32(i * 8)},
			Hp: 10, MaxHp: 10, PrefabId: 2,
		})
	}
	for i := 0; i < numBuildings; i++ {
		entities = append(entities, &wildwoodv1.EntityState{
			EntityId: uint32(3000 + i), Kind: wildwoodv1.EntityKind_ENTITY_KIND_BUILDING,
			Position: &wildwoodv1.Vec2F{X: float32(i * 64), Y: 0},
			Hp: 100, MaxHp: 100, PrefabId: 20,
		})
	}
	events := make([]*wildwoodv1.WorldEvent, numEvents)
	for i := 0; i < numEvents; i++ {
		events[i] = &wildwoodv1.WorldEvent{
			EventId: uint32(i), EventKind: wildwoodv1.WorldEventKind_WORLD_EVENT_GATHER_DONE,
			TargetEntityId: uint32(2000 + i%numResources), Amount: 1,
			Position: &wildwoodv1.Vec2F{X: 0, Y: 0},
		}
	}
	acks := make([]uint32, numAcks)
	for i := 0; i < numAcks; i++ {
		acks[i] = uint32(i + 1)
	}
	return &wildwoodv1.S2C_WorldDelta{
		ServerTick: 1234, ServerTimeMs: now,
		AckedInputSeqs: acks, EntityUpdates: entities,
		RemovedEntityIds: nil, PlayerStatus: players, Events: events,
	}
}
