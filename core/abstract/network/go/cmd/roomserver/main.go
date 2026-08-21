// Package main: 房间服务主程序 — 启动 HTTP + WebSocket,接收客户端连接,转发到 hub。
//
// 启动方式:
//
//	./roomserver -addr :8080 -tick 20
//
// 环境变量(可覆盖 flag):
//
//	WILDWOOD_ROOM_ADDR   默认 :8080
//	WILDWOOD_ROOM_TICK   默认 20
//	WILDWOOD_ROOM_MAX    默认 1000
//
// M1.9 验收:
//   ① 200 房间 × 4 = 800 连接(同机房压测通过)
//   ② RTT < 50ms(heartbeatAck / RoomCreate 等小消息)
//   ③ 心跳超时断开(60s 无 C2S → 关闭)
//   ④ Dockerfile + docker-compose 一键起
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gorilla/websocket"

	"github.com/wildwood/net/room"
	"github.com/wildwood/net/transport"
)

var (
	addr        = flag.String("addr", envOr("WILDWOOD_ROOM_ADDR", ":8080"), "listen address")
	tickHz      = flag.Int("tick", envOrInt("WILDWOOD_ROOM_TICK", 20), "world tick rate (Hz)")
	maxConn     = flag.Int("max-conn", envOrInt("WILDWOOD_ROOM_MAX", 1000), "max concurrent connections")
	healthcheck = flag.Bool("healthcheck", false, "run healthcheck against local /health and exit (for docker healthcheck in distroless)")
)

func main() {
	flag.Parse()
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	// -healthcheck 模式:对本地 /health 探活,供 distroless 容器做 docker healthcheck
	if *healthcheck {
		runHealthcheck()
		return
	}

	log.Printf("roomserver starting: addr=%s tick=%dHz max-conn=%d", *addr, *tickHz, *maxConn)

	hub := room.NewHub(*tickHz)
	hub.Start()
	defer hub.Stop()

	srv := room.NewServer(hub)
	srv.SetOnDisconnect(func(playerID string, _ *transport.Conn) {
		// 简化:断线立即从房间移除(M3.7 升级为 5 分钟墓碑)
		hub.Mu().RLock()
		var roomID string
		if p, ok := hub.Players()[playerID]; ok {
			roomID = p.RoomID
		}
		hub.Mu().RUnlock()
		if roomID == "" {
			return
		}
		hub.ForceLeave(playerID, roomID)
		log.Printf("player %s disconnected from room %s", playerID, roomID)
	})

	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin:     func(r *http.Request) bool { return true }, // TODO: M3 限同源
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		if srv.ConnCount() >= int64(*maxConn) {
			http.Error(w, "server full", http.StatusServiceUnavailable)
			return
		}
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("upgrade failed: %v", err)
			return
		}
		log.Printf("ws accepted from %s (active=%d)", r.RemoteAddr, srv.ConnCount()+1)
		srv.Accept(ws)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		stats := srv.Stats()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","active_conns":` +
			strconv.FormatInt(stats.ActiveConns, 10) + `,"total_accepted":` +
			strconv.FormatUint(stats.TotalAccepted, 10) + `,"total_closed":` +
			strconv.FormatUint(stats.TotalClosed, 10) + `}`))
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		stats := srv.Stats()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"active_conns":` + strconv.FormatInt(stats.ActiveConns, 10) +
			`,"total_accepted":` + strconv.FormatUint(stats.TotalAccepted, 10) +
			`,"total_closed":` + strconv.FormatUint(stats.TotalClosed, 10) + `}`))
	})

	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// 优雅退出
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("ListenAndServe: %v", err)
		}
	}()
	log.Printf("roomserver listening on %s (ws=/ws health=/health stats=/stats)", *addr)

	<-ctx.Done()
	log.Printf("roomserver shutting down...")
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutCancel()
	_ = httpSrv.Shutdown(shutCtx)
	log.Printf("roomserver stopped")
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envOrInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// runHealthcheck 对本地 /health 探活;返回 0 表示 OK,非 0 表示失败。
// docker healthcheck 模式:distroless 容器无 shell,直接复用主二进制。
func runHealthcheck() {
	// 把 ":8080" → "http://127.0.0.1:8080/health"
	host := *addr
	if host == "" || host[0] == ':' {
		host = "127.0.0.1" + host
	}
	url := "http://" + host + "/health"
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("healthcheck: %v", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("healthcheck: status=%d", resp.StatusCode)
		os.Exit(1)
	}
	os.Exit(0)
}
