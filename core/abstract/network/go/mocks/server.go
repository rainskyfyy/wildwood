// Package mocks: 协议层高阶 mock — 演示完整房间生命周期
// (Handshake → RoomCreate → RoomJoin → Heartbeat → PlayerInput → WorldDelta → Chat)。
//
// 真实房间服务在 M1.9 由工作台搭建师实现,本文件只做协议层端到端互通验证。
package mocks

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"
)

// MockServer 协议层 mock 服务端:模拟 4 人满员 + 20Hz tick
type MockServer struct {
	ep        Endpoint
	mu        sync.Mutex // 保护 rooms / 成员
	rooms     map[string]*roomState
	playerSeq atomic.Uint32
	closed    atomic.Bool
}

type roomState struct {
	id         string
	joinToken  string
	maxPlayers uint32
	members    []*wildwoodv1.PlayerState
	createdAt  time.Time
}

func NewMockServer(ep Endpoint) *MockServer {
	return &MockServer{
		ep:    ep,
		rooms: make(map[string]*roomState),
	}
}

// Run 启动服务端主循环,直到连接关闭
func (s *MockServer) Run() error {
	for {
		msg, err := s.ep.Recv()
		if err != nil {
			return err
		}
		if err := s.handle(msg); err != nil {
			return err
		}
	}
}

func (s *MockServer) handle(msg proto.Message) error {
	switch m := msg.(type) {
	case *wildwoodv1.C2S_Handshake:
		return s.ep.Send("S2C_HandshakeAck", &wildwoodv1.S2C_HandshakeAck{
			ServerVersion:  "0.1.0",
			PlayerId:       fmt.Sprintf("p-%d", s.nextPlayerID()),
			SessionToken:   "mock-session-token",
			ServerTickRate: 20,
			MaxRoomPlayers: 4,
		})
	case *wildwoodv1.C2S_Heartbeat:
		return s.ep.Send("S2C_HeartbeatAck", &wildwoodv1.S2C_HeartbeatAck{
			ClientTimeMs: m.ClientTimeMs,
			PingSeq:       m.PingSeq,
			ServerTimeMs: uint64(time.Now().UnixMilli()),
		})
	case *wildwoodv1.C2S_RoomCreate:
		roomID := fmt.Sprintf("r-%05d", s.nextPlayerID())
		joinToken := fmt.Sprintf("t-%05d", s.nextPlayerID())
		s.mu.Lock()
		s.rooms[roomID] = &roomState{
			id:         roomID,
			joinToken:  joinToken,
			maxPlayers: 4,
			members:    nil,
			createdAt:  time.Now(),
		}
		s.mu.Unlock()
		return s.ep.Send("S2C_RoomCreated", &wildwoodv1.S2C_RoomCreated{
			RoomId:     roomID,
			JoinToken:  joinToken,
			MaxPlayers: 4,
		})
	case *wildwoodv1.C2S_RoomJoin:
		// 先取新 player id(atomic,不需要持锁),避免在持锁时再调
		newPlayerID := s.nextPlayerID()
		s.mu.Lock()
		room, ok := s.rooms[m.RoomId]
		if !ok {
			s.mu.Unlock()
			return s.ep.Send("S2C_Error", &wildwoodv1.S2C_Error{
				Code:    wildwoodv1.RoomErrorCode_ROOM_ERROR_NOT_FOUND,
				Message: "room not found",
				Context: m.RoomId,
			})
		}
		if m.JoinToken != room.joinToken {
			s.mu.Unlock()
			return s.ep.Send("S2C_Error", &wildwoodv1.S2C_Error{
				Code:    wildwoodv1.RoomErrorCode_ROOM_ERROR_NOT_FOUND,
				Message: "invalid join_token",
				Context: m.RoomId,
			})
		}
		if uint32(len(room.members)) >= room.maxPlayers {
			s.mu.Unlock()
			return s.ep.Send("S2C_Error", &wildwoodv1.S2C_Error{
				Code:    wildwoodv1.RoomErrorCode_ROOM_ERROR_FULL,
				Message: "room is full (4/4)",
				Context: m.RoomId,
			})
		}
		newPlayer := &wildwoodv1.PlayerState{
			PlayerId:   fmt.Sprintf("p-%d", newPlayerID),
			PlayerName: "mock-player",
			Position:   &wildwoodv1.Vec2F{X: 0, Y: 0},
			Facing:     0,
			ColorRgb:   0xc89058,
			IsAlive:    true,
		}
		room.members = append(room.members, newPlayer)
		membersCopy := make([]*wildwoodv1.PlayerState, len(room.members))
		copy(membersCopy, room.members)
		s.mu.Unlock()
		return s.ep.Send("S2C_RoomJoined", &wildwoodv1.S2C_RoomJoined{
			RoomId:     m.RoomId,
			PlayerId:   newPlayer.PlayerId,
			Members:    membersCopy,
			InitialState: &wildwoodv1.WorldSnapshot{
				ServerTick:    1,
				ServerTimeMs:  uint64(time.Now().UnixMilli()),
				Entities:      nil,
				Players:       membersCopy,
				Status:        nil,
				WorldSeed:     "42",
				Season:        "autumn",
				Day:           1,
			},
			ServerTick: 1,
		})
	case *wildwoodv1.C2S_PlayerInput:
		// 简单 ack:回送一个 WorldDelta,带 ack
		return s.ep.Send("S2C_WorldDelta", &wildwoodv1.S2C_WorldDelta{
			ServerTick:       1,
			ServerTimeMs:     uint64(time.Now().UnixMilli()),
			AckedInputSeqs:   []uint32{m.InputSeq},
			EntityUpdates:    nil,
			RemovedEntityIds: nil,
			PlayerStatus:     nil,
			Events:           nil,
		})
	case *wildwoodv1.C2S_ChatMsg:
		return s.ep.Send("S2C_ChatBroadcast", &wildwoodv1.S2C_ChatBroadcast{
			Channel:        m.Channel,
			SenderId:       "p-mock",
			SenderName:     "mock-player",
			TargetPlayerId: m.TargetPlayerId,
			Text:           m.Text,
			ServerTimeMs:   uint64(time.Now().UnixMilli()),
		})
	case *wildwoodv1.C2S_Disconnect:
		return s.ep.Close()
	}
	return nil
}

