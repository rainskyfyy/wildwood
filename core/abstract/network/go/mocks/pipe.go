// Package mocks: 内存管道 mock 客户端/服务端 — 用于无网络环境验证
// 协议端到端互通(M1.5 验收 ③)。
//
// 用法:
//
//	pipe := NewPipe()
//	srv := NewMockServer(pipe.PipeServer())
//	cli := NewMockClient(pipe.PipeClient())
//	cli.SendHandshake(...)
//	resp := cli.Recv() // 来自服务端的帧
package mocks

import (
	"errors"
	"io"
	"sync"

	"github.com/wildwood/net/codec"
	"google.golang.org/protobuf/proto"
)

// Pipe 是双向内存管道,客户端写 → 服务端读,服务端写 → 客户端读
type Pipe struct {
	c2s *syncBuffer
	s2c *syncBuffer
}

func NewPipe() *Pipe {
	return &Pipe{
		c2s: newSyncBuffer(),
		s2c: newSyncBuffer(),
	}
}

// PipeClient 返回给客户端使用的 read/write 端
func (p *Pipe) PipeClient() Endpoint {
	return Endpoint{reader: p.s2c, writer: p.c2s}
}

// PipeServer 返回给服务端使用的 read/write 端
func (p *Pipe) PipeServer() Endpoint {
	return Endpoint{reader: p.c2s, writer: p.s2c}
}

// syncBuffer 协程安全的 byte buffer,实现 io.Reader / io.Writer
type syncBuffer struct {
	mu   sync.Mutex
	cond *sync.Cond
	buf  []byte
	closed bool
}

func newSyncBuffer() *syncBuffer {
	b := &syncBuffer{}
	b.cond = sync.NewCond(&b.mu)
	return b
}

func (b *syncBuffer) Read(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.buf) == 0 {
		if b.closed {
			return 0, io.EOF
		}
		b.cond.Wait()
	}
	n := copy(p, b.buf)
	b.buf = b.buf[n:]
	if len(b.buf) == 0 {
		b.buf = nil
	}
	return n, nil
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return 0, io.ErrClosedPipe
	}
	b.buf = append(b.buf, p...)
	b.cond.Broadcast()
	return len(p), nil
}

func (b *syncBuffer) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	b.cond.Broadcast()
	return nil
}

// Endpoint 端点:reader + writer
type Endpoint struct {
	reader *syncBuffer
	writer *syncBuffer
}

// Send 编码并发送一条帧
func (e Endpoint) Send(name string, m proto.Message) error {
	frame, err := codec.MarshalFrame(name, m)
	if err != nil {
		return err
	}
	data, err := codec.EncodeFrame(frame)
	if err != nil {
		return err
	}
	_, err = e.writer.Write(data)
	return err
}

// Recv 阻塞接收一条已解析的 proto.Message
func (e Endpoint) Recv() (proto.Message, error) {
	if errors.Is(io.EOF, nil) {
		_ = io.EOF
	}
	rdr := codec.NewReader()
	tmp := make([]byte, 4096)
	for {
		n, err := e.reader.Read(tmp)
		if err != nil {
			return nil, err
		}
		frames, err := rdr.Feed(tmp[:n])
		if err != nil {
			return nil, err
		}
		if len(frames) > 0 {
			return codec.UnmarshalFrame(frames[0])
		}
	}
}

// Close 关闭写入端(对端 Read 会解除阻塞返回 EOF)
func (e Endpoint) Close() error { return e.writer.Close() }
