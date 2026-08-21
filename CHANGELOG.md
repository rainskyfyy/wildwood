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

## [0.5.0] - 2026-08-20

### 新增(M2.5 死亡与复活 ★ 关键路径)

- **协议层**:`core/abstract/network/proto/wildwood/v1/common.proto` 已预留字段 `PlayerStatus.is_ghost` / `ghost_remaining_ms` / `death_pos_x` / `death_pos_y` / `remains_id`,以及 `InputAction.INPUT_ACTION_RESPAWN` / `WorldEventKind.WORLD_EVENT_DEATH` / `WORLD_EVENT_RESPAWN`,**M2.5 不改 .proto**(M1.5 阶段已预埋)
- **GDScript 核心**(`core/survival/`,新 8 个文件)
  - `death_constants.gd` — 状态常量 `STATE_ALIVE/GHOST/DEAD` + 时间/距离硬约束(`GHOST_WINDOW_MS=10000`、`REVIVE_TOUCH_PX=48.0`、`REMAINS_LIFETIME_MS=300000`)
  - `hp_provider.gd` — 抽象 `HpProvider` + `MockHpProvider`(1ms=1HP 衰减、可触发 `on_hp_depleted` 回调),作为 M2.4 HP/饥饿/精神/温度的桥接桩,M2.4 接入只需 `HpBridge.set_provider()` 注入真实现
  - `survival_signals.gd` — 集中信号总线:`player_entered_ghost` / `player_revived` / `player_died` / `remains_spawned` / `remains_picked` / `remains_expired` / `slot_visual_state_changed`
  - `death_state.gd` — 单玩家状态机 `ALIVE → GHOST (10s) → DEAD` + 复活 `DEAD/GHOST → ALIVE`,提供 `bind_hp_bridge()` / `try_revive(reviver_id)` / `tick(now_ms)`
  - `ghost_window.gd` — 10s 倒计时(100ms tick),发 `tick(remaining_ms)` + `expired()` 信号
  - `revive_handler.gd` — 队友接触检测(48px 阈值,`_process` 每帧判定),自动发 `try_revive()`
  - `remains.gd` — 遗物管理器,5min 生命周期,生成/拾取/过期 3 个事件
  - `world_m25.gd` — 4 人小队整合层:`add_player/remove_player/force_hp_zero/damage/get_snapshot`,负责把单机状态机事件广播成联机信号
- **HUD**(`scenes/hud/`,新)
  - `hud_player_slot.gd` — 单玩家槽,`modulate = Color(0.5, 0.5, 0.5, 0.5)` 灰显 50% 透明覆盖 GHOST/DEAD 状态,`Color(1, 1, 1, 1)` 复原 ALIVE(**M2.5 验收 ④**)
- **Go 端死亡服务**(`core/abstract/network/go/room/death.go`,新 350+ 行)
  - `deathMeta` 全局 Map(玩家 id → `{state, ghostStartedAtMs, reviveByPlayer, deathPos{x,y}, remainsId, remainsExpiresAtMs}`)
  - `MarkPlayerDead(pid, x, y)` / `TryRevive(reviverPid, targetPid, distPx, nowMs)` / `TickDeath(nowMs)` / `MakePlayerStatus(pid)`
  - 广播辅助 `broadcastStatus` / `broadcastDeathEvent` / `broadcastRespawnEvent` —— 整合到 `hub.go` 的 20Hz tick loop
- **协议验证**:`WorldDelta` 携带 `player_status[]` 字段已存在(M1.5 预埋),死亡事件用 `WORLD_EVENT_DEATH` + `respawn` 事件,均通过 `proto.Marshal/Unmarshal` roundtrip 测试
- **15 项 Go 单元测试**(`go/room/m25_death_test.go`,新 19.4 KB)
  - ① 鬼魂态 10s 倒计时:`TestM25_Ghost_10s_Countdown` / `TestM25_Ghost_Transitions_To_Dead`
  - ② 队友 10s 内接触复活:`TestM25_Revive_Within_10s` / `TestM25_Revive_Too_Far` / `TestM25_Revive_Cannot_Self` / `TestM25_Revive_Only_When_Ghost` / `TestM25_Revive_After_Dead_Uses_Remains`
  - ③ 超时生成遗物坐标:`TestM25_Remains_After_Timeout` / `TestM25_Remains_Ids_Are_Unique`
  - ④ HUD 灰显 50% 透明:`TestM25_Hud_Slot_State_For_Alive` / `TestM25_Hud_Slot_State_For_Ghost` / `TestM25_Hud_Slot_State_For_Dead`
  - 协议:`TestM25_PlayerStatus_Proto_Roundtrip` / `TestM25_WorldDelta_Includes_PlayerStatus`
  - 健壮性:`TestM25_Concurrent_TickDeath_No_Panic`(10 goroutine × 100 tick) / `TestM25_Room_Members_Limit`
- **Python 端到端验收**(`tests/integration/test_m25_e2e.py`,新)
  - 调 `go test -v` 收集 PASS/FAIL,按 4 条验收分组映射,彩色输出
  - 实测:`① 3/3` / `② 5/5` / `③ 3/3` / `④ 3/3` = **11/11 通过**

### 修复

- **Hub 扩展侵入控制**:`hub.go` 仅 +62 行(4 个字段 + 4 个方法 + 1 处 nil-check),未触动 M1.x 任何业务
- **Room.Broadcast nil-safety**:M2.5 测试用最小 `Hub`(无真实 WS 连接)触发 `Player.Conn == nil` 崩溃,在 `Broadcast` 开头加 `if p.Conn == nil { continue }` 兜底,M1.x 行为不变

### 验证

- **M2.5 全部 4 项验收 11/11 通过**(0.30s)
- **Go 端全量回归 68/68 通过** in 10 packages(53 baseline + 15 M2.5 新增)
  - room 包 22 个:旧 hub_test 6 + M1.11 5 + 1 stress + M2.5 15 = 27
  - 字节预算:`PlayerStatus` 含 ghost_remaining_ms 8B + death_pos{x,y} 8B + remains_id ≤ 10B,均远低于 4KB 帧上限

### A/B 兼容性
- 三层抽象(数据 M1.4 / 网络 M1.5 / 资源 M1.6)继续生效;M2.5 业务用 A 线 Go + GDScript 写,B 线 Unity 6 / C# 切换时按 `WorldDelta.player_status` 字段等价实现 `WorldM25` 即可
- `MockHpProvider` 让 M2.5 不阻塞 M2.4 实现;M2.4 落地后通过 `HpBridge.set_provider(real_provider)` 平滑替换

### 留给后续
- M2.1 移动 + 采集(消费 `tick` + `damage` API)
- M2.6 战斗(消费 `force_hp_zero` / 攻击伤害路径)
- M2.7 合成(消费 `remains.pickup` 事件)
- 遗物可视化(M2.x 美术资源)
- 跨房断线 5min 墓碑(M3.7 升级,与 `remains` 共用数据结构)

## [0.4.0] - 2026-08-20

### 新增(M1.11 房间创建/加入/退出基础流程 ★ 关键路径)