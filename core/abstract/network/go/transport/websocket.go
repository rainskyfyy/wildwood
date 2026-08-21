// Package transport: 真实 WebSocket 传输层 — 把 gorilla/websocket 连接
// 适配为 codec 层能直接使用的 Conn 抽象。
//
// 设计要点:
//   - 一个连接:1 个读协程 + 1 个写协程(通过 channel 解耦,避免 ws 跨协程写并发问题)
//   - 心跳:服务端 ws.SetReadDeadline + 收到 ping/pong/任何 C2S 消息时延期
//   - 写超时:每次 WriteMessage 单次设短超时,避免长连接卡住
//   - 关闭:Close() 幂等,广播到读/写协程,读 EOF 后退出
//
// M1.9 验收:
//   ① 单进程支持 200 房间 × 4 = 800 连接(写协程 / 连接,共享 hub)
//   ② RTT < 50ms(同机房):ping/pong 协议帧即时回,不走业务逻辑
//   ③ 心跳超时断开:30s 无 C2S → 60s 读超时 → 主动关闭
package transport

import (
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
)

const (
	// WriteTimeout 写超时 — 防止对端半开导致 send 阻塞
	WriteTimeout = 5 * time.Second
	// ReadIdleTimeout 读空闲超时 — 心跳机制(超过该时间没收到 C2S 帧则断开)
	ReadIdleTimeout = 60 * time.Second
	// PongDeadline ping/pong 兜底:服务端主动 ping 客户端
	PingInterval = 30 * time.Second
	// ReadBufferSize / WriteBufferSize 缓冲区大小
	ReadBufferSize  = 4096
	WriteBufferSize = 4096
)

// ErrConnClosed 连接已关闭
var ErrConnClosed = errors.New("transport: connection closed")

// Conn 表示一个经过认证或未认证的 WebSocket 连接。
//
// 用法(典型):
//
//	conn := transport.Accept(ws)
//	conn.SetPlayerID("p-1")              // 握手后由 hub 注入
//	go conn.WriteLoop()
//	go conn.ReadLoop(func(msg proto.Message) error { return hub.Handle(conn, msg) })
type Conn struct {
	ws *websocket.Conn

	send   chan Frame // 业务侧投递到这里,由 WriteLoop 实际写
	closed atomic.Bool

	closeOnce sync.Once
	closeErr  error

	// auth context:由 hub 在 handshake 后注入
	playerID atomic.Value // string
	authed   atomic.Bool

	// stats(可选;压测用)
	bytesIn   atomic.Uint64
	bytesOut  atomic.Uint64
	framesIn  atomic.Uint64
	framesOut atomic.Uint64
}

// Frame 是写队列上的最小单元(已编码字节)
type Frame struct {
	Type    string
	Payload []byte
}

// Accept 把 gorilla websocket 连接包装为 *Conn(服务端用)
func Accept(ws *websocket.Conn) *Conn {
	ws.SetReadLimit(codec.MaxFrameSize)
	_ = ws.SetReadDeadline(time.Now().Add(ReadIdleTimeout))
	ws.SetPongHandler(func(string) error {
		_ = ws.SetReadDeadline(time.Now().Add(ReadIdleTimeout))
		return nil
	})
	c := &Conn{
		ws:   ws,
		send: make(chan Frame, 64),
	}
	return c
}

// Dial 客户端发起 WebSocket 拨号(测试 / Godot 客户端外接测试用)
//
// Dial 内部会启一个 WriteLoop goroutine,调用方可以直接使用 Send/Close;
// 读路径需要通过返回的 ws 直接 ReadMessage(因为 ReadLoop 已经被
// 服务端占用语义,客户端可以单独启一个 ReadLoop)。
func Dial(url string) (*Conn, *websocket.Conn, *websocket.Dialer, error) {
	d := websocket.DefaultDialer
	d.ReadBufferSize = ReadBufferSize
	d.WriteBufferSize = WriteBufferSize
	ws, _, err := d.Dial(url, nil)
	if err != nil {
		return nil, ws, d, err
	}
	// 客户端:不设 read deadline(测试短时),不接 pong handler
	c := &Conn{
		ws:   ws,
		send: make(chan Frame, 64),
	}
	go c.WriteLoop()
	return c, ws, d, nil
}

// SetPlayerID 握手后由 hub 注入玩家 ID
func (c *Conn) SetPlayerID(pid string) {
	c.playerID.Store(pid)
	c.authed.Store(true)
}

