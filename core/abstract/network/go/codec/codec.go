// Package codec 定义 Wildwood 网络协议语义层的传输帧格式。
//
// 帧格式(传输层只负责读写字节,本层负责语义解析):
//
//	+--------+----------+----------------------------------+
//	| LEN    | TYPE_LEN | TYPE                            |
//	| varint | varint   | UTF-8 字符串(例 "C2S_Handshake") |
//	+--------+----------+----------------------------------+
//	|                                                |
//	|                PAYLOAD(protobuf bytes)          |
//	|                                                |
//	+------------------------------------------------+
//
//   - LEN:       整个帧剩余字节的 varint 长度(包 TYPE_LEN + TYPE + PAYLOAD)
//   - TYPE_LEN:  TYPE 字符串的 UTF-8 字节数 varint
//   - TYPE:      消息类型名,与 proto 包内 message 同名(C2S_Handshake / S2C_WorldDelta ...)
//   - PAYLOAD:   对应 proto message 的 Marshal 字节
//
// 任何传输层(WebSocket / KCP / QUIC / loopback)都按本格式序列化;
// 协议稳定前(M1.9+)不需要重写本文件。
package codec

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sync"

	"google.golang.org/protobuf/proto"
)

// FrameHeaderSize 上限,单帧 varint 长度前缀最多 5 字节
const (
	MaxFrameSize  = 64 * 1024 // 单帧上限 64KB(包含 WorldDelta / 快照)
	MaxTypeLength = 64
)

var (
	ErrFrameTooLarge   = errors.New("codec: frame exceeds MaxFrameSize")
	ErrTypeTooLong     = errors.New("codec: type string exceeds MaxTypeLength")
	ErrEmptyFrame      = errors.New("codec: empty frame")
	ErrUnknownType     = errors.New("codec: unknown message type")
	ErrPayloadTooLarge = errors.New("codec: payload exceeds frame size")
)

// Frame 表示一条已解析的协议帧(类型 + payload)
type Frame struct {
	Type    string // 消息类型,例 "C2S_Handshake"
	Payload []byte // proto.Marshal 后的字节
}

// 帧解析器状态机(支持流式喂数据)
type reader struct {
	buf []byte
}

// NewReader 构造一个流式帧读取器
func NewReader() *reader { return &reader{buf: make([]byte, 0, 4096)} }

// Feed 把从 socket 读到的字节喂入,返回完整解析的帧
func (r *reader) Feed(data []byte) ([]Frame, error) {
	r.buf = append(r.buf, data...)
	var frames []Frame
	for {
		f, n, err := parseFrame(r.buf)
		if err == ErrEmptyFrame || err == ErrFrameTooLarge {
			// 等待更多数据(如果长度超限则报错)
			if err == ErrFrameTooLarge {
				return frames, err
			}
			return frames, nil
		}
		if err != nil {
			return frames, err
		}
		frames = append(frames, f)
		r.buf = r.buf[n:]
	}
}

// parseFrame 解析单帧;返回 (frame, consumed_bytes, err)
func parseFrame(buf []byte) (Frame, int, error) {
	if len(buf) == 0 {
		return Frame{}, 0, ErrEmptyFrame
	}
	// varint 读取总长度
	length, n := binary.Uvarint(buf)
	if n <= 0 {
		return Frame{}, 0, fmt.Errorf("codec: invalid length varint")
	}
	totalNeeded := n + int(length)
	if totalNeeded > MaxFrameSize {
		return Frame{}, 0, ErrFrameTooLarge
	}
	if len(buf) < totalNeeded {
		return Frame{}, 0, ErrEmptyFrame // 等更多数据
	}
	// varint 读取 type 长度
	typeLen, n2 := binary.Uvarint(buf[n:])
	if n2 <= 0 {
		return Frame{}, 0, fmt.Errorf("codec: invalid type_len varint")
	}
	if typeLen > MaxTypeLength {
		return Frame{}, 0, ErrTypeTooLong
	}
	typeStart := n + n2
	payloadStart := typeStart + int(typeLen)
	if payloadStart > totalNeeded {
		return Frame{}, 0, fmt.Errorf("codec: type overflows frame")
	}
	f := Frame{
		Type:    string(buf[typeStart:payloadStart]),
		Payload: make([]byte, totalNeeded-payloadStart),
	}
	copy(f.Payload, buf[payloadStart:totalNeeded])
	return f, totalNeeded, nil
}

