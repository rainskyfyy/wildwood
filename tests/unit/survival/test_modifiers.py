"""
Unit tests for M2.4 survival modifiers.

任务验收:
  ② 警示动效 < 30% 触发 → is_critical
  ③ 温度 < 0°C 减速 50% → get_speed_modifier
  ④ 精神 < 30% 幻象 shader 启用 → should_show_illusion
"""

from __future__ import annotations

import pytest

from core.abstract.survival.stats import SurvivalStats, SurvivalContext
from core.abstract.survival.modifiers import (
    is_critical,
    get_speed_modifier,
    should_show_illusion,
    CRITICAL_THRESHOLD,
    ILLUSION_THRESHOLD,
    SPEED_FREEZING,
    TEMP_COLD_WARNING,
    TEMP_HOT_WARNING,
)


class TestIsCritical:
    """is_critical:任意维度进入警示(任务验收 ②)。"""

    def test_all_full_normal_not_critical(self):
        s = SurvivalStats(hp=100, hunger=100, sanity=100, temperature=20)
        assert is_critical(s) is False

    def test_hp_below_30_is_critical(self):
        """HP 29.9 / 100 = 29.9% < 30% → 警示"""
        s = SurvivalStats(hp=29.9)
        assert is_critical(s) is True

    def test_hp_at_30_not_critical(self):
        """HP 30.0 / 100 = 30.0% ≥ 30% → 不警示(边界)"""
        s = SurvivalStats(hp=30.0)
        assert is_critical(s) is False

    def test_hunger_below_30_is_critical(self):
        s = SurvivalStats(hunger=29.0)
        assert is_critical(s) is True

    def test_sanity_below_30_is_critical(self):
        s = SurvivalStats(sanity=29.0)
        assert is_critical(s) is True

    def test_temperature_cold_critical(self):
        """温度 < 5°C 警示(冻)"""
        s = SurvivalStats(temperature=4.0)
        assert is_critical(s) is True

    def test_temperature_freezing_critical(self):
        s = SurvivalStats(temperature=-10.0)
        assert is_critical(s) is True

    def test_temperature_hot_critical(self):
        """温度 > 35°C 警示(热)"""
        s = SurvivalStats(temperature=36.0)
        assert is_critical(s) is True

    def test_temperature_neutral_not_critical(self):
        """20°C 中性温度 → 不警示"""
        s = SurvivalStats(temperature=20.0)
        assert is_critical(s) is False

    def test_temperature_at_cold_boundary_not_critical(self):
        """5°C 边界 = 临界值,不警示"""
        s = SurvivalStats(temperature=5.0)
        assert is_critical(s) is False

    def test_temperature_at_hot_boundary_not_critical(self):
        """35°C 边界 = 临界值,不警示"""
        s = SurvivalStats(temperature=35.0)
        assert is_critical(s) is False

    def test_multiple_dims_below_30_still_critical(self):
        s = SurvivalStats(hp=20, hunger=20, sanity=20)
        assert is_critical(s) is True


class TestGetSpeedModifier:
    """get_speed_modifier:温度 < 0°C 减速 50%(任务验收 ③)。"""

    def test_default_speed_1(self):
        s = SurvivalStats()
        m = get_speed_modifier(s)
        assert m == 1.0

    def test_freezing_reduces_speed_to_50_percent(self):
        """任务验收 ③:温度 < 0°C 减速 50%"""
        s = SurvivalStats(temperature=-5.0)
        m = get_speed_modifier(s)
        assert m == SPEED_FREEZING  # 0.5

    def test_just_above_freezing_full_speed(self):
        """温度 = 0 不算冻结,1.0"""
        s = SurvivalStats(temperature=0.0)
        m = get_speed_modifier(s)
        assert m == 1.0

    def test_just_below_freezing_halved(self):
        s = SurvivalStats(temperature=-0.1)
        m = get_speed_modifier(s)
        assert m == SPEED_FREEZING

    def test_extreme_cold_still_50_percent(self):
        """温度 -50°C 仍然是 0.5(不继续衰减)"""
        s = SurvivalStats(temperature=-50.0)
        m = get_speed_modifier(s)
        assert m == SPEED_FREEZING

    def test_extreme_heat_reduces_speed(self):
        s = SurvivalStats(temperature=40.0)
        m = get_speed_modifier(s)
        assert m == 0.7

    def test_low_hp_reduces_speed(self):
        s = SurvivalStats(hp=20.0)  # 20% < 30%
        m = get_speed_modifier(s)
        assert m == 0.8

    def test_compound_modifier_takes_min(self):
        """温度低 + HP 低 → 取最严格的 0.5"""
        s = SurvivalStats(temperature=-5.0, hp=20.0)
        m = get_speed_modifier(s)
        assert m == 0.5

    def test_high_hp_freezing_still_50(self):
        s = SurvivalStats(temperature=-5.0, hp=100.0)
        m = get_speed_modifier(s)
        assert m == 0.5

    def test_cold_but_not_freezing_no_penalty(self):
        """5°C 中性冷,不减速"""
        s = SurvivalStats(temperature=5.0)
        m = get_speed_modifier(s)
        assert m == 1.0


class TestShouldShowIllusion:
    """should_show_illusion:精神 < 30% 启用幻象(任务验收 ④)。"""

    def test_full_sanity_no_illusion(self):
        s = SurvivalStats(sanity=100.0)
        assert should_show_illusion(s) is False

    def test_sanity_at_30_no_illusion(self):
        """30% 边界不触发"""
        s = SurvivalStats(sanity=30.0)
        assert should_show_illusion(s) is False

    def test_sanity_just_below_30_shows_illusion(self):
        """任务验收 ④:精神 < 30% 幻象 shader 启用"""
        s = SurvivalStats(sanity=29.9)
        assert should_show_illusion(s) is True

    def test_zero_sanity_shows_illusion(self):
        s = SurvivalStats(sanity=0.0)
        assert should_show_illusion(s) is True

    def test_custom_sanity_max_uses_ratio(self):
        """精神上限不是 100 时也按比例判定"""
        s = SurvivalStats(sanity=20.0, sanity_max=100.0)
        assert should_show_illusion(s) is True
        s2 = SurvivalStats(sanity=40.0, sanity_max=200.0)  # 20%
        assert should_show_illusion(s2) is True
        s3 = SurvivalStats(sanity=100.0, sanity_max=200.0)  # 50%
        assert should_show_illusion(s3) is False


class TestModifierConstants:
    """常量值。"""

    def test_critical_threshold_is_30_percent(self):
        assert CRITICAL_THRESHOLD == 0.30

    def test_illusion_threshold_is_30_percent(self):
        assert ILLUSION_THRESHOLD == 0.30

    def test_speed_freezing_is_50_percent(self):
        assert SPEED_FREEZING == 0.5

    def test_temp_cold_warning(self):
        assert TEMP_COLD_WARNING == 5.0

    def test_temp_hot_warning(self):
        assert TEMP_HOT_WARNING == 35.0
