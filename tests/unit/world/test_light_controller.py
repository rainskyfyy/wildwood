"""
Wildwood M2.8 — LightController 测试(验收 ① ④ 核心)

覆盖:
  - 初始态正确
  - start_transition 触发过渡
  - update 推进: 0s 起点 / 中点 / 0.5s 完成 → 终态
  - 完成后保持终态(不反弹)
  - 0.5s 恰好完成(验收 ①)
  - RGB 通道 0..255
  - intensity 0..1
  - 负 dt 抛 ValueError
  - 多次连续过渡(切季节 + 切昼夜 接力)
  - 零时长立即到位
  - 在过渡中重新 start_transition(从当前位置继续)
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
    DEFAULT_DAYNIGHT_TRANSITION_SECONDS,
    DEFAULT_SEASON_TRANSITION_SECONDS,
    SEASON_TINT_SPRING,
    SEASON_TINT_WINTER,
)
from core.abstract.world.light_controller import (  # noqa: E402
    LIGHT_TRANSITION_DAYNIGHT,
    LIGHT_TRANSITION_SEASON,
    LightController,
)


class TestLightControllerInit(unittest.TestCase):
    def test_default_initial(self) -> None:
        c = LightController()
        self.assertEqual(c.current_rgb, (255, 250, 245))
        self.assertEqual(c.current_intensity, 1.0)
        self.assertFalse(c.is_in_transition)

    def test_custom_initial(self) -> None:
        c = LightController(initial_rgb=(100, 100, 100), initial_intensity=0.5)
        self.assertEqual(c.current_rgb, (100, 100, 100))
        self.assertEqual(c.current_intensity, 0.5)

    def test_invalid_initial_rgb(self) -> None:
        with self.assertRaises(ValueError):
            LightController(initial_rgb=(256, 0, 0))

    def test_invalid_initial_intensity(self) -> None:
        with self.assertRaises(ValueError):
            LightController(initial_intensity=2.0)
        with self.assertRaises(ValueError):
            LightController(initial_intensity=-0.1)

    def test_default_transition_seconds(self) -> None:
        self.assertEqual(LIGHT_TRANSITION_SEASON, 0.5)
        self.assertEqual(LIGHT_TRANSITION_DAYNIGHT, 0.5)
        self.assertEqual(DEFAULT_SEASON_TRANSITION_SECONDS, 0.5)
        self.assertEqual(DEFAULT_DAYNIGHT_TRANSITION_SECONDS, 0.5)


class TestSeasonTransition(unittest.TestCase):
    """M2.8 验收 ①: 4 季节切换 0.5s LOD 过渡."""

    def test_zero_dt_no_movement(self) -> None:
        c = LightController()
        c.start_transition(SEASON_TINT_WINTER, 0.3)
        rgb0 = c.current_rgb
        i0 = c.current_intensity
        c.update(0.0)
        self.assertEqual(c.current_rgb, rgb0)
        self.assertEqual(c.current_intensity, i0)
        self.assertTrue(c.is_in_transition)

    def test_midpoint_is_average(self) -> None:
        c = LightController(
            initial_rgb=SEASON_TINT_SPRING, initial_intensity=1.0
        )
        c.start_transition(SEASON_TINT_WINTER, 0.0, duration=1.0)
        c.update(0.5)
        # 中点 0.5s, 插值 0.5
        # spring = (255,200,215), winter = (180,215,245)
        # mid = ((255+180)/2, (200+215)/2, (215+245)/2) = (217, 207, 230)
        self.assertEqual(c.current_rgb, (218, 208, 230))  # round((217.5, 207.5, 230.0))
        self.assertAlmostEqual(c.current_intensity, 0.5)
        self.assertTrue(c.is_in_transition)

    def test_full_transition_lands_on_target(self) -> None:
        c = LightController(
            initial_rgb=SEASON_TINT_SPRING, initial_intensity=1.0
        )
        c.start_transition(SEASON_TINT_WINTER, 0.0, duration=0.5)
        # 0.5s 内任意 dt 累加到 0.5 都应完成
        c.update(0.3)
        c.update(0.2)
        self.assertEqual(c.current_rgb, SEASON_TINT_WINTER)
        self.assertEqual(c.current_intensity, 0.0)
        self.assertFalse(c.is_in_transition)

    def test_zero_duration_lands_immediately(self) -> None:
        c = LightController(
            initial_rgb=SEASON_TINT_SPRING, initial_intensity=1.0
        )
        c.start_transition(SEASON_TINT_WINTER, 0.0, duration=0.0)
        self.assertEqual(c.current_rgb, SEASON_TINT_WINTER)
        self.assertEqual(c.current_intensity, 0.0)
        self.assertFalse(c.is_in_transition)

    def test_holds_at_terminal_state(self) -> None:
        c = LightController()
        c.start_transition(SEASON_TINT_WINTER, 0.0, duration=0.5)
        c.update(0.5)
        # 之后再 update 应当保持终态
        for _ in range(10):
            c.update(0.1)
        self.assertEqual(c.current_rgb, SEASON_TINT_WINTER)
        self.assertEqual(c.current_intensity, 0.0)
        self.assertFalse(c.is_in_transition)

    def test_default_season_transition_uses_0_5s(self) -> None:
        c = LightController(
            initial_rgb=SEASON_TINT_SPRING, initial_intensity=1.0
        )
        # 不传 duration 应当用 0.5s
        c.start_transition(SEASON_TINT_WINTER, 0.0)
        self.assertTrue(c.is_in_transition)
        c.update(0.5)  # 恰 0.5s
        self.assertEqual(c.current_rgb, SEASON_TINT_WINTER)
        self.assertFalse(c.is_in_transition)


class TestDayNightTransition(unittest.TestCase):
    """M2.8 验收 ④: 昼夜光照过场平滑."""

    def test_smooth_dawn_to_noon(self) -> None:
        c = LightController(
            initial_rgb=(40, 50, 90), initial_intensity=0.0  # night tint
        )
        c.start_transition((255, 250, 245), 1.0, duration=0.5)  # day tint, full light
        # 采样 11 帧
        samples = []
        for _ in range(11):
            samples.append((c.current_rgb, c.current_intensity))
            c.update(0.05)  # 0.5s / 10
        # 终态
        self.assertEqual(samples[-1][0], (255, 250, 245))
        self.assertAlmostEqual(samples[-1][1], 1.0)
        # 起点
        self.assertEqual(samples[0][0], (40, 50, 90))
        self.assertEqual(samples[0][1], 0.0)
        # 应当单调上升(光强和 R/G/B 总体)
        intensities = [s[1] for s in samples]
        for i in range(1, len(intensities)):
            self.assertGreaterEqual(
                intensities[i], intensities[i - 1] - 1e-6,
                f"intensity dropped at frame {i}",
            )

    def test_rgb_channels_in_range(self) -> None:
        c = LightController(
            initial_rgb=(0, 0, 0), initial_intensity=0.0
        )
        c.start_transition((255, 255, 255), 1.0, duration=0.5)
        for _ in range(20):
            c.update(0.025)
            r, g, b = c.current_rgb
            self.assertGreaterEqual(r, 0)
            self.assertLessEqual(r, 255)
            self.assertGreaterEqual(g, 0)
            self.assertLessEqual(g, 255)
            self.assertGreaterEqual(b, 0)
            self.assertLessEqual(b, 255)
            self.assertGreaterEqual(c.current_intensity, 0.0)
            self.assertLessEqual(c.current_intensity, 1.0)


class TestMidTransitionRestart(unittest.TestCase):
    def test_restart_during_transition_continues_from_current(self) -> None:
        c = LightController(
            initial_rgb=(0, 0, 0), initial_intensity=0.0
        )
        c.start_transition((100, 100, 100), 1.0, duration=1.0)
        c.update(0.5)  # 半程
        mid_rgb = c.current_rgb
        # 切新终点
        c.start_transition((200, 200, 200), 0.5, duration=1.0)
        # 应当从 mid_rgb 继续
        c.update(0.0)
        self.assertEqual(c.current_rgb, mid_rgb)
        # 完成 1s
        c.update(1.0)
        self.assertEqual(c.current_rgb, (200, 200, 200))
        self.assertEqual(c.current_intensity, 0.5)


class TestForceFinish(unittest.TestCase):
    def test_force_finish(self) -> None:
        c = LightController()
        c.start_transition(SEASON_TINT_WINTER, 0.0, duration=10.0)
        c.force_finish()
        self.assertEqual(c.current_rgb, SEASON_TINT_WINTER)
        self.assertEqual(c.current_intensity, 0.0)
        self.assertFalse(c.is_in_transition)


class TestNegativeDt(unittest.TestCase):
    def test_negative_dt_rejected(self) -> None:
        c = LightController()
        c.start_transition(SEASON_TINT_WINTER, 0.0, duration=1.0)
        with self.assertRaises(ValueError):
            c.update(-0.1)


if __name__ == "__main__":
    unittest.main()
