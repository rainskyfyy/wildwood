# 更新日志

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已计划
- M2.1 移动 + 采集
- M2.6 战斗
- M2.7 合成
- M2.14 联机压测
- M3.1 联机完整版

## [0.4.0] - 2026-08-20

### 新增(M1.11 房间创建/加入/退出基础流程 ★ 关键路径)

- **协议层**(`core/abstract/network/proto/wildwood/v1/{c2s,s2c}.proto`)
  - `C2S_RoomKick` 新增:房主踢人请求,字段 `room_id` / `target_player_id` / `reason`(≤ 64 字符)
  - `S2C_RoomKicked` 新增:被踢通知,含 `kicked_by_id` / `reason` / `server_time_ms`
  - `S2C_RoomStateChanged` 新增:房间状态变化广播,`current_players` / `max_players` / `trigger`("join"/"leave"/"kick"/"disconnect")
- **Go codec**(`go/codec/registry.go` + 自动生成的 `*.pb.go`):3 个新消息类型注册,Go 端测试覆盖
- **房间服务**(`core/abstract/network/go/room/hub.go`)
  - `handleRoomCreate`:房主建房,生成 r-NNNNN 短链 ID + t-NNNNN join_token,4 人上限(方案 §5.4 硬约束)
  - `handleRoomJoin`:满员返回 `ROOM_ERROR_FULL`(明确错误码 + `Context=room_id`),成功广播 `S2C_PlayerJoined` + `S2C_RoomStateChanged` 给其他成员
  - `handleRoomLeave`:离房广播 `S2C_PlayerLeft(reason="leave")` + `S2C_RoomStateChanged`,空房间清理
  - `handleRoomKick`:host 校验 → `RemoveMember` 立即释放槽位 → 目标收 `S2C_RoomKicked` + `ROOM_ERROR_KICKED`,全队收 `PlayerLeft(reason="kicked")` + `RoomStateChanged(trigger="kick")`
  - **修复**: `handleRoomKick` 历史上给 host 重复发 1 份 `RoomStateChanged`(Broadcast 已覆盖),删除冗余 `conn.Send`,避免 host 收到 2 份状态帧污染后续断言
- **3 套独立计数器**(`playerSeq` / `roomSeq` / `tokenSeq`,均为 `atomic.Uint32`):修复 M1.5 时代 `nextPlayerID` / `nextRoomID` 共享 `roomSeq` 的 bug,玩家 id 和房间 id 不再互踩
- **5 位短链**:`r-NNNNN` / `t-NNNNN`(5 位,与方案 §5.4 一致)
- **M1.11 专项验收测试**(`go/room/m111_room_flow_test.go`,新 18.6 KB)
  - `TestM111_Acc01_FifthPlayerRejected`:5 号玩家被 `ROOM_ERROR_FULL` 拒绝,错误消息含 "full",`Context=room_id`
  - `TestM111_Acc02_HostKickFreesSlot`:host 踢 p2 → p2 收 `RoomKicked` + `ROOM_ERROR_KICKED` → 房内变 3 人 → p5 再申请成功 → 非 host 踢 / self-kick 拒绝
  - `TestM111_Acc03_RoomStateBroadcasts`:join/leave 触发 `PlayerJoined/PlayerLeft` + `RoomStateChanged` 双广播
  - `TestM111_Regression_CounterIndependence`:开 N 个房间消耗 playerSeq 后,room id 仍 r-NNNNN,player/room 计数器独立
  - `TestM111_Regression_FullRejection_DoesNotMutateRoom`:连续 3 次 5 号加入被拒,房内仍 4 人

### 修复

- **Acc02 测试 RWMutex 死锁**(`m111_room_flow_test.go:260`):原代码 happy path 下 `hub.Mu().RLock()` 后没释放,又写错 1 个 `RLock` 凑数,导致读锁计数永久 +1,后续 `RegisterPlayer` 的 `Lock()` 永久阻塞 → p5.handshake 卡死 → 死锁。改为正确配对的 `RUnlock`
- **`handleRoomKick` 帧重复**:host 在 Broadcast 之外又收 1 份 `RoomStateChanged`,导致后续 p5.rejoin 断言帧顺序错位。删除冗余 `conn.Send`

### 验证

