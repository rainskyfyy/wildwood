## Wildwood M2.8 — GDScript 4.3 验收测试目录
##
## 测试脚本:
##   test_m28.gd — M2.8 任务 4 项验收 (① ② ③ ④) + 12 子测试
##
## 沙箱无 Godot 4.3 二进制, 实际跑测试在外部 CI:
##   godot --headless --script res://core/abstract/world/gd/tests/test_m28.gd
##
## 验收覆盖:
##   ① 4 季节切换 0.5s LOD 过渡: _test_light_controller_lod_transition,
##                                   _test_tick_driver_season_event
##   ② 温度范围符合方案 §2.7:    _test_season_table_temperature
##   ③ 全局时间轴统一驱动:       _test_tick_driver_time_axis_owner
##   ④ 昼夜光照过场平滑:        _test_day_night_phase_boundaries,
##                                   _test_day_night_intensity_range,
##                                   _test_tick_driver_phase_event
