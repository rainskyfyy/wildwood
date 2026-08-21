"""
Wildwood M2.8 — SeasonTable(季节数据表)

数据来源:项目总方案 §2.7(全季节)
  - 春: 暖粉 / 15-25°C / 雨季+蘑菇生长
  - 夏: 明黄 / 25-40°C / 高温中暑+仙人掌结果
  - 秋: 橙金 / 10-20°C / 落叶+收获期
  - 冬: 冷蓝 / -10-5°C / 结冰+篝火保命+雪盲

设计:
  - 不可变 Dict[Season, SeasonProfile]
  - 提供 lookup(season) 与 4 季节全表
  - 怪物池字段留空(M2.7 怪物类型未发布, 见 monster_spawn_table.py)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Tuple

from core.abstract.world.constants import (
    SEASON_FEATURES,
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
from core.abstract.world.season import Season


@dataclass(frozen=True)
class SeasonProfile:
    """单个季节的不可变数据. frozen=True 保证配置不被运行时修改."""

    season: Season
    label: str                    # 显示名 (中/英)
    tint_rgb: Tuple[int, int, int]  # 季节光照色调 RGB 0-255
    temp_min_c: float             # 温度下限 °C
    temp_max_c: float             # 温度上限 °C
    features: Tuple[str, ...]     # 关键机制标签
    vegetation_palette: Tuple[str, ...]  # 植被色卡 ID (美术配置)
    # 怪物池: M2.7 未完成, 此处保留接口, 用空 tuple 占位
    # M2.7 完成后由 MonsterSpawnTable 接管
    monster_pool: Tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.temp_min_c > self.temp_max_c:
            raise ValueError(
                f"temp_min_c ({self.temp_min_c}) > temp_max_c ({self.temp_max_c})"
            )
        for c in self.tint_rgb:
            if not 0 <= c <= 255:
                raise ValueError(f"tint_rgb channel {c} out of 0..255")


SEASON_PROFILES = {
    Season.SPRING: SeasonProfile(
        season=Season.SPRING,
        label="春",
        tint_rgb=SEASON_TINT_SPRING,
        temp_min_c=TEMP_SPRING_MIN,
        temp_max_c=TEMP_SPRING_MAX,
        features=SEASON_FEATURES["spring"],
        vegetation_palette=("veg_spring_grass", "veg_spring_bush"),
    ),
    Season.SUMMER: SeasonProfile(
        season=Season.SUMMER,
        label="夏",
        tint_rgb=SEASON_TINT_SUMMER,
        temp_min_c=TEMP_SUMMER_MIN,
        temp_max_c=TEMP_SUMMER_MAX,
        features=SEASON_FEATURES["summer"],
        vegetation_palette=("veg_summer_grass", "veg_summer_cactus"),
    ),
    Season.AUTUMN: SeasonProfile(
        season=Season.AUTUMN,
        label="秋",
        tint_rgb=SEASON_TINT_AUTUMN,
        temp_min_c=TEMP_AUTUMN_MIN,
        temp_max_c=TEMP_AUTUMN_MAX,
        features=SEASON_FEATURES["autumn"],
        vegetation_palette=("veg_autumn_grass", "veg_autumn_leaves"),
    ),
    Season.WINTER: SeasonProfile(
        season=Season.WINTER,
        label="冬",
        tint_rgb=SEASON_TINT_WINTER,
        temp_min_c=TEMP_WINTER_MIN,
        temp_max_c=TEMP_WINTER_MAX,
        features=SEASON_FEATURES["winter"],
        vegetation_palette=("veg_winter_grass", "veg_winter_snow"),
    ),
}


def lookup(season: Season) -> SeasonProfile:
    """按 Season 查表. 越界 ValueError(已由 enum 阻止, 防御性检查)."""
    if season not in SEASON_PROFILES:
        raise ValueError(f"unknown season: {season}")
    return SEASON_PROFILES[season]
