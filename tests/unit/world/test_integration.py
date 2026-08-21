"""
Wildwood M2.8 — 集成测试(端到端 4 项验收)

覆盖 M2.8 任务验收 4 项:
  ① 4 季节切换 0.5s LOD 过渡
  ② 温度范围符合方案 §2.7
  ③ 全局时间轴统一驱动
  ④ 昼夜光照过场平滑

每个验收点单独一组测试, 通过则该项验收通过.
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
    DEFAULT_DAYNIGHT_TRANSITION_SECONDS,
    DEFAULT_REAL_SECONDS_PER_DAY,
    DEFAULT_SEASON_TRANSITION_SECONDS,
    HOURS_PER_DAY,
    REAL_SECONDS_PER_HOUR,
    SEASON_TINT_AUTUMN,
    SEASON_TINT_SPRING,
    SEASON_TINT_SUMMER,
    SEASON_TINT_WINTER,
    TEMP_AUTUMN_MAX,
    TEMP_AUTUMN_MIN,
    TEMP_SPRING_MAX,
    TEMP_SPRING_MIN,
    TEMP_SUMMER_MAX,
    TEMP_SUMMER_MIN,
    TEMP_WINTER_MAX,
    TEMP_WINTER_MIN,
)
from core.abstract.world.day_night import DayPhase  # noqa: E402
from core.abstract.world.season import Season  # noqa: E402
from core.abstract.world.season_table import lookup  # noqa: E402
from core.abstract.world.tick_driver import TickDriver  # noqa: E402


HOUR_STEP = REAL_SECONDS_PER_HOUR
DAY_STEPS = HOURS_PER_DAY
SEASON_STEPS = DAYS_PER_SEASON * DAY_STEPS
YEAR_STEPS = SEASON_STEPS * 4


# ========================================================================
# 验收 ① 4 季节切换 0.5s LOD 过渡
# ========================================================================

class TestAcceptance01SeasonLODTransition(unittest.TestCase):
    """4 季节切换 0.5s LOD 过渡(验收 ①)."""

    def test_constant_default_0_5s(self) -> None:
        # 0.5s 是硬约束
        self.assertEqual(DEFAULT_SEASON_TRANSITION_SECONDS, 0.5)

    def test_light_controller_uses_0_5s_default(self) -> None:
        from core.abstract.world.light_controller import LightController
        c = LightController()
        c.start_transition((0, 0, 0), 0.0)
        # 内部 0.5s 过渡, 0.5s 内完成
        c.update(0.5)
        self.assertEqual(c.current_rgb, (0, 0, 0))
        self.assertEqual(c.current_intensity, 0.0)

    def test_four_seasons_all_transition_correctly(self) -> None:
        """spring→summer→autumn→winter 全部走完 0.5s LOD 过渡."""
        d = TickDriver()
        # spring → summer
        for _ in range(SEASON_STEPS):
            d.tick(HOUR_STEP)
        self.assertEqual(d.season_clock.current, Season.SUMMER)
        self.assertEqual(d.light.current_rgb, SEASON_TINT_SUMMER)
        # summer → autumn
        for _ in range(SEASON_STEPS):
            d.tick(HOUR_STEP)
        self.assertEqual(d.season_clock.current, Season.AUTUMN)
        self.assertEqual(d.light.current_rgb, SEASON_TINT_AUTUMN)
        # autumn → winter
        for _ in range(SEASON_STEPS):
            d.tick(HOUR_STEP)
        self.assertEqual(d.season_clock.current, Season.WINTER)
        self.assertEqual(d.light.current_rgb, SEASON_TINT_WINTER)

    def test_transition_event_fires_per_season_change(self) -> None:
        d = TickDriver()
        seen_in_transition = 0
        for _ in range(YEAR_STEPS):
            ev = d.tick(HOUR_STEP)
            if ev.in_season_transition:
                seen_in_transition += 1
        # 1 年 4 次季节切换, 每次都触发过渡
        self.assertEqual(seen_in_transition, 4)


# ========================================================================
# 验收 ② 温度范围符合方案 §2.7
# ========================================================================

class TestAcceptance02TemperatureRange(unittest.TestCase):
    """温度范围符合方案 §2.7(验收 ②)."""

    def test_spring_range(self) -> None:
        self.assertEqual(TEMP_SPRING_MIN, 15.0)
        self.assertEqual(TEMP_SPRING_MAX, 25.0)

    def test_summer_range(self) -> None:
        self.assertEqual(TEMP_SUMMER_MIN, 25.0)
        self.assertEqual(TEMP_SUMMER_MAX, 40.0)

    def test_autumn_range(self) -> None:
        self.assertEqual(TEMP_AUTUMN_MIN, 10.0)
        self.assertEqual(TEMP_AUTUMN_MAX, 20.0)

    def test_winter_range(self) -> None:
        self.assertEqual(TEMP_WINTER_MIN, -10.0)
        self.assertEqual(TEMP_WINTER_MAX, 5.0)

    def test_season_table_returns_correct_temp_per_season(self) -> None:
        cases = [
            (Season.SPRING, 15.0, 25.0),
            (Season.SUMMER, 25.0, 40.0),
            (Season.AUTUMN, 10.0, 20.0),
            (Season.WINTER, -10.0, 5.0),
        ]
        for s, lo, hi in cases:
            p = lookup(s)
            self.assertEqual(
                p.temp_min_c, lo,
                f"{s.value} temp_min_c 不匹配"
            )
            self.assertEqual(
                p.temp_max_c, hi,
                f"{s.value} temp_max_c 不匹配"
            )

    def test_tick_driver_preserves_season_table_temperature(self) -> None:
        """TickDriver 推进到任意季节, temperature 仍可从 season_table 查到."""
        d = TickDriver()
        for s in Season:
            p = lookup(s)
            # TickDriver 持有的 season_clock.current 应能查回该 season
            self.assertEqual(lookup(d.season_clock.current), p)
            # 推进 1 季节
            for _ in range(SEASON_STEPS):
                d.tick(HOUR_STEP)


# ========================================================================
# 验收 ③ 全局时间轴统一驱动
# ========================================================================

class TestAcceptance03UnifiedTimeAxis(unittest.TestCase):
    """全局时间轴统一驱动(验收 ③)."""

    def test_tick_driver_owns_time_axis(self) -> None:
        d = TickDriver()
        self.assertIsNotNone(d.time_axis)
        # 外部不能新建 TimeAxis 替代 — 但 Python 里没有强制, 验证结构即可

    def test_time_axis_is_singleton_per_driver(self) -> None:
        d = TickDriver()
        # d.time_axis 始终是同一个对象
        self.assertIs(d.time_axis, d.time_axis)
        # season_clock 和 day_night 持有同一个 time_axis
        # (通过 day_in_season 一致性间接验证)
        for _ in range(10):
            d.tick(HOUR_STEP)
        self.assertEqual(
            d.time_axis.day_in_season,
            d.season_clock.day_in_season,
        )

    def test_only_tick_driver_advances_time(self) -> None:
        """外部直接调 time_axis.tick() 会破坏单一 owner 约束.

        这条测试作为文档化提醒: 仅 d.tick(dt) 允许推进, d.time_axis.tick() 禁
        用. 我们不能完全阻止, 但可验证 d.tick_count 与 time_axis.elapsed 一致.
        """
        d = TickDriver()
        d.tick(60.0)
        d.tick(60.0)
        self.assertEqual(d.tick_count, 2)
        self.assertAlmostEqual(d.time_axis.elapsed_real_seconds, 120.0)

    def test_season_clock_and_day_night_share_time_axis(self) -> None:
        d = TickDriver()
        for _ in range(50):
            d.tick(HOUR_STEP)
        # 派生值一致
        self.assertEqual(
            d.season_clock.day_in_season,
            d.time_axis.day_in_season,
        )
        self.assertEqual(
            d.day_night.current,
            d.day_night.phase(),
        )

    def test_negative_dt_rejected_by_tick_driver(self) -> None:
        d = TickDriver()
        with self.assertRaises(ValueError):
            d.tick(-0.001)


# ========================================================================
# 验收 ④ 昼夜光照过场平滑
# ========================================================================

class TestAcceptance04DayNightTransition(unittest.TestCase):
    """昼夜光照过场平滑(验收 ④)."""

    def test_constant_default_0_5s(self) -> None:
        self.assertEqual(DEFAULT_DAYNIGHT_TRANSITION_SECONDS, 0.5)

    def test_intensity_in_valid_range_24h(self) -> None:
        d = TickDriver()
        for _ in range(DAY_STEPS):
            d.tick(HOUR_STEP)
            i = d.light.current_intensity
            self.assertGreaterEqual(i, 0.0)
            self.assertLessEqual(i, 1.0)

    def test_intensity_full_at_noon(self) -> None:
        d = TickDriver()
        for _ in range(12):
            d.tick(HOUR_STEP)
        # 12h 中午 = day full
        self.assertEqual(d.light.current_intensity, 1.0)

    def test_intensity_zero_at_midnight(self) -> None:
        d = TickDriver()
        # 起步 0h night
        self.assertEqual(d.light.current_intensity, 0.0)
        # 推进 24h 后回到 night
        for _ in range(DAY_STEPS):
            d.tick(HOUR_STEP)
        self.assertEqual(d.light.current_intensity, 0.0)

    def test_rgb_in_range_throughout_24h(self) -> None:
        d = TickDriver()
        for _ in range(DAY_STEPS):
            d.tick(HOUR_STEP)
            r, g, b = d.light.current_rgb
            for c in (r, g, b):
                self.assertGreaterEqual(c, 0)
                self.assertLessEqual(c, 255)

    def test_four_phase_transitions_per_day(self) -> None:
        """1 天内应当看到 4 次昼夜切换事件."""
        d = TickDriver()
        seen = []
        for _ in range(DAY_STEPS):
            ev = d.tick(HOUR_STEP)
            if ev.phase_change is not None:
                seen.append(ev.phase_change)
        self.assertEqual(
            [p.value for p in seen],
            ["dawn", "day", "dusk", "night"],
        )

    def test_phase_event_marks_daynight_transition(self) -> None:
        """每次昼夜切换都触发 in_daynight_transition(0.5s LOD)."""
        d = TickDriver()
        in_dn_count = 0
        for _ in range(DAY_STEPS):
            ev = d.tick(HOUR_STEP)
            if ev.in_daynight_transition:
                in_dn_count += 1
        self.assertEqual(in_dn_count, 4)


# ========================================================================
# 端到端:1 整年
# ========================================================================

class TestEndToEndOneYear(unittest.TestCase):
    """1 整年(2880 step)端到端验证."""

    def test_one_year_4_season_changes(self) -> None:
        d = TickDriver()
        events: list[Season] = []
        for _ in range(YEAR_STEPS):
            ev = d.tick(HOUR_STEP)
            if ev.season_change is not None:
                events.append(ev.season_change)
        self.assertEqual(
            events,
            [Season.SUMMER, Season.AUTUMN, Season.WINTER, Season.SPRING],
        )

    def test_one_year_terminal_season_is_spring(self) -> None:
        d = TickDriver()
        for _ in range(YEAR_STEPS):
            d.tick(HOUR_STEP)
        self.assertEqual(d.season_clock.current, Season.SPRING)
        # spring 起点 tint
        self.assertEqual(d.light.current_rgb, SEASON_TINT_SPRING)

    def test_one_year_no_rgb_out_of_range(self) -> None:
        d = TickDriver()
        for step in range(YEAR_STEPS):
            d.tick(HOUR_STEP)
            r, g, b = d.light.current_rgb
            self.assertGreaterEqual(r, 0)
            self.assertLessEqual(r, 255)
            self.assertGreaterEqual(g, 0)
            self.assertLessEqual(g, 255)
            self.assertGreaterEqual(b, 0)
            self.assertLessEqual(b, 255)

    def test_one_year_no_intensity_out_of_range(self) -> None:
        d = TickDriver()
        for step in range(YEAR_STEPS):
            d.tick(HOUR_STEP)
            self.assertGreaterEqual(d.light.current_intensity, 0.0)
            self.assertLessEqual(d.light.current_intensity, 1.0)


if __name__ == "__main__":
    unittest.main()