// GetPlayerID 取玩家 ID;未认证返回 ("", false)
func (c *Conn) GetPlayerID() (string, bool) {
	if !c.authed.Load() {
		return "", false
	}
	v, ok := c.playerID.Load().(string)
	return v, ok
}

// Send 投递一条消息到写队列(线程安全;非阻塞,满了返回 false)
func (c *Conn) Send(typeName string, m proto.Message) error {
	if c.closed.Load() {
		return ErrConnClosed
	}
	payload, err := proto.Marshal(m)
	if err != nil {
		return err
	}
	return c.SendFrame(Frame{Type: typeName, Payload: payload})
}

// SendFrame 投递一条已编码帧(跳过 Marshal;广播场景用)
func (c *Conn) SendFrame(f Frame) error {
	if c.closed.Load() {
		return ErrConnClosed
	}
	select {
	case c.send <- f:
		c.framesOut.Add(1)
		return nil
	default:
		// 队列满:对端消费能力差,主动断开
		c.Close()
		return ErrConnClosed
	}
}

// ReadLoop 读取循环,handler 在每个完整帧上被调用
//
// handler 应当:
//   - 同步处理(轻量)或投递到 hub 的 worker pool
//   - 不直接调用 c.Send (会死锁,Send 投到 c.send 通道,handler 在 ReadLoop 协程)
func (c *Conn) ReadLoop(handler func(proto.Message) error) error {
	rdr := codec.NewReader()
	for {
		msgType, data, err := c.ws.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return nil
			}
			if errors.Is(err, io.EOF) {
				return nil
			}
			// 读超时/网络错误:正常关闭流程
			return err
		}
		if msgType != websocket.BinaryMessage && msgType != websocket.TextMessage {
			continue
		}
		c.bytesIn.Add(uint64(len(data)))
		frames, err := rdr.Feed(data)
		if err != nil {
			// 协议错误:主动断开
			c.Close()
			return err
		}
		for _, f := range frames {
			c.framesIn.Add(1)
			msg, err := codec.UnmarshalFrame(f)
			if err != nil {
				c.Close()
				return err
			}
			// 任何 C2S 帧都算"在线心跳",续命
			_ = c.ws.SetReadDeadline(time.Now().Add(ReadIdleTimeout))
			if err := handler(msg); err != nil {
				c.Close()
				return err
			}
		}
	}
}

// WriteLoop 写循环;从 send 通道拉帧并写 socket
func (c *Conn) WriteLoop() error {
	ticker := time.NewTicker(PingInterval)
	defer ticker.Stop()
	for {
		select {
		case f, ok := <-c.send:
			if !ok {
				// send 通道被关 → 主动 Close
				return c.writeClose()
			}
			if err := c.writeFrame(f); err != nil {
				return err
			}
		case <-ticker.C:
			// 主动 ping,触发对端 pong(对端 pong handler 会续命读超时)
			if err := c.writePing(); err != nil {
				return err
			}
		}
	}
}

func (c *Conn) writeFrame(f Frame) error {
	_ = c.ws.SetWriteDeadline(time.Now().Add(WriteTimeout))
	codecFrame := codec.Frame{Type: f.Type, Payload: f.Payload}
	data, err := codec.EncodeFrame(codecFrame)
	if err != nil {
		return err
	}
	if err := c.ws.WriteMessage(websocket.BinaryMessage, data); err != nil {
		return err
	}
	c.bytesOut.Add(uint64(len(data)))
	return nil
}

func (c *Conn) writePing() error {
	_ = c.ws.SetWriteDeadline(time.Now().Add(WriteTimeout))
	return c.ws.WriteMessage(websocket.PingMessage, nil)
}

func (c *Conn) writeClose() error {
	_ = c.ws.SetWriteDeadline(time.Now().Add(WriteTimeout))
	return c.ws.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
}

// Close 幂等关闭
func (c *Conn) Close() error {
	c.closeOnce.Do(func() {
		c.closed.Store(true)
		close(c.send) // 通知 WriteLoop 退出
		_ = c.ws.Close()
	})
	return c.closeErr
}

// Stats 返回统计(压测 / 监控用)
type Stats struct {
	BytesIn   uint64
	BytesOut  uint64
	FramesIn  uint64
	FramesOut uint64
}

func (c *Conn) Stats() Stats {
	return Stats{
		BytesIn:   c.bytesIn.Load(),
		BytesOut:  c.bytesOut.Load(),
		FramesIn:  c.framesIn.Load(),
		FramesOut: c.framesOut.Load(),
	}
}
