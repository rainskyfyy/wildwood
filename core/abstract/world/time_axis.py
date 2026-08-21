"""
Wildwood M2.8 — TimeAxis(全局时间轴, 唯一 owner)

职责:
  - 记录 elapsed_real_seconds(累计真实秒, 由外部 tick 传入)
  - 派生 day_in_season / season_index / hour_in_day / minute_in_hour
  - 提供 day_progress / season_progress (0..1) 供插值/UI 用

设计要点:
  - 单一 owner:同一游戏世界只允许一个 TimeAxis 实例(TickDriver 持有, 不外暴)
  - 确定性:同一 tick 序列 → 同一时间快照(无浮点随机)
  - 无副作用:tick 只更新内部 _elapsed, 不触发季节/昼夜切换(那是 SeasonClock/DayNightClock 的职责)
"""

from __future__ import annotations

from core.abstract.world.constants import (
    DAYS_PER_SEASON,
    DEFAULT_REAL_SECONDS_PER_DAY,
    HOURS_PER_DAY,
    MINUTES_PER_HOUR,
    SEASONS_PER_YEAR,
    SECONDS_PER_MINUTE,
)


class TimeAxis:
    __slots__ = (
        "_elapsed",
        "_real_seconds_per_day",
        "_real_seconds_per_hour",
        "_real_seconds_per_minute",
    )

    def __init__(
        self,
        real_seconds_per_day: float = DEFAULT_REAL_SECONDS_PER_DAY,
    ) -> None:
        if real_seconds_per_day <= 0:
            raise ValueError(
                f"real_seconds_per_day must be > 0, got {real_seconds_per_day}"
            )
        self._real_seconds_per_day = float(real_seconds_per_day)
        # 派生:1 game hour = real_seconds_per_day / 24
        self._real_seconds_per_hour = self._real_seconds_per_day / HOURS_PER_DAY
        # 1 game minute = real_seconds_per_hour / 60 = real_seconds_per_day / 1440
        self._real_seconds_per_minute = (
            self._real_seconds_per_hour / MINUTES_PER_HOUR
        )
        self._elapsed: float = 0.0

    # ---- owner API --------------------------------------------------------

    def tick(self, real_dt: float) -> None:
        """推进真实秒. 不允许负值(回退时间不在 M2.8 范围)."""
        if real_dt < 0:
            raise ValueError(f"real_dt must be >= 0, got {real_dt}")
        self._elapsed += real_dt

    def reset(self) -> None:
        """重置到 0(用于测试 / 新建存档)."""
        self._elapsed = 0.0

    # ---- 读访问 ----------------------------------------------------------

    @property
    def elapsed_real_seconds(self) -> float:
        return self._elapsed

    @property
    def real_seconds_per_day(self) -> float:
        return self._real_seconds_per_day

    @property
    def day_in_season(self) -> int:
        """0..DAYS_PER_SEASON-1, 当前季节的第 N 天."""
        total_days = int(self._elapsed // self._real_seconds_per_day)
        return total_days % DAYS_PER_SEASON

    @property
    def season_index(self) -> int:
        """0..SEASONS_PER_YEAR-1, 0=春 1=夏 2=秋 3=冬."""
        total_days = int(self._elapsed // self._real_seconds_per_day)
        return (total_days // DAYS_PER_SEASON) % SEASONS_PER_YEAR

    @property
    def hour_in_day(self) -> int:
        """0..HOURS_PER_DAY-1, 当前日的小时."""
        if self._real_seconds_per_hour <= 0:
            return 0
        total_hours = int(self._elapsed // self._real_seconds_per_hour)
        return total_hours % HOURS_PER_DAY

    @property
    def minute_in_hour(self) -> int:
        """0..MINUTES_PER_HOUR-1, 当前小时的分钟."""
        if self._real_seconds_per_minute <= 0:
            return 0
        total_minutes = int(self._elapsed // self._real_seconds_per_minute)
        return total_minutes % MINUTES_PER_HOUR

    @property
    def day_progress(self) -> float:
        """0.0..1.0, 当前 24h 的进度(用于昼夜过场插值)."""
        if self._real_seconds_per_day <= 0:
            return 0.0
        return (self._elapsed % self._real_seconds_per_day) / self._real_seconds_per_day

    @property
    def season_progress(self) -> float:
        """0.0..1.0, 当前 30 日季节的进度(用于季节过场插值)."""
        if self._real_seconds_per_day <= 0:
            return 0.0
        season_real_seconds = self._real_seconds_per_day * DAYS_PER_SEASON
        return (self._elapsed % season_real_seconds) / season_real_seconds

    # ---- 调试 ------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"TimeAxis(elapsed={self._elapsed:.2f}s, "
            f"day={self.day_in_season}, season={self.season_index}, "
            f"hour={self.hour_in_day}, minute={self.minute_in_hour})"
        )
