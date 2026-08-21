"""
Unit tests for M2.4 survival context (external conditions).
"""

from __future__ import annotations

import pytest

from core.abstract.survival.stats import (
    SurvivalContext,
    Season,
    SurvivalError,
)


class TestSurvivalContextDefaults:
    """默认值与字段齐全性。"""

    def test_default_ambient_temperature(self):
        c = SurvivalContext()
        assert c.ambient_temperature == 20.0

    def test_default_flags_are_false(self):
        c = SurvivalContext()
        assert c.is_near_fire is False
        assert c.is_wet is False
        assert c.is_in_shelter is False
        assert c.resting is False

    def test_default_time_of_day_noon(self):
        c = SurvivalContext()
        assert c.time_of_day == 0.5

    def test_default_season_spring(self):
        c = SurvivalContext()
        assert c.season == Season.SPRING.value

    def test_default_monster_proximity_zero(self):
        c = SurvivalContext()
        assert c.monster_proximity == 0.0

    def test_default_is_alive_true(self):
        c = SurvivalContext()
        assert c.is_alive is True

    def test_default_food_quality_zero(self):
        c = SurvivalContext()
        assert c.food_quality_recent == 0.0


class TestSurvivalContextConstruction:
    """显式构造 + 边界值。"""

    def test_create_with_explicit_values(self):
        c = SurvivalContext(
            ambient_temperature=-10.0,
            is_near_fire=True,
            is_wet=True,
            is_in_shelter=False,
            time_of_day=0.85,
            season=Season.WINTER.value,
            monster_proximity=0.7,
            food_quality_recent=0.6,
            resting=True,
            is_alive=True,
        )
        assert c.ambient_temperature == -10.0
        assert c.is_near_fire is True
        assert c.is_wet is True
        assert c.time_of_day == 0.85
        assert c.season == Season.WINTER.value
        assert c.monster_proximity == 0.7
        assert c.food_quality_recent == 0.6
        assert c.resting is True


class TestSeasonEnum:
    """季节枚举 4 值。"""

    def test_season_has_4_values(self):
        seasons = [s.value for s in Season]
        assert set(seasons) == {"spring", "summer", "autumn", "winter"}

    def test_season_string_inheritance(self):
        """Season 是 str 的子类,可直接用 string 上下文。"""
        s = Season.WINTER
        assert s == "winter"
        assert isinstance(s, str)


class TestSurvivalError:
    """异常基类可实例化。"""

    def test_survival_error_subclasses_exception(self):
        assert issubclass(SurvivalError, Exception)

    def test_survival_error_can_be_raised(self):
        with pytest.raises(SurvivalError):
            raise SurvivalError("test")
