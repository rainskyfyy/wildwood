"""
Wildwood M2.8 — TickEvents(一次 tick 期间发生的事件集合).

语义:
  - season_change:  本帧发生了季节切换, 值是新的 Season
  - phase_change:   本帧发生了昼夜切换, 值是新的 DayPhase
  - in_season_transition:  本帧触发了季节色调 0.5s LOD 过渡 (不论是否已完成)
  - in_daynight_transition: 本帧触发了昼夜色调 + 光强 0.5s LOD 过渡 (不论是否已完成)

注意:in_*_transition 与 season_change/phase_change 独立 — 如果本帧同时发生
季节和昼夜切换, 两个 transition 都标记 True. step 步长远大于 0.5s 过渡时长
时, 本帧会同时触发并完成过渡, 但事件仍然报告 "本帧触发了过渡".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from core.abstract.world.day_night import DayPhase
from core.abstract.world.season import Season


@dataclass(frozen=True)
class TickEvents:
    season_change: Optional[Season] = None
    phase_change: Optional[DayPhase] = None
    in_season_transition: bool = False
    in_daynight_transition: bool = False

    def has_events(self) -> bool:
        return (
            self.season_change is not None
            or self.phase_change is not None
            or self.in_season_transition
            or self.in_daynight_transition
        )
