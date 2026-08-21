"""
Wildwood M2.8 — SeasonClock 测试(修正版)

注意:TimeAxis.season_index 是 (total_days // 30) % 4 的离散计算, 一次 tick
跨多个季节不会触发中间 SeasonClock 切换事件(这是预期, 现实里也是逐帧推进).
因此"跨季节"测试必须分步 tick + update, 才能观察到 WINTER→SPRING 等切换.

单位:1 game day = 1440 real sec, 4 step/day (6h/step).
1 季节 = 30 day = 120 step, 1 年 = 120 day = 480 step.
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
    SEASON_ORDER,
)
from core.abstract.world.season import Season, SeasonClock  # noqa: E402
from core.abstract.world.time_axis import TimeAxis  # noqa: E402

STEP_SECONDS = DEFAULT_REAL_SECONDS_PER_DAY / 4  # 6 game hours per step
STEPS_PER_DAY = 4
STEPS_PER_SEASON = DAYS_PER_SEASON * STEPS_PER_DAY  # 120
STEPS_PER_YEAR = STEPS_PER_SEASON * 4  # 480


class TestSeasonEnum(unittest.TestCase):
    def test_season_values(self) -> None:
        self.assertEqual(Season.SPRING.value, "spring")
        self.assertEqual(Season.SUMMER.value, "summer")
        self.assertEqual(Season.AUTUMN.value, "autumn")
        self.assertEqual(Season.WINTER.value, "winter")

    def test_season_count(self) -> None:
        self.assertEqual(len(Season), 4)

    def test_season_order_matches_constants(self) -> None:
        ordered = [s.value for s in Season]
        self.assertEqual(ordered, list(SEASON_ORDER))

    def test_from_index(self) -> None:
        self.assertIs(Season.from_index(0), Season.SPRING)
        self.assertIs(Season.from_index(1), Season.SUMMER)
        self.assertIs(Season.from_index(2), Season.AUTUMN)
        self.assertIs(Season.from_index(3), Season.WINTER)

    def test_from_index_out_of_range(self) -> None:
        with self.assertRaises(ValueError):
            Season.from_index(-1)
        with self.assertRaises(ValueError):
            Season.from_index(4)
        with self.assertRaises(ValueError):
            Season.from_index(99)

    def test_season_index_property(self) -> None:
        self.assertEqual(Season.SPRING.index, 0)
        self.assertEqual(Season.SUMMER.index, 1)
        self.assertEqual(Season.AUTUMN.index, 2)
        self.assertEqual(Season.WINTER.index, 3)

    def test_season_str_round_trip(self) -> None:
        self.assertIs(Season("spring"), Season.SPRING)
        self.assertIs(Season("summer"), Season.SUMMER)
        self.assertIs(Season("autumn"), Season.AUTUMN)
        self.assertIs(Season("winter"), Season.WINTER)


def _advance_full_seasons(seasons: int):
    """推进 N 个完整季节(逐帧), 返回 (TimeAxis, SeasonClock, [events])."""
    ta = TimeAxis()
    clock = SeasonClock(ta)
    seen = []
    total_steps = seasons * STEPS_PER_SEASON
    for _ in range(total_steps):
        ta.tick(STEP_SECONDS)
        r = clock.update()
        if r is not None:
            seen.append(r)
    return ta, clock, seen


class TestSeasonClockSingleTransition(unittest.TestCase):
    def test_no_change_within_season(self) -> None:
        ta = TimeAxis()
        clock = SeasonClock(ta)
        for _ in range(STEPS_PER_DAY):  # 推进 1 天
            ta.tick(STEP_SECONDS)
            self.assertIsNone(clock.update())
        self.assertEqual(clock.current, Season.SPRING)

    def test_transition_spring_to_summer(self) -> None:
        ta, clock, seen = _advance_full_seasons(1)
        # 最后一天跨过 30 → season_index=1 = SUMMER
        self.assertEqual(clock.current, Season.SUMMER)
        self.assertIn(Season.SUMMER, seen)
        # 整季节推进应当恰好 1 次季节切换
        self.assertEqual(seen, [Season.SUMMER])

    def test_transition_summer_to_autumn(self) -> None:
        ta, clock, seen = _advance_full_seasons(2)
        self.assertEqual(clock.current, Season.AUTUMN)
        self.assertEqual(seen, [Season.SUMMER, Season.AUTUMN])

    def test_transition_autumn_to_winter(self) -> None:
        ta, clock, seen = _advance_full_seasons(3)
        self.assertEqual(clock.current, Season.WINTER)
        self.assertEqual(
            seen, [Season.SUMMER, Season.AUTUMN, Season.WINTER]
        )

    def test_transition_winter_to_spring(self) -> None:
        ta, clock, seen = _advance_full_seasons(4)
        # 推进 4 整季节 = 1 整年 = 回 spring
        self.assertEqual(clock.current, Season.SPRING)
        self.assertEqual(
            seen,
            [Season.SUMMER, Season.AUTUMN, Season.WINTER, Season.SPRING],
        )


class TestSeasonClockRepeatedUpdate(unittest.TestCase):
    def test_two_years(self) -> None:
        ta, clock, seen = _advance_full_seasons(8)  # 8 季节 = 2 年
        # 2 整年应当看到 4 季节 * 2 = 8 次切换
        self.assertEqual(len(seen), 8)
        # 顺序 SPRING→SUMMER→AUTUMN→WINTER→SPRING 重复 2 轮
        expected = [
            Season.SUMMER, Season.AUTUMN, Season.WINTER, Season.SPRING,
            Season.SUMMER, Season.AUTUMN, Season.WINTER, Season.SPRING,
        ]
        self.assertEqual(seen, expected)


class TestSeasonClockDayTracking(unittest.TestCase):
    def test_day_in_season_tracks(self) -> None:
        # autumn day 5 = 60 + 5 = 65 天
        ta, clock, _ = _advance_full_seasons(2)  # 推进到 autumn 起点
        # 再推进 5 天
        for _ in range(5 * STEPS_PER_DAY):
            ta.tick(STEP_SECONDS)
            clock.update()
        self.assertEqual(clock.current, Season.AUTUMN)
        self.assertEqual(clock.day_in_season, 5)

    def test_day_in_season_resets_each_season(self) -> None:
        # summer day 10 = 30 + 10 = 40 天
        ta, clock, _ = _advance_full_seasons(1)  # 推进到 summer 起点
        for _ in range(10 * STEPS_PER_DAY):
            ta.tick(STEP_SECONDS)
            clock.update()
        self.assertEqual(clock.current, Season.SUMMER)
        self.assertEqual(clock.day_in_season, 10)


if __name__ == "__main__":
    unittest.main()
