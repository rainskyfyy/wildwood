## Wildwood M2.8 — 季节循环 + 昼夜循环 (Godot 4.3 薄包装)
##
## GDScript 4.3 API 与 Python core/abstract/world/*.py 一一对应.
## Python 业务逻辑(M1.4 data 层 + M2.8 world 层)的真相源; GDScript 端
## 由 Godot 4.3 引擎调用, 沙箱无 Godot 二进制 — 实际接入由 M2.1+ 任务完成.
##
## 公开 API:
##   wildwood_constants   — 不可变常量
##   wildwood_time_axis   — 全局时间轴 (TimeAxis)
##   wildwood_season      — 季节枚举 + 状态机 (Season / SeasonClock)
##   wildwood_day_night   — 昼夜枚举 + 时钟 (DayPhase / DayNightClock)
##   wildwood_season_table — 季节数据表 (SeasonProfile / SEASON_PROFILES / lookup)
##   wildwood_light_controller — 0.5s LOD 过渡 (LightController)
##   wildwood_tick_driver — 统一 tick 入口 (TickDriver)
##   wildwood_monster_spawn_table — 怪物生成表 (MonsterSpawnTable)
##
## Godot headless 验收: tests/gd/test_m28.gd
