"""
Unit tests for M2.4 survival stats data class.

字段语义参考 M1.4 PlayerCurrentState(HP/饱腹/精神/温度),
但本模块独立于 M1.4 持久化层,只复用 4 维属性边界。
"""

from __future__ import annotations

import pytest

from core.abstract.survival.stats import SurvivalStats


class TestSurvivalStatsDefaults:
    """默认值与字段齐全性(任务验收 ① 4 维属性实时更新)。"""

    def test_create_default_has_4_dimensions(self):
        s = SurvivalStats()
        assert hasattr(s, "hp")
        assert hasattr(s, "hunger")
        assert hasattr(s, "sanity")
        assert hasattr(s, "temperature")

    def test_default_values_match_m1_4_convention(self):
        """沿用 M1.4 字段语义:HP/饱腹/精神默认 100,温度默认 20°C 中性。"""
        s = SurvivalStats()
        assert s.hp == 100.0
        assert s.hunger == 100.0
        assert s.sanity == 100.0
        assert s.temperature == 20.0

    def test_default_max_values(self):
        """上限默认:HP 100,饱腹 100,精神 100,温度 100(双向,实际范围 [-50, 100])。"""
        s = SurvivalStats()
        assert s.hp_max == 100.0
        assert s.hunger_max == 100.0
        assert s.sanity_max == 100.0
        # 温度上限 100,下限 -50(避免冻死瞬间归零)
        assert s.temperature_max == 100.0
        assert s.temperature_min == -50.0


class TestSurvivalStatsConstruction:
    """显式构造 + 边界值。"""

    def test_create_with_explicit_values(self):
        s = SurvivalStats(
            hp=50.0,
            hunger=80.0,
            sanity=20.0,
            temperature=-5.0,
        )
        assert s.hp == 50.0
        assert s.hunger == 80.0
        assert s.sanity == 20.0
        assert s.temperature == -5.0

    def test_create_with_custom_max(self):
        s = SurvivalStats(hp=150.0, hp_max=200.0)
        assert s.hp == 150.0
        assert s.hp_max == 200.0


class TestSurvivalStatsClamp:
    """clamp 到合法范围,防止外部写入越界值。"""

    def test_clamp_hp_upper(self):
        s = SurvivalStats(hp=150.0, hp_max=100.0)
        s.clamp()
        assert s.hp == 100.0

    def test_clamp_hp_lower(self):
        s = SurvivalStats(hp=-10.0, hp_max=100.0)
        s.clamp()
        assert s.hp == 0.0

    def test_clamp_hunger_bounds(self):
        s = SurvivalStats(hunger=200.0, hunger_max=100.0)
        s.clamp()
        assert s.hunger == 100.0
        s2 = SurvivalStats(hunger=-1.0)
        s2.clamp()
        assert s2.hunger == 0.0

    def test_clamp_sanity_bounds(self):
        s = SurvivalStats(sanity=200.0, sanity_max=100.0)
        s.clamp()
        assert s.sanity == 100.0

    def test_clamp_temperature_within_min_max(self):
        """温度范围 [-50, 100],默认。"""
        s = SurvivalStats(temperature=200.0)
        s.clamp()
        assert s.temperature == 100.0
        s2 = SurvivalStats(temperature=-100.0)
        s2.clamp()
        assert s2.temperature == -50.0

    def test_clamp_is_idempotent(self):
        s = SurvivalStats()
        s.clamp()
        s.clamp()
        assert s.hp == 100.0
        assert s.hunger == 100.0


class TestSurvivalStatsSerialization:
    """序列化/反序列化(给 M2.6 世界持久化用)。"""

    def test_to_dict_round_trip(self):
        s = SurvivalStats(
            hp=75.0,
            hunger=50.0,
            sanity=90.0,
            temperature=15.0,
        )
        d = s.to_dict()
        s2 = SurvivalStats.from_dict(d)
        assert s2.hp == 75.0
        assert s2.hunger == 50.0
        assert s2.sanity == 90.0
        assert s2.temperature == 15.0
        assert s2.hp_max == 100.0
        assert s2.temperature_min == -50.0

    def test_to_dict_contains_all_4_dimensions(self):
        s = SurvivalStats()
        d = s.to_dict()
        assert "hp" in d
        assert "hunger" in d
        assert "sanity" in d
        assert "temperature" in d
