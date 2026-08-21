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

### 新增(M1.11 房间创建/加入/退出基础流程 ★ 关键路径)