// nextPlayerID atomic 自增,不需要持锁
func (s *MockServer) nextPlayerID() uint32 {
	return s.playerSeq.Add(1)
}

// Close 关闭服务端
func (s *MockServer) Close() error {
	if s.closed.CompareAndSwap(false, true) {
		return s.ep.Close()
	}
	return nil
}

// MockClient 协议层 mock 客户端,封装常用发送动作
type MockClient struct {
	ep Endpoint
}

func NewMockClient(ep Endpoint) *MockClient { return &MockClient{ep: ep} }

func (c *MockClient) Handshake(version, name string) error {
	return c.ep.Send("C2S_Handshake", &wildwoodv1.C2S_Handshake{
		ClientVersion: version,
		PlayerName:    name,
	})
}

func (c *MockClient) Heartbeat() error {
	return c.ep.Send("C2S_Heartbeat", &wildwoodv1.C2S_Heartbeat{
		ClientTimeMs: uint64(time.Now().UnixMilli()),
		PingSeq:       1,
	})
}

func (c *MockClient) CreateRoom(name, seed string) error {
	return c.ep.Send("C2S_RoomCreate", &wildwoodv1.C2S_RoomCreate{
		RoomName:   name,
		WorldSeed:  seed,
		MaxPlayers: 4,
	})
}

func (c *MockClient) JoinRoom(roomID, token string) error {
	return c.ep.Send("C2S_RoomJoin", &wildwoodv1.C2S_RoomJoin{
		RoomId:    roomID,
		JoinToken: token,
	})
}

func (c *MockClient) PlayerInput(seq uint32, action wildwoodv1.InputAction) error {
	return c.ep.Send("C2S_PlayerInput", &wildwoodv1.C2S_PlayerInput{
		InputSeq:     seq,
		Action:       action,
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	})
}

func (c *MockClient) Chat(channel wildwoodv1.ChatChannel, text string) error {
	return c.ep.Send("C2S_ChatMsg", &wildwoodv1.C2S_ChatMsg{
		Channel:      channel,
		Text:         text,
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	})
}

// Recv 阻塞接收服务端消息
func (c *MockClient) Recv() (proto.Message, error) { return c.ep.Recv() }

// Close 关闭客户端(对端会收到 EOF)
func (c *MockClient) Close() error { return c.ep.Close() }
