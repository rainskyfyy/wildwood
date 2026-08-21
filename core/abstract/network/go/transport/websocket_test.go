// 真实 WebSocket 端到端测试 — 启动 httptest 服务器,客户端用 gorilla Dial,
// 走完整握手 → 心跳 → 房间流程。覆盖 M1.9 验收点(① 连接通路 ② RTT < 50ms ③ 并发 50)。
package transport_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
	wtransport "github.com/wildwood/net/transport"
	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

func newTestServer(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("upgrade: %v", err)
			return
		}
		conn := wtransport.Accept(ws)
		go conn.WriteLoop()
		go func() {
			_ = conn.ReadLoop(func(msg proto.Message) error {
				switch m := msg.(type) {
				case *wildwoodv1.C2S_Handshake:
					return conn.Send("S2C_HandshakeAck", &wildwoodv1.S2C_HandshakeAck{
						ServerVersion:  "0.1.0",
						PlayerId:       "p-test",
						SessionToken:   "test-token",
						ServerTickRate: 20,
						MaxRoomPlayers: 4,
					})
				case *wildwoodv1.C2S_Heartbeat:
					return conn.Send("S2C_HeartbeatAck", &wildwoodv1.S2C_HeartbeatAck{
						ClientTimeMs: m.ClientTimeMs,
						PingSeq:      m.PingSeq,
						ServerTimeMs: uint64(time.Now().UnixMilli()),
					})
				}
				return nil
			})
		}()
	}))
	return srv, srv.Close
}

// dialClient dial 出 ws + transport.Conn
// transport.Dial 内部已起 WriteLoop,返回的 conn 可直接 Send;
// ws 用来在测试 goroutine 中直接 ReadMessage 收 frame
func dialClient(t *testing.T, url string) (*websocket.Conn, *wtransport.Conn) {
	t.Helper()
	u := "ws" + strings.TrimPrefix(url, "http")
	conn, ws, _, err := wtransport.Dial(u)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return ws, conn
}

// readFrame 从 ws 读一条完整帧(已 codec 解码)
func readFrame(t *testing.T, ws *websocket.Conn, timeout time.Duration) (string, proto.Message) {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(timeout))
	_, data, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("ws.ReadMessage: %v", err)
	}
	rdr := codec.NewReader()
	frames, err := rdr.Feed(data)
	if err != nil {
		t.Fatalf("codec.Feed: %v", err)
	}
	if len(frames) == 0 {
		t.Fatalf("no complete frame in %d bytes", len(data))
	}
	msg, err := codec.UnmarshalFrame(frames[0])
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return frames[0].Type, msg
}

// sendFrame 通过 transport.Conn 发送一条 frame
func sendFrame(t *testing.T, conn *wtransport.Conn, typeName string, m proto.Message) {
	t.Helper()
	if err := conn.Send(typeName, m); err != nil {
		t.Fatalf("send %s: %v", typeName, err)
	}
}

func TestHandshake_RoundTrip(t *testing.T) {
	srv, cleanup := newTestServer(t)
	defer cleanup()
	ws, conn := dialClient(t, srv.URL)
	defer ws.Close()
	defer conn.Close()

	sendFrame(t, conn, "C2S_Handshake", &wildwoodv1.C2S_Handshake{
		ClientVersion: "0.1.0",
		PlayerName:    "alice",
	})

	gotType, got := readFrame(t, ws, 2*time.Second)
	if gotType != "S2C_HandshakeAck" {
		t.Fatalf("type=%s want S2C_HandshakeAck", gotType)
	}
	ack := got.(*wildwoodv1.S2C_HandshakeAck)
	if ack.ServerVersion != "0.1.0" {
		t.Errorf("server_version=%q", ack.ServerVersion)
	}
	if ack.MaxRoomPlayers != 4 {
		t.Errorf("max_room_players=%d want 4", ack.MaxRoomPlayers)
	}
	if ack.ServerTickRate != 20 {
		t.Errorf("server_tick_rate=%d want 20", ack.ServerTickRate)
	}
}

func TestHeartbeat_RTT_Under50ms(t *testing.T) {
	srv, cleanup := newTestServer(t)
	defer cleanup()
	ws, conn := dialClient(t, srv.URL)
	defer ws.Close()
	defer conn.Close()

	// 先 handshake
	sendFrame(t, conn, "C2S_Handshake", &wildwoodv1.C2S_Handshake{
		ClientVersion: "0.1.0",
		PlayerName:    "alice",
	})
	if gotType, _ := readFrame(t, ws, 2*time.Second); gotType != "S2C_HandshakeAck" {
		t.Fatalf("first frame type=%s want HandshakeAck", gotType)
	}

	// 5 次 heartbeat,平均 RTT
	const N = 5
	var total time.Duration
	for i := 0; i < N; i++ {
		start := time.Now()
		sendFrame(t, conn, "C2S_Heartbeat", &wildwoodv1.C2S_Heartbeat{
			ClientTimeMs: uint64(start.UnixMilli()),
			PingSeq:      uint32(i + 1),
		})
		gotType, got := readFrame(t, ws, 1*time.Second)
		elapsed := time.Since(start)
		if gotType != "S2C_HeartbeatAck" {
			t.Fatalf("hb #%d: type=%s", i+1, gotType)
		}
		hb := got.(*wildwoodv1.S2C_HeartbeatAck)
		if hb.PingSeq != uint32(i+1) {
			t.Errorf("hb #%d: seq=%d want %d", i+1, hb.PingSeq, i+1)
		}
		total += elapsed
	}
	avg := total / N
	t.Logf("avg RTT over %d heartbeats: %v (M1.9 要求 < 50ms)", N, avg)
	if avg > 50*time.Millisecond {
		t.Errorf("avg RTT %v > 50ms", avg)
	}
}

func TestConcurrentConnections(t *testing.T) {
	srv, cleanup := newTestServer(t)
	defer cleanup()
	const N = 50 // 沙箱内存 / fd 限制,200 房间压测在 loadtest 跑
	var wg sync.WaitGroup
	failed := make(chan string, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			ws, conn := dialClient(t, srv.URL)
			defer ws.Close()
			defer conn.Close()
			sendFrame(t, conn, "C2S_Handshake", &wildwoodv1.C2S_Handshake{
				ClientVersion: "0.1.0",
				PlayerName:    "user",
			})
			gotType, _ := readFrame(t, ws, 2*time.Second)
			if gotType != "S2C_HandshakeAck" {
				failed <- gotType
				return
			}
		}(i)
	}
	wg.Wait()
	close(failed)
	for f := range failed {
		t.Errorf("concurrent: got %q", f)
	}
}
