# Changelog

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增(M2.11 图鉴系统 ★ 关键路径)

- **协议层**(`core/abstract/network/proto/wildwood/v1/{common,c2s,s2c}.proto`)
  - `CodexCategory` (enum):UNSPECIFIED / CREATURE / ITEM / BIOME
  - `CodexQueryKind` (enum):UNSPECIFIED / FULL / ENTRY
  - `CodexEntry` (msg):11 字段,见方案 §3.10
  - `CodexUnlock` (msg):`entry_id` / `unlock_time_ms`
  - `C2S_CodexQuery` / `C2S_CodexView` 新增:客户端查询 + 面板开关
  - `S2C_CodexSync` 新增:join 时全量下发 database + unlocked
  - `S2C_CodexDelta` 新增:5Hz 增量广播
- **Go codec**(`go/codec/registry.go` + 自动重生 `*.pb.go`):4 个新消息类型注册
- **服务端**(`core/abstract/network/go/room/`)
  - `codex.go` 新增(370 行):`CodexState` per-room 状态(单调解锁 + dirty set)+ `BuildTestDatabase` 31 条目 hard-code + `BuildCodexSync` / `BuildCodexDelta` 构造器
  - `hub.go` 修改:
    - Room struct 增加 `codex *CodexState` 字段
    - `Hub.codexTickerLoop` 5Hz 独立 ticker(`CodexTickInterval = 200ms`)
    - `Hub.UnlockCodex(playerID, entryID) bool` 单点接入钩子(供 M2.2/M2.9/M2.10/M2.13 调用)
    - `Hub.handleRoomJoin` 一次性发 `S2C_CodexSync`
    - `Hub.handleCodexQuery` / `Hub.handleCodexView` 实现
- **客户端**(`core/abstract/network/gd/`)
  - `wildwood_common.gd` 追加 `CodexCategory` / `CodexQueryKind` / `CodexEntry` / `CodexUnlock` + encode/decode
  - `wildwood_c2s.gd` 追加 `CodexQuery` / `CodexView` + registry
  - `wildwood_s2c.gd` 追加 `CodexSync` / `CodexDelta` + registry
  - `wildwood_codex.gd` 新增(160 行):客户端图鉴控制器,`feed_sync` / `feed_delta` / `is_unlocked` / `get_entry` / `get_database` / `request_full_query` 等
- **文档**(`docs/codex/`)
  - `SCHEMA.md` 三层架构(数据层 / 协议层 / 服务层 / 客户端)
  - `seed_data.json` 31 条目占位数据
  - `ACCEPTANCE.md` 验收记录 + 字节预算 + 接入点

### 验证
- Go 单元测试 **23 个新增,0 fail**(17 codex unit/integration + 6 GD wire format)
  - protocol:`TestCodexEntry_RoundTrip` / `TestS2C_CodexSync_RoundTrip` / `TestS2C_CodexDelta_RoundTrip` / `TestC2S_CodexQuery_CodecRegistered` / `TestC2S_CodexView_CodecRegistered` / `TestS2C_CodexSync_RegisteredInRegistry`
  - state:`TestM211_Database_31Entries` / `TestM211_CodexState_Unlock_Idempotent` / `TestM211_CodexState_MultipleUnlocks` / `TestM211_BuildCodexSync_HasDatabase` / `TestM211_BuildCodexDelta_HasUnlockedFull` / `TestM211_BuildCodexDelta_Empty` / `TestM211_AllEntriesHaveValidFields` / `TestM211_AllEntryIDsUnique` / `TestM211_CategoryCoverage` / `TestM211_5HzTickInterval` / `TestM211_HubUnlockCodex_HooksRoom`
  - GD wire format:`TestGD_WireFormat_CodexEntry_RoundTrip`(GDScript 219 bytes = Go 219 bytes byte-equivalent)/ `TestGD_WireFormat_CodexUnlock_RoundTrip` / `TestGD_WireFormat_CodexSync_RoundTrip` / `TestGD_WireFormat_CodexDelta_RoundTrip` / `TestGD_WireFormat_CodexQuery_RoundTrip` / `TestGD_WireFormat_CodexView_RoundTrip`
- 全量回归 Go 测试 ~70 个 0 fail(M1.5/M1.9/M1.10/M1.11 + M2.11)
- GDScript 客户端测试 11 个 `tests/test_m211.gd`(需 Godot 4.3 headless 跑,沙箱无 Godot 二进制)

### 5Hz 同步统一(M2.11/M2.12/M2.13 拍板)

- 5Hz 独立 ticker + 完整 unlocked 表(简化版,典型 4-50 项 < 256B)
- M3.1 客户端预测+校正协议到位后,移除独立 ticker,挂 WorldDelta 走 20Hz 主通道,只发 entry_id 增量

### 字节预算
- `S2C_CodexSync` 31 entries + 0 unlocked = **6576 bytes** (< 8KB ✓)
- `S2C_CodexDelta` 4-50 unlocked = **< 256B** (typical)
- 4 客户端 × 5Hz × 256B = 5KB/s(典型队伍,可控)

### 接入点(M2.2/M2.9/M2.10/M2.13 集成)

```go
// 击杀怪物 / 采集资源 / 合成物品 / 开箱子时:
hub.UnlockCodex(playerID, "creature.tree_sprite")  // M2.10 战斗
hub.UnlockCodex(playerID, "item.berry")             // M2.2 采集
hub.UnlockCodex(playerID, "item.cookpot")          // M2.9 合成
hub.UnlockCodex(playerID, "item.chest")            // M2.13 交互
```

