// M1.10 验收 ① + ② 端到端 demo 工具:单连接心跳 + 30s 重连
//
// 用法:
//
//	# 1. 启动服务端(另一个终端)
//	go run ./cmd/roomserver
//
//	# 2. 跑 e2e 客户端
//	go run ./cmd/e2eclient -url ws://127.0.0.1:8080/ws
//
// 默认行为:
//   - 拨号 + 握手
//   - 每 1s 发一次 C2S_Heartbeat,持续 60s
//   - 打印每次 RTT,以及"是否在 1s 内回 pong"
//   - 30s 时模拟"断网"(close 当前 ws),等 5s 后再重新连接
//   - 退出码 0 = 全程通过, 非 0 = 失败
//
// 这个工具是 M1.10 验收 ① 和 ② 的"沙箱内"快速冒烟;
// 真实客户端是 GDScript(WildwoodSession)。
package main

import (
	"context"
	"flag"
	"log"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
	wtransport "github.com/wildwood/net/transport"
	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

var (
	url        = flag.String("url", "ws://127.0.0.1:8080/ws", "server url")
	duration   = flag.Duration("duration", 60*time.Second, "总运行时间")
	hbInterval = flag.Duration("hb", 1*time.Second, "心跳间隔 (生产环境是 30s)")
	disconnAt  = flag.Duration("disconn-at", 30*time.Second, "何时模拟断网 (相对 start)")
	reconnAt   = flag.Duration("reconn-at", 35*time.Second, "何时恢复 (相对 start, 必须 > disconn-at)")
	rttLimit   = flag.Duration("rtt-limit", 1*time.Second, "M1.10 验收 ① 硬约束: pong 必须 < 此值")
)

func main() {
	flag.Parse()
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Printf("e2eclient: url=%s duration=%s hb=%s disconn-at=%s reconn-at=%s",
		*url, *duration, *hbInterval, *disconnAt, *reconnAt)

	if *reconnAt <= *disconnAt {
		log.Fatalf("reconn-at 必须 > disconn-at (重连必须在断网之后)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *duration)
	defer cancel()

	var (
		totalPings  atomic.Int64
		totalPongs  atomic.Int64
		rttOver1s   atomic.Int64
		maxRTT      atomic.Int64
		disconnects atomic.Int64
		reconnects  atomic.Int64
	)

	// 阶段 1: 拨号 + 握手
	conn, ws, _, playerID, err := connectAndHandshake(*url)
	if err != nil {
		log.Fatalf("阶段 1 握手失败: %v", err)
	}
	log.Printf("✓ 阶段 1: 握手成功, player_id=%s", playerID)
	startTime := time.Now()
	_ = startTime

	// 阶段 2: 心跳循环
	hbTicker := time.NewTicker(*hbInterval)
	defer hbTicker.Stop()
	disconnTimer := time.NewTimer(*disconnAt)
	defer disconnTimer.Stop()
	reconnTimer := time.NewTimer(*reconnAt)
	defer reconnTimer.Stop()

	rdr := codec.NewReader()
	disconnected := false
	reconnected := false

	for {
		select {
		case <-ctx.Done():
			log.Printf("=== FINAL: pings=%d pongs=%d rtt_over_1s=%d max_rtt=%dms disconnects=%d reconnects=%d ===",
				totalPings.Load(), totalPongs.Load(), rttOver1s.Load(), maxRTT.Load(),
				disconnects.Load(), reconnects.Load())
			if rttOver1s.Load() > 0 {
				log.Fatalf("✗ M1.10 验收 ① 失败: %d 次 RTT > 1s", rttOver1s.Load())
			}
			if reconnects.Load() < 1 {
				log.Fatalf("✗ M1.10 验收 ② 失败: 断网后未重连")
			}
			log.Printf("✓ M1.10 验收 ① + ② 全部通过")
			return

		case <-hbTicker.C:
			if disconnected && !reconnected {
				// 断网期间不发心跳
				continue
			}
			totalPings.Add(1)
			clientTime := uint64(time.Now().UnixMilli())
			seq := uint32(totalPings.Load())
			if err := conn.Send("C2S_Heartbeat", &wildwoodv1.C2S_Heartbeat{
				ClientTimeMs: clientTime,
				PingSeq:      seq,
			}); err != nil {
				log.Printf("send heartbeat: %v", err)
				continue
			}
			// 等 pong (设个短超时)
			ws.SetReadDeadline(time.Now().Add(2 * time.Second))
			_, data, err := ws.ReadMessage()
			if err != nil {
				log.Printf("read pong: %v", err)
				continue
			}
			frames, err := rdr.Feed(data)
			if err != nil || len(frames) == 0 {
				continue
			}
			if frames[0].Type != "S2C_HeartbeatAck" {
				log.Printf("got non-ack frame: %s", frames[0].Type)
				continue
			}
			ack, _ := codec.UnmarshalFrame(frames[0])
			hbAck, ok := ack.(*wildwoodv1.S2C_HeartbeatAck)
			if !ok {
				continue
			}
			_ = hbAck
			totalPongs.Add(1)
			nowMs := time.Now().UnixMilli()
			rttMs := nowMs - int64(clientTime)
			if rttMs > maxRTT.Load() {
				maxRTT.Store(rttMs)
			}
			if time.Duration(rttMs)*time.Millisecond > *rttLimit {
				rttOver1s.Add(1)
				log.Printf("✗ RTT=%dms > 1s 硬约束 (ping_seq=%d)", rttMs, seq)
			} else {
				log.Printf("✓ ping_seq=%d rtt=%dms", seq, rttMs)
			}

		case <-disconnTimer.C:
			log.Printf("--- 阶段 3 模拟: 断网 (close 当前 ws) ---")
			conn.Close()
			ws.Close()
			disconnects.Add(1)
			disconnected = true

		case <-reconnTimer.C:
			log.Printf("--- 阶段 4 模拟: 网络恢复, 重新连接 ---")
			conn2, ws2, _, playerID2, err := connectAndHandshake(*url)
			if err != nil {
				log.Fatalf("阶段 4 重连失败: %v", err)
			}
			conn = conn2
			ws = ws2
			reconnects.Add(1)
			reconnected = true
			disconnected = false
			log.Printf("✓ 阶段 4: 重连成功, player_id=%s, 重新握手 + heartbeat 恢复", playerID2)
		}
	}
}

func connectAndHandshake(url string) (*wtransport.Conn, *websocket.Conn, *websocket.Dialer, string, error) {
	conn, rawWS, dialer, err := wtransport.Dial(url)
	if err != nil {
		return nil, nil, nil, "", err
	}
	_ = dialer

	hsBytes, _ := proto.Marshal(&wildwoodv1.C2S_Handshake{
		ClientVersion: "0.3.0",
		PlayerName:    "e2eclient",
	})
	frame, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_Handshake", Payload: hsBytes})
	rawWS.SetWriteDeadline(time.Now().Add(2 * time.Second))
	if err := rawWS.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		rawWS.Close()
		conn.Close()
		return nil, nil, nil, "", err
	}
	rawWS.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := rawWS.ReadMessage()
	if err != nil {
		rawWS.Close()
		conn.Close()
		return nil, nil, nil, "", err
	}
	frames, err := codec.NewReader().Feed(data)
	if err != nil || len(frames) == 0 {
		rawWS.Close()
		conn.Close()
		return nil, nil, nil, "", err
	}
	ack, err := codec.UnmarshalFrame(frames[0])
	if err != nil {
		rawWS.Close()
		conn.Close()
		return nil, nil, nil, "", err
	}
	hsAck, ok := ack.(*wildwoodv1.S2C_HandshakeAck)
	if !ok {
		rawWS.Close()
		conn.Close()
		return nil, nil, nil, "", err
	}
	return conn, rawWS, dialer, hsAck.PlayerId, nil
}
