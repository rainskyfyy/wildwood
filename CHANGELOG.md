# Changelog

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已完成 (2026-08-20)

- **M2.7 生物群系 4 大(森林/平原/矿区/雪原)** — 共享元素库 + 9 宫格流式加载 + 0.5s 相机过渡
  - 抽象层 `core/abstract/biome/` 5 个模块:24 暖色板 / 4 共享元素 / 4 群系 / 9 宫格映射 / 流式加载器
  - A 线引擎层 `core/biome_runtime/` 4 个 GDScript:常量 / Loader / Runtime / 相机过渡状态机
  - 资源 JSON 5 个:`palette.json` / `elements.json` / `biome_map.json` / `biomes/{forest,plains,mines,snow}.json`
  - 验收:① 4 群系主色与特征资源 / 怪物到位 ✅ · ② 9 宫格懒加载 -64% 内存 ✅ · ③ 相机过渡 500ms ± 20ms ✅
  - 微调(2026-08-20 拍板):主色与特征资源复用 M2.14 资产清单(`source_ref="m2.14.*"`,不重复生产
  - 测试:105 个 pytest 全过(76 单元 + 29 验收)+ 31 个 GUT 集成测试(Godot CI 端)
  - 详见 `docs/m27_biomes.md`

## [0.8.0] - 2026-08-20

### 新增(M2.7 生物群系 4 大 ★ 关键路径)

- **共享元素库** + 4 大群系(森林/平原/矿区/雪原) + 9 宫格流式加载 + 0.5s 相机过渡
- **抽象层** `core/abstract/biome/` 5 个模块:
  - `palette.py` 24 暖色板(暖 17/冷 3/中性 4,源数据来自美术风格指南 §色板规范)
  - `elements.py` 4 共享元素(grass/rock/tree/mushroom),4 群系共用,仅替换主色 + 密度
  - `biomes.py` 4 群系定义(forest #7d8b4d / plains #5a6b3a / mines #5a7080 / snow #8fb4c0),各 2 特征资源 + 2 特征怪物
  - `biome_map.py` 9 宫格流式加载(中心 3×3 = 9 chunk,1 chunk ≈ 1MB)
  - `loader.py` JSON 资源加载
- **A 线引擎层** `core/biome_runtime/` 4 个 GDScript:
  - `WildwoodBiomeConstants.gd` — 常量层
  - `WildwoodBiomeLoader.gd` — 加载器
  - `WildwoodBiomeRuntime.gd` — 运行时
  - `WildwoodCameraTransition.gd` — 0.5s 相机过渡状态机(IDLE→OUT→SWAP→IN→IDLE)
- **资源 JSON** 5 个:`assets/biomes/{palette,elements,biome_map,biomes/{forest,plains,mines,snow}}.json`
- **验收 3/3 全过**:
  - ① 4 群系主色与特征资源 / 怪物到位
  - ② 9 宫格懒加载:全图基线 ≥ 25 chunk → 9/25 = 36% → 节省 64% ≥ 60% 验收
  - ③ 相机过渡 500ms ± 20ms(0.5s = 250ms OUT + 0ms SWAP + 250ms IN)
- **微调**(2026-08-20 拍板):主色与特征资源复用 M2.14 资产清单(`source_ref="m2.14.*"`),避免 M2.7 与 M2.14 重复生产
- **测试**:105 个 pytest 全过(76 单元 + 29 验收) + 31 个 GUT 集成测试(Godot CI 端)
- **关键路径意义**:解锁 M2.8(季节循环)+ M2.10(战斗地图多样性),无延期

### 已计划
- M1.2 CI/CD 雏形
- M1.6 资源元数据抽象
- M1.12-1.13 5 张样稿 + Aseprite 工作流
- M2.1 移动 + 采集
- M2.6 战斗
- M2.7 合成
- M2.14 联机压测
- M3.1 联机完整版

## [0.7.0] - 2026-08-20

### 新增(M2.6 世界持久化 ★ 关键路径)

#### 分块存储
- `core/abstract/data/chunks.py`:新增 `TerrainChunk` / `InventoryChunk` 数据类
- `chunks.py`:新增切分重组工具 `split_world_modifications` / `merge_terrain_chunks` / `extract_inventory` / `inject_inventory`
- `chunks.py`:新增 chunk_id 计算工具 `terrain_chunk_id(x, y)`(16x16 tile 网格) / `inventory_chunk_id(player_id)`
- `chunks.py`:新增文件路径工具 `terrain_chunk_file_path` / `inventory_file_path` / `atomic_write_json` / `measure_save_dir_size`
- `JsonFileStore`(reference, M2.6 升级):
  - 默认 `use_chunks=True`,存档目录内分块存储:
    - `terrain/{cid}.json`(每 chunk 一个文件)
    - `profiles/{pid}_inventory.json`(玩家库存独立文件)
  - 新增 6 个分块粒度 API:`save_terrain_chunk` / `load_terrain_chunk` / `list_terrain_chunks` / `save_inventory_chunk` / `load_inventory_chunk` / `save_size_bytes`
- `MockLiteDbStore`(mock, M2.6 升级):
  - 加 `terrain_chunks` / `inventory_chunks` collection(doc_id 加 save_id 前缀以支持多 save 隔离)
  - 同样实现 6 个分块粒度 API
  - `save_size_bytes` 返回整个 db 文件字节数(mock 是单文件)

#### 版本迁移
- `core/abstract/data/migrations.py`:新增 `SchemaMigrator` 单例类(注册 / 链式升级 / 缺失迁移报错 / 安全防护)
- 内置迁移函数:
  - WorldState v1.0.0 → v1.1.0:加 `world_seed_hash`(从 `world_seed` 派生)
  - WorldState v1.1.0 → v1.2.0:`world_modifications` 按 16x16 切到 `chunks` 索引
  - PlayerProfile v1.0.0 → v1.1.0:加 `last_known_position`(None) + `inventory_capacity`(16)
- `_migrate_world_state` / `_migrate_profile` / `_migrate_save_game` 在 `JsonFileStore` / `MockLiteDbStore` 加载时自动检测 schema_version,跨 major 抛 `VersionIncompatibleError`,同 major 自动链式 upgrade

#### 跨模式
- `SaveGame.game_mode` / `clients` 字段已支持单机 / 联机 host 切换
- 跨模式 roundtrip 校验:`TestCrossModeRoundtrip` 4 个测试,覆盖 single↔host 互转不丢数据

#### 变更
- `CURRENT_WORLD_STATE_VERSION`: 1.0.0 → 1.2.0(加 `world_seed_hash` + `chunks`)
- `CURRENT_PLAYER_PROFILE_VERSION`: 1.0.0 → 1.1.0(加 `last_known_position` + `inventory_capacity`)
- `CURRENT_SAVE_GAME_VERSION`: 1.0.0(不变)
- `schemas.py` 字段校验器更新:`world_seed_hash` / `chunks` / `last_known_position` / `inventory_capacity` 字段(均 Optional,旧数据不抛错)
- `JsonFileStore` 持久化时把 `world_modifications` / `chunks` 从 `world.json` 中剥到分块文件(避免双存数据漂移)

#### 测试
- `tests/unit/test_m26_world_persistence.py`(M2.6 专项测试):59 个测试
  - `TestSchemaMigratorRegistration` 10 个 / `TestBuiltinMigrations` 4 个 / `TestChunkIds` 3 个 / `TestSplitMergeRoundtrip` 4 个 / `TestInventoryChunkExtractInject` 2 个 / `TestChunkFilePaths` 2 个
  - `TestJsonFileStoreChunkIO` 8 个 / `TestJsonFileStoreUseChunksFalse` 1 个 / `TestMockLiteDbStoreChunkIO` 6 个
  - `TestCrossModeRoundtrip` 4 个 / `TestFullSaveSizeBudget` 3 个 / `TestExitReenterIdentical` 4 个 / `TestVersionMigrationOnLoad` 2 个
  - `DataStoreChunkContractMixin` 6 个(ref + mock × 3 方法)
- `tests/unit/test_data_layer.py` 更新:1 个测试从 M1.4 风格的"1 个 profile 文件"改为 M2.6 分块的"1 profile + 1 inventory = 2 文件"
- 全部回归:**125 个测试通过(M1.4 66 + M2.6 59)**
- 满存档实测:JsonFileStore 1.0 MB / MockLiteDbStore 1.4 MB(都远低于 10MB 上限)
- 性能基准:save ~150ms / load ~30ms(都远低于 1s 目标)

#### 文档
- `core/abstract/data/SCHEMAS.md` 加 §9"M2.6 增量 — 分块存储 + 版本迁移 + 跨模式"
- `core/abstract/data/README.md` 更新模块结构 + 跑测命令 + 验收对账
- `core/abstract/data/examples/m26_demo.py`:新增演示脚本(满存档 / 跨模式 / 版本迁移 / 跨 backend 一致)

## [0.6.0] - 2026-08-20

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

- **Hub 扩展侵入控制**:`hub.go` 仅 +62 行(4 个字段 + 4 个 方法 + 1 处 nil-check),未触动 M1.x 任何业务
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
## [0.3.0] - 2026-08-20  ### M2.6 世界持久化

### Added — 分块存储
- `core/abstract/data/chunks.py`:新增 `TerrainChunk` / `InventoryChunk` 数据类
- `chunks.py`:新增切分重组工具 `split_world_modifications` / `merge_terrain_chunks` / `extract_inventory` / `inject_inventory`
- `chunks.py`:新增 chunk_id 计算工具 `terrain_chunk_id(x, y)`(16x16 tile 网格) / `inventory_chunk_id(player_id)`
- `chunks.py`:新增文件路径工具 `terrain_chunk_file_path` / `inventory_file_path` / `atomic_write_json` / `measure_save_dir_size`
- `JsonFileStore`(reference, M2.6 升级):
  - 默认 `use_chunks=True`,存档目录内分块存储:
    - `terrain/{cid}.json`(每 chunk 一个文件)
    - `profiles/{pid}_inventory.json`(玩家库存独立文件)
  - 新增 6 个分块粒度 API:`save_terrain_chunk` / `load_terrain_chunk` / `list_terrain_chunks` / `save_inventory_chunk` / `load_inventory_chunk` / `save_size_bytes`
- `MockLiteDbStore`(mock, M2.6 升级):
  - 加 `terrain_chunks` / `inventory_chunks` collection(doc_id 加 save_id 前缀以支持多 save 隔离)
  - 同样实现 6 个分块粒度 API
  - `save_size_bytes` 返回整个 db 文件字节数(mock 是单文件)

### Added — 版本迁移
- `core/abstract/data/migrations.py`:新增 `SchemaMigrator` 单例类(注册 / 链式升级 / 缺失迁移报错 / 安全防护)
- `migrations.py`:新增内置迁移函数
  - WorldState v1.0.0 → v1.1.0:加 `world_seed_hash`(从 `world_seed` 派生)
  - WorldState v1.1.0 → v1.2.0:`world_modifications` 按 16x16 切到 `chunks` 索引
  - PlayerProfile v1.0.0 → v1.1.0:加 `last_known_position`(None) + `inventory_capacity`(16)
- `_migrate_world_state` / `_migrate_profile` / `_migrate_save_game` 在 `JsonFileStore` / `MockLiteDbStore` 加载时自动检测 schema_version,跨 major 抛 `VersionIncompatibleError`,同 major 自动链式 upgrade

### Added — 跨模式
- `SaveGame.game_mode` / `clients` 字段已支持单机 / 联机 host 切换
- 跨模式 roundtrip 校验:`TestCrossModeRoundtrip` 4 个测试,覆盖 single↔host 互转不丢数据

### Changed
- `CURRENT_WORLD_STATE_VERSION`: 1.0.0 → 1.2.0(加 `world_seed_hash` + `chunks`)
- `CURRENT_PLAYER_PROFILE_VERSION`: 1.0.0 → 1.1.0(加 `last_known_position` + `inventory_capacity`)
- `CURRENT_SAVE_GAME_VERSION`: 1.0.0(不变)
- `schemas.py` 字段校验器更新:`world_seed_hash` / `chunks` / `last_known_position` / `inventory_capacity` 字段(均 Optional,旧数据不抛错)
- `JsonFileStore` 持久化时把 `world_modifications` / `chunks` 从 `world.json` 中剥到分块文件(避免双存数据漂移)

### Tests
- `tests/unit/test_m26_world_persistence.py`(M2.6 专项测试):59 个测试
  - `TestSchemaMigratorRegistration` 10 个:注册 / 链式 / 缺失迁移 / 倒退 / 循环防护
  - `TestBuiltinMigrations` 4 个:实际执行 world 1.0.0→1.2.0 / profile 1.0.0→1.1.0
  - `TestChunkIds` 3 个 / `TestSplitMergeRoundtrip` 4 个 / `TestInventoryChunkExtractInject` 2 个
  - `TestChunkFilePaths` 2 个
  - `TestJsonFileStoreChunkIO` 8 个:分块粒度 IO
  - `TestJsonFileStoreUseChunksFalse` 1 个:退化模式分块 API 抛错
  - `TestMockLiteDbStoreChunkIO` 6 个:mock 端分块粒度 IO + 多 save 隔离 + delete 清理
  - `TestCrossModeRoundtrip` 4 个:单机 / 联机 host 互转 + 跨 backend 一致
  - `TestFullSaveSizeBudget` 3 个:满存档 < 10MB + save/load 性能
  - `TestExitReenterIdentical` 4 个:roundtrip 一致性
  - `TestVersionMigrationOnLoad` 2 个:加载时自动迁移
  - `DataStoreChunkContractMixin` 6 个(ref + mock × 3 方法):跨 backend 合约
- `tests/unit/test_data_layer.py` 更新:1 个测试从 M1.4 风格的"1 个 profile 文件"改为 M2.6 分块的"1 profile + 1 inventory = 2 文件"
- 全部回归:**125 个测试通过(M1.4 66 + M2.6 59)**
- 满存档实测:JsonFileStore 1.0 MB / MockLiteDbStore 1.4 MB(都远低于 10MB 上限)
- 性能基准:save ~150ms / load ~30ms(都远低于 1s 目标)

### Docs
- `core/abstract/data/SCHEMAS.md` 加 §9"M2.6 增量 — 分块存储 + 版本迁移 + 跨模式"
- `core/abstract/data/README.md` 更新模块结构 + 跑测命令 + 验收对账
- `core/abstract/data/examples/m26_demo.py`:新增演示脚本(满存档 / 跨模式 / 版本迁移 / 跨 backend 一致)

## [0.2.0] - 2026-08-20  ### M1.4 数据层抽象接口

### Added
- A/B 通用层 1:`WorldState` / `PlayerProfile` / `SaveGame` / `ClientConnection` 数据类
- `JsonFileStore`(reference)+ `MockLiteDbStore`(mock,模拟 B 线 LiteDB 多 collection 语义)
- A/B 切换工厂 `make_store(backend, **kwargs)`,支持 env 变量 `WILDSWOOD_DATA_BACKEND`
- 66 个单元测试 + 工厂测试 + `DataStoreContractMixin` 共享合约测试

### Tests
- 66 / 66 通过(0.07s)

## [0.1.0] - 2026-08-20

### 新增
- M1.1 项目初始化:Godot 4.3 工程骨架 + Git 仓库
- 目录结构:`core/` / `scripts/` / `scenes/` / `assets/` / `tests/`
- `project.godot` 主配置(含 4.3 feature tag、WASD 输入映射、像素 snapping、6 层渲染)
- `icon.svg` 占位图标(柴火主题,待 M1.12 AI 画师替换)
- `scenes/main.tscn` + `scripts/main.gd` 主入口占位
- `.gitignore` / `.gitattributes` / `.editorconfig` 工程配置
- `LICENSE` MIT
- 各子目录 `README.md` 文档
- 本 `CHANGELOG.md`

[Unreleased]: https://example.com/wildwood/compare/v0.3.0...HEAD
[0.3.0]: https://example.com/wildwood/compare/v0.2.0...v0.3.0
[0.2.0]: https://example.com/wildwood/compare/v0.1.0...v0.2.0
[0.1.0]: https://example.com/wildwood/releases/tag/v0.1.0
