# 更新日志

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已计划
- M1.2 CI/CD 雏形
- M1.3 GUT + Playwright 测试框架
- M1.6 资源元数据抽象
- M1.10 客户端协议语义 + 1.11 联调
- M1.12-1.13 5 张样稿 + Aseprite 工作流

## [0.1.0] - 2026-08-20

### 新增
- M1.1 项目初始化:Godot 4.3 工程骨架 + Git 仓库
- 目录结构:`core/` / `scripts/` / `scenes/` / `assets/` / `tests/`
- `project.godot` 主配置(含 4.3 feature tag、WASD 输入映射、像素 snapping、6 层渲染)

## M1.5 — 网络协议语义层(2026-08-20)

- 新增 Protobuf 协议定义:`core/abstract/network/proto/wildwood/v1/{common,c2s,s2c,wildwood}.proto`
- Go 端 codec + 注册表 + mock 管道:`go/{codec,mocks}/`(34 单测通过)
- GDScript 端手写 wire format codec:`gd/{wildwood_wire,common,c2s,s2c,net}.gd`
- GDScript mock 客户端/服务端(对标 Go mocks):`gd/wildwood_net.gd`
- 字节预算:worst-case WorldDelta(4 人+200 实体) = 2851 bytes < 4KB ✓
- Python 独立验证器:`python3/verify_wire.py`(17 个 wire format 用例)
- 真实传输层(NetClient/NetServer)stub:M1.9 由工作台搭建师补 WebSocket/UDP
- A/B 通用:协议与传输解耦,Godot 4.3 / Unity 6 双端可走同一 .proto

## M1.9 — 传输层接入(2026-08-20)

### 新增
- **Go 房间服务**(服务端)
  - `core/abstract/network/go/transport/websocket.go` — 基于 gorilla/websocket v1.5.3 的 `Conn` 抽象(`Accept`/`Dial` + 1 读 1 写 goroutine + 30s ping + 60s 读空闲 + 5s 写超时)
  - `core/abstract/network/go/room/hub.go` — 房间/玩家注册表,20Hz tickLoop,4 人满员拒绝,断线 ForceLeave
  - `core/abstract/network/go/room/server.go` — 多连接 + onDisconnect 钩子
  - `core/abstract/network/go/cmd/roomserver/main.go` — 主程序 + `-healthcheck` 探活(distroless 容器用)
  - `core/abstract/network/go/cmd/loadtest/main.go` — 独立压测工具
  - `go.mod` / `go.sum` 引入 gorilla/websocket v1.5.3 + protobuf v1.34.2
- **GDScript 客户端传输层**
  - `core/abstract/network/gd/wildwood_transport.gd`(新,392 行)— `WsConn` / `WsNetClient` / `WsNetServer`,基于 Godot 4.3 `WebSocketPeer` + `TCPServer.accept_stream()` upgrade 握手
  - `core/abstract/network/gd/wildwood_net.gd` 升级为委托给 `WildwoodTransport`,Mock 端不变
- **部署**
  - `Dockerfile` — 多阶段 build:`golang:1.22-alpine` → `gcr.io/distroless/static:nonroot`,目标镜像 < 20MB
  - `docker-compose.yml` — 端口 8080,资源限制 1 CPU / 512MB,`/health` 探活,`read_only` + `cap_drop ALL` + `no-new-privileges`
- **README.md** 新增「M1.9 传输层接入」章节(架构图 + 客户端接入示例 + 启动方式 + 6 项验收标准)

### 验证
- Go 单元测试 23 个全过(短测试模式)
  - transport 3 个:`TestHandshake_RoundTrip` / `TestHeartbeat_RTT_Under50ms` / `TestConcurrentConnections`
  - room 6 个:`TestFullLifecycle` / `TestRoomFull_RejectsFifth` / `TestInvalidRoomId_NotFound` / `TestHeartbeat_Echo` / `TestDisconnect_RemovesFromRoom` / `TestConcurrent_RoomCreate`
  - tests 14 个(M1.5 协议层全部保留)
- 压测 `TestStress_200Rooms_4Players`:50 房间 × 4 人 = **200 并发连接**,setup 46ms,heartbeat 150 次 RTT **avg 34µs / max 331µs**(远低于 50ms 目标)
- roomserver 静态二进制 **9.9MB**(`CGO_ENABLED=0`),distroless 镜像 < 20MB
- `/health` 端点 + `-healthcheck` 探活行为正确(服务离线 exit=1,在线 exit=0)
- GDScript 文件 gdlint 4.5.0 干净,gdparse 解析通过

### A/B 兼容性
- `Go transport.Conn` / `GDScript WildwoodTransport.WsNetClient` 都暴露 `send_frame / recv_frame` 帧 API
- Godot ↔ Unity 切换只重写 GDScript/C# 绑定层,通用层接口不变

### 留给后续
- 5 分钟断线墓碑(M3.7 升级)
- 跨机房 RTT 测量(M2.14 联机压测)
- WebTransport/QUIC(M3.7 可选替换)
