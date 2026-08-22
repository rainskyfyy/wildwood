# Wildwood

> 一款 4 人小队合作 2D 像素生存游戏 — 类饥荒 × 星露谷暖色基底,Web 优先零安装。

[![Engine](https://img.shields.io/badge/Godot-4.3-478cbf?logo=godotengine&logoColor=white)](https://godotengine.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Stage](https://img.shields.io/badge/stage-M1-blueviolet)](#里程碑)
[![Status](https://img.shields.io/badge/M3.1--prediction-success-brightgreen)](#里程碑)

---

## 项目简介

**Wildwood** 是 M1 阶段立项的类饥荒合作生存游戏。技术主线 A 线:**Godot 4.3 + WebSocket + Go 房间服务**,通过三层抽象接口(数据 / 网络协议语义 / 资源元数据)预留 B 线(Unity 6 + Mirror + .NET 8)切换空间。

- **核心循环**:采集 → 制造 → 建造 → 战斗 → 季节循环
- **联机**:4 人小队(1 主机 + 3 队友),服务器权威,20Hz tick,客户端预测 + 服务端校正
- **美术**:32px 基础网格 + 24 暖色板 + 哥特暗黑 × 星露谷暖色
- **目标**:6 个月内可发布可体验的 MVP 完整版

详细方案见[《项目总方案》](https://hisense.feishu.cn/docx/M5pEdEDvPoUGpGxgiWUcLxSQnGu) · 任务拆解见[《项目任务拆分表》](https://hisense.feishu.cn/docx/JrCmdC2S9o4ID5xRM70cuSNsnS2)。

---

## 目录结构

```
wildwood/
├── .editorconfig          # 编辑器统一缩进 / 行尾
├── .gitattributes         # Git 行尾归一化
├── .gitignore             # Godot / 引擎产物 / 资产 / 编辑器忽略
├── LICENSE                # MIT
├── README.md              # 本文件
├── project.godot          # Godot 4.3 项目主配置
├── icon.svg               # 临时图标(M1.12 由 AI 画师替换)
│
├── core/                  # 核心游戏逻辑(autoload 单例 / 全局服务)
│                            包含 GameManager、NetworkClient、SaveSystem 等。
│                            M1.4-1.6 在此落三层抽象接口(A/B 通用层)。
│
├── scripts/               # GDScript 脚本(非 autoload 的纯逻辑)
│                            玩家控制器、怪物 AI、状态机、工具脚本等。
│
├── scenes/                # Godot 场景文件(.tscn / .tres)
│                            主菜单、游戏世界、HUD、背包、地图、图鉴。
│
├── assets/                # 美术 / 音频 / 字体资源
│   ├── art/               # 像素画(M1.12 起 5 张样稿,M2.14 60+ 资产)
│   ├── audio/             # 音效 / 音乐
│   └── fonts/             # 像素字体
│
└── tests/                 # 测试目录
    ├── unit/              # GUT 单元测试(M1.3 落地)
    └── integration/       # 场景级集成测试(M1.3 落地)
```

**分层原则**(对应方案 §3.3 的 A/B 切换接口层):

| 目录        | A 线                | B 线切换            | A/B 通用？ |
|-------------|---------------------|---------------------|-----------|
| `core/`     | 引擎脚本(autoload)  | 引擎脚本(autoload)  | 否(引擎层) |
| `scripts/`  | GDScript 业务       | C# 业务             | 否(引擎层) |
| `scenes/`   | Godot 场景          | Unity 场景          | 否(引擎层) |
| `assets/`   | Godot 导入(`.import`) | Unity 导入        | 否(引擎层) |
| `tests/`    | GUT + Playwright    | Unity Test Framework | 否(引擎层) |
| 三层抽象    | 见 `core/abstract/` | 同左                | **是(通用层)** |

A→B 切换时**仅重写引擎层**(`core/` / `scripts/` / `scenes/`),通用层接口不变。

---

## 环境要求

| 工具              | 版本          | 说明                        |
|-------------------|---------------|-----------------------------|
| Godot Engine      | **4.3.x**     | 必须 ≥ 4.3,推荐 4.3.1+      |
| Git               | 任意现代版本  | LFS 非必需(本仓库不存大文件)|
| Go                | 1.22+         | 仅在 M1.9+ 跑房间服务时需要 |
| Python            | 3.10+         | CI 脚本依赖(可选)          |
| Node.js           | 18+           | Playwright E2E(M1.3 落地)  |

### 安装 Godot 4.3

- **官方下载**:<https://godotengine.org/download> → 选 `Godot v4.3.x` Mono **或** 标准版(M1 阶段 GDScript 即可,Mono 在 C# 实验性场景按需启用)
- **macOS**:`brew install --cask godot@4.3`
- **Linux**:`flatpak install flathub org.godotengine.Godot` 或下载 AppImage
- **Windows**:官方 zip 解压即用

> **CI 环境固化**:M1.2 由工作台搭建师把 Godot 4.3 安装包写入工作台 CI,确保所有 PR 跑同版本引擎。

---

## 构建与运行

### 1. 克隆仓库

```bash
git clone <repo-url> wildwood
cd wildwood
```

### 2. 在 Godot 中打开

#### 方式 A:Godot 编辑器

```bash
godot --editor .
```

首次打开 Godot 会自动创建 `.godot/` 缓存目录(已在 `.gitignore` 中),导入完成后即可在编辑器内点 **▶ Play** 运行。

#### 方式 B:直接运行(无编辑器)

```bash
godot --path . scenes/main.tscn
```

### 3. 调试 / 运行参数

| 场景                | 命令                                                    |
|---------------------|---------------------------------------------------------|
| 编辑器打开          | `godot --editor .`                                      |
| 直接跑主场景        | `godot --path . scenes/main.tscn`                       |
| 跑 GUT 单元测试     | `godot --headless --path . -s addons/gut/gut_cmdln.gd`  |
| Web 导出(HTML5)     | `godot --headless --path . --export-release "Web" build/index.html` |

> Web 导出配置(`export_presets.cfg`)由 M1.2 工作台搭建师提供。本仓库已预留该文件名,但内容为占位。

### 4. 输入操作(默认绑定)

| 操作          | 键位            | 备注                                   |
|---------------|-----------------|----------------------------------------|
| 移动          | `WASD` / 方向键 | 8 方向                                 |
| 互动 / 攻击   | 鼠标左键        | LMB 智能判别(移动 / 攻击 / 采集,M2.1) |
| 退出          | `Esc`           | 主场景根节点监听 `ui_cancel`           |

> 自定义输入映射在 `project.godot` 的 `[input]` 段,直接编辑或 Godot 编辑器 → Project Settings → Input Map 调整。

---

## 验证 M1.1 验收标准

本任务(M1.1)对应三条硬验收:

| 编号 | 验收标准                                            | 状态 |
|------|-----------------------------------------------------|------|
| ①    | 仓库可 `git clone` 后用 Godot 4.3 打开              | ✅ `project.godot` `config_version=5`、含 `4.3` feature tag |
| ②    | 目录结构按 "core / scripts / scenes / assets / tests" 分层 | ✅ 见上方目录结构图 |
| ③    | README 含构建运行说明                                | ✅ 见上方「构建与运行」一节 |

快速自检:

```bash
# 1. 验证项目文件可被 Godot 4.3 识别
godot --headless --check-only --path .

# 2. 验证主场景可加载(不报错即通过)
godot --headless --quit --path . scenes/main.tscn
```

`--check-only` 在 Godot 4.3+ 可用,会校验项目配置合法性而不进入主循环。

---

## M1.9 传输层接入

M1.9 在 M1.5 协议层之上接入真实 WebSocket 传输层,交付 **Go 房间服务**(服务端)+ **GDScript `WildwoodTransport`**(Godot 客户端),同时提供 Dockerfile + docker-compose 一键起服务。

### 架构

```
┌────────────────────────┐  WebSocket (RFC 6455)   ┌──────────────────────────┐
│  Godot 4.3 Client      │ ◀──────────────────────▶ │  Go 1.22 roomserver      │
│  WsNetClient           │  frame: [varint LEN]    │  /ws handler             │
│  (wildwood_transport.gd)│  [varint TYPE_LEN]     │  ↓                       │
│  ↓                     │  [TYPE]                 │  transport.Conn          │
│  WildwoodWire codec    │  [PAYLOAD]              │  (1 读 + 1 写 goroutine) │
│  (M1.5)                │                          │  ↓                       │
│                        │                          │  room.Hub (4 人满员)     │
│                        │                          │  20Hz tickLoop           │
└────────────────────────┘                          └──────────────────────────┘
```

帧格式与 M1.5 完全一致(Go / GDScript 端 codec 已对齐),`send_frame(type, payload)` / `recv_frame()` 在两侧 API 同形,后续 A→B 切换只重写 C# 绑定层即可。

### 目录布局(M1.9 新增)

```
core/abstract/network/
├── proto/                       # M1.5 .proto 真相源(未变)
├── go/
│   ├── codec/  mocks/  tests/  wildwood/v1/    # M1.5 已完成
│   ├── transport/  # ✨ M1.9 新增:gorilla/websocket Conn 封装
│   │   ├── websocket.go         # Conn 抽象 + Accept/Dial + 心跳 + 写超时
│   │   └── websocket_test.go
│   ├── room/      # ✨ M1.9 新增:真实多连接房间服务
│   │   ├── hub.go               # Hub 房间/玩家注册表 + 20Hz tickLoop
│   │   ├── hub_test.go
│   │   └── server.go            # 多连接 + onDisconnect 钩子
│   └── cmd/
│       ├── roomserver/main.go   # ✨ 主程序(含 -healthcheck 探活)
│       └── loadtest/main.go     # ✨ 独立压测工具
└── gd/
    ├── wildwood_transport.gd    # ✨ M1.9 新增:WsConn / WsNetClient / WsNetServer
    └── wildwood_net.gd          # 升级:NetClient/NetServer 委托给 WildwoodTransport

Dockerfile                       # ✨ 多阶段 build:golang:1.22-alpine → distroless/static
docker-compose.yml               # ✨ 一键起服务(端口 8080,资源限制 + 安全选项)
```

### Godot 4.3 客户端接入示例

```gdscript
extends Node

var _client: WildwoodTransport.WsNetClient

func _ready() -> void:
    _client = WildwoodTransport.WsNetClient.new()
    var ok = _client.connect_to("ws://127.0.0.1:8080/ws")
    if not ok:
        push_error("connect_to failed"); return

func _process(_dt: float) -> void:
    if _client == null: return
    _client.poll(0.0)
    while _client.is_open():
        var f: Dictionary = _client.recv_frame()
        if f.is_empty(): break
        _handle_frame(f["type"], f["payload"])

func send_input(payload: PackedByteArray) -> void:
    if _client != null and _client.is_open():
        _client.send_frame("C2S_PlayerInput", payload)

func _handle_frame(type_name: String, payload: PackedByteArray) -> void:
    match type_name:
        "S2C_HandshakeAck": _on_handshake_ack(payload)
        "S2C_WorldDelta":   _on_world_delta(payload)
        "S2C_HeartbeatAck": pass
        _: push_warning("unknown frame: " + type_name)
```

完整 API 参见 `core/abstract/network/gd/wildwood_transport.gd` 顶部 docstring。

### 房间服务启动

```bash
# 方式 1:本地直接跑
cd core/abstract/network/go
go run ./cmd/roomserver -addr :8080 -tick 20

# 方式 2:Docker(distroless 镜像,无 shell,< 20MB)
docker build -t wildwood/roomserver:dev .
docker run -p 8080:8080 wildwood/roomserver:dev

# 方式 3:docker-compose(含 /health 探活 + 资源限制)
docker compose up --build
```

环境变量(可覆盖 flag):

| 变量                  | 默认值 | 说明                          |
|-----------------------|--------|-------------------------------|
| `WILDWOOD_ROOM_ADDR`  | `:8080`| listen 地址                   |
| `WILDWOOD_ROOM_TICK`  | `20`   | tick 频率(Hz)                 |
| `WILDWOOD_ROOM_MAX`   | `1000` | 单进程最大并发连接数           |

### 端到端联调

```bash
# 1. 启服务
docker compose up --build

# 2. 健康检查
curl http://localhost:8080/health
# {"status":"ok","active_conns":0,"total_accepted":0,"total_closed":0}

# 3. 客户端握手(用 wscat 验证)
wscat -c ws://localhost:8080/ws
> [binary frame, type=C2S_Handshake, payload={...}]
< [binary frame, type=S2C_HandshakeAck, payload={...}]
```

### M1.9 验收标准

| 编号 | 验收标准                                                 | 状态 | 证据 |
|------|----------------------------------------------------------|------|------|
| ①    | 200 连接并发(同机房)                                     | ✅    | `TestStress_200Rooms_4Players`:50 房间 × 4 人 = 200 并发连接,setup 46ms,清理后残留 ≈ 0 |
| ②    | RTT < 50ms(heartbeatAck / RoomCreate)                    | ✅    | `TestHeartbeat_RTT_Under50ms` + 压测 150 次 heartbeat,avg 34µs / max 331µs |
| ③    | 心跳超时断开(60s 无 C2S → 关闭)                          | ✅    | `transport.PongHandler` 续命 + `SetReadDeadline(60s)`;`TestDisconnect_RemovesFromRoom` 覆盖 onDisconnect 路径 |
| ④    | Dockerfile + docker-compose 一键起服务                   | ✅    | 多阶段 build → distroless/static(目标 < 20MB);`/health` 端点 + `no-new-privileges` + `cap_drop ALL` |
| ⑤    | 4 人小队上限(第 5 人拒绝)                                 | ✅    | `TestRoomFull_RejectsFifth` + `TestInterop_FullRoom_RejectsFifthPlayer` |
| ⑥    | GDScript 客户端 API(WsNetClient/Server)                  | ✅    | `gd/wildwood_transport.gd` + 委托到 `wildwood_net.gd`,gdlint 干净 |

快速自检:

```bash
# 1. Go 单元测试(短测试模式,秒过)
cd core/abstract/network/go
go test -count=1 -short ./...

# 2. 200 连接压测(约 1 秒)
go test -count=1 -timeout 120s -run TestStress_200Rooms_4Players -v ./room/

# 3. 编译静态二进制(≈ 10MB,CGO_ENABLED=0)
CGO_ENABLED=0 go build -o /tmp/roomserver ./cmd/roomserver
```

**已知未覆盖 / 留给后续里程碑**:
- Godot headless 跑 GDScript 测试:沙箱无 Godot 二进制,已用 `gdtoolkit` 静态检查 + Python wire format 验证器交叉验证(参见 M1.5 交付)
- 5 分钟断线墓碑:当前 `onDisconnect` 立即 ForceLeave,M3.7 升级为墓碑保留
- 跨机房 RTT 测量:本机 34µs 仅供同机房基线,M2.14 跨机房压测
- WebTransport(QUIC):M1.9 锁定 WebSocket,M3.7 可选替换

---

## M1.10 客户端-服务端 WebSocket 连通

M1.10 在 M1.9 传输层之上,补全**应用层心跳 + 自动重连**,把"WebSocket 字节流"变成"稳定业务会话":

| 层 | 文件 | 职责 |
|----|------|------|
| 协议 | M1.5 (`C2S_Heartbeat` / `S2C_HeartbeatAck`) | 应用层 ping/pong |
| 传输 | M1.9 (`WildwoodNet.NetClient` / `WildwoodTransport.WsNetClient`) | WebSocket 字节流 |
| **会话** | **M1.10 `WildwoodSession`** | connect → handshake → heartbeat → reconnect 全流程 |

### 客户端组件

- `core/abstract/network/gd/wildwood_heartbeat.gd` — 30s 周期心跳 + 5s 超时检测 + 3 次丢 ping 告警
- `core/abstract/network/gd/wildwood_reconnect.gd` — 退避 1s→2s→4s→8s→16s→30s,30s 窗口硬约束,attempt_callable 注入式
- `core/abstract/network/gd/wildwood_session.gd` — 组合 NetClient + Heartbeat + Reconnect,状态机 `idle → connecting → handshaking → connected ↔ reconnecting → failed`

### 用法(`scripts/main.gd`)

```gdscript
var sess = WildwoodSession.new("ws://127.0.0.1:8080/ws", "0.3.0", "player-1")
sess.on_state = func(s, info): print("state=", s, info)
sess.on_rtt = func(rtt_ms, seq): print("rtt=", rtt_ms)
sess.on_reconnected = func(attempts): print("✓ reconnected, attempts=", attempts)
sess.on_giveup = func(): print("✗ 30s window expired")
sess.connect_to()
# 每帧 sess.poll(delta) 推进
```

### 验收

| # | 标准 | 验证方式 | 结果 |
|---|------|----------|------|
| ① | 客户端发 `heartbeat` 服务端 1s 内回 `pong` | `go test -run TestM110_Heartbeat_RTT_Under1s` 30 次实测 | avg 0ms / max 1ms ✅ |
| ② | 断网 30s 自动重连 | `go test -run TestM110_Reconnect_AfterServerRestart` | 退避机制正确 ✅ |
| ③ | 浏览器 console 无错误 | `tests/e2e/tests/console-clean.spec.ts`(Playwright,CI 跑) | spec 已就位 |

### 一键端到端

```bash
# 沙箱(无 Godot / 无浏览器): 只跑 Go 端
./tests/scripts/run_m110_e2e.sh

# 完整: 加 --with-godot
./tests/scripts/run_m110_e2e.sh --with-godot

# 手动: 启动服务端 + e2eclient
cd core/abstract/network/go && go run ./cmd/roomserver &
cd core/abstract/network/go && go run ./cmd/e2eclient -url ws://127.0.0.1:8080/ws
```

---

## M2.7 生物群系 4 大(森林/平原/矿区/雪原)

4 大群系共享元素库(草地/岩石/树/蘑菇),仅替换主色与组合比例;9 宫格流式加载;相机过渡 0.5s。

### 验收
- ① 4 群系主色 + 特征资源 / 怪物到位(各 2 个 M2.14 资源 + 2 个 M2.14 怪物)
- ② 9 宫格懒加载,内存占用 -64%(9 / 25 chunks)
- ③ 相机过渡 500ms ± 20ms(状态机 IDLE → OUT 250ms → SWAP 0ms → IN 250ms → IDLE)
- 微调(2026-08-20 拍板):主色与特征资源复用 M2.14 资产清单(`source_ref="m2.14.*"`),不重复生产

### 目录
- `core/abstract/biome/` 5 个模块:palette(24 暖色板) / elements(4 共享元素) / biomes(4 群系) / biome_map(9 宫格映射) / loader(流式加载)
- `core/biome_runtime/` 4 个 GDScript:WildwoodBiomeConstants / WildwoodBiomeLoader / WildwoodBiomeRuntime / WildwoodCameraTransition
- `assets/biomes/` 5 个 JSON:palette / elements / biome_map / biomes/{forest,plains,mines,snow}

### 测试
```bash
# 105 个 pytest 测试(76 单元 + 29 验收)
python3 -m pytest core/abstract/biome/ -v

# 31 个 GUT 测试(Godot 端)
godot --headless --quit -s addons/gut/gut_cmdln.gd     -gdir=res://core/biome_runtime/tests -gprefix=test_ -gexit
```

详见 `docs/m27_biomes.md` 与 `core/abstract/biome/README.md`。

## M1.11 房间创建/加入/退出基础流程

M1.11 在 M1.5 协议 + M1.9 传输 + M1.10 会话之上,落地**业务层房间状态机**:建房 / 加入 / 离开 / 踢人 / 满员拒绝 / 状态广播。这是联机 MVP 拼图的最后一块 — M1.11 通过后即可解锁 M2.1-M2.x 业务流。

### 关键约束(方案 §5.4 硬约束)

- **4 人小队上限**(1 主机 + 3 队友):第 5 人加入返回 `ROOM_ERROR_FULL`(明确错误码)
- **5 位短链 ID**:`r-NNNNN` 房间 id / `t-NNNNN` join_token(避免长链刷屏)
- **3 套独立计数器**:`playerSeq` / `roomSeq` / `tokenSeq` 均为 `atomic.Uint32`,互不耦合
- **状态广播双帧**:成员变化时同时发 `PlayerJoined/PlayerLeft` + `RoomStateChanged`(M1.11 验收 ③)

### 协议层新增

| 消息 | 方向 | 字段 | 用途 |
|------|------|------|------|
| `C2S_RoomKick` | C→S | `room_id` / `target_player_id` / `reason` | 房主踢人 |
| `S2C_RoomKicked` | S→C | `room_id` / `kicked_by_id` / `reason` / `server_time_ms` | 被踢通知 |
| `S2C_RoomStateChanged` | S→C | `room_id` / `current_players` / `max_players` / `trigger` | 槽位刷新广播 |

`trigger` 取值:`"join"` / `"leave"` / `"kick"`(`"disconnect"` 留 M3.7)。

### 验收

| # | 标准 | 测试 | 结果 |
|---|------|------|------|
| ① | 第 5 人加入被 `ROOM_ERROR_FULL` 拒绝(明确错误码) | `TestM111_Acc01_FifthPlayerRejected` | ✅ |
| ② | 房主踢人后房间槽释放,被踢者收 `RoomKicked` + `ROOM_ERROR_KICKED`,非 host/self-kick 拒绝 | `TestM111_Acc02_HostKickFreesSlot` | ✅ |
| ③ | 房间状态变更对全队广播(join/leave 触发 `PlayerJoined/PlayerLeft` + `RoomStateChanged`) | `TestM111_Acc03_RoomStateBroadcasts` | ✅ |
| 回归 1 | `playerSeq` / `roomSeq` 独立(修复 M1.5 时代 `nextPlayerID` 与 `nextRoomID` 共享 `roomSeq` 的 bug) | `TestM111_Regression_CounterIndependence` | ✅ |
| 回归 2 | 满员拒绝不修改房间(5 号连续 3 次加入被拒,房内仍 4 人) | `TestM111_Regression_FullRejection_DoesNotMutateRoom` | ✅ |

### 关键 Bug 修复(2026-08-20)

- **Acc02 RWMutex 死锁**:`m111_room_flow_test.go:260` happy path 下读锁未释放,导致 `RegisterPlayer` 的 `Lock()` 永久阻塞 → p5.handshake 卡死。改为正确配对 `RUnlock`
- **`handleRoomKick` 帧重复**:host 在 Broadcast 之外又收 1 份 `RoomStateChanged`,污染后续 p5.rejoin 断言。删除冗余 `conn.Send`

### 字节预算

`S2C_RoomStateChanged` = 17 bytes / `S2C_RoomKicked` = 28 bytes,均在 4KB 帧上限内,联机 4 玩家每 tick 可携带多个状态帧无压力。

---

## M2.1 移动 + LMB 智能判别

M2.1 落地 M2 核心循环的**第一块拼图**:**WASD/方向键移动 (60 FPS 平滑) + LMB 智能判别**(鼠标左键在射程内自动识别 移动 / 攻击 / 采集 三类目标)。这是所有 M2 玩家操作任务的前置,**关键路径**:延期 ≥ 3 天拖累 M2.2 / M2.3 / M2.4 + M2.10 战斗手感。

### 架构:A/B 通用层 + Godot 薄包装

```
鼠标左键 LMB
    │
    ▼
PlayerController._unhandled_input(event)
    │  (INPUT_MAP action "lmb")
    ▼
World.handle_lmb_click(screen_pos, ctx)
    │ ① 屏幕→世界坐标(M2.1 只用世界坐标,viewport 转换留 M2.4)
    │ ② get_tree().get_nodes_in_group("world_target")
    │   → candidates[]
    ▼
LmbDecide.decide(player_pos, candidates, click_pos, ctx)   # 1:1 Python/GDScript
    │
    │ 优先级:射程内 attack > 射程内 gather > 否则 MOVE
    │
    ▼
Action { type: MOVE/ATTACK/GATHER, target_id?, target_pos? }
    │
    ▼
World.execute_action(action)
    ├─ MOVE:    player.set_target_pos(action.target_pos)
    ├─ ATTACK:  攻击目标(本版本 placeholder print + 视觉反馈)
    └─ GATHER:  采集目标(本版本 placeholder print + 视觉反馈)
```

### LMB 判别规则(纯逻辑,沙箱内 19 个 pytest 100% 覆盖)

1. **射程内 attack 候选** → `Action(type=ATTACK, target_id=...)`
2. **否则 射程内 gather 候选** → `Action(type=GATHER, target_id=...)`
3. **否则** → `Action(type=MOVE, target_pos=...)`(让玩家向点击处移动,接近目标)
4. 距离用欧氏距离,严格 `<= best_d` 边界判定(浮点 1.4999/1.5001 双用例验证)

### 移动 + 朝向(Godot 60Hz 物理步)

- 输入:`_physics_process(delta)` 每 16.67ms 跑一次(60 FPS)
- 8 方向归一化:`Vector2.normalized()` 控速(防斜向 √2 加速)
- 速度:4.0 米/秒 × 32 像素/米 = 128 像素/秒
- 朝向:横向用 `flip_h`,纵向用 `last_vertical_sign`(上/下两套 sprite 帧)
- 响应预算:单帧 ≤ 16.67ms,远低于 200ms 验收线

### 验收(10 场景用例 100% 命中)

| # | 场景 | 期望 Action | 验证位置 |
|---|------|-------------|----------|
| ACC-01 | 点击空地,无候选 | `MOVE(click_pos)` | `test_lmb_decide.py::TestAcc01` |
| ACC-02 | 点击 attack 目标(射程内) | `ATTACK(target_id)` | `TestAcc02` |
| ACC-03 | 点击 gather 目标(射程内) | `GATHER(target_id)` | `TestAcc03` |
| ACC-04 | 射程外 attack + 射程内 gather | `GATHER` 优先 | `TestAcc04` |
| ACC-05 | attack + gather 都射程内 | `ATTACK` 优先 | `TestAcc05` |
| ACC-06 | 射程外 attack,无 gather | `MOVE`(靠近 attack) | `TestAcc06` |
| ACC-07 | 多 gather,选最近的 | `GATHER(最近 ID)` | `TestAcc07` |
| ACC-08 | 0 候选(空场景) | `MOVE(click_pos)` | `TestAcc08` |
| ACC-09 | 负坐标(世界原点左上) | 正常判别 | `TestAcc09` |
| ACC-10 | attack_range 边界(1.4999 / 1.5001) | 1.4999 内 / 1.5001 外 | `TestAcc10` |
| ① | 移动 200ms 内响应 | `_physics_process` 16.67ms / 帧,**12× 余量** | `headless_smoke.py` |
| ② | LMB 智能判别 10 场景 100% | 19/19 pytest + 15/15 headless smoke | `run_m21_tests.sh` |
| ③ | 移动时 sprite 朝向正确 | flip_h 横向 + last_vertical_sign 纵向 | `player_controller.gd` |

### 运行验收

```bash
# 1. Python 核心逻辑测试(19 个用例,沙箱内可跑)
cd wildwood
python3 -m pytest tests/unit/test_lmb_decide.py -v
# 期望: 19 passed in <0.1s

# 2. 端到端验收 6 步(全过则输出 ALL GREEN)
bash tests/scripts/run_m21_tests.sh
# 期望末尾: ALL GREEN

# 3. Godot 客户端手动演示(需要 Godot 4.3 二进制)
godot --path . scenes/m21_demo.tscn
# 操作:WASD 移动 / 鼠标点击 attack / gather / 远 attack 目标
# ESC 退出 / H 切换 HUD(显示位置/朝向/最近一次 action)
```

### 关键路径解锁

- **M2.1 → M2.2** 资源采集(gather 已就位,只缺资源实例化)
- **M2.1 → M2.3** 战斗基础(attack 已就位,只缺伤害管线)
- **M2.1 → M2.4** 建造/交互(只用 `MOVE` + 候选扩展)
- **M2.1 → M2.10** 战斗手感(60Hz 移动平滑 + ATTACK 触发器)

### 已知边界(留 M2.2/3/4 处理)

- ATTACK/GATHER 是 placeholder(M2.1 只验证判别,伤害 / 资源产出 M2.3/2.2 落地)
- 屏幕↔世界坐标转换(`get_canvas_transform()`)留 M2.4
- 移动用 `position +=` 直接写(M2.1 demo 无碰撞体;M2.5 引入 CharacterBody2D + collision shape)
- 无 LMB 拖拽 / 蓄力 / 长按(M2.10 战斗手感再细化)

---

## 里程碑


| 阶段     | 周次    | 目标                                       | 当前状态 |
|----------|---------|--------------------------------------------|----------|
| **M1 框架**  | W1-W4   | 引擎选型落地、CI/CD、三层抽象接口跑通       | **完成** (M1.1 ✅ / M1.5 ✅ / M1.9 ✅ / M1.10 ✅ / M1.11 ✅) |
| **M2 核心循环** | W5-W10  | 单机可玩:核心循环 + 战斗 + 合成 + 图鉴     | **进行中** (M2.1 ✅) |
| M3 联机    | W11-W16 | 4 人联机 MVP 完整版可发布                  | 未开始   |

M1 + M2.9 关键交付一览:
- **M1.1 项目脚手架**:Godot 4.3 工程骨架 + Git 仓库(commit `38d4e15`)
- **M1.5 网络协议语义层**:Protobuf `.proto` 真相源 + Go/GDScript 双端 codec + 字节预算 2851B < 4KB(commit `e57cae1`)
- **M1.9 传输层接入**:Go gorilla/websocket 房间服务 + GDScript `WildwoodTransport` + Dockerfile/distroless 部署;200 连接压测 RTT avg 34µs,远低于 50ms 目标(见下节)
- **M1.10 客户端-服务端 WebSocket 连通**:`WildwoodSession`(客户端) + Go e2eclient + 4 个 M1.10 单元测试(30 次 heartbeat RTT avg 0ms / max 1ms + 30s 重连机制)
- **M1.11 房间创建/加入/退出基础流程**:`C2S_RoomKick` / `S2C_RoomKicked` / `S2C_RoomStateChanged` 协议层新增 + Go 端 `handleRoomCreate/Join/Leave/Kick` 业务实现 + 5 个 M1.11 验收测试(3 条核心 + 2 条回归)全部通过
- **M2.9 合成系统**:34 配方(9 tool / 7 equip / 11 food / 7 building)+ Python ↔ GDScript 语义对齐 + 84 个测试全过(75 单元 + 9 跨端对齐 + 9 E2E 验收),4 项验收标准全部通过,性能 p99 = 0.009ms(预算 400ms → 44,000× 余量)。详见 [§M2.9 合成系统](#m29-合成系统)

M2.1 交付:
- **LMB 智能判别核心**:`core/abstract/gameplay/lmb_decide.py` + `.gd` 1:1 语义,10 验收 + 5 边界 + 1 性能基准,19/19 pytest 全过;性能 p99 = 0.06ms
- **PlayerController**(`scripts/player_controller.gd`):WASD/方向键 8 方向 + 60 FPS 物理 + 8 方向朝向(flip_h + last_vertical)
- **World / WorldTarget**:M2.1 demo 场景 4 占位目标(1 attack 近 + 2 gather + 1 attack 远)
- **M2.1 Demo**:`scenes/m21_demo.tscn` + `scripts/m21_demo.gd`,WASD 移动 + LMB 智能判别 + HUD 实时反馈
- **验收脚本**:`tests/scripts/run_m21_tests.sh`,6 步一键跑(详情见下文)

任务依赖图与关键路径见[《项目任务拆分表》§2.1-2.2](https://hisense.feishu.cn/docx/JrCmdC2S9o4ID5xRM70cuSNsnS2)。

---

## M2.10 资源系统(M4 Canvas demo 端)

资源系统演进 5 个里程碑,纯前端 HTML5 Canvas,无框架,20 模块 + 3 JSON 表 + 6 测试套件,共 489/489 测试通过。

| 版本  | 任务 | 关键能力 | 测试 |
|-------|------|---------|------|
| M2.10  | 资源系统基础 | 17 资源 + 18 物品 + 21 槽背包 + 8 配方 + 重生 + 工具耐久度 | 58/58 |
| M2.10b | 资源重生 + 工具耐久 | 30-240s regrowTime + 4 工具耐久上限 + 工具兼容表 | 67/67 |
| M2.10c | 铲工具 + 新资源 | 4 挖掘类资源 + 5 新物品(泥土/胡萝卜/蘑菇/花瓣) + shovel 接 4 资源 | 76/76 |
| M2.10d | 资源枯竭 | maxHarvests 永久枯竭 + 4 矿物(煤/金/宝石/锡)+ in-place 变身(rock) | 171/171 |
| **M2.10e** | **三阶段成长** | **时间驱动 / tree+dead_tree+berry_bush 3 阶段 / 阶段 2 稀有种子(橡子/浆果种子/枯木块)** | **97/97** |

### M2.10e 三阶段成长设计

- **推进机制**:时间驱动 — 每个阶段有独立 `duration`(秒),`update()` 用 leftover-time 算法在单次 tick 内完成跨阶段链式推进
- **资源范围**:`tree` / `dead_tree` / `berry_bush` 三个根资源,每个有 3 阶段
- **阶段奖励**:第 2 阶段(成熟)给更多掉落 + 1 颗稀有种子(橡子/浆果种子/枯木块)
- **生命周期**:
  - tree:    sapling(30s, 1 twine)→ tree(180s, 3 log+25% twine)→ tree_old(∞, 4 log+1 twine+1 acorn)
  - dead_tree: twig(45s, 1 log)→ dead_tree(180s, 2 log+1 twine)→ dead_tree_old(∞, 3 log+1 dead_wood_chunk)
  - berry_bush: sprout(30s, 1 berry)→ berry_bush(120s, 2 berries+25% twine)→ berry_bush_old(∞, 4 berries+1 berry_seed)
- **采后行为**:任何阶段被采都会重置到 stage 0,depleted 时长 = 被采阶段的 regrowTime(stage 0=0 即时,stage 1/2 = 60/120s)
- **新物品**:`acorn` / `dead_wood_chunk` / `berry_seed`(category=material, stackMax=20, 种子可种)
- **API 增量**:`isGrowthCapable(id)` / `getGrowthStages(id)` / `getStageDef(id, stageIdx)` / 实体 `_rootId` + `currentStageIndex` + `stageStartedAt` + `isTerminalStage` + `getStageProgress()`
- **UI**:生长进度条(非终态)+ 终态星标 ★;阶段进阶金色 banner 通知

### 模块清单

- 数据:`src/resources/{resources,items,recipes}.json` + `src/resources/catalog.js`
- 模块:`src/resources/{spawner,inventory,resource-entity,gather,crafting,regrow,items}.js`
- 渲染:`src/render/{picker,resource-renderer}.js`(M2.10e 新增 6 个 stage 变体图标)
- HUD:`src/hud/{inventory-panel,crafting-panel,hotbar}.js`
- 入口:`src/main.js` + `demo.html`
- 测试:`tests/m{210,210b,210c,210d,210e,4}-*.mjs`(6 套件 489 测试全过)

---

## 团队与协作

- **老板**:产品决策、需求拍板、对外发布
- **高级开发工程师**(agent):架构设计 + 模块整合 + 代码审查
- **AI 画师**(agent):美术资产 + 风格一致性维护
- **UI 设计师**(agent):交互规范 + 原型 + 组件库
- **工作台搭建师**(agent):DevOps / CI / 房间服务部署

任务通过 aily-cli task 派发,产出以飞书云文档链接交付,跨 agent 不传本地文件路径。

---

## 贡献

### 分支策略(待 M1.2 确认)

- `main`:稳定分支,只接受通过 PR review 的合并
- `develop`:日常开发分支
- `feature/*`:功能分支,命名 `<M1.x>-<slug>`(如 `M1.4-data-layer`)

### PR 评审 5 项自查(美术相关,见方案 §4.5)

1. 剪影测试(转纯黑剪影必须能识别身份)
2. 色板测试(违例色 = 0)
3. 网格测试(像素对齐误差 ≤ 0px)
4. 抗锯齿测试(边缘不允许中间灰阶)
5. 动画流畅度(同动作帧数前后版本变化 ≤ 20%)

> 纯代码 / 逻辑类 PR 暂不强制上述 5 项,采用通用代码评审(可读性 / 测试 / 边界 / 安全 / 性能)。

---

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
