"""
Wildwood M2.8 — 季节循环 + 昼夜循环

全局时间轴统一驱动季节/昼夜/光照。
本模块与 A 线 (Godot 4.3) / B 线 (Unity 6) 引擎解耦:核心逻辑纯 Python,
GDScript 端通过 core/abstract/world/gd/ 下的薄包装调用。

子模块:
  constants        — 不可变常量(季节/昼夜/温度/颜色)
  time_axis        — 唯一 owner, 推进全局时间
  season           — 季节状态机(Spring/Summer/Autumn/Winter)
  day_night        — 昼夜时钟(dawn/day/dusk/night)
  season_table     — 季节数据表(温度/光照色调/植被/怪物池,来自方案 §2.7)
  light_controller — 0.5s LOD 平滑过渡
  tick_driver      — 统一 tick 入口
  monster_spawn_table — 按季节返回怪物池(具体怪物 ID 来自 M2.7, 此处仅接口)

硬约束(方案 §2.7 + M2.8 验收):
  ① 4 季节切换 0.5s LOD 过渡
  ② 温度范围:春 15-25 / 夏 25-40 / 秋 10-20 / 冬 -10-5 (°C)
  ③ 全局时间轴统一驱动(单一 owner, 不允许并存)
  ④ 昼夜光照过场平滑(无突变)
"""