- **M1.11 全部 3 条验收 + 2 条回归**:5/5 通过(0.30s)
- **Go 端全量回归** 33 个顶级测试 + 16 个子测试,**全部 0 fail**
  - room 包 12 个:旧 hub_test 6 个 + M1.11 5 个 + `TestStress_200Rooms_4Players`
  - tests 包 14 个:M1.5 协议 + M1.9 transport + M1.10 heartbeat/reconnect
  - transport 包 3 个:`TestHandshake_RoundTrip` / `TestHeartbeat_RTT_Under50ms` (avg 22µs) / `TestConcurrentConnections`
- 字节预算:`S2C_RoomStateChanged` 17B / `S2C_RoomKicked` 28B,均在 4KB 帧上限内

### A/B 兼容性
- 协议层 `.proto` 真相源:Godot 4.3 / Unity 6 双端共用,切换 A/B 不重写 M1.11 业务

### 留给后续
- 5 分钟断线墓碑(M3.7 升级)
- 房主转让(host leave → 自动选下一个成员为 host)
- `S2C_RoomStateChanged.trigger` 缺 "disconnect" 实现(当前 ForceLeave 不发 trigger="disconnect" 帧)
- 房间列表分页(M2.x 大厅 UI)


## [0.3.0] - 2026-08-20

### 新增(M1.10 客户端-服务端 WebSocket 连通)

- **Go 端 M1.10 验收测试**(`go/tests/m110_*.go`,4 个测试全过)
  - `TestM110_Heartbeat_RTT_Under1s` — 30 次 heartbeat,断言 max RTT < 1s,avg < 200ms(M1.10 验收 ①)
  - `TestM110_Heartbeat_WorksBeforeHandshake` — 协议层不强制握手→心跳顺序
  - `TestM110_Reconnect_AfterServerRestart` — 30s 窗口内重连到新 hub(M1.10 验收 ②)
  - `TestM110_Reconnect_GiveUpAfterWindow` — 30s 窗口内未恢复 → state=failed
- **Go e2eclient**(`go/cmd/e2eclient/main.go`,新)— 单进程 demo 工具:握手→心跳→模拟断网→重连
- **GDScript 客户端三层**(`gd/`)
  - `wildwood_heartbeat.gd`(新,130 行)— 30s 周期心跳,测 RTT,5s 超时,3 次丢 ping 告警
  - `wildwood_reconnect.gd`(新,130 行)— 退避 1s→2s→4s→8s→16s→30s,30s 窗口硬约束
  - `wildwood_session.gd`(新,180 行)— 组合 NetClient + Heartbeat + Reconnect,状态机(connecting/handshaking/connected/reconnecting/failed)
- **GDScript 单元测试**(`gd/tests/test_m110.gd`,新)— 退避计算 + 状态机 + 窗口耗尽
- **Playwright 验收 ③ spec**(`tests/e2e/tests/console-clean.spec.ts`,新)— 30s 内 console.error = 0
- **一键 e2e 脚本**(`tests/scripts/run_m110_e2e.sh`,新)— Go 单元测试 + 全量回归 + e2eclient + (可选) Godot headless
- **main.gd demo**(`scripts/main.gd`,更新)— 启动后自动 connect → heartbeat → reconnect,按 ESC 退出

### 验证(M1.10 全部 3 项验收)

- ① 客户端发 `heartbeat` 服务端 1s 内回 `pong`:`TestM110_Heartbeat_RTT_Under1s` 30 次实测 avg=0ms, max=1ms
- ② 断网 30s 自动重连:`TestM110_Reconnect_AfterServerRestart` 重连耗时 < 1ms (退避机制正确)
- ③ 浏览器 console 无错误:Playwright spec 已写,CI 跑(沙箱无 Godot HTML5 export)
- Go 全部单元测试 **48 个通过**(M1.5 协议 + M1.9 transport + M1.10 新增)

### A/B 兼容性
- GDScript 客户端走与 M1.9 transport 一致的 `WildwoodNet.NetClient`(B 线 Unity 用 C# 等价物)
- 协议层(M1.5)+ 传输层(M1.9)+ 会话层(M1.10)三层解耦,切换 A/B 不重写上层业务

### 留给后续
- 5 分钟断线墓碑(协议层,M3.7 升级)
- 输入预测 + 服务端校正(2.0 客户端,M2.1+)
- 跨机房 RTT 测量(M2.14 联机压测)

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
