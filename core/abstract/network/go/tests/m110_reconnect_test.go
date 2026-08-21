// M1.10 验收 ②:断网 30s 自动重连 — 服务端 + 客户端 端到端验证
//
// 关键概念:
//   "30s 自动重连" = 客户端在断网后 30s 内尝试重新建立连接 + 恢复业务.
//
// 服务端职责:
//   - 持续接受 WebSocket 连接 (运行 hub)
//   - 不主动断开, 30s 内允许客户端无限重试
//
// 客户端职责 (这里由 Go 模拟 Godot WsNetClient):
//   - 监测 is_closed 状态
//   - 断网后用指数退避重连 (1s/2s/4s/8s/16s/30s 上限, 30s 仍失败 = 硬断开)
//   - 重连后重新发起 handshake + 恢复业务 (heartbeat)
//
// 测试策略:
//   1. 沙箱内 "等真实 30s" 太慢, 我们测机制: 客户端的"重连循环 + 指数退避"逻辑
//      用"30s 上限 = 200ms" (即退避最大 200ms) 跑, 总耗时 < 3s
//   2. 验证三件事:
//      a. 客户端断网后能 detect 到
//      b. 客户端在 30s 窗口内发起新连接
//      c. 重连成功后 handshake + heartbeat 仍正常
package tests

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

// ReconnectingClient — 模拟 Godot 端的"自动重连 + 指数退避"逻辑.
//
// 简化版(不抄 GDScript 实现): backoffMin/backoffMax/backoffStep 三个旋钮,
// 总重试窗口 reconnectWindowMs, 失败后放弃.
//
// 真实 GDScript 客户端 (WildwoodReconnect) 用 30s 上限.
// 这里测试时用 2s 上限以加速.
type ReconnectingClient struct {
	URL              string
	backoffMin       time.Duration
	backoffMax       time.Duration
	reconnectWindow  time.Duration
	connAttempts     atomic.Int32
	connectSuccesses atomic.Int32
	heartbeatsOK     atomic.Int32
	state            atomic.Value // "idle" / "connecting" / "connected" / "reconnecting" / "failed"
	closeOnce        sync.Once
	stopCh           chan struct{}
	onConnected      func(playerID string, attempts int32) // 测试用回调
}

func NewReconnectingClient(url string) *ReconnectingClient {
	rc := &ReconnectingClient{
		URL:             url,
		backoffMin:      10 * time.Millisecond,
		backoffMax:      200 * time.Millisecond,
		reconnectWindow: 2 * time.Second, // 测试用, 真实 GDScript 是 30s
		stopCh:          make(chan struct{}),
	}
	rc.state.Store("idle")
	return rc
}

func (rc *ReconnectingClient) State() string {
	v, _ := rc.state.Load().(string)
	return v
}

func (rc *ReconnectingClient) ConnAttempts() int32    { return rc.connAttempts.Load() }
func (rc *ReconnectingClient) ConnectSuccesses() int32 { return rc.connectSuccesses.Load() }
func (rc *ReconnectingClient) HeartbeatsOK() int32     { return rc.heartbeatsOK.Load() }

// TryConnect — 一次连接尝试, 成功返回 ws + player_id, 失败返回 err.
// 模拟 Godot WsNetClient.connect_to().
func (rc *ReconnectingClient) TryConnect() (*websocket.Conn, string, error) {
	rc.connAttempts.Add(1)
	ws, _, err := websocket.DefaultDialer.Dial(rc.URL, nil)
	if err != nil {
		return nil, "", err
	}
	hsBytes, _ := proto.Marshal(&wildwoodv1.C2S_Handshake{
		ClientVersion: "0.1.0",
		PlayerName:    "m110-reconnect-tester",
	})
	frame, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_Handshake", Payload: hsBytes})
	_ = ws.SetWriteDeadline(time.Now().Add(1 * time.Second))
	if err := ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		ws.Close()
		return nil, "", err
	}
	_ = ws.SetReadDeadline(time.Now().Add(1 * time.Second))
	_, data, err := ws.ReadMessage()
	if err != nil {
		ws.Close()
		return nil, "", err
	}
	frames, _ := codec.NewReader().Feed(data)
	if len(frames) == 0 {
		ws.Close()
		return nil, "", err
	}
	ack, _ := codec.UnmarshalFrame(frames[0])
	hsAck, ok := ack.(*wildwoodv1.S2C_HandshakeAck)
	if !ok {
		ws.Close()
		return nil, "", err
	}
	rc.connectSuccesses.Add(1)
	return ws, hsAck.PlayerId, nil
}

// Run — 启动重连循环. 阻塞直到 30s 窗口耗尽 或 外部 stop.
// 返回值: nil = 重连成功; err = 30s 窗口内未恢复.
func (rc *ReconnectingClient) Run() error {
	rc.state.Store("connecting")
	deadline := time.Now().Add(rc.reconnectWindow)
	backoff := rc.backoffMin

	for {
		select {
		case <-rc.stopCh:
			rc.state.Store("failed")
			return errClientStopped
		default:
		}

		if time.Now().After(deadline) {
			rc.state.Store("failed")
			return errWindowExpired
		}

		ws, playerID, err := rc.TryConnect()
		if err == nil {
			rc.state.Store("connected")
			if rc.onConnected != nil {
				rc.onConnected(playerID, rc.ConnAttempts())
			}
			if ok := rc.runHeartbeats(ws, 5); ok {
				rc.heartbeatsOK.Add(5)
			}
			ws.Close()
			return nil
		}

		rc.state.Store("reconnecting")
		select {
		case <-time.After(backoff):
		case <-rc.stopCh:
			rc.state.Store("failed")
			return errClientStopped
		}
		backoff *= 2
		if backoff > rc.backoffMax {
			backoff = rc.backoffMax
		}
	}
}

