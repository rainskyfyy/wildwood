"""
Wildwood M2.8 — TickDriver(统一 tick 入口, 验收 ③ 核心)

职责:
  - 持有 TimeAxis (单一 owner)
  - 持有 SeasonClock / DayNightClock / LightController / MonsterSpawnTable
  - tick(real_dt) 推进时间 + 通知所有订阅者
  - 返回 TickEvents(本帧发生的季节切换 / 昼夜切换 / 光照过渡触发)

设计要点:
  - TickDriver 是全局时间轴的唯一写入者(验收 ③: 同一时间轴统一驱动)
  - 外部代码不可直接调 TimeAxis.tick(), 必须经 TickDriver.tick()
  - TickDriver 是 module-level singleton-friendly(单世界)
"""

from __future__ import annotations

from core.abstract.world.constants import (
    DAWN_TINT,
    DAY_TINT,
    DEFAULT_DAYNIGHT_TRANSITION_SECONDS,
    DEFAULT_REAL_SECONDS_PER_DAY,
    DEFAULT_SEASON_TRANSITION_SECONDS,
    DUSK_TINT,
    NIGHT_TINT,
)
from core.abstract.world.day_night import DayNightClock, DayPhase
from core.abstract.world.light_controller import LightController
from core.abstract.world.monster_spawn_table import MonsterSpawnTable
from core.abstract.world.season import Season, SeasonClock
from core.abstract.world.season_table import lookup as lookup_season
from core.abstract.world.tick_events import TickEvents
from core.abstract.world.time_axis import TimeAxis


# 阶段 → 目标 tint 映射
_PHASE_TINT = {
    DayPhase.DAWN: DAWN_TINT,
    DayPhase.DAY: DAY_TINT,
    DayPhase.DUSK: DUSK_TINT,
    DayPhase.NIGHT: NIGHT_TINT,
}


class TickDriver:
    """统一 tick 入口."""

    def __init__(
        self,
        real_seconds_per_day: float = DEFAULT_REAL_SECONDS_PER_DAY,
        season_transition_seconds: float = DEFAULT_SEASON_TRANSITION_SECONDS,
        daynight_transition_seconds: float = DEFAULT_DAYNIGHT_TRANSITION_SECONDS,
    ) -> None:
        self._time_axis = TimeAxis(real_seconds_per_day=real_seconds_per_day)
        self._season_clock = SeasonClock(self._time_axis)
        self._day_night = DayNightClock(self._time_axis)
        self._light = LightController(
            initial_rgb=lookup_season(self._season_clock.current).tint_rgb,
            initial_intensity=self._day_night.light_intensity(),
        )
        self._season_transition_seconds = float(season_transition_seconds)
        self._daynight_transition_seconds = float(daynight_transition_seconds)
        self._monster_spawn = MonsterSpawnTable()
        self._tick_count: int = 0

    # ---- 公开只读 API ---------------------------------------------------

    @property
    def time_axis(self) -> TimeAxis:
        return self._time_axis

    @property
    def season_clock(self) -> SeasonClock:
        return self._season_clock

    @property
    def day_night(self) -> DayNightClock:
        return self._day_night

    @property
    def light(self) -> LightController:
        return self._light

    @property
    def monster_spawn(self) -> MonsterSpawnTable:
        return self._monster_spawn

    @property
    def tick_count(self) -> int:
        return self._tick_count

    # ---- tick 入口 -------------------------------------------------------

    def tick(self, real_dt: float) -> TickEvents:
        """推进一帧. 唯一允许的"时间推进"入口(验收 ③).

        步骤:
          1) 推进 TimeAxis
          2) 检测 SeasonClock 切换 → 若有, 触发季节色调 0.5s LOD 过渡
          3) 检测 DayNightClock 切换 → 若有, 触发昼夜色调 + 光强 0.5s LOD 过渡
          4) 推进 LightController 插值(用本帧 real_dt)
          5) 计数 + 返回 TickEvents
        """
        if real_dt < 0:
            raise ValueError(f"real_dt must be >= 0, got {real_dt}")
        # 1) 推进时间轴
        self._time_axis.tick(real_dt)
        # 2) 检测季节切换
        season_change = self._season_clock.update()
        in_season_transition = False
        if season_change is not None:
            target_rgb = lookup_season(season_change).tint_rgb
            self._light.start_transition(
                target_rgb=target_rgb,
                target_intensity=self._day_night.light_intensity(),
                duration=self._season_transition_seconds,
            )
            in_season_transition = True
        # 3) 检测昼夜切换
        phase_change = self._day_night.update()
        in_daynight_transition = False
        if phase_change is not None:
            target_rgb = _PHASE_TINT[phase_change]
            self._light.start_transition(
                target_rgb=target_rgb,
                target_intensity=self._day_night.light_intensity(),
                duration=self._daynight_transition_seconds,
            )
            in_daynight_transition = True
        # 4) 推进光照插值
        self._light.update(real_dt)
        # 5) 计数
        self._tick_count += 1
        # 6) 报告
        return TickEvents(
            season_change=season_change,
            phase_change=phase_change,
            in_season_transition=in_season_transition,
            in_daynight_transition=in_daynight_transition,
        )

    def __repr__(self) -> str:
        return (
            f"TickDriver(tick={self._tick_count}, "
            f"season={self._season_clock.current.value}, "
            f"phase={self._day_night.current.value}, "
            f"day={self._time_axis.day_in_season}, "
            f"hour={self._time_axis.hour_in_day})"
        )
