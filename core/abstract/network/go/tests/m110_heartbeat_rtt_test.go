// M1.10 验收 ①:心跳 1s 内回 pong
//
// 启动真实房间服务,客户端拨号,完成 handshake,
// 周期性发 C2S_Heartbeat,测每条 RTT。
// 断言: 1s 内必须收到 S2C_HeartbeatAck (M1.10 验收硬约束)。
//
// 这与 M1.9 transport 测试不同: 那个测 WebSocket 层的 RTT;
// 这个测"应用层 heartbeat" 经 hub.Handle → 立即回包 的端到端时延。
package tests

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
	"github.com/wildwood/net/room"
	wtransport "github.com/wildwood/net/transport"
	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

// httpToWS 把 httptest URL 转成 ws:// URL.
// httptest.NewServer 返回 "http://127.0.0.1:PORT",
// gorilla dial 要 "ws://127.0.0.1:PORT".
// 复用: RTT 测试和重连测试都需要。
func httpToWS(httpURL string) string {
	return strings.Replace(httpURL, "http://", "ws://", 1)
}

// startHeartbeatHub 启动一个独立的 httptest 房间服务
func startHeartbeatHub(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	hub := room.NewHub(20)
	hub.Start()
	srv := room.NewServer(hub)
	srv.SetOnDisconnect(func(playerID string, _ *wtransport.Conn) {
		hub.Mu().RLock()
		var roomID string
		if p, ok := hub.Players()[playerID]; ok {
			roomID = p.RoomID
		}
		hub.Mu().RUnlock()
		if roomID != "" {
			hub.ForceLeave(playerID, roomID)
		}
	})
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		srv.Accept(ws)
	}))
	// closeOnce 让 defer cleanup() 和显式 cleanup() 重复调用也安全 (防 "close of closed channel")
	var closeOnce sync.Once
	return ts, func() {
		closeOnce.Do(func() {
			ts.Close()
			hub.Stop()
		})
	}
}

// dialAndHandshake 模拟 Godot 客户端: 拨号 → 握手 → 返回 player_id
func dialAndHandshake(t *testing.T, url string) (*websocket.Conn, string) {
	t.Helper()
	ws, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	hs := &wildwoodv1.C2S_Handshake{
		ClientVersion: "0.1.0",
		PlayerName:    "m110-tester",
	}
	hsBytes, _ := proto.Marshal(hs)
	frame, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_Handshake", Payload: hsBytes})
	if err := ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		t.Fatalf("write handshake: %v", err)
	}
	_, data, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read handshake ack: %v", err)
	}
	frames, err := codec.NewReader().Feed(data)
	if err != nil {
		t.Fatalf("feed frames: %v", err)
	}
	if len(frames) == 0 {
		t.Fatal("no frames in handshake ack")
	}
	ack, err := codec.UnmarshalFrame(frames[0])
	if err != nil {
		t.Fatalf("unmarshal ack: %v", err)
	}
	hsAck, ok := ack.(*wildwoodv1.S2C_HandshakeAck)
	if !ok {
		t.Fatalf("expected S2C_HandshakeAck, got %T", ack)
	}
	return ws, hsAck.PlayerId
}