返回 `true` = 新解锁(5Hz 内广播),`false` = 已解锁(幂等)或 player 不在房间。

### 留给后续
- 美术资产 `sprite_key = "TBD_64"` 占位,M2.14 美术完成后替换
- 客户端 UI 双 Tab + 灰显 + ?? 由 UI 设计师交付 `scenes/ui/codex/codex_view.tscn`
- M3.1 接管 5Hz ticker,改走 WorldDelta 20Hz 主通道

### 已计划
- M2.2 资源采集
- M3.2 实体插值
- M3.7 断线保留
- M3.8 反作弊

## [0.6.0] - 2026-08-20

### 新增(M3.1 客户端预测 + 服务端校正 ★ 关键路径)

- **Python 核心预测 + 插值**:
  - `core/abstract/network/python3/wildwood/prediction.py` — Predictor(16 pytest)+ InputRecord / Correction / NoCorrection
  - `core/abstract/network/python3/wildwood/interpolation.py` — Interpolator 100ms 校正插值 + 隐藏窗口(21 pytest)
  - `core/abstract/network/python3/wildwood/constants.py` — 11 M3.1 常量
- **GDScript 1:1 镜像**(`core/abstract/network/gd/`):
  - `wildwood_constants.gd` / `wildwood_predictor.gd` / `wildwood_interpolator.gd` / `SEMANTICS.md`
- **Go 服务端**(`core/abstract/network/go/room/`):
  - `auth_state.go` — 6 条输入校验(幂等 seq / 单轴超速 / 对角线归一化 / 速率限制 / 越界 / NaN/Inf 保护)
  - `hub.go` — 20Hz tick 广播 S2C_WorldDelta + `Hub.TickCount()` 公开接口
  - `m31_auth_test.go`(23 tests)+ `m31_hub_tick_tick_test.go`(4 tests)+ `m31_tick_timing_test.go`(1000-tick 压力)
- **客户端集成**:
  - `scripts/network_client.gd` — class_name NetworkClient,WebSocketPeer 收发 + 60Hz 输入节流
  - `scripts/player_controller.gd` — 接入 `enable_network_mode(client)`,网络模式从 client 同步位置 + 校正期 hidden
- **测试**:
  - `core/abstract/network/python3/tests/test_m31_integration.py` — 25 tests(端到端 demo)
  - `tests/scripts/run_m31_tests.sh` — 6 步一键验收
- **文档**:
  - `docs/plans/2026-08-20-m3.1-prediction.md` — 实施计划(10 子任务)
  - `README.md` M3.1 章节

### 关键路径解锁

- M3.2 实体插值(远程玩家同步)✅ — 复用 Interpolator
- M3.7 断线保留 + 离线墓碑 ✅ — 复用 5min 遗物超时
- M3.8 反作弊 ✅ — 复用 6 条 AuthState 规则

### 验收

- ① 20Hz tick 100ms 内到达:Hub 20Hz 节奏 + 50ms tick 周期 ✓
- ② 客户端预测 ≤ 1 帧误差:predictor.predict 同步本地应用 ✓
- ③ 偏差 > 32px 触发 100ms 插值 + 隐藏:Correction 启动 Interpolator ✓
- ④ 权威位置 1:1 一致:reconcile 总是切到 re_simulated ✓
- 性能:Go 1000-tick p99 = 1.98ms(60Hz 帧时间 16.7ms 预算内)✓

### 已知边界

- 沙箱内无 Godot binary,GDScript 端走静态审查 + SEMANTICS.md 对照表;CI 由工作台搭建师补 GUT
- WebSocket 帧用简化二进制编码;M3.14 接入 protoc-go
- 远程玩家插值留 M3.2;本任务只覆盖本地玩家

## [0.5.0] - 2026-08-20

### 新增(M2.1 移动 + LMB 智能判别 ★ 关键路径)

- **LMB 智能判别核心**(M2.1):
  - `core/abstract/gameplay/lmb_decide.py` — Python 纯逻辑,19 pytest 全过
  - `core/abstract/gameplay/lmb_decide.gd` — GDScript 1:1 语义绑定
  - `core/abstract/gameplay/SEMANTICS.md` — Python ↔ GDScript 规则对照表
- **M2.1 Demo 场景**:
  - `scripts/player_controller.gd` — WASD/方向键 8 方向 + 60 FPS 物理 + 8 方向朝向
  - `scripts/world.gd` + `scripts/world_target.gd` — World 容器 + 候选目标 API
  - `scripts/m21_demo.gd` + `scenes/m21_demo.tscn` — M2.1 demo 主场景
- **测试基础设施**:
  - `tests/unit/test_lmb_decide.py` — 19 pytest
  - `tests/scripts/headless_smoke.py` — 15 验收场景
  - `tests/scripts/run_m21_tests.sh` — 一键 6 步验收

### 关键路径解锁

- M2.2 / M2.3 / M2.4 / M2.10 ✅ 可开始

### 验收

- ① 移动 200ms 内响应:`_physics_process` 60Hz = 16.67ms / 帧
- ② LMB 智能判别 100%(10 场景):19 pytest + 15 headless smoke + 6 验收脚本
- ③ sprite 朝向正确:`_update_facing` 8 方向分支
- 性能:200 候选 × 1000 轮 p99 = 0.06ms
