"""
Wildwood M2.8 — SeasonTable 测试

覆盖:
  - 4 季节 profile 全部存在
  - 温度范围匹配方案 §2.7(春 15-25 / 夏 25-40 / 秋 10-20 / 冬 -10-5)
  - 顺序与 Season 枚举一致
  - 不可变(frozen)
  - tint RGB 通道 0..255
  - lookup API
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

from core.abstract.world.season import Season  # noqa: E402
from core.abstract.world.season_table import (  # noqa: E402
    SEASON_PROFILES,
    SeasonProfile,
    lookup,
)


class TestSeasonProfiles(unittest.TestCase):
    def test_all_four_seasons_present(self) -> None:
        self.assertEqual(
            set(SEASON_PROFILES.keys()),
            {Season.SPRING, Season.SUMMER, Season.AUTUMN, Season.WINTER},
        )

    def test_order_matches_season_enum(self) -> None:
        ordered = [
            SEASON_PROFILES[Season.SPRING],
            SEASON_PROFILES[Season.SUMMER],
            SEASON_PROFILES[Season.AUTUMN],
            SEASON_PROFILES[Season.WINTER],
        ]
        for p in ordered:
            self.assertIsInstance(p, SeasonProfile)
        # 验证顺序: spring < summer < autumn < winter
        self.assertEqual(
            [p.season for p in ordered],
            [Season.SPRING, Season.SUMMER, Season.AUTUMN, Season.WINTER],
        )


class TestTemperatureRange(unittest.TestCase):
    """方案 §2.7 温度范围硬约束."""

    def test_spring_temp(self) -> None:
        p = lookup(Season.SPRING)
        self.assertEqual(p.temp_min_c, 15.0)
        self.assertEqual(p.temp_max_c, 25.0)

    def test_summer_temp(self) -> None:
        p = lookup(Season.SUMMER)
        self.assertEqual(p.temp_min_c, 25.0)
        self.assertEqual(p.temp_max_c, 40.0)

    def test_autumn_temp(self) -> None:
        p = lookup(Season.AUTUMN)
        self.assertEqual(p.temp_min_c, 10.0)
        self.assertEqual(p.temp_max_c, 20.0)

    def test_winter_temp(self) -> None:
        p = lookup(Season.WINTER)
        self.assertEqual(p.temp_min_c, -10.0)
        self.assertEqual(p.temp_max_c, 5.0)


class TestSeasonTint(unittest.TestCase):
    def test_all_tints_in_0_255(self) -> None:
        for s in Season:
            p = lookup(s)
            for c in p.tint_rgb:
                self.assertGreaterEqual(c, 0)
                self.assertLessEqual(c, 255)

    def test_tints_distinct(self) -> None:
        # 4 季节光照色调应可区分(美术硬约束 24 色违例 = 0;光照是核心)
        tints = {lookup(s).tint_rgb for s in Season}
        self.assertEqual(len(tints), 4, "4 季节光照色调必须各不相同")


class TestSeasonFeatures(unittest.TestCase):
    def test_spring_features(self) -> None:
        p = lookup(Season.SPRING)
        self.assertIn("rain", p.features)
        self.assertIn("mushroom_growth", p.features)

    def test_summer_features(self) -> None:
        p = lookup(Season.SUMMER)
        self.assertIn("heatstroke", p.features)
        self.assertIn("cactus_fruit", p.features)

    def test_autumn_features(self) -> None:
        p = lookup(Season.AUTUMN)
        self.assertIn("leaf_fall", p.features)
        self.assertIn("harvest", p.features)

    def test_winter_features(self) -> None:
        p = lookup(Season.WINTER)
        self.assertIn("freeze", p.features)
        self.assertIn("campfire_required", p.features)
        self.assertIn("snow_blind", p.features)


class TestImmutability(unittest.TestCase):
    def test_profile_frozen(self) -> None:
        p = lookup(Season.SPRING)
        with self.assertRaises(Exception):  # FrozenInstanceError
            p.temp_min_c = 100.0  # type: ignore[misc]

    def test_temp_range_validation(self) -> None:
        with self.assertRaises(ValueError):
            SeasonProfile(
                season=Season.SPRING,
                label="x",
                tint_rgb=(0, 0, 0),
                temp_min_c=30.0,
                temp_max_c=10.0,  # min > max
                features=(),
                vegetation_palette=(),
            )

    def test_tint_channel_validation(self) -> None:
        with self.assertRaises(ValueError):
            SeasonProfile(
                season=Season.SPRING,
                label="x",
                tint_rgb=(256, 0, 0),  # out of range
                temp_min_c=0.0,
                temp_max_c=10.0,
                features=(),
                vegetation_palette=(),
            )


class TestLookup(unittest.TestCase):
    def test_lookup_returns_correct_profile(self) -> None:
        self.assertIs(lookup(Season.SPRING), SEASON_PROFILES[Season.SPRING])

    def test_lookup_unknown_raises(self) -> None:
        # 防御性: 实际不会发生 (enum 限制), 但代码有保护
        with self.assertRaises(ValueError):
            lookup("not_a_season")  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
