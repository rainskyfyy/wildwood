"""
Wildwood M2.8 — DayNightClock(昼夜时钟)

24h 划分为 4 段(来自 constants.DAY_HOUR_*):
  - dawn:  05:00 - 07:59  (3h, 光照 0→1 上升)
  - day:   08:00 - 16:59  (9h, 光照 1.0 满)
  - dusk:  17:00 - 19:59  (3h, 光照 1→0 下降)
  - night: 20:00 - 04:59  (9h, 光照 0.0)

提供:
  - phase()      → DayPhase
  - light_intensity() → 0.0..1.0 (供 LightController 二次插值)
  - phase_changed() → Optional[DayPhase] (检测切换事件)
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from core.abstract.world.constants import (
    DAY_HOUR_DAWN_START,
    DAY_HOUR_DAY_START,
    DAY_HOUR_DUSK_START,
    DAY_HOUR_NIGHT_START,
    HOURS_PER_DAY,
)
from core.abstract.world.time_axis import TimeAxis


class DayPhase(str, Enum):
    DAWN = "dawn"
    DAY = "day"
    DUSK = "dusk"
    NIGHT = "night"


class DayNightClock:
    __slots__ = ("_time_axis", "_current")

    def __init__(self, time_axis: TimeAxis) -> None:
        self._time_axis = time_axis
        self._current: DayPhase = self._compute_phase()

    @staticmethod
    def _phase_from_hour(hour: int) -> DayPhase:
        """给定 0..23 小时, 返回所属时段."""
        if hour < DAY_HOUR_DAWN_START or hour >= DAY_HOUR_NIGHT_START:
            return DayPhase.NIGHT
        if hour < DAY_HOUR_DAY_START:
            return DayPhase.DAWN
        if hour < DAY_HOUR_DUSK_START:
            return DayPhase.DAY
        return DayPhase.DUSK

    def _compute_phase(self) -> DayPhase:
        return self._phase_from_hour(self._time_axis.hour_in_day)

    @property
    def current(self) -> DayPhase:
        return self._current

    def phase(self) -> DayPhase:
        """直接读 TimeAxis 推算当前时段(权威来源是 TimeAxis, _current 是缓存)."""
        return self._compute_phase()

    def update(self) -> Optional[DayPhase]:
        """若时段切换, 返回新 DayPhase; 否则 None."""
        new = self._compute_phase()
        if new != self._current:
            self._current = new
            return new
        return None

    def light_intensity(self) -> float:
        """0.0..1.0, 当前光照强度.

        简化模型:
          - night (含 20-04): 0.0
          - dawn  (05-08): 线性 0 → 1
          - day   (08-17): 1.0
          - dusk  (17-20): 线性 1 → 0

        实际游戏里可被 LightController 二次插值(平滑过场,验收 ④).
        """
        hour = self._time_axis.hour_in_day
        if hour < DAY_HOUR_DAWN_START or hour >= DAY_HOUR_NIGHT_START:
            return 0.0
        if hour < DAY_HOUR_DAY_START:
            # dawn 段, 0..1
            span = DAY_HOUR_DAY_START - DAY_HOUR_DAWN_START
            t = (hour - DAY_HOUR_DAWN_START) / span
            return float(t)
        if hour < DAY_HOUR_DUSK_START:
            return 1.0
        # dusk 段, 1..0
        span = DAY_HOUR_NIGHT_START - DAY_HOUR_DUSK_START
        t = (hour - DAY_HOUR_DUSK_START) / span
        return float(1.0 - t)

    def __repr__(self) -> str:
        return (
            f"DayNightClock(phase={self._current.value}, "
            f"intensity={self.light_intensity():.3f})"
        )