// EncodeFrame 把 frame 编码为可写入 socket 的字节
func EncodeFrame(f Frame) ([]byte, error) {
	if len(f.Type) == 0 {
		return nil, errors.New("codec: empty type")
	}
	if len(f.Type) > MaxTypeLength {
		return nil, ErrTypeTooLong
	}
	typeBytes := []byte(f.Type)
	// 计算: type_len(varint) + type + payload
	bodyLen := varintSize(uint64(len(typeBytes))) + len(typeBytes) + len(f.Payload)
	if bodyLen+nvarintSize(uint64(bodyLen)) > MaxFrameSize {
		return nil, ErrFrameTooLarge
	}
	out := make([]byte, 0, nvarintSize(uint64(bodyLen))+bodyLen)
	var lenBuf [binary.MaxVarintLen64]byte
	ln := binary.PutUvarint(lenBuf[:], uint64(bodyLen))
	out = append(out, lenBuf[:ln]...)
	ln = binary.PutUvarint(lenBuf[:], uint64(len(typeBytes)))
	out = append(out, lenBuf[:ln]...)
	out = append(out, typeBytes...)
	out = append(out, f.Payload...)
	return out, nil
}

// varintSize / nvarintSize 计算 varint 编码字节数
func varintSize(x uint64) int  { return nvarintSize(x) }
func nvarintSize(x uint64) int {
	i := 0
	for x >= 0x80 {
		x >>= 7
		i++
	}
	return i + 1
}

// 内存复用:避免每次 EncodeFrame 分配新 buffer
var framePool = sync.Pool{
	New: func() any { return new(frameBuilder) },
}

type frameBuilder struct {
	buf []byte
}

// EncodeFramePooled 池化版本的 EncodeFrame,长连接高频发送场景使用
func EncodeFramePooled(f Frame) ([]byte, error) {
	b := framePool.Get().(*frameBuilder)
	defer func() {
		b.buf = b.buf[:0]
		framePool.Put(b)
	}()
	if len(f.Type) == 0 {
		return nil, errors.New("codec: empty type")
	}
	typeBytes := []byte(f.Type)
	bodyLen := varintSize(uint64(len(typeBytes))) + len(typeBytes) + len(f.Payload)
	totalLen := bodyLen + nvarintSize(uint64(bodyLen))
	if totalLen > MaxFrameSize {
		return nil, ErrFrameTooLarge
	}
	if cap(b.buf) < totalLen {
		b.buf = make([]byte, 0, totalLen)
	}
	b.buf = b.buf[:0]
	var lenBuf [binary.MaxVarintLen64]byte
	ln := binary.PutUvarint(lenBuf[:], uint64(bodyLen))
	b.buf = append(b.buf, lenBuf[:ln]...)
	ln = binary.PutUvarint(lenBuf[:], uint64(len(typeBytes)))
	b.buf = append(b.buf, lenBuf[:ln]...)
	b.buf = append(b.buf, typeBytes...)
	b.buf = append(b.buf, f.Payload...)
	// 必须 copy 一份,Pool 会重用 buf
	out := make([]byte, totalLen)
	copy(out, b.buf)
	return out, nil
}

// io.Writer 适配器:把帧按顺序写入
func WriteFrame(w io.Writer, f Frame) error {
	data, err := EncodeFrame(f)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

// proto.Message → Frame(Type 来自 proto.Message 的 FullName 末段)
func MarshalFrame(name string, m proto.Message) (Frame, error) {
	if m == nil {
		return Frame{Type: name}, errors.New("codec: nil proto message")
	}
	payload, err := proto.Marshal(m)
	if err != nil {
		return Frame{}, fmt.Errorf("codec: marshal %s: %w", name, err)
	}
	return Frame{Type: name, Payload: payload}, nil
}
