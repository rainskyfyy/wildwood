// Package room: 服务端连接管理 — 接受 WebSocket、运行读写循环、监控断线。
package room

import (
	"log"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/transport"
)

// Server 持有 hub + 当前活跃连接数 + accept hook
type Server struct {
	hub            *Hub
	connCount      atomic.Int64
	totalAccepted  atomic.Uint64
	totalClosed    atomic.Uint64
	onDisconnect   func(playerID string, conn *transport.Conn)
}

// NewServer 构造
func NewServer(hub *Hub) *Server {
	return &Server{hub: hub}
}

// SetOnDisconnect 设置连接断开回调(用于清理房间成员 / 5 分钟墓碑)
func (s *Server) SetOnDisconnect(fn func(playerID string, conn *transport.Conn)) {
	s.onDisconnect = fn
}

// ConnCount 当前活跃连接数
func (s *Server) ConnCount() int64 { return s.connCount.Load() }

// Stats 服务端统计
type ServerStats struct {
	ActiveConns   int64
	TotalAccepted uint64
	TotalClosed   uint64
}

func (s *Server) Stats() ServerStats {
	return ServerStats{
		ActiveConns:   s.connCount.Load(),
		TotalAccepted: s.totalAccepted.Load(),
		TotalClosed:   s.totalClosed.Load(),
	}
}

// Accept 处理一个已升级的 WebSocket 连接
//
// 启 2 个 goroutine:ReadLoop(从 socket 读,handle)+ WriteLoop(从 send 队列写)
// 任意一边退出都会清理本连接。
func (s *Server) Accept(ws *websocket.Conn) {
	conn := transport.Accept(ws)
	s.connCount.Add(1)
	s.totalAccepted.Add(1)

	// 监控 goroutine:ReadLoop 退出后,触发 onDisconnect
	readErr := make(chan error, 1)
	writeErr := make(chan error, 1)

	go func() {
		readErr <- conn.ReadLoop(func(msg proto.Message) error {
			return s.hub.Handle(conn, msg)
		})
	}()
	go func() {
		writeErr <- conn.WriteLoop()
	}()

	// 等待任一结束 → 关闭连接 + 清理
	go func() {
		var firstErr error
		select {
		case err := <-readErr:
			firstErr = err
		case err := <-writeErr:
			firstErr = err
		}

		// 通知 hub 清理(玩家可能已在房间中)
		if pid, ok := conn.GetPlayerID(); ok && s.onDisconnect != nil {
			s.onDisconnect(pid, conn)
		}

		_ = conn.Close()
		// 等另一边也退出
		select {
		case <-readErr:
		case <-writeErr:
		case <-time.After(2 * time.Second):
			log.Printf("room.Server: read/write loop did not exit in 2s")
		}
		s.connCount.Add(-1)
		s.totalClosed.Add(1)
		_ = firstErr
	}()
}
