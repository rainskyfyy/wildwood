# core/abstract/survival — M2.4 生存属性系统(关键路径)

A/B 通用层(纯 Python stdlib,无外部依赖,Godot/Unity 引擎层薄壳镜像公式)。

## 模块边界

- **`stats.py`** — 4 维属性 + 外部条件
  - `SurvivalStats`:HP / 饱腹 / 精神 / 温度(数据类,带 clamp / to_dict / from_dict)
  - `SurvivalContext`:ambient / fire / wet / shelter / time_of_day / monster_proximity / resting / is_alive
  - `Season`:`spring` / `summer` / `autumn` / `winter`
  - `SurvivalError`:异常基类

- **`modifiers.py`** — 三个 modifier 接口
  - `is_critical(stats)` → bool:任务验收 ② 警示动效触发条件
  - `get_speed_modifier(stats, context=None)` → float:任务验收 ③ 温度 < 0°C 减速 50%
  - `should_show_illusion(stats)` → bool:任务验收 ④ 幻象 shader 触发条件
  - 阈值常量:`CRITICAL_THRESHOLD` / `TEMP_FREEZING` / `SPEED_FREEZING` / 等

- **`tick.py`** — 30Hz 推进运行时
  - `SurvivalSystem(stats, context=None)`:运行时对象,30Hz `tick(dt)` 推进
  - `TICK_HZ = 30`, `TICK_DT = 1/30`
  - 4 维推进顺序:饥饿 → 精神 → 温度 → HP
  - HP <= 0 时 `is_dead = True`,停止推进(等 M2.5 复活)

## 任务验收(项目总方案 §2.1 + 任务描述)

| 验收项 | 实现位置 |
| --- | --- |
| ① 4 维属性实时更新(30Hz) | `SurvivalSystem.tick(TICK_DT)` |
| ② 警示动效 < 30% 触发 | `is_critical(stats)` |
| ③ 温度 < 0°C 减速 50% | `get_speed_modifier(stats)` 返回 `SPEED_FREEZING = 0.5` |
| ④ 精神 < 30% 幻象 shader 启用 | `should_show_illusion(stats)` |

## 性能

- 单次 tick(4 维推进 + clamp + 3 modifier 判定):Python 实测 < 33µs
- 1000 玩家 × 30Hz × 1s = 30 000 ticks 实测 < 1s
- 详细:`tests/unit/survival/test_tick.py::TestTickPerformance`

## 字段语义参考

`SurvivalStats` 字段名(hp / hunger / sanity / temperature)与 M1.4 `PlayerCurrentState` 保持一致。
本模块**不依赖 M1.4 import**(M1.4 在独立分支),只复用 4 维属性边界。
后续集成时:
- 存档/读档用 `to_dict()` / `from_dict()` 与 M2.6 世界持久化对接
- 联机同步用 `get_stats_dict()` 暴露给 M3.x 房间服务

## 接入点(等后续任务)

- **M2.1 移动控制器**:读 `SurvivalSystem.get_speed_modifier()`,乘到 base_speed
- **M2.5 死亡监听**:读 `SurvivalSystem.is_dead`,触发复活流程
- **UI 警示动效**:读 `SurvivalSystem.is_critical()`,触发闪动效果
- **渲染层幻象**:读 `SurvivalSystem.should_show_illusion()`,启用对应 shader

## 测试

- 94 个 pytest 单测全过(0.07s,纯 stdlib 无外部依赖)
  - `test_stats.py`:13 个(数据模型 / clamp / 序列化)
  - `test_context.py`:12 个(上下文 / 季节 / 异常)
  - `test_modifiers.py`:32 个(3 个 modifier + 边界)
  - `test_tick.py`:28 个(30Hz 推进 + 性能基准)
  - `test_integration.py`:9 个(端到端场景)

## 不在本任务范围

- M2.5 死亡复活机制(等 M2.5 接入 `is_dead` 标志)
- M2.8 季节循环对温度的影响(等 M2.8 接入 `Season` 字段)
- 联机同步协议字段定义(等 M3.x 接入,本模块已通过 `to_dict()` 暴露可序列化形态)
- 4 维属性的具体音效/动效(等 UI/音效 agent 接入 `is_critical()` / `should_show_illusion()`)
