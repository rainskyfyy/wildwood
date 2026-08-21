"""
Wildwood M2.9 — InventoryView 抽象接口

约束:
  - 合成系统只通过本接口读取 + 扣减库存
  - M2.2 采集系统 / M2.13 背包系统 各自实现本接口对接
  - 本模块定义 1 个 Protocol 描述契约 + 1 个 reference 实现 + 1 个测试用 mock

边界:
  - InventoryView 不感知"加成 / 减成 / 重量"等业务规则 — 只暴露"够不够 / 扣不扣"
  - add 是只读契约外的可变操作,但仍走接口(供合成结果落库)
  - count(item_id) 不在的 item 视作 0(不抛)
"""
from __future__ import annotations

from typing import Dict, Mapping, Protocol, runtime_checkable

from .schemas import Ingredient


@runtime_checkable
class InventoryView(Protocol):
    """
    合成系统对库存的只读 + 扣减契约。
    """

    def get_count(self, item_id: str) -> int:
        """查询物品数量;不在视作 0。"""
        ...

    def consume(self, ingredient: Ingredient) -> bool:
        """
        扣减 1 份材料。返回是否成功(库存不足返 False)。
        注意:仅当所有材料 check 成功后才会被调用,正常情况应总返 True。
        """
        ...

    def add(self, item_id: str, count: int) -> bool:
        """
        添加物品(产出落库)。返回是否成功(背包满返 False)。
        边界:实现应保证 count > 0。
        """
        ...


class DictInventoryView:
    """
    Reference / 测试用实现:基于 dict 的内存库存。
    不持久化,适用于单元测试 + 联机前的单机 demo。
    """

    def __init__(self, items: Mapping[str, int] | None = None):
        self._items: Dict[str, int] = dict(items or {})

    def get_count(self, item_id: str) -> int:
        return self._items.get(item_id, 0)

    def consume(self, ingredient: Ingredient) -> bool:
        if self.get_count(ingredient.item_id) < ingredient.count:
            return False
        self._items[ingredient.item_id] = self._items.get(ingredient.item_id, 0) - ingredient.count
        if self._items[ingredient.item_id] <= 0:
            self._items.pop(ingredient.item_id, None)
        return True

    def add(self, item_id: str, count: int) -> bool:
        if count <= 0:
            raise ValueError(f"add count 必须 > 0,实际 {count}")
        self._items[item_id] = self._items.get(item_id, 0) + count
        return True

    def snapshot(self) -> Dict[str, int]:
        """调试用快照(返回副本)。"""
        return dict(self._items)


class FailingInventoryView:
    """测试用:consume 永远失败(用于回滚测试)。add 总是 True。"""

    def get_count(self, item_id: str) -> int:
        return 0

    def consume(self, ingredient: Ingredient) -> bool:
        return False

    def add(self, item_id: str, count: int) -> bool:
        return True
