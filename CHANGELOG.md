# Changelog

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已计划
- M1.2 CI/CD 雏形
- M1.6 资源元数据抽象
- M1.12-1.13 5 张样稿 + Aseprite 工作流
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

## [0.3.0] - 2026-08-20

### 新增(M1.10 客户端-服务端 WebSocket 连通)

- **Go 端 M1.10 验收测试**(`go/tests/m110_*.go`,4 个测试全过)
  - `TestM110_Heartbeat_RTT_Under1s` — 30 次 heartbeat,断言 max RTT < 1s,avg < 200ms(M1.10 验收 ①)
  - `TestM110_Heartbeat_WorksBeforeHandshake` — 协议层不强制握手→心跳顺序
  - `TestM110_Reconnect_AfterServerRestart` — 30s 窗口内重连到新 hub(M1.10 验收 ②)
  - `TestM110_Reconnect_GiveUpAfterWindow` — 30s 窗口内未恢复 → state=failed
- **Go e2eclient**(`go/cmd/e2eclient/main.go`,新)— 单进程 demo 工具:握手→心跳→模拟断网→重连

## [0.2.0] - 2026-08-20

### 新增(M1.3 自动化测试框架)

- **三层测试体系**(验收 ①②③ 全部覆盖):
  - `tests/unit/` GUT 9.2.0 单测:`test_math_utils.gd`、`test_save_metadata.gd`
  - `tests/integration/` Godot 集成测试:场景加载、资源引用、项目配置
  - `tests/e2e/` Playwright 1.62 + Chromium,含沙箱可用的 mock Godot web export
- 测试可执行目标(给单测当 subject):
  - `core/utils/math_utils.gd` — 纯函数工具(浮点容差 / 钳制 / 网格吸附 / AABB)
  - `core/abstract/data/save_metadata.gd` — 数据层 v1 schema(M1.4 占位)
- 运行脚本 `tests/scripts/`:`install_gut.sh`、`run_unit.sh`、`run_integration.sh`、`run_e2e.sh`、`run_all.sh`
- CI 集成 `.github/workflows/test.yml`:GUT + Godot 集成 + Playwright 三个 job
- 文档:更新 `tests/README.md`,新增 `core/utils/README.md` 与 `core/abstract/data/README.md`

### 改动

- `tests/README.md` 重写为三层测试的运行手册
- `.gitignore` 屏蔽 `addons/` 与 `tests/e2e/{node_modules,screenshots,playwright-report,test-results,dist}`

## [0.1.0] - 2026-08-20

- Godot 4.3 + Git 仓库初始化
- 目录结构 `core/` / `scripts/` / `scenes/` / `assets/{art,audio,fonts}/` / `tests/{unit,integration}/`
- 主场景 `scenes/main.tscn` + `scripts/main.gd` 占位
- README、CHANGELOG、.gitignore、.editorconfig、.gitattributes
