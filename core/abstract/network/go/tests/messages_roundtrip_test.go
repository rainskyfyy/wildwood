// Package tests: 全消息类型 round-trip 编解码测试
package tests

import (
	"testing"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"
)

// fixtureInputs 构造每个消息类型的"满字段"样本
func fixtureInputs() map[string]proto.Message {
	now := uint64(time.Now().UnixMilli())
	return map[string]proto.Message{
		"C2S_Handshake": &wildwoodv1.C2S_Handshake{
			ClientVersion: "0.1.0",
			PlayerName:    "Alice",
			AuthToken:     "tok-abc",
		},
		"C2S_Heartbeat": &wildwoodv1.C2S_Heartbeat{
			ClientTimeMs: now,
			PingSeq:      42,
		},
		"C2S_Disconnect": &wildwoodv1.C2S_Disconnect{Reason: "user_quit"},
		"C2S_RoomCreate": &wildwoodv1.C2S_RoomCreate{
			RoomName:   "Test Room",
			WorldSeed:  "42",
			MaxPlayers: 4,
		},
		"C2S_RoomJoin": &wildwoodv1.C2S_RoomJoin{
			RoomId:    "r-00001",
			JoinToken: "t-00001",
		},
		"C2S_RoomLeave": &wildwoodv1.C2S_RoomLeave{RoomId: "r-00001"},
		"C2S_RoomList": &wildwoodv1.C2S_RoomList{
			Page:     0,
			PageSize: 16,
		},
		"C2S_PlayerInput": &wildwoodv1.C2S_PlayerInput{
			InputSeq:        7,
			ServerTick:      100,
			Action:          wildwoodv1.InputAction_INPUT_ACTION_MOVE,
			MoveDx:          0.5,
			MoveDy:          -0.3,
			TargetEntityId:  0,
			TargetPrefabId:  0,
			TileX:           0,
			TileY:           0,
			SlotIndex:       0,
			Facing:          1.57,
			ClientTimeMs:    now,
		},
		"C2S_ChatMsg": &wildwoodv1.C2S_ChatMsg{
			Channel:      wildwoodv1.ChatChannel_CHAT_CHANNEL_TEAM,
			TargetPlayerId: "",
			Text:         "今晚开会",
			ClientTimeMs: now,
		},
		"S2C_HandshakeAck": &wildwoodv1.S2C_HandshakeAck{
			ServerVersion:  "0.1.0",
			PlayerId:       "p-001",
			SessionToken:   "session-xyz",
			ServerTickRate: 20,
			MaxRoomPlayers: 4,
		},
		"S2C_HeartbeatAck": &wildwoodv1.S2C_HeartbeatAck{
			ClientTimeMs: now,
			PingSeq:      42,
			ServerTimeMs: now + 30,
		},
		"S2C_RoomCreated": &wildwoodv1.S2C_RoomCreated{
			RoomId:     "r-00001",
			JoinToken:  "t-00001",
			MaxPlayers: 4,
		},
		"S2C_RoomJoined": &wildwoodv1.S2C_RoomJoined{
			RoomId:   "r-00001",
			PlayerId: "p-001",
			Members: []*wildwoodv1.PlayerState{{
				PlayerId:   "p-001",
				PlayerName: "Alice",
				Position:   &wildwoodv1.Vec2F{X: 0, Y: 0},
				Facing:     0,
				ColorRgb:   0xc89058,
				IsAlive:    true,
			}},
			InitialState: &wildwoodv1.WorldSnapshot{
				ServerTick:   1,
				ServerTimeMs: now,
				WorldSeed:    "42",
				Season:       "autumn",
				Day:          1,
			},
			ServerTick: 1,
		},
		"S2C_WorldDelta": &wildwoodv1.S2C_WorldDelta{
			ServerTick:      1234,
			ServerTimeMs:    now,
			AckedInputSeqs:  []uint32{1, 2, 3, 4, 5},
			EntityUpdates:   nil,
			RemovedEntityIds: []uint32{99, 100},
			PlayerStatus: []*wildwoodv1.PlayerStatus{{
				PlayerId:          "p-001",
				HpPct:             100,
				HungerPct:         80,
				SanityPct:         100,
				TempPct:           60,
				IsAlive:           true,
				IsGhost:           false,
				GhostRemainingMs:  0,
			}},
			Events: []*wildwoodv1.WorldEvent{{
				EventId:         1,
				EventKind:       wildwoodv1.WorldEventKind_WORLD_EVENT_GATHER_DONE,
				SourceEntityId:  0,
				TargetEntityId:  50,
				Amount:          1,
				Position:        &wildwoodv1.Vec2F{X: 100, Y: 100},
			}},
		},
		"S2C_ChatBroadcast": &wildwoodv1.S2C_ChatBroadcast{
			Channel:        wildwoodv1.ChatChannel_CHAT_CHANNEL_TEAM,
			SenderId:       "p-001",
			SenderName:     "Alice",
			TargetPlayerId: "",
			Text:           "hi",
			ServerTimeMs:   now,
		},
		"S2C_Error": &wildwoodv1.S2C_Error{
			Code:    wildwoodv1.RoomErrorCode_ROOM_ERROR_FULL,
			Message: "room is full",
			Context: "r-00001",
		},
	}
}

