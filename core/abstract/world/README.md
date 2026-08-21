# M2.8 — 季节循环 + 昼夜循环

> **阶段:** M2 核心循环 (W5-W10)
> **任务 ID:** 7676046310469799186
> **依赖:** M2.7(进行中, M2.8 自身可独立工作)
> **目标:** 4 季节 30 日循环;每季节改变光照/温度/植被/怪物生成表;昼夜循环 24h

## 验收标准

| # | 项目 | 状态 |
|---|------|------|
| ① | 4 季节切换 0.5s LOD 过渡 | ✅ |
| ② | 温度范围符合方案 §2.7 | ✅ |
| ③ | 全局时间轴统一驱动 | ✅ |
| ④ | 昼夜光照过场平滑 | ✅ |

## 数据来源

- 项目总方案 §2.6(全生物群系, 5 群系)
- 项目总方案 §2.7(全季节, 4 季节 + 30 日循环)
- 项目总方案 §2.8(MVP 验收汇总)

## 模块结构

```
core/abstract/world/
├── __init__.py
├── constants.py            # 不可变常量(温度范围来自方案 §2.7)
├── time_axis.py            # 全局时间轴 (TimeAxis, 单一 owner)
├── season.py               # 季节枚举 + 状态机 (Season / SeasonClock)
├── day_night.py            # 昼夜枚举 + 时钟 (DayPhase / DayNightClock)
├── season_table.py         # 季节数据表 (SeasonProfile)
├── light_controller.py     # 0.5s LOD 平滑过渡 (LightController)
├── tick_events.py          # 一次 tick 事件集合 (TickEvents)
├── tick_driver.py          # 统一 tick 入口 (TickDriver, 验收 ③)
├── monster_spawn_table.py  # 怪物生成表 (MonsterSpawnTable, M2.7 接口)
└── gd/                     # Godot 4.3 薄包装
    ├── wildwood_time_axis.gd
    ├── wildwood_season.gd
    ├── wildwood_season_clock.gd
    ├── wildwood_day_phase.gd
    ├── wildwood_day_night_clock.gd
    ├── wildwood_season_profile.gd
    ├── wildwood_season_table.gd
    ├── wildwood_light_controller.gd
    ├── wildwood_tick_driver.gd
    └── tests/
        ├── README.md
        └── test_m28.gd     # Godot headless 验收脚本
```

## 核心概念

### TimeAxis(全局时间轴, 验收 ③ 核心)

- **单一 owner**:由 `TickDriver` 持有, 外部只能通过 `TickDriver.tick(dt)` 推进
- **派生属性**:`day_in_season` / `season_index` / `hour_in_day` / `minute_in_hour` / `day_progress` / `season_progress`
- **确定性**:相同 `tick` 序列产生相同时间快照

### SeasonClock + SeasonTable(验收 ②)

- 4 季节枚举:`spring` / `summer` / `autumn` / `winter`(str enum, 可 JSON 序列化)
- 30 日循环, `season_index = (total_days // 30) % 4`
- 季节切换由 `update()` 检测, 返回新 `Season` 或 `None`
- 季节表温度范围(方案 §2.7 硬约束):
  - 春 15-25°C / 夏 25-40°C / 秋 10-20°C / 冬 -10-5°C

### DayNightClock(验收 ④)

- 4 时段:`dawn` (05-08) / `day` (08-17) / `dusk` (17-20) / `night` (20-05)
- `light_intensity()` 0..1, 线性插值
- 切换由 `update()` 检测, 返回新 `DayPhase` 或 `None`

### LightController(验收 ① ④)

- 0.5s 线性插值(从起点 RGB + 起点光强 到 终点 RGB + 终点光强)
- `start_transition(target_rgb, target_intensity, duration=0.5)` 触发
- `update(dt)` 推进, 完成后保持终态
- 通道 0..255, 光强 0..1, 负 dt 拒绝
- 支持过渡中重新 start(从当前位置继续)

### TickDriver(验收 ③ 核心)

- 持有 `TimeAxis` 唯一实例
- `tick(real_dt)` 是唯一允许的"时间推进"入口
- 季节切换 → 触发季节色调 0.5s LOD
- 昼夜切换 → 触发时段色调 + 光强 0.5s LOD
- 返回 `TickEvents`(本帧发生的事件 + 过渡触发标记)

### MonsterSpawnTable(M2.7 接口)

- 季节 → 怪物 ID 池
- M2.7 未发布, 当前所有季节池为空
- M2.7 完成后, 由 maintainer 调 `set_pool(season, ids)` 填入真实怪物 ID

## 测试覆盖

- **109 个 Python 单元测试**(全部通过):
  - `test_time_axis.py` (13)
  - `test_season.py` (14)
  - `test_day_night.py` (18)
  - `test_season_table.py` (17)
  - `test_light_controller.py` (16)
  - `test_monster_spawn_table.py` (8)
  - `test_tick_driver.py` (22)
  - `test_integration.py` (26 验收专项)

- **GDScript 验收脚本**(`test_m28.gd`): 12 个验收用例, 沙箱无 Godot 二进制, CI 跑:
  - 季节枚举顺序
  - 温度范围(验收 ②)
  - TimeAxis 推进
  - DayNight 时段边界
  - LightController 0.5s LOD(验收 ①)
  - TickDriver 季节/昼夜切换事件(验收 ① ④)
  - 端到端 1 整年

## 接入方式

```python
from core.abstract.world import TickDriver

# 1) 创建 TickDriver(单一 owner)
driver = TickDriver()

# 2) 每帧调 tick(主循环 real_dt)
def _process(delta: float) -> None:
    events = driver.tick(delta)
    if events.season_change is not None:
        # 通知 UI / 资产系统
        pass
    # 应用光照
    apply_light(driver.light.current_rgb, driver.light.current_intensity)

# 3) 查季节数据
from core.abstract.world.season_table import lookup
profile = lookup(driver.season_clock.current)
# profile.temp_min_c, profile.tint_rgb, profile.features, ...

# 4) 怪物池(M2.7 完成后)
for monster_id in driver.monster_spawn.pool_for(driver.season_clock.current):
    spawn(monster_id)
```

## Godot 4.3 接入(参考实现)

```gdscript
const WildwoodTimeAxis = preload("res://core/abstract/world/gd/wildwood_time_axis.gd")
# ... 其他 preload

var tick_driver: WildwoodTickDriver

func _ready() -> void:
    tick_driver = WildwoodTickDriver.new()

func _process(delta: float) -> void:
    var ev: Dictionary = tick_driver.tick(delta)
    if ev.season_change != -1:
        # 季节切换
        pass
    if ev.phase_change != -1:
        # 昼夜切换
        pass
```

## 已知约束 / 未做

- **Godot 4.3 实际接入**:沙箱无 Godot 二进制, GDScript 端为参考实现, 由 M2.1+ 实际接入
- **怪物表**:M2.7 阻塞中, 池为空; M2.7 完成后由其 maintainer 调 `set_pool()` 注入
- **A/B 通用层**:本模块为 M2.8 业务模块, 不进 M1.4-M1.6 三层抽象; A/B 切换走 M3.9
- **数据持久化**:`SeasonClock` / `DayNightClock` 当前不序列化; M2.6 持久化时挂接
