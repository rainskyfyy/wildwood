"""
Wildwood M2.8 — DayNightClock 测试

覆盖:
  - 4 段边界:05→dawn / 08→day / 17→dusk / 20→night
  - 跨午夜:23→night, 00→night
  - light_intensity: dawn 线性上升 / day 满 / dusk 线性下降 / night 0
  - update() 切换事件
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
    DEFAULT_REAL_SECONDS_PER_DAY,
    REAL_SECONDS_PER_HOUR,
)
from core.abstract.world.day_night import DayNightClock, DayPhase  # noqa: E402
from core.abstract.world.time_axis import TimeAxis  # noqa: E402


class TestDayNightPhase(unittest.TestCase):
    """TimeAxis 推到指定小时, 验证 phase()."""

    def _at_hour(self, h: int) -> DayNightClock:
        ta = TimeAxis()
        ta.tick(h * REAL_SECONDS_PER_HOUR + 1.0)  # +1s 进入新小时
        return DayNightClock(ta)

    def test_dawn_at_05(self) -> None:
        self.assertEqual(self._at_hour(5).phase(), DayPhase.DAWN)

    def test_dawn_at_07(self) -> None:
        self.assertEqual(self._at_hour(7).phase(), DayPhase.DAWN)

    def test_day_at_08(self) -> None:
        self.assertEqual(self._at_hour(8).phase(), DayPhase.DAY)

    def test_day_at_16(self) -> None:
        self.assertEqual(self._at_hour(16).phase(), DayPhase.DAY)

    def test_dusk_at_17(self) -> None:
        self.assertEqual(self._at_hour(17).phase(), DayPhase.DUSK)

    def test_dusk_at_19(self) -> None:
        self.assertEqual(self._at_hour(19).phase(), DayPhase.DUSK)

    def test_night_at_20(self) -> None:
        self.assertEqual(self._at_hour(20).phase(), DayPhase.NIGHT)

    def test_night_at_23(self) -> None:
        self.assertEqual(self._at_hour(23).phase(), DayPhase.NIGHT)

    def test_night_at_00(self) -> None:
        self.assertEqual(self._at_hour(0).phase(), DayPhase.NIGHT)

    def test_night_at_04(self) -> None:
        self.assertEqual(self._at_hour(4).phase(), DayPhase.NIGHT)


class TestDayNightIntensity(unittest.TestCase):
    def _intensity_at(self, h: int) -> float:
        ta = TimeAxis()
        ta.tick(h * REAL_SECONDS_PER_HOUR + 0.5)
        return DayNightClock(ta).light_intensity()

    def test_night_zero(self) -> None:
        self.assertEqual(self._intensity_at(0), 0.0)
        self.assertEqual(self._intensity_at(3), 0.0)
        self.assertEqual(self._intensity_at(20), 0.0)
        self.assertEqual(self._intensity_at(23), 0.0)

    def test_day_full(self) -> None:
        # 08..16 全部 day
        for h in (8, 10, 12, 14, 16):
            self.assertEqual(self._intensity_at(h), 1.0, f"hour={h}")

    def test_dawn_rises(self) -> None:
        # 05 dawn 起点 → 0
        # 08 切换到 day, 应当是 1.0
        i5 = self._intensity_at(5)
        i6 = self._intensity_at(6)
        i7 = self._intensity_at(7)
        # 越接近 08 越亮, 单调上升
        self.assertLessEqual(i5, i6)
        self.assertLessEqual(i6, i7)
        self.assertGreater(i7, 0.0)

    def test_dusk_falls(self) -> None:
        i17 = self._intensity_at(17)
        i18 = self._intensity_at(18)
        i19 = self._intensity_at(19)
        # dusk 段单调下降
        self.assertGreaterEqual(i17, i18)
        self.assertGreaterEqual(i18, i19)
        self.assertLess(i19, 1.0)


class TestDayNightUpdate(unittest.TestCase):
    def test_update_detects_phase_change(self) -> None:
        ta = TimeAxis()
        clock = DayNightClock(ta)  # 初始 0h = night
        # 推进到 05h = dawn
        ta.tick(5 * REAL_SECONDS_PER_HOUR)
        result = clock.update()
        self.assertEqual(result, DayPhase.DAWN)
        # 再调用不切换
        self.assertIsNone(clock.update())

    def test_update_dawn_to_day(self) -> None:
        ta = TimeAxis()
        ta.tick(5 * REAL_SECONDS_PER_HOUR)
        clock = DayNightClock(ta)  # 起始 05h = dawn
        ta.tick(3 * REAL_SECONDS_PER_HOUR)
        result = clock.update()
        self.assertEqual(result, DayPhase.DAY)

    def test_update_full_day_cycle(self) -> None:
        ta = TimeAxis()
        clock = DayNightClock(ta)
        seen = []
        # 跨完整 24h
        for _ in range(24):
            ta.tick(REAL_SECONDS_PER_HOUR)
            r = clock.update()
            if r is not None:
                seen.append(r)
        # 应当看到 night→dawn→day→dusk→night 4 次切换
        # 起始 night, 24h 后又回 night
        self.assertEqual(
            [p.value for p in seen],
            ["dawn", "day", "dusk", "night"],
        )


if __name__ == "__main__":
    unittest.main()
