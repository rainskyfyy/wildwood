"""
Wildwood M2.9 — StationProbe 抽象接口

约束:
  - 合成系统只通过本接口问"附近有 X 工作站吗?"
  - M2.3 建造系统实现本接口对接(玩家站在工作台 1 米内 → has_station(WORKBENCH) 返 True)
  - 本模块定义 1 个 Protocol 描述契约 + 1 个 reference 实现

边界:
  - StationProbe 不感知"距离" / "格挡" — 实现内部决定如何判断"附近"
  - 单次调用是同步的;不要做异步 / 跨帧查询
  - 不在 has_station 时改变状态(只读)
"""
from __future__ import annotations

from typing import Protocol, Set, runtime_checkable

from .schemas import StationType


@runtime_checkable
class StationProbe(Protocol):
    """
    合成系统对工作站的只读契约。
    """

    def has_station(self, station: StationType) -> bool:
        """
        玩家附近是否有指定工作站。
        NONE 永远返 True(无门槛 = 总是就绪)。
        """
        ...


class StaticStationProbe:
    """
    Reference / 测试用实现:硬编码一组就绪的工作站。
    适用于单元测试 + 联机前的单机 demo。
    """

    def __init__(self, stations: Set[StationType] | None = None):
        self._stations: Set[StationType] = set(stations or set())

    def has_station(self, station: StationType) -> bool:
        if station == StationType.NONE:
            return True  # NONE 永远就绪
        return station in self._stations

    def with_station(self, station: StationType) -> "StaticStationProbe":
        """返回新实例,新增 1 个工作站(原实例不可变,便于测试快照)。"""
        return StaticStationProbe(self._stations | {station})

    def without_station(self, station: StationType) -> "StaticStationProbe":
        """返回新实例,移除 1 个工作站。"""
        return StaticStationProbe(self._stations - {station})

    def snapshot(self) -> Set[StationType]:
        return set(self._stations)