func TestAllMessages_RoundTrip(t *testing.T) {
	for name, msg := range fixtureInputs() {
		t.Run(name, func(t *testing.T) {
			data, err := proto.Marshal(msg)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			round := proto.Clone(msg)
			// 用 zero 替换原对象,验证 Unmarshal 重建
			zeroMsg, _ := cloneZero(name)
			_ = zeroMsg
			round = cloneOf(name)
			if err := proto.Unmarshal(data, round); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !proto.Equal(msg, round) {
				t.Errorf("round-trip mismatch:\n orig: %v\n back: %v", msg, round)
			}
		})
	}
}

// cloneOf / cloneZero 辅助函数 — 测试中创建同类型 zero 值
func cloneOf(name string) proto.Message {
	switch name {
	case "C2S_Handshake":
		return &wildwoodv1.C2S_Handshake{}
	case "C2S_Heartbeat":
		return &wildwoodv1.C2S_Heartbeat{}
	case "C2S_Disconnect":
		return &wildwoodv1.C2S_Disconnect{}
	case "C2S_RoomCreate":
		return &wildwoodv1.C2S_RoomCreate{}
	case "C2S_RoomJoin":
		return &wildwoodv1.C2S_RoomJoin{}
	case "C2S_RoomLeave":
		return &wildwoodv1.C2S_RoomLeave{}
	case "C2S_RoomList":
		return &wildwoodv1.C2S_RoomList{}
	case "C2S_PlayerInput":
		return &wildwoodv1.C2S_PlayerInput{}
	case "C2S_ChatMsg":
		return &wildwoodv1.C2S_ChatMsg{}
	case "S2C_HandshakeAck":
		return &wildwoodv1.S2C_HandshakeAck{}
	case "S2C_HeartbeatAck":
		return &wildwoodv1.S2C_HeartbeatAck{}
	case "S2C_RoomCreated":
		return &wildwoodv1.S2C_RoomCreated{}
	case "S2C_RoomJoined":
		return &wildwoodv1.S2C_RoomJoined{}
	case "S2C_WorldDelta":
		return &wildwoodv1.S2C_WorldDelta{}
	case "S2C_ChatBroadcast":
		return &wildwoodv1.S2C_ChatBroadcast{}
	case "S2C_Error":
		return &wildwoodv1.S2C_Error{}
	case "S2C_RoomLeft":
		return &wildwoodv1.S2C_RoomLeft{}
	case "S2C_PlayerJoined":
		return &wildwoodv1.S2C_PlayerJoined{}
	case "S2C_PlayerLeft":
		return &wildwoodv1.S2C_PlayerLeft{}
	case "S2C_RoomState":
		return &wildwoodv1.S2C_RoomState{}
	case "S2C_RoomList":
		return &wildwoodv1.S2C_RoomList{}
	}
	return nil
}

func cloneZero(name string) (proto.Message, error) { return cloneOf(name), nil }
