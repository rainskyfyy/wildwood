"""
Wildwood M2.8 — Season(季节枚举 + 状态机)

设计:
  - Season 是 str 枚举(便于 JSON 序列化存档,M2.6 持久化时用)
  - SeasonClock 包装 TimeAxis, 提供 current/update API
  - update() 返回新季节(若发生切换)或 None — 让 LightController 触发 0.5s LOD 过渡
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from core.abstract.world.constants import (
    DAYS_PER_SEASON,
    SEASONS_PER_YEAR,
    SEASON_ORDER,
)
from core.abstract.world.time_axis import TimeAxis


class Season(str, Enum):
    SPRING = "spring"
    SUMMER = "summer"
    AUTUMN = "autumn"
    WINTER = "winter"

    @classmethod
    def from_index(cls, idx: int) -> "Season":
        """索引 0..3 → Season. 越界时 ValueError."""
        if not 0 <= idx < SEASONS_PER_YEAR:
            raise ValueError(
                f"season_index out of range: {idx} (expected 0..{SEASONS_PER_YEAR-1})"
            )
        return cls(SEASON_ORDER[idx])

    @property
    def index(self) -> int:
        return SEASON_ORDER.index(self.value)


class SeasonClock:
    """基于 TimeAxis 推算当前季节. update() 触发季节切换事件."""

    __slots__ = ("_time_axis", "_current", "_day_in_season_cache")

    def __init__(self, time_axis: TimeAxis) -> None:
        self._time_axis = time_axis
        self._current: Season = Season.from_index(time_axis.season_index)
        self._day_in_season_cache: int = time_axis.day_in_season

    @property
    def current(self) -> Season:
        return self._current

    @property
    def day_in_season(self) -> int:
        return self._time_axis.day_in_season

    def update(self) -> Optional[Season]:
        """基于 TimeAxis 当前快照, 若季节发生变化则返回新 Season; 否则 None.

        调用顺序:TickDriver.tick(dt) 先推进 TimeAxis, 然后调用 SeasonClock.update()
        检测切换. 同一 season 内反复调用 update() 返回 None(无事件).
        """
        new_index = self._time_axis.season_index
        new_season = Season.from_index(new_index)
        if new_season != self._current:
            old = self._current
            self._current = new_season
            self._day_in_season_cache = self._time_axis.day_in_season
            return new_season
        self._day_in_season_cache = self._time_axis.day_in_season
        return None

    def __repr__(self) -> str:
        return f"SeasonClock(current={self._current.value}, day={self._day_in_season_cache})"