// TestM110_Heartbeat_RTT_Under1s
//
// 验证 M1.10 验收 ①: 客户端发 heartbeat, 服务端 1s 内回 pong.
//
// 测法: 周期性发 C2S_Heartbeat 30 次 (M1.10 demo 节奏),
// 每条测 (server_time_ms - client_time_ms) 时延.
// 断言: max RTT < 1s, avg RTT < 200ms (远低于 1s 硬约束,留余量给网络)
func TestM110_Heartbeat_RTT_Under1s(t *testing.T) {
	ts, cleanup := startHeartbeatHub(t)
	defer cleanup()

	ws, playerID := dialAndHandshake(t, httpToWS(ts.URL)+"/ws")
	defer ws.Close()
	t.Logf("handshake OK, player_id=%s", playerID)

	reader := codec.NewReader()
	const N = 30 // 30 次心跳
	var maxRTTMs atomic.Int64
	var totalRTTMs atomic.Int64
	maxRTTMs.Store(0)

	for i := uint32(0); i < N; i++ {
		clientTime := uint64(time.Now().UnixMilli())
		hb := &wildwoodv1.C2S_Heartbeat{
			ClientTimeMs: clientTime,
			PingSeq:      i,
		}
		hbBytes, _ := proto.Marshal(hb)
		frame, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_Heartbeat", Payload: hbBytes})
		_ = ws.SetWriteDeadline(time.Now().Add(1 * time.Second))
		if err := ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
			t.Fatalf("write heartbeat #%d: %v", i, err)
		}

		_ = ws.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, data, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("read heartbeat ack #%d: %v", i, err)
		}
		frames, err := reader.Feed(data)
		if err != nil || len(frames) == 0 {
			t.Fatalf("frames parse #%d: err=%v", i, err)
		}
		ack, err := codec.UnmarshalFrame(frames[0])
		if err != nil {
			t.Fatalf("unmarshal ack #%d: %v", i, err)
		}
		hbAck, ok := ack.(*wildwoodv1.S2C_HeartbeatAck)
		if !ok {
			t.Fatalf("expected S2C_HeartbeatAck, got %T", ack)
		}
		if hbAck.PingSeq != i {
			t.Errorf("ack.ping_seq=%d, want %d", hbAck.PingSeq, i)
		}
		if hbAck.ClientTimeMs != clientTime {
			t.Errorf("ack.client_time_ms=%d, want %d", hbAck.ClientTimeMs, clientTime)
		}
		rtt := int64(hbAck.ServerTimeMs) - int64(clientTime)
		if rtt < 0 {
			rtt = 0
		}
		totalRTTMs.Add(rtt)
		for {
			old := maxRTTMs.Load()
			if rtt <= old || maxRTTMs.CompareAndSwap(old, rtt) {
				break
			}
		}
		if rtt > 1000 {
			t.Errorf("heartbeat #%d RTT=%dms > 1s 硬约束 (M1.10 验收 ①)", i, rtt)
		}
	}

	avg := totalRTTMs.Load() / int64(N)
	max := maxRTTMs.Load()
	t.Logf("✓ M1.10 验收 ①: %d 次 heartbeat, avg RTT=%dms, max RTT=%dms (< 1s 硬约束)",
		N, avg, max)

	if max >= 1000 {
		t.Errorf("max RTT=%dms >= 1000ms 违反验收 ①", max)
	}
	if avg >= 200 {
		t.Errorf("avg RTT=%dms >= 200ms 留余量不足 (期望 < 200ms)", avg)
	}
}

// TestM110_Heartbeat_WorksBeforeHandshake
//
// 验证握手前发 heartbeat 也回 pong — 协议层不强制顺序,
// 客户端实现中可优先发 heartbeat 检测连通性。
func TestM110_Heartbeat_WorksBeforeHandshake(t *testing.T) {
	ts, cleanup := startHeartbeatHub(t)
	defer cleanup()

	ws, _, err := websocket.DefaultDialer.Dial(httpToWS(ts.URL)+"/ws", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer ws.Close()

	hb := &wildwoodv1.C2S_Heartbeat{
		ClientTimeMs: uint64(time.Now().UnixMilli()),
		PingSeq:      0,
	}
	hbBytes, _ := proto.Marshal(hb)
	frame, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_Heartbeat", Payload: hbBytes})
	if err := ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		t.Fatalf("write heartbeat: %v", err)
	}
	_ = ws.SetReadDeadline(time.Now().Add(1 * time.Second))
	_, data, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v (期望: 即使未 handshake, heartbeat 仍能工作)", err)
	}
	frames, _ := codec.NewReader().Feed(data)
	if len(frames) == 0 {
		t.Fatal("no frames")
	}
	ack, _ := codec.UnmarshalFrame(frames[0])
	if _, ok := ack.(*wildwoodv1.S2C_HeartbeatAck); !ok {
		t.Fatalf("expected S2C_HeartbeatAck, got %T", ack)
	}
	t.Logf("✓ heartbeat 在 handshake 之前也能工作 (回 pong) — 协议层不强制顺序")
}
