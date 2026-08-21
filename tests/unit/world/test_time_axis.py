"""
Wildwood M2.8 — TimeAxis 测试

覆盖:
  - 初始态 day=0 / hour=0 / minute=0 / season=spring
  - tick(dt) 推进 elapsed_real_seconds
  - 派生属性 day_in_season / hour_in_day / minute_in_hour / season_index
  - day_progress / season_progress 0..1
  - 季节切换 day 30 边界
  - 负数 dt 抛 ValueError
  - 单实例 owner 约束(只读 API,不允许多实例并存, 见 test_tick_driver)
"""

import os
import sys
import unittest

sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
    ),
)

from core.abstract.world.constants import (  # noqa: E402
    DAYS_PER_SEASON,
    DEFAULT_REAL_SECONDS_PER_DAY,
    HOURS_PER_DAY,
    REAL_SECONDS_PER_HOUR,
    SEASONS_PER_YEAR,
    SEASON_ORDER,
)
from core.abstract.world.time_axis import TimeAxis  # noqa: E402


class TestTimeAxisInit(unittest.TestCase):
    def test_initial_state(self) -> None:
        t = TimeAxis()
        self.assertEqual(t.elapsed_real_seconds, 0.0)
        self.assertEqual(t.day_in_season, 0)
        self.assertEqual(t.season_index, 0)
        self.assertEqual(t.hour_in_day, 0)
        self.assertEqual(t.minute_in_hour, 0)
        self.assertEqual(t.day_progress, 0.0)
        self.assertEqual(t.season_progress, 0.0)

    def test_custom_time_scale(self) -> None:
        # 60s/天 = 1h/天, 推进 30s 应当到第 12 小时
        t = TimeAxis(real_seconds_per_day=60.0)
        t.tick(30.0)
        self.assertEqual(t.hour_in_day, 12)
        self.assertEqual(t.day_in_season, 0)


class TestTimeAxisTick(unittest.TestCase):
    def test_tick_accumulates(self) -> None:
        t = TimeAxis()
        t.tick(10.0)
        t.tick(20.0)
        self.assertAlmostEqual(t.elapsed_real_seconds, 30.0)

    def test_negative_dt_rejected(self) -> None:
        t = TimeAxis()
        with self.assertRaises(ValueError):
            t.tick(-1.0)

    def test_full_day_advances_to_day_1(self) -> None:
        t = TimeAxis()
        t.tick(DEFAULT_REAL_SECONDS_PER_DAY)
        self.assertEqual(t.day_in_season, 1)
        self.assertEqual(t.hour_in_day, 0)
        self.assertEqual(t.minute_in_hour, 0)

    def test_hour_rounding(self) -> None:
        t = TimeAxis()  # 1 game hour = 60 real sec
        t.tick(REAL_SECONDS_PER_HOUR + 0.0001)  # 跨过 1 hour 边界
        # 1 game hour = 60 real sec, 跨过 1 小时
        self.assertEqual(t.hour_in_day, 1)
        self.assertEqual(t.day_in_season, 0)

    def test_minute_within_hour(self) -> None:
        t = TimeAxis()  # 1 game minute = 1 real sec (1440/60/24=1)
        t.tick(15.0)  # 15 game minutes = 0.25 game hour
        self.assertEqual(t.hour_in_day, 0)
        self.assertEqual(t.minute_in_hour, 15)

    def test_season_index_wraps(self) -> None:
        t = TimeAxis()
        # 推进 4 个完整季节 + 1 天
        total = (DAYS_PER_SEASON * SEASONS_PER_YEAR + 1) * DEFAULT_REAL_SECONDS_PER_DAY
        t.tick(total)
        # 4 季节后 + 1 天 = 回到第 1 个季节(春季)第 1 天
        self.assertEqual(t.season_index, 0)
        self.assertEqual(t.day_in_season, 1)

    def test_day_progress_zero_at_start(self) -> None:
        t = TimeAxis()
        self.assertEqual(t.day_progress, 0.0)

    def test_day_progress_full_at_end(self) -> None:
        t = TimeAxis()
        t.tick(DEFAULT_REAL_SECONDS_PER_DAY - 0.0001)
        self.assertAlmostEqual(t.day_progress, 1.0, places=4)

    def test_season_progress_full(self) -> None:
        t = TimeAxis()
        t.tick(DAYS_PER_SEASON * DEFAULT_REAL_SECONDS_PER_DAY - 0.0001)
        self.assertAlmostEqual(t.season_progress, 1.0, places=4)

    def test_hour_in_day_upper_bound(self) -> None:
        # hour_in_day 应在 0..HOURS_PER_DAY-1
        t = TimeAxis()
        t.tick(DEFAULT_REAL_SECONDS_PER_DAY - 0.0001)
        self.assertEqual(t.hour_in_day, HOURS_PER_DAY - 1)


class TestTimeAxisDeterminism(unittest.TestCase):
    """同一序列 tick 必须产生同一时间快照(全局时间轴确定性)."""

    def test_same_input_same_output(self) -> None:
        t1 = TimeAxis()
        t2 = TimeAxis()
        for dt in (10.0, 5.0, 100.0, 30.0, 200.0):
            t1.tick(dt)
            t2.tick(dt)
        self.assertEqual(
            t1.elapsed_real_seconds, t2.elapsed_real_seconds
        )
        self.assertEqual(t1.day_in_season, t2.day_in_season)
        self.assertEqual(t1.season_index, t2.season_index)
        self.assertEqual(t1.hour_in_day, t2.hour_in_day)


if __name__ == "__main__":
    unittest.main()
