"""
Wildwood 生存属性系统 — M2.4 关键路径

模块边界:
  - stats.py:SurvivalStats(4 维属性当前值)+ SurvivalContext(外部条件)
  - modifiers.py:critical / speed / illusion 三个判定接口(暴露给 UI / 移动 / 渲染)
  - tick.py:SurvivalSystem 30Hz tick 推进(外部条件驱动)

A/B 通用层(纯 stdlib,无外部依赖,Godot/Unity 引擎层薄壳镜像公式)。
详见 docs/plans/2026-08-20-m2.4-survival.md。
"""

from .stats import (
    SurvivalStats,
    SurvivalContext,
    Season,
    SurvivalError,
)
from .modifiers import (
    is_critical,
    get_speed_modifier,
    should_show_illusion,
    CRITICAL_THRESHOLD,
    ILLUSION_THRESHOLD,
    SPEED_FREEZING,
    TEMP_COLD_WARNING,
    TEMP_HOT_WARNING,
    TEMP_FREEZING,
    TEMP_HOT_EXTREME,
    HP_LOW_THRESHOLD,
    SPEED_NORMAL,
    SPEED_HOT,
    SPEED_LOW_HP,
)
from .tick import (
    SurvivalSystem,
    TICK_HZ,
    TICK_DT,
    is_night,
    HUNGER_DRAIN_PER_SEC,
    HP_DRAIN_STARVING_PER_SEC,
    HP_DRAIN_TEMP_EXTREME_PER_SEC,
    HP_DRAIN_INSANE_PER_SEC,
    HP_REGEN_INTERVAL_SEC,
    HP_REGEN_AMOUNT,
)

__all__ = [
    # 数据
    "SurvivalStats",
    "SurvivalContext",
    "Season",
    "SurvivalError",
    # modifier
    "is_critical",
    "get_speed_modifier",
    "should_show_illusion",
    # modifier 常量
    "CRITICAL_THRESHOLD",
    "ILLUSION_THRESHOLD",
    "SPEED_FREEZING",
    "TEMP_COLD_WARNING",
    "TEMP_HOT_WARNING",
    "TEMP_FREEZING",
    "TEMP_HOT_EXTREME",
    "HP_LOW_THRESHOLD",
    "SPEED_NORMAL",
    "SPEED_HOT",
    "SPEED_LOW_HP",
    # 系统
    "SurvivalSystem",
    "TICK_HZ",
    "TICK_DT",
    "is_night",
    "HUNGER_DRAIN_PER_SEC",
    "HP_DRAIN_STARVING_PER_SEC",
    "HP_DRAIN_TEMP_EXTREME_PER_SEC",
    "HP_DRAIN_INSANE_PER_SEC",
    "HP_REGEN_INTERVAL_SEC",
    "HP_REGEN_AMOUNT",
]
