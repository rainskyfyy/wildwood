# 更新日志

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已计划
- M2.2 资源采集
- M2.3 建造系统
- M2.10 战斗手感
- M3.1 联机完整版

## [0.5.0] - 2026-08-20

### 新增(M2.1 移动 + LMB 智能判别 ★ 关键路径)

- **LMB 智能判别核心**(M2.1):
  - `core/abstract/gameplay/lmb_decide.py` — Python 纯逻辑,10 验收场景 + 5 边界 + 1 性能基准,19/19 pytest 全过
  - `core/abstract/gameplay/lmb_decide.gd` — GDScript 1:1 语义绑定(给 Godot 端用)
  - `core/abstract/gameplay/SEMANTICS.md` — Python ↔ GDScript 规则对照表(供 CI GUT 验收)
- **M2.1 Demo 场景**:
  - `scripts/player_controller.gd` — WASD/方向键 8 方向 + 60 FPS 物理 + 8 方向朝向(`flip_h` 横向 + `last_vertical_sign` 纵向)
  - `scripts/world.gd` + `scripts/world_target.gd` — World 容器 + 候选目标 API(`to_candidate()`)
  - `scripts/m21_demo.gd` + `scenes/m21_demo.tscn` — M2.1 demo 主场景(4 占位目标 + HUD)
- **测试基础设施**:
  - `tests/unit/test_lmb_decide.py` — 19 个 pytest(全过,< 0.1s)
  - `tests/scripts/headless_smoke.py` — 15 验收场景端到端冒烟
  - `tests/scripts/run_m21_tests.sh` — 一键验收 6 步:pytest + smoke + 文件 + scene + 符号 + 性能
- **文档**:
  - `docs/plans/2026-08-20-m2.1-movement-and-lmb-decide.md` — M2.1 实施计划(10 任务)
  - `README.md` M2.1 章节(架构图、10 验收场景、跑测命令、关键路径解锁)

### 关键路径解锁

- M2.2 资源采集 ✅ 可开始(gather 判别已就位,只缺资源实例化)
- M2.3 建造系统 ✅ 可开始(攻击 / 采集 / 移动 智能判别已稳定)
- M2.4 生存属性 ✅ 可开始(玩家控制器抽象已稳定)
- M2.10 战斗手感 ✅ 可开始(60Hz 移动平滑 + ATTACK 触发器)

### 验收

- ① 移动 200ms 内响应:`_physics_process` 60Hz = 16.67ms / 帧,**12× 余量**
- ② LMB 智能判别 100%(10 场景):`tests/unit/test_lmb_decide.py` 19/19 pytest + 15/15 headless smoke + 6/6 验收脚本,**全过**
- ③ sprite 朝向正确:`_update_facing` 8 方向分支 + `flip_h` + `last_vertical_sign`
- 性能基线:200 候选 × 1000 轮 p99 = 0.06ms(200× 远低于 1ms 预算)

### 已知边界 / 留给后续

- 沙箱内无 Godot 二进制,GDScript 端走静态审查 + SEMANTICS 对照表;CI 由工作台搭建师补 GUT 等价测试
- 占位 sprite 用 ColorRect(深绿地板 + 4 色方块),M2.14 替换为真实像素画
- 联机输入流(M3.1+)接管 C2S_PlayerInput,本控制器降级为"客户端预测/演示"
- ATTACK/GATHER 是 placeholder(M2.1 只验证判别,伤害 / 资源产出 M2.3/2.2 落地)
- 屏幕↔世界坐标转换(`get_canvas_transform()`)留 M2.4
- 移动用 `position +=` 直接写(M2.1 demo 无碰撞体;M2.5 引入 CharacterBody2D + collision shape)

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

[0.5.0]: https://github.com/example/wildwood/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/example/wildwood/compare/v0.3.0...v0.4.0
