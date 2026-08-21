"""
Wildwood M2.9 — InventoryView + StationProbe 单元测试

覆盖:
  - DictInventoryView CRUD(初始空 / get / consume / add / 边界)
  - InventoryView Protocol runtime checkable
  - FailingInventoryView 行为
  - StaticStationProbe NONE 永远 True / 有/无 切换
  - StationProbe Protocol runtime checkable
"""
from __future__ import annotations

import unittest

from core.abstract.crafting.inventory_view import (
    DictInventoryView,
    FailingInventoryView,
    InventoryView,
)
from core.abstract.crafting.station_probe import StaticStationProbe, StationProbe
from core.abstract.crafting.schemas import Ingredient, StationType


class TestDictInventoryView(unittest.TestCase):
    def test_empty_inventory(self):
        inv = DictInventoryView()
        self.assertEqual(inv.get_count("wood"), 0)
        self.assertEqual(inv.get_count("anything"), 0)

    def test_init_with_items(self):
        inv = DictInventoryView({"wood": 5, "stone": 2})
        self.assertEqual(inv.get_count("wood"), 5)
        self.assertEqual(inv.get_count("stone"), 2)
        self.assertEqual(inv.get_count("flint"), 0)

    def test_consume_sufficient(self):
        inv = DictInventoryView({"wood": 5})
        ok = inv.consume(Ingredient(item_id="wood", count=3))
        self.assertTrue(ok)
        self.assertEqual(inv.get_count("wood"), 2)

    def test_consume_insufficient(self):
        inv = DictInventoryView({"wood": 2})
        ok = inv.consume(Ingredient(item_id="wood", count=3))
        self.assertFalse(ok)
        self.assertEqual(inv.get_count("wood"), 2)  # 库存不变

    def test_consume_exact_zero_removed(self):
        inv = DictInventoryView({"wood": 3})
        ok = inv.consume(Ingredient(item_id="wood", count=3))
        self.assertTrue(ok)
        self.assertEqual(inv.get_count("wood"), 0)
        self.assertNotIn("wood", inv.snapshot())  # 0 计数应从 dict 移除(避免脏数据)

    def test_add(self):
        inv = DictInventoryView()
        self.assertTrue(inv.add("axe", 1))
        self.assertEqual(inv.get_count("axe"), 1)

    def test_add_accumulates(self):
        inv = DictInventoryView({"axe": 2})
        inv.add("axe", 3)
        self.assertEqual(inv.get_count("axe"), 5)

    def test_add_must_be_positive(self):
        inv = DictInventoryView()
        with self.assertRaises(ValueError):
            inv.add("axe", 0)
        with self.assertRaises(ValueError):
            inv.add("axe", -1)

    def test_consume_unknown_item_fails(self):
        inv = DictInventoryView()
        ok = inv.consume(Ingredient(item_id="wood", count=1))
        self.assertFalse(ok)

    def test_snapshot_is_copy(self):
        inv = DictInventoryView({"wood": 5})
        snap = inv.snapshot()
        snap["wood"] = 99
        # 修改 snapshot 不影响原 inventory
        self.assertEqual(inv.get_count("wood"), 5)


class TestInventoryViewProtocol(unittest.TestCase):
    def test_dict_inventory_satisfies_protocol(self):
        inv = DictInventoryView()
        self.assertIsInstance(inv, InventoryView)

    def test_failing_inventory_satisfies_protocol(self):
        inv = FailingInventoryView()
        self.assertIsInstance(inv, InventoryView)

    def test_failing_consume_always_false(self):
        inv = FailingInventoryView()
        self.assertFalse(inv.consume(Ingredient(item_id="wood", count=1)))

    def test_failing_get_count_zero(self):
        inv = FailingInventoryView()
        self.assertEqual(inv.get_count("wood"), 0)


class TestStaticStationProbe(unittest.TestCase):
    def test_empty_probe(self):
        probe = StaticStationProbe()
        # NONE 永远 True
        self.assertTrue(probe.has_station(StationType.NONE))
        self.assertFalse(probe.has_station(StationType.WORKBENCH))
        self.assertFalse(probe.has_station(StationType.COOKPOT))

    def test_with_workbench(self):
        probe = StaticStationProbe({StationType.WORKBENCH})
        self.assertTrue(probe.has_station(StationType.NONE))
        self.assertTrue(probe.has_station(StationType.WORKBENCH))
        self.assertFalse(probe.has_station(StationType.COOKPOT))

    def test_with_cookpot(self):
        probe = StaticStationProbe({StationType.COOKPOT})
        self.assertTrue(probe.has_station(StationType.COOKPOT))
        self.assertFalse(probe.has_station(StationType.WORKBENCH))

    def test_with_both_stations(self):
        probe = StaticStationProbe({StationType.WORKBENCH, StationType.COOKPOT})
        self.assertTrue(probe.has_station(StationType.WORKBENCH))
        self.assertTrue(probe.has_station(StationType.COOKPOT))

    def test_with_station_returns_new_instance(self):
        """不可变:原 probe 不变。"""
        p1 = StaticStationProbe()
        p2 = p1.with_station(StationType.WORKBENCH)
        # p1 没变
        self.assertFalse(p1.has_station(StationType.WORKBENCH))
        # p2 有
        self.assertTrue(p2.has_station(StationType.WORKBENCH))

    def test_without_station(self):
        p1 = StaticStationProbe({StationType.WORKBENCH, StationType.COOKPOT})
        p2 = p1.without_station(StationType.WORKBENCH)
        self.assertTrue(p1.has_station(StationType.WORKBENCH))  # 原不变
        self.assertFalse(p2.has_station(StationType.WORKBENCH))  # 移除成功
        self.assertTrue(p2.has_station(StationType.COOKPOT))    # 其它保留


class TestStationProbeProtocol(unittest.TestCase):
    def test_static_probe_satisfies_protocol(self):
        self.assertIsInstance(StaticStationProbe(), StationProbe)


if __name__ == "__main__":
    unittest.main()
