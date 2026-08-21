// M1.9 验收 ① + ② 压测:模拟 N 个并发连接到 server,持续心跳,
// 记录 RTT / 错误率 / 内存增长。
//
// 用法:
//
//	go run ./cmd/loadtest -url ws://localhost:8080/ws -conns 100 -duration 30s
//
// 沙箱内 1C4G 跑 100-200 连接可承受;800 连接建议放到生产环境。
package main

import (
	"context"
	"flag"
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
	wtransport "github.com/wildwood/net/transport"
	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

var (
	url      = flag.String("url", "ws://localhost:8080/ws", "server url")
	conns    = flag.Int("conns", 100, "concurrent connections")
	duration = flag.Duration("duration", 30*time.Second, "test duration")
	hbInt    = flag.Duration("hb", 2*time.Second, "heartbeat interval per conn")
	memSamp  = flag.Duration("mem-sample", 5*time.Second, "memory sample interval")
)

func main() {
	flag.Parse()
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Printf("loadtest: url=%s conns=%d duration=%s hb=%s",
		*url, *conns, *duration, *hbInt)

	ctx, cancel := context.WithTimeout(context.Background(), *duration)
	defer cancel()

	var totalRTT atomic.Int64
	var rttCount atomic.Int64
	var errCount atomic.Int64
	var hbCount atomic.Int64

	// 内存采样
	go func() {
		t := time.NewTicker(*memSamp)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				var m runtime.MemStats
				runtime.ReadMemStats(&m)
				log.Printf("mem: heap=%dMB sys=%dMB conns=%d errs=%d hbs=%d avg_rtt=%v",
					m.HeapAlloc/1024/1024, m.Sys/1024/1024,
					*conns, errCount.Load(), hbCount.Load(),
					avgDuration(totalRTT.Load(), rttCount.Load()))
			}
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < *conns; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			runOneConn(ctx, idx, &totalRTT, &rttCount, &errCount, &hbCount)
		}(i)
	}

	<-ctx.Done()
	// 等待所有 conn 收到 ctx.Done 主动退出
	wg.Wait()

	finalAvg := avgDuration(totalRTT.Load(), rttCount.Load())
	log.Printf("=== FINAL: conns=%d total_hbs=%d total_rtt_count=%d errs=%d avg_rtt=%v ===",
		*conns, hbCount.Load(), rttCount.Load(), errCount.Load(), finalAvg)

	var m runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m)
	log.Printf("=== FINAL MEM: heap=%dMB sys=%dMB ===", m.HeapAlloc/1024/1024, m.Sys/1024/1024)
}

func avgDuration(totalNs, count int64) time.Duration {
	if count == 0 {
		return 0
	}
	return time.Duration(totalNs / count)
}

func runOneConn(ctx context.Context, idx int, totalRTT, rttCount, errCount, hbCount *atomic.Int64) {
	d := websocket.DefaultDialer
	d.ReadBufferSize = 4096
	d.WriteBufferSize = 4096
	ws, _, err := d.Dial(*url, nil)
	if err != nil {
		log.Printf("conn %d dial: %v", idx, err)
		errCount.Add(1)
		return
	}
	defer ws.Close()
	conn, _, _, err := wtransport.Dial(*url)
	if err != nil {
		log.Printf("conn %d dial2: %v", idx, err)
		errCount.Add(1)
		return
	}
	defer conn.Close()

	// handshake
	if err := conn.Send("C2S_Handshake", &wildwoodv1.C2S_Handshake{
		ClientVersion: "0.1.0",
		PlayerName:    "loadtest",
	}); err != nil {
		log.Printf("conn %d send: %v", idx, err)
		errCount.Add(1)
		return
	}
	// 收 HandshakeAck(读 ws)
	rdr := codec.NewReader()
	_, data, err := ws.ReadMessage()
	if err != nil {
		log.Printf("conn %d read ack: %v", idx, err)
		errCount.Add(1)
		return
	}
	frames, err := rdr.Feed(data)
	if err != nil || len(frames) == 0 {
		log.Printf("conn %d feed ack: %v", idx, err)
		errCount.Add(1)
		return
	}
	var firstAck proto.Message
	firstAck, err = codec.UnmarshalFrame(frames[0])
	if err != nil {
		log.Printf("conn %d unmarshal ack: %v", idx, err)
		errCount.Add(1)
		return
	}
	_ = firstAck

	// 心跳循环
	t := time.NewTicker(*hbInt)
	defer t.Stop()
	var seq uint32
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			seq++
			start := time.Now()
			if err := conn.Send("C2S_Heartbeat", &wildwoodv1.C2S_Heartbeat{
				ClientTimeMs: uint64(start.UnixMilli()),
				PingSeq:      seq,
			}); err != nil {
				errCount.Add(1)
				return
			}
			ws.SetReadDeadline(time.Now().Add(5 * time.Second))
			_, data, err := ws.ReadMessage()
			elapsed := time.Since(start)
			if err != nil {
				errCount.Add(1)
				return
			}
			frames, err := rdr.Feed(data)
			if err != nil || len(frames) == 0 {
				errCount.Add(1)
				continue
			}
			if frames[0].Type != "S2C_HeartbeatAck" {
				errCount.Add(1)
				continue
			}
			hbCount.Add(1)
			totalRTT.Add(int64(elapsed))
			rttCount.Add(1)
		}
	}
}
