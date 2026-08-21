"""
Wildwood 生存属性 — 三个 modifier 接口

- is_critical(stats):任意维度 < 30% 返回 True(任务验收 ② 警示动效触发条件)
- get_speed_modifier(stats, context):返回 0~1 系数(任务验收 ③ 温度 < 0°C 减速 50%)
- should_show_illusion(stats):精神 < 30% 返回 True(任务验收 ④ 幻象 shader 触发条件)

设计说明:
  - HP/饱腹/精神:用 ratio(value/max) < 30% 判定(都是"越高越好"维度)
  - 温度:中性温度 (5~35°C) 算正常,偏离即警示(温度不是"越高越好"维度)
"""

from __future__ import annotations

from typing import Union

from .stats import SurvivalStats, SurvivalContext

# 警示阈值(任务验收 ②):HP/饱腹/精神 < max * 30%
CRITICAL_THRESHOLD = 0.30

# 温度警示阈值(绝对值,非 ratio)
TEMP_COLD_WARNING = 5.0      # 低于此温度提示过冷
TEMP_HOT_WARNING = 35.0       # 高于此温度提示过热

# 速度 modifier 阈值(任务验收 ③ + 方案 §2.1 极端温度)
TEMP_FREEZING = 0.0      # < 0°C 减速 50%
TEMP_HOT_EXTREME = 35.0  # > 35°C 减速 30%(高体温中暑)
HP_LOW_THRESHOLD = 0.30  # HP < 30% 减速 20%

# 速度 modifier 值
SPEED_NORMAL = 1.0
SPEED_FREEZING = 0.5  # 任务验收:温度 < 0°C 减速 50%
SPEED_HOT = 0.7
SPEED_LOW_HP = 0.8

# 幻象阈值(任务验收 ④)
ILLUSION_THRESHOLD = 0.30  # sanity < 30%


def _ratio(value: float, max_value: float) -> float:
    """计算 value 在 [0, max_value] 上的比例(0~1)。max 为 0 时返回 0(避免除零)。"""
    if max_value <= 0:
        return 0.0
    return max(0.0, min(1.0, value / max_value))


def is_critical(stats: SurvivalStats) -> bool:
    """
    任意维度进入警示(任务验收 ②)。

    HP/饱腹/精神:用 ratio < 30% 判定(都是"越高越好"维度)。
    温度:偏离中性 (5~35°C) 即警示(温度是"中性最好"维度)。
    """
    if _ratio(stats.hp, stats.hp_max) < CRITICAL_THRESHOLD:
        return True
    if _ratio(stats.hunger, stats.hunger_max) < CRITICAL_THRESHOLD:
        return True
    if _ratio(stats.sanity, stats.sanity_max) < CRITICAL_THRESHOLD:
        return True
    if stats.temperature < TEMP_COLD_WARNING or stats.temperature > TEMP_HOT_WARNING:
        return True
    return False


def get_speed_modifier(
    stats: SurvivalStats,
    context: SurvivalContext = None,
) -> float:
    """
    返回 0~1 速度 modifier(任务验收 ③ 温度 < 0°C 减速 50%)。

    规则(取所有触发 modifier 的最小值,即最严格的减速):
      - 温度 < 0°C → 0.5
      - 温度 > 35°C → 0.7
      - HP < 30%   → 0.8
      - 默认 1.0
    """
    modifier = SPEED_NORMAL

    if stats.temperature < TEMP_FREEZING:
        modifier = min(modifier, SPEED_FREEZING)
    if stats.temperature > TEMP_HOT_EXTREME:
        modifier = min(modifier, SPEED_HOT)
    if _ratio(stats.hp, stats.hp_max) < HP_LOW_THRESHOLD:
        modifier = min(modifier, SPEED_LOW_HP)

    return modifier


def should_show_illusion(stats: SurvivalStats) -> bool:
    """
    精神 < 30% 时启用幻象 shader(任务验收 ④)。
    """
    return _ratio(stats.sanity, stats.sanity_max) < ILLUSION_THRESHOLD
