# Changelog

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已计划
- M1.2 CI/CD 雏形
- M1.6 资源元数据抽象
- M1.12-1.13 5 张样稿 + Aseprite 工作流
- M2.6 战斗
- M2.7 合成
- M2.14 联机压测
- M3.1 联机完整版

## [0.5.0] - 2026-08-20

### 新增(M2.4 生存属性系统 ★ 关键路径)

- **`core/abstract/survival/`**(A/B 通用层,纯 stdlib,零外部依赖)
  - `stats.py` — `SurvivalStats`(HP/饱腹/精神/温度 4 维数据类,带 clamp/to_dict/from_dict)+ `SurvivalContext`(ambient/fire/wet/shelter/time_of_day/monster_proximity/resting/is_alive)+ `Season` 枚举 + `SurvivalError` 异常
  - `modifiers.py` — 三个 modifier 接口:
    - `is_critical(stats)` — 任务验收 ② 警示动效触发条件(H/饱/精 ratio<30% 或温度偏离中性)
    - `get_speed_modifier(stats)` — 任务验收 ③ 温度 < 0°C 减速 50%(返回 `SPEED_FREEZING=0.5`)
    - `should_show_illusion(stats)` — 任务验收 ④ 精神 < 30% 启用幻象
  - `tick.py` — `SurvivalSystem` 30Hz tick 推进
    - 4 维推进顺序:饥饿 → 精神 → 温度 → HP
    - HP 再生条件:饱腹>50 + 精神>50 + 温度适中(每 5s +1)
    - HP 衰减触发:饥饿归零(-2/s) / 温度极端(<-5 或 >40, -3/s) / 精神归零(-1/s)
    - 温度平衡:牛顿冷却 + 火堆/淋雨/庇护所修正
    - 死亡:HP <= 0 → `is_dead=True`,停止推进
- **`scripts/survival/`**(Godot 端 GDScript 镜像)
  - `survival_formulas.gd` — 静态公式类,镜像 Python 端 `modifiers.py`
  - `survival_system.gd` — 运行时节点,30Hz `_physics_process` 推进,镜像 `tick.py`
  - `README.md` — 接入点说明(M2.1/M2.5/UI/渲染)
- **测试**:`tests/unit/survival/` 共 94 个 pytest 单测全过(0.07s)
  - `test_stats.py` 13 + `test_context.py` 12 + `test_modifiers.py` 32 + `test_tick.py` 28 + `test_integration.py` 9
  - 性能基准:1000 玩家 × 30Hz × 1s = 30000 ticks < 1s(单 tick < 33µs)
- **规划文档**:`docs/plans/2026-08-20-m2.4-survival.md`(TDD 实施记录)

### 接入点(等后续任务)

- **M2.1 移动控制器**:读 `SurvivalSystem.get_speed_modifier()` 乘到 base_speed
- **M2.5 死亡监听**:读 `SurvivalSystem.is_dead` 触发复活流程
- **UI 警示动效**:读 `is_critical()` 触发闪动
- **渲染幻象**:读 `should_show_illusion()` 启用对应 shader

### 兼容性

- 字段语义沿用 M1.4 `PlayerCurrentState`(hp/hunger/sanity/temperature),**不依赖 M1.4 import**
- 本任务在 `feat/m2.4-survival` 独立分支,不影响 M2.1 `feat/m2.1-movement` 分支
- M2.1 完成后做集成 merge

## [0.4.0] - 2026-08-20

### 新增(M2.1 ★)

- **MOVE 服务端处理**(Go): `HandlePlayerInputMove` — 更新 PosX/PosY(200 px/s)、facing;移动时取消当前采集;广播玩家位置给全队
- **客户端预测**(GDScript): `scripts/player.gd` — WASD 立即移动(预测) + 发 C2S_PlayerInput(MOVE);服务端 S2C_WorldDelta 校正
- **LMB 智能判别**: `world.find_nearest_gatherable(mouse_pos, reach*2)` → 找屏幕鼠标位置最近的可采资源 → 发 GATHER
- **关键 Bug 修复**: handlePlayerInput 路由到 MOVE / GATHER / ATTACK 子 handler(M2.1 之前是 echo)

### 新增(M2.2 ★ 关键路径)

- **10+ 资源类型**(Go `world.go`): Tree / RockOre / Grass / RabbitHut / Berry / Mushroom / Reed / Flint / Bone / Twig / Bush / BerryBush = 12 种(超额满足 10+)
  - HP:草/芦苇/燧石/骨/木棍/浆果/蘑菇/兔窝=1,树/矿/灌木/浆果丛=3
  - 采集时长:全部 1500ms ± 100ms(任务验收 ①)
  - ReachPixels: 48 / 64(32px 网格对齐)
  - 浆果丛 RespawnAfterMS=60s(重生)
- **服务端采集 tick 推进**: `Room.TickGather(now)` 20Hz tick 循环,到 ExpiresAt 扣 1 HP;HP=0 → 移除(或重生)
- **GATHER 处理**: `HandlePlayerInputGather` 距离判定 + 创建/覆盖 GatherProgress(每次发新 GATHER 都重置 1.5s 倒计时)
- **HP 同步**(任务验收 ④): tick 检测到 HP 变化时,广播 S2C_WorldDelta.entity_updates 给全队
- **客户端联动**(GDScript):
  - `scripts/resource.gd` — sprite 抖动(HP 变化触发 0.15s 抖动 + 4px 振幅)+ HP 文字 + 颜色随 HP 衰减
  - `scripts/player.gd` — 头顶 ProgressBar 1.5s 倒计时
  - `scripts/world.gd` — WorldSnapshot.Entities spawn 资源,接收 S2C_WorldDelta 更新 HP / 玩家位置

### 测试

- Go 端:
  - 既有 53 个测试全过(M1.5+M1.9+M1.10+M1.11 baseline 不破坏)
  - 新增 5 个 M2.1/M2.2 验收测试:
    - `TestM21_Acc01_MoveUpdatesPosition` — 移动位置 + facing 广播
    - `TestM21_Acc02_MoveCancelsGather` — 移动取消当前采集
    - `TestM22_Acc01_10ResourceTypes_1500ms` — 12 种资源 1.5s ± 200ms 验证
    - `TestM22_Acc02_ProgressExpiresAt_1500ms` — GatherProgress.ExpiresAt = now + 1500ms
    - `TestM22_Acc03_HPSync_BroadcastToAllPlayers` — p2 收到 host 的 GATHER 引起的 WorldDelta(含 grass HP 变化 + GATHER_DONE event)
  - 全部 58 个测试 PASS(0.6s)

### 关键路径意义

- M2.2 解锁:
  - M2.6 战斗(怪物掉落材料依赖采集系统产出物品)
  - M2.7 合成(树/矿/芦苇/燧石等资源是合成的输入)
  - M2.14 联机压测(资源同步是联机带宽预算的关键场景)
- M2.1 解锁:
  - M2.10 战斗(玩家需要位置预测 + 服务端校正)
  - M3.1 联机完整版(20Hz tick + 客户端预测模式)

### 风险与限制

- 客户端进度条用本地计时 1.5s,未严格从 ack_input_seq 推导(简化)
- 资源位置由服务端 InitWorld 决定(每种 1 个);真实游戏中 M2.7 生物群系 spawner 接管
- M2.10 战斗 AI 的 ATTACK handler 已占位(只 ack),M2.10 任务实现完整攻击

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