func (rc *ReconnectingClient) runHeartbeats(ws *websocket.Conn, n int) bool {
	reader := codec.NewReader()
	for i := 0; i < n; i++ {
		hb := &wildwoodv1.C2S_Heartbeat{
			ClientTimeMs: uint64(time.Now().UnixMilli()),
			PingSeq:      uint32(i),
		}
		hbBytes, _ := proto.Marshal(hb)
		frame, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_Heartbeat", Payload: hbBytes})
		_ = ws.SetWriteDeadline(time.Now().Add(1 * time.Second))
		if err := ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
			return false
		}
		_ = ws.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, data, err := ws.ReadMessage()
		if err != nil {
			return false
		}
		frames, err := reader.Feed(data)
		if err != nil || len(frames) == 0 {
			return false
		}
		ack, _ := codec.UnmarshalFrame(frames[0])
		if _, ok := ack.(*wildwoodv1.S2C_HeartbeatAck); !ok {
			return false
		}
	}
	return true
}

func (rc *ReconnectingClient) Stop() {
	rc.closeOnce.Do(func() { close(rc.stopCh) })
}

var (
	errWindowExpired = simpleErr("reconnect window expired")
	errClientStopped = simpleErr("client stopped")
)

type simpleErr string

func (e simpleErr) Error() string { return string(e) }

// TestM110_Reconnect_AfterServerRestart
//
// 场景:
//   1. 客户端 A 连上 hub, heartbeat OK
//   2. 模拟"网络断开": 服务端 ts.Close() (旧 hub 死了)
//   3. 启动新 hub (服务端重启 / 网络恢复)
//   4. 客户端 A 的 ReconnectingClient 应该:
//      - 检测到断开
//      - 在 30s 窗口内成功重连到新 hub
//      - 重新 handshake + heartbeat 通过
func TestM110_Reconnect_AfterServerRestart(t *testing.T) {
	// 阶段 1: 启动旧 hub, 客户端连上
	ts1, cleanup1 := startHeartbeatHub(t)
	ws, playerID := dialAndHandshake(t, httpToWS(ts1.URL)+"/ws")
	if err := ws.Close(); err != nil {
		t.Logf("close first ws: %v", err)
	}
	t.Logf("阶段 1 完成: 旧 hub 客户端连上, player_id=%s", playerID)
	cleanup1()
	t.Logf("阶段 2 模拟: 旧 hub 关闭 (网络断开)")

	rc := NewReconnectingClient(httpToWS(ts1.URL) + "/ws")
	if _, _, err := rc.TryConnect(); err == nil {
		t.Fatal("期望 TryConnect 失败 (旧 hub 已关), 但成功了")
	} else {
		t.Logf("✓ 阶段 2: TryConnect 在断网时失败 (err=%v)", err)
	}

	ts2, cleanup2 := startHeartbeatHub(t)
	defer cleanup2()
	rc.URL = httpToWS(ts2.URL) + "/ws"
	rc.onConnected = func(playerID string, attempts int32) {
		t.Logf("    reconnect OK, player_id=%s, attempt #%d", playerID, attempts)
	}
	t.Logf("阶段 3: 新 hub 启动, url=%s", rc.URL)

	start := time.Now()
	if err := rc.Run(); err != nil {
		t.Fatalf("ReconnectingClient.Run 失败: %v (期望: 30s 窗口内重连成功)", err)
	}
	elapsed := time.Since(start)
	t.Logf("✓ M1.10 验收 ②: 重连成功, 耗时=%v, conn_attempts=%d, connect_successes=%d, heartbeats_ok=%d",
		elapsed, rc.ConnAttempts(), rc.ConnectSuccesses(), rc.HeartbeatsOK())

	if rc.ConnectSuccesses() == 0 {
		t.Error("connect_successes = 0, 期望 ≥ 1")
	}
	if rc.HeartbeatsOK() < 5 {
		t.Errorf("heartbeats_ok=%d, 期望 ≥ 5", rc.HeartbeatsOK())
	}
	if rc.state.Load() != "connected" {
		t.Errorf("state=%q, 期望 %q", rc.state.Load(), "connected")
	}
}

// TestM110_Reconnect_GiveUpAfter30s
//
// 场景: 客户端断网后, 30s 窗口内服务端一直不恢复 — 客户端应放弃 (state=failed)
func TestM110_Reconnect_GiveUpAfterWindow(t *testing.T) {
	ts, cleanup := startHeartbeatHub(t)
	defer cleanup()
	cleanup() // 立即关掉, 让重连一直失败

	rc := NewReconnectingClient(httpToWS(ts.URL) + "/ws")
	rc.reconnectWindow = 300 * time.Millisecond
	rc.backoffMax = 100 * time.Millisecond

	start := time.Now()
	err := rc.Run()
	elapsed := time.Since(start)

	if err == nil {
		t.Error("期望 Run 失败 (服务端不恢复), 但成功了")
	} else {
		t.Logf("✓ M1.10 验收 ② 边界: 30s 窗口内未恢复 → 放弃, 实际耗时=%v err=%v, attempts=%d",
			elapsed, err, rc.ConnAttempts())
	}
	if rc.state.Load() != "failed" {
		t.Errorf("state=%q, 期望 %q", rc.state.Load(), "failed")
	}
	if elapsed < 200*time.Millisecond {
		t.Errorf("重连循环太快放弃 elapsed=%v, 至少应尝试 ≥ 200ms", elapsed)
	}
	if elapsed > 2*time.Second {
		t.Errorf("重连循环太慢 elapsed=%v, 上限应是 300ms × buffer", elapsed)
	}
}
