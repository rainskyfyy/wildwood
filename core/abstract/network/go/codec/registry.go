// Package codec: message registry — type string ↔ proto.Message 双向映射。
//
// 由于 A/B 线共用同一份 .proto,type 字符串约定为 proto.Message 的
// "末段名" (例 wildwood.net.v1.C2S_Handshake → "C2S_Handshake"),
// 见 proto/wildwood/v1/*.proto。
package codec

import (
	"fmt"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"
)

// MessageFactory 返回对应类型的新消息实例(zero value)
type MessageFactory func() proto.Message

var registry = map[string]MessageFactory{
	// C2S
	"C2S_Handshake":  func() proto.Message { return &wildwoodv1.C2S_Handshake{} },
	"C2S_Heartbeat":  func() proto.Message { return &wildwoodv1.C2S_Heartbeat{} },
	"C2S_Disconnect": func() proto.Message { return &wildwoodv1.C2S_Disconnect{} },
	"C2S_RoomCreate": func() proto.Message { return &wildwoodv1.C2S_RoomCreate{} },
	"C2S_RoomJoin":   func() proto.Message { return &wildwoodv1.C2S_RoomJoin{} },
	"C2S_RoomLeave":  func() proto.Message { return &wildwoodv1.C2S_RoomLeave{} },
	"C2S_RoomKick":   func() proto.Message { return &wildwoodv1.C2S_RoomKick{} },
	"C2S_RoomList":   func() proto.Message { return &wildwoodv1.C2S_RoomList{} },
	"C2S_PlayerInput": func() proto.Message { return &wildwoodv1.C2S_PlayerInput{} },
	"C2S_ChatMsg":     func() proto.Message { return &wildwoodv1.C2S_ChatMsg{} },

	// S2C
	"S2C_HandshakeAck":  func() proto.Message { return &wildwoodv1.S2C_HandshakeAck{} },
	"S2C_HeartbeatAck":  func() proto.Message { return &wildwoodv1.S2C_HeartbeatAck{} },
	"S2C_RoomCreated":   func() proto.Message { return &wildwoodv1.S2C_RoomCreated{} },
	"S2C_RoomJoined":    func() proto.Message { return &wildwoodv1.S2C_RoomJoined{} },
	"S2C_RoomLeft":      func() proto.Message { return &wildwoodv1.S2C_RoomLeft{} },
	"S2C_PlayerJoined":  func() proto.Message { return &wildwoodv1.S2C_PlayerJoined{} },
	"S2C_PlayerLeft":    func() proto.Message { return &wildwoodv1.S2C_PlayerLeft{} },
	"S2C_RoomKicked":    func() proto.Message { return &wildwoodv1.S2C_RoomKicked{} },
	"S2C_RoomState":     func() proto.Message { return &wildwoodv1.S2C_RoomState{} },
	"S2C_RoomStateChanged": func() proto.Message { return &wildwoodv1.S2C_RoomStateChanged{} },
	"S2C_RoomList":      func() proto.Message { return &wildwoodv1.S2C_RoomList{} },
	"S2C_WorldDelta":    func() proto.Message { return &wildwoodv1.S2C_WorldDelta{} },
	"S2C_ChatBroadcast": func() proto.Message { return &wildwoodv1.S2C_ChatBroadcast{} },
	"S2C_Error":         func() proto.Message { return &wildwoodv1.S2C_Error{} },
}

// IsKnownType 检查 type 字符串是否注册
func IsKnownType(typeName string) bool {
	_, ok := registry[typeName]
	return ok
}

// NewMessage 根据 type 名构造一个 zero-value proto.Message
func NewMessage(typeName string) (proto.Message, error) {
	f, ok := registry[typeName]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownType, typeName)
	}
	return f(), nil
}

// UnmarshalFrame 从 Frame 还原为强类型 proto.Message
func UnmarshalFrame(f Frame) (proto.Message, error) {
	msg, err := NewMessage(f.Type)
	if err != nil {
		return nil, err
	}
	if err := proto.Unmarshal(f.Payload, msg); err != nil {
		return nil, fmt.Errorf("codec: unmarshal %s: %w", f.Type, err)
	}
	return msg, nil
}

// RegisteredTypes 返回所有已注册类型(测试 / 自检用)
func RegisteredTypes() []string {
	out := make([]string, 0, len(registry))
	for k := range registry {
		out = append(out, k)
	}
	return out
}
