# 更新日志

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
