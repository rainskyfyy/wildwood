"""
Wildwood 生存属性 — 数据类与上下文

本模块是 M2.4 的最小数据层,4 维属性:
  - HP(生命)
  - 饱腹(饥饿度反向)
  - 精神(理智)
  - 温度(体温,摄氏度)

字段语义参考 M1.4 PlayerCurrentState,但本模块独立于 M1.4 持久化层。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict


class Season(str, Enum):
    """四季。对应方案 §2.7。"""
    SPRING = "spring"
    SUMMER = "summer"
    AUTUMN = "autumn"
    WINTER = "winter"


class SurvivalError(Exception):
    """生存属性相关错误基类。"""


@dataclass
class SurvivalStats:
    """
    4 维属性当前值 + 上限。

    字段语义(对应 M1.4 PlayerCurrentState):
      - hp:        [0, hp_max]        生命
      - hunger:    [0, hunger_max]    饱腹(0=极度饥饿,100=饱)
      - sanity:    [0, sanity_max]    精神(0=崩溃,100=正常)
      - temperature: [temperature_min, temperature_max]  体温(°C)
    """
    hp: float = 100.0
    hunger: float = 100.0
    sanity: float = 100.0
    temperature: float = 20.0
    # 上限/下限
    hp_max: float = 100.0
    hunger_max: float = 100.0
    sanity_max: float = 100.0
    temperature_max: float = 100.0
    temperature_min: float = -50.0

    def clamp(self) -> None:
        """把 4 维属性 clamp 到合法范围(写后调用,防止外部越界)。"""
        self.hp = max(0.0, min(self.hp, self.hp_max))
        self.hunger = max(0.0, min(self.hunger, self.hunger_max))
        self.sanity = max(0.0, min(self.sanity, self.sanity_max))
        self.temperature = max(
            self.temperature_min, min(self.temperature, self.temperature_max)
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hp": self.hp,
            "hunger": self.hunger,
            "sanity": self.sanity,
            "temperature": self.temperature,
            "hp_max": self.hp_max,
            "hunger_max": self.hunger_max,
            "sanity_max": self.sanity_max,
            "temperature_max": self.temperature_max,
            "temperature_min": self.temperature_min,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "SurvivalStats":
        return cls(
            hp=d.get("hp", 100.0),
            hunger=d.get("hunger", 100.0),
            sanity=d.get("sanity", 100.0),
            temperature=d.get("temperature", 20.0),
            hp_max=d.get("hp_max", 100.0),
            hunger_max=d.get("hunger_max", 100.0),
            sanity_max=d.get("sanity_max", 100.0),
            temperature_max=d.get("temperature_max", 100.0),
            temperature_min=d.get("temperature_min", -50.0),
        )


@dataclass
class SurvivalContext:
    """
    外部条件(驱动生存属性变化)。

    字段:
      - ambient_temperature: 环境温度(°C),影响体温平衡
      - is_near_fire: 是否靠近火源(篝火/营火)
      - is_wet: 是否淋雨/落水
      - is_in_shelter: 是否在庇护所
      - time_of_day: 一天中的时间,[0, 1](0=午夜,0.5=正午)
      - season: 季节
      - monster_proximity: 怪物接近程度,[0, 1]
      - food_quality_recent: 最近进食质量,[0, 1]
      - resting: 是否在休息(火堆旁/床上)
      - is_alive: 是否存活
    """
    ambient_temperature: float = 20.0
    is_near_fire: bool = False
    is_wet: bool = False
    is_in_shelter: bool = False
    time_of_day: float = 0.5
    season: str = Season.SPRING.value
    monster_proximity: float = 0.0
    food_quality_recent: float = 0.0
    resting: bool = False
    is_alive: bool = True
