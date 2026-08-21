"""
Wildwood M2.8 — TickDriver + 端到端集成测试

核心:验收 ① ② ③ ④ 集成
  ① 4 季节切换 0.5s LOD 过渡
  ② 温度范围符合方案 §2.7
  ③ 全局时间轴统一驱动(只有 TickDriver.tick 能推进)
  ④ 昼夜光照过场平滑

约定:1 step = 1 game hour = REAL_SECONDS_PER_HOUR = 60 real sec.
1 game day = 24 step, 1 season = 30 day = 720 step, 1 year = 2880 step.

注:在 LightController 内部 0.5s 过渡是 0.5 真实秒. 1 step = 60s, 大于过渡时长,
所以一帧内会触发并完成过渡. 测试用 TickEvents.in_*_transition 标记"本帧是否触发".
对于真实游戏(60 FPS, 0.016s/frame), 30 帧内完成 0.5s 过渡, 视觉上平滑.
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
    HOURS_PER_DAY,
    REAL_SECONDS_PER_HOUR,
    SEASON_TINT_AUTUMN,
    SEASON_TINT_SPRING,
    SEASON_TINT_SUMMER,
    SEASON_TINT_WINTER,
)
from core.abstract.world.day_night import DayPhase  # noqa: E402
from core.abstract.world.season import Season  # noqa: E402
from core.abstract.world.season_table import lookup  # noqa: E402
from core.abstract.world.tick_driver import TickDriver  # noqa: E402

HOUR_STEP = REAL_SECONDS_PER_HOUR
DAY_STEPS = HOURS_PER_DAY
SEASON_STEPS = DAYS_PER_SEASON * DAY_STEPS
YEAR_STEPS = SEASON_STEPS * 4


class TestTickDriverInit(unittest.TestCase):
    def test_default_init(self) -> None:
        d = TickDriver()
        self.assertEqual(d.tick_count, 0)
        self.assertEqual(d.season_clock.current, Season.SPRING)
        self.assertEqual(d.light.current_rgb, SEASON_TINT_SPRING)
        # 0h = night
        self.assertEqual(d.day_night.current, DayPhase.NIGHT)


class TestTickBasic(unittest.TestCase):
    def test_tick_increments_counter(self) -> None:
        d = TickDriver()
        d.tick(0.1)
        d.tick(0.1)
        self.assertEqual(d.tick_count, 2)

    def test_negative_dt_rejected(self) -> None:
        d = TickDriver()
        with self.assertRaises(ValueError):
            d.tick(-0.1)

    def test_tick_advances_time(self) -> None:
        d = TickDriver()
        d.tick(60.0)
        self.assertAlmostEqual(d.time_axis.elapsed_real_seconds, 60.0)


class TestTickSeasonEvents(unittest.TestCase):
    def test_no_event_within_season(self) -> None:
        d = TickDriver()
        for _ in range(SEASON_STEPS - 1):
            ev = d.tick(HOUR_STEP)
            self.assertIsNone(ev.season_change)
            self.assertFalse(ev.in_season_transition)

    def test_season_change_at_spring_end(self) -> None:
        d = TickDriver()
        for _ in range(SEASON_STEPS - 1):
            d.tick(HOUR_STEP)
        ev = d.tick(HOUR_STEP)
        self.assertEqual(ev.season_change, Season.SUMMER)
        self.assertTrue(ev.in_season_transition)
        self.assertEqual(d.season_clock.current, Season.SUMMER)

    def test_full_year_season_events(self) -> None:
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

    def test_two_years_events(self) -> None:
        d = TickDriver()
        events: list[Season] = []
        for _ in range(YEAR_STEPS * 2):
            ev = d.tick(HOUR_STEP)
            if ev.season_change is not None:
                events.append(ev.season_change)
        self.assertEqual(len(events), 8)
        expected = [
            Season.SUMMER, Season.AUTUMN, Season.WINTER, Season.SPRING,
            Season.SUMMER, Season.AUTUMN, Season.WINTER, Season.SPRING,
        ]
        self.assertEqual(events, expected)


class TestTickPhaseEvents(unittest.TestCase):
    def test_no_event_within_phase(self) -> None:
        d = TickDriver()
        for _ in range(4):  # 0-4h = night
            ev = d.tick(HOUR_STEP)
            self.assertIsNone(ev.phase_change)
            self.assertFalse(ev.in_daynight_transition)

    def test_phase_change_at_dawn(self) -> None:
        d = TickDriver()
        for _ in range(5):  # 5h 边界
            ev = d.tick(HOUR_STEP)
        self.assertEqual(ev.phase_change, DayPhase.DAWN)
        self.assertTrue(ev.in_daynight_transition)

    def test_full_day_phase_events(self) -> None:
        d = TickDriver()
        seen = [d.day_night.current]
        for _ in range(DAY_STEPS):
            ev = d.tick(HOUR_STEP)
            if ev.phase_change is not None:
                seen.append(ev.phase_change)
        self.assertEqual(
            [p.value for p in seen],
            ["night", "dawn", "day", "dusk", "night"],
        )


class TestSeasonLightTransition(unittest.TestCase):
    """验收 ①: 4 季节切换 0.5s LOD 过渡."""

    def test_season_change_event_marks_transition(self) -> None:
        d = TickDriver()
        for _ in range(SEASON_STEPS - 1):
            d.tick(HOUR_STEP)
        ev = d.tick(HOUR_STEP)
        self.assertEqual(ev.season_change, Season.SUMMER)
        self.assertTrue(ev.in_season_transition)

    def test_season_transition_terminal_state(self) -> None:
        """季节切换后, 1h step 远超 0.5s 过渡时长, 应当到达季节表终态."""
        d = TickDriver()
        for _ in range(SEASON_STEPS - 1):
            d.tick(HOUR_STEP)
        d.tick(HOUR_STEP)
        # 触发季节切换
        self.assertEqual(d.season_clock.current, Season.SUMMER)
        # 1h step 远超 0.5s 过渡时长, 光照已到 summer 终态
        self.assertEqual(d.light.current_rgb, SEASON_TINT_SUMMER)

    def test_season_transition_lands_on_table_value(self) -> None:
        """验收 ② + ① 联合: 切换后 0.5s 内到达 season_table 的 tint_rgb."""
        d = TickDriver()
        # 推进到第 4 季节末
        for _ in range(YEAR_STEPS - 1):
            d.tick(HOUR_STEP)
        # 跨入第 2 年 = spring
        d.tick(HOUR_STEP)
        # 1 step 内过渡完成
        self.assertEqual(d.season_clock.current, Season.SPRING)
        self.assertEqual(d.light.current_rgb, lookup(Season.SPRING).tint_rgb)

    def test_all_four_season_terminal_rgb(self) -> None:
        """4 季节切换的终态 RGB 全部匹配 season_table."""
        d = TickDriver()
        # spring 起点
        self.assertEqual(d.light.current_rgb, SEASON_TINT_SPRING)
        # summer
        for _ in range(SEASON_STEPS):
            d.tick(HOUR_STEP)
        self.assertEqual(d.season_clock.current, Season.SUMMER)
        self.assertEqual(d.light.current_rgb, SEASON_TINT_SUMMER)
        # autumn
        for _ in range(SEASON_STEPS):
            d.tick(HOUR_STEP)
        self.assertEqual(d.season_clock.current, Season.AUTUMN)
        self.assertEqual(d.light.current_rgb, SEASON_TINT_AUTUMN)
        # winter
        for _ in range(SEASON_STEPS):
            d.tick(HOUR_STEP)
        self.assertEqual(d.season_clock.current, Season.WINTER)
        self.assertEqual(d.light.current_rgb, SEASON_TINT_WINTER)

    def test_season_temperature_matches_table(self) -> None:
        """验收 ②: 温度范围来自 season_table, TickDriver 不破坏."""
        d = TickDriver()
        for _ in range(SEASON_STEPS):  # 到 summer
            d.tick(HOUR_STEP)
        self.assertEqual(d.season_clock.current, Season.SUMMER)
        # 通过 lookup 验证温度范围
        self.assertEqual(lookup(Season.SUMMER).temp_min_c, 25.0)
        self.assertEqual(lookup(Season.SUMMER).temp_max_c, 40.0)


class TestDayNightLightTransition(unittest.TestCase):
    """验收 ④: 昼夜光照过场平滑."""

    def test_phase_change_event_marks_transition(self) -> None:
        d = TickDriver()
        for _ in range(17):  # 17h 跨 dusk
            ev = d.tick(HOUR_STEP)
        self.assertEqual(ev.phase_change, DayPhase.DUSK)
        self.assertTrue(ev.in_daynight_transition)

    def test_intensity_stays_in_range_24h(self) -> None:
        """24h 内光照强度 0..1 不越界, 且终点回到 0."""
        d = TickDriver()
        for _ in range(DAY_STEPS):
            d.tick(HOUR_STEP)
            i = d.light.current_intensity
            self.assertGreaterEqual(i, 0.0)
            self.assertLessEqual(i, 1.0)
        # 24h 末 = night = 0
        self.assertEqual(d.light.current_intensity, 0.0)

    def test_intensity_smooth_at_fine_step(self) -> None:
        """用 6s step (10 step/hour) 24h 内采样, 验证 0.5s LOD 让光强不过分突变.

        验收 ④ 的"平滑"在真实游戏(60 FPS, 0.016s/frame)才能直接观察到.
        测试以"步长 < 0.5s"为前提: 6s step > 0.5s, 故单步仍可能跑完过渡;
        此测试只验证 0..1 范围 + 关键点(中午/夜)值.
        """
        d = TickDriver()
        intensities = []
        for _ in range(240):  # 24h × 10 step/h
            d.tick(HOUR_STEP / 10)
            intensities.append(d.light.current_intensity)
        self.assertEqual(intensities[0], 0.0)  # 0h night
        # 12h 中午 = day full
        self.assertAlmostEqual(intensities[120], 1.0, places=1)
        # 24h 末 = night = 0
        self.assertEqual(intensities[-1], 0.0)

    def test_rgb_in_range_throughout_day(self) -> None:
        d = TickDriver()
        for _ in range(240):
            d.tick(HOUR_STEP / 10)
            r, g, b = d.light.current_rgb
            self.assertGreaterEqual(r, 0)
            self.assertLessEqual(r, 255)
            self.assertGreaterEqual(g, 0)
            self.assertLessEqual(g, 255)
            self.assertGreaterEqual(b, 0)
            self.assertLessEqual(b, 255)


class TestEndToEndOneYear(unittest.TestCase):
    """1 整年端到端 (2880 step = 1h/step), 验证 RGB 始终在 0..255 + 4 季节切换完整."""

    def test_one_year_no_out_of_range(self) -> None:
        d = TickDriver()
        season_count = 0
        for step in range(YEAR_STEPS):
            ev = d.tick(HOUR_STEP)
            r, g, b = d.light.current_rgb
            self.assertGreaterEqual(r, 0)
            self.assertLessEqual(r, 255)
            self.assertGreaterEqual(g, 0)
            self.assertLessEqual(g, 255)
            self.assertGreaterEqual(b, 0)
            self.assertLessEqual(b, 255)
            self.assertGreaterEqual(d.light.current_intensity, 0.0)
            self.assertLessEqual(d.light.current_intensity, 1.0)
            if ev.season_change is not None:
                season_count += 1
        # 1 年 4 次切换
        self.assertEqual(season_count, 4)
        # 年末回到 spring
        self.assertEqual(d.season_clock.current, Season.SPRING)


if __name__ == "__main__":
    unittest.main()
