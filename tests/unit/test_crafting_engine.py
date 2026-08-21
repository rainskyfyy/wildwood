"""
Wildwood M2.9 — CraftingEngine 单元测试

覆盖:
  - check_can_craft 全有 → True,missing=[],blocked=None
  - check_can_craft 缺料 → False,missing 含缺料项
  - check_can_craft 无工作站 → False,blocked="requires_workbench"/"requires_cookpot"
  - check_can_craft 库存 + 工作站都缺 → blocked 优先(顺序约定)
  - check_can_craft 未知 recipe → 抛 ValueError
  - craft 可合成 → 扣材料 + 加产出 + 返 CraftingResult
  - craft 不可合成 → 抛 CraftingError
  - craft 部分 consume 失败 → 回滚补偿(库存回退到原状)
  - craft 性能预算:1000 次 p99 < 50ms
  - get_ui_state 各种场景(对应验收 ②④)

边界:
  - 工作台 NONE → 永远不卡工作站门槛
  - inventory 空时 consume 永远返 False
  - 配方不存在时 check 抛 ValueError,craft 抛 CraftingError
"""
from __future__ import annotations

import time
import unittest
from typing import List

from core.abstract.crafting.crafting_engine import (
    CraftingEngine,
    CraftingError,
    CheckResult,
)
from core.abstract.crafting.inventory_view import (
    DictInventoryView,
    FailingInventoryView,
)
from core.abstract.crafting.recipe_book import RecipeBook
from core.abstract.crafting.station_probe import StaticStationProbe
from core.abstract.crafting.schemas import (
    CraftingResult,
    Ingredient,
    Recipe,
    RecipeCategory,
    StationType,
)


def _inv(items=None):
    return DictInventoryView(items or {})


def _probe(stations=None):
    return StaticStationProbe(set(stations or set()))


def _book():
    return RecipeBook.default_book()


# ==================== check_can_craft 测试 ====================

class TestCheckCanCraftSuccess(unittest.TestCase):
    def test_full_materials_with_workbench_returns_can_craft(self):
        book = _book()
        inv = _inv({"wood": 5})
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertTrue(result.can_craft)
        self.assertEqual(result.missing, ())
        self.assertIsNone(result.blocked)

    def test_full_materials_no_station_required(self):
        book = _book()
        inv = _inv({"wood": 3, "flint": 2})
        probe = _probe()  # 没工作台,但 spear 不需要
        r = book.find_by_id("craft.tool.spear")
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertTrue(result.can_craft)
        self.assertEqual(result.missing, ())
        self.assertIsNone(result.blocked)


class TestCheckCanCraftMissing(unittest.TestCase):
    def test_missing_one_ingredient(self):
        book = _book()
        inv = _inv({"wood": 3})  # 没有 flint
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.pickaxe")  # 需 3 wood + 2 flint
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertFalse(result.can_craft)
        self.assertEqual(len(result.missing), 1)
        missing_item = result.missing[0].item_id
        self.assertEqual(missing_item, "flint")
        self.assertEqual(result.missing[0].count, 2)
        self.assertIsNone(result.blocked)

    def test_missing_multiple_ingredients(self):
        book = _book()
        inv = _inv({})  # 库存空
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.pickaxe")
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertFalse(result.can_craft)
        self.assertEqual(len(result.missing), 2)
        missing_items = {ing.item_id for ing in result.missing}
        self.assertEqual(missing_items, {"wood", "flint"})

    def test_insufficient_count_means_missing(self):
        book = _book()
        inv = _inv({"wood": 1})  # 不够 3
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertFalse(result.can_craft)
        self.assertEqual(len(result.missing), 1)
        self.assertEqual(result.missing[0].item_id, "wood")
        # 缺的数量 = 配方要求 - 库存(此处 3 - 1 = 2)
        self.assertEqual(result.missing[0].count, 2)


class TestCheckCanCraftBlocked(unittest.TestCase):
    def test_no_workbench_for_workbench_recipe(self):
        book = _book()
        inv = _inv({"wood": 5})  # 材料全有
        probe = _probe()  # 没工作台
        r = book.find_by_id("craft.tool.axe")  # 需要 WORKBENCH
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertFalse(result.can_craft)
        self.assertEqual(result.missing, ())
        self.assertEqual(result.blocked, "requires_workbench")

    def test_no_cookpot_for_cookpot_recipe(self):
        book = _book()
        inv = _inv({"berries": 5, "wood": 2})
        probe = _probe()  # 没烹饪锅
        r = book.find_by_id("craft.food.cooked_berries")
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertFalse(result.can_craft)
        self.assertEqual(result.blocked, "requires_cookpot")

    def test_station_requirement_present_in_result(self):
        book = _book()
        inv = _inv({"wood": 5})
        probe = _probe()
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertEqual(result.station_required, StationType.WORKBENCH)

    def test_missing_and_no_station_both_indicated(self):
        """缺料 + 无工作站 → blocked 字段表示工作站门槛,missing 字段同时填充。"""
        book = _book()
        inv = _inv({})  # 没材料
        probe = _probe()  # 没工作台
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        result = engine.check_can_craft(r, inv, probe)
        self.assertFalse(result.can_craft)
        self.assertGreater(len(result.missing), 0)
        self.assertEqual(result.blocked, "requires_workbench")


class TestCheckCanCraftUnknownRecipe(unittest.TestCase):
    def test_non_recipe_input_raises_value_error(self):
        """check_can_craft 接受合法 Recipe;非 Recipe 实例(如 None/dict)应抛 ValueError。"""
        engine = CraftingEngine()
        with self.assertRaises(ValueError):
            engine.check_can_craft(None, _inv(), _probe())
        with self.assertRaises(ValueError):
            engine.check_can_craft({"id": "fake"}, _inv(), _probe())


# ==================== craft 测试 ====================

class TestCraftSuccess(unittest.TestCase):
    def test_craft_consumes_materials_and_adds_result(self):
        book = _book()
        inv = _inv({"wood": 3})
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()

        result = engine.craft(r, inv, probe)

        # 库存:wood -3,新增 axe
        self.assertEqual(inv.get_count("wood"), 0)
        self.assertEqual(inv.get_count("axe"), 1)
        # CraftingResult 内容
        self.assertIsInstance(result, CraftingResult)
        self.assertEqual(result.recipe_id, "craft.tool.axe")
        self.assertEqual(result.produced, (Ingredient(item_id="axe", count=1),))
        self.assertEqual(result.consumed, (Ingredient(item_id="wood", count=3),))

    def test_craft_multi_ingredient(self):
        book = _book()
        inv = _inv({"wood": 5, "flint": 3})
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.pickaxe")  # 3 wood + 2 flint
        engine = CraftingEngine()
        engine.craft(r, inv, probe)
        self.assertEqual(inv.get_count("wood"), 2)
        self.assertEqual(inv.get_count("flint"), 1)
        self.assertEqual(inv.get_count("pickaxe"), 1)

    def test_craft_food_with_cookpot(self):
        book = _book()
        inv = _inv({"berries": 5, "wood": 2})
        probe = _probe({StationType.COOKPOT})
        r = book.find_by_id("craft.food.cooked_berries")
        engine = CraftingEngine()
        result = engine.craft(r, inv, probe)
        self.assertEqual(inv.get_count("cooked_berries"), 1)
        self.assertEqual(inv.get_count("berries"), 2)
        self.assertEqual(inv.get_count("wood"), 1)

    def test_craft_none_station_works_anywhere(self):
        book = _book()
        inv = _inv({"wood": 3, "grass": 3})
        probe = _probe()  # 啥工作站都没有
        r = book.find_by_id("craft.tool.torch")
        engine = CraftingEngine()
        result = engine.craft(r, inv, probe)
        self.assertEqual(inv.get_count("torch"), 1)


class TestCraftFailure(unittest.TestCase):
    def test_craft_without_materials_raises(self):
        book = _book()
        inv = _inv({})
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        with self.assertRaises(CraftingError):
            engine.craft(r, inv, probe)

    def test_craft_without_station_raises(self):
        book = _book()
        inv = _inv({"wood": 5})
        probe = _probe()  # 无工作台
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        with self.assertRaises(CraftingError):
            engine.craft(r, inv, probe)

    def test_craft_compensates_on_partial_consume_failure(self):
        """
        关键安全测试:如果 consume 中途失败(罕见但可能,如并发修改),
        之前已扣的材料必须补偿回去。
        """
        book = _book()
        # 用一个特殊的 failing inventory:第 1 次 consume 成功(wood),第 2 次失败(flint)
        class HalfFailingInv:
            def __init__(self):
                self.items = {"wood": 5, "flint": 0}
                self.consume_calls: List[str] = []

            def get_count(self, item_id):
                return self.items.get(item_id, 0)

            def consume(self, ing):
                self.consume_calls.append(ing.item_id)
                if self.items.get(ing.item_id, 0) < ing.count:
                    return False
                self.items[ing.item_id] -= ing.count
                if self.items[ing.item_id] <= 0:
                    self.items.pop(ing.item_id, None)
                return True

            def add(self, item_id, count):
                self.items[item_id] = self.items.get(item_id, 0) + count
                return True

        inv = HalfFailingInv()
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.pickaxe")  # 3 wood + 2 flint
        engine = CraftingEngine()
        with self.assertRaises(CraftingError):
            engine.craft(r, inv, probe)
        # 关键:wood 已被扣 → 应补偿回去(回到 5)
        self.assertEqual(inv.items.get("wood"), 5)
        # pickaxe 也不应被加入
        self.assertEqual(inv.items.get("pickaxe", 0), 0)

    def test_craft_uses_failing_inventory_raises_immediately(self):
        inv = FailingInventoryView()
        probe = _probe({StationType.WORKBENCH})
        r = _book().find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        with self.assertRaises(CraftingError):
            engine.craft(r, inv, probe)


# ==================== 性能测试 ====================

class TestCraftingPerformance(unittest.TestCase):
    """M2.9 验收 ③:合成 ≤ 400ms;我们目标 < 50ms(8x 余量)。"""

    def test_single_craft_under_50ms(self):
        """单次合成 1000 次, p99 < 50ms。"""
        book = _book()
        inv = _inv({"wood": 3})
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()

        # Warm up
        for _ in range(10):
            engine.craft(r, _inv({"wood": 3}), probe)

        timings = []
        for _ in range(1000):
            inv = _inv({"wood": 3})  # 每次重置
            t0 = time.perf_counter()
            engine.craft(r, inv, probe)
            t1 = time.perf_counter()
            timings.append((t1 - t0) * 1000)  # ms
        timings.sort()
        p50 = timings[500]
        p99 = timings[990]
        # 断言:中位数 < 5ms,p99 < 50ms(预算 400ms 的 12.5%)
        self.assertLess(p50, 5, f"p50={p50:.3f}ms 应 < 5ms")
        self.assertLess(p99, 50, f"p99={p99:.3f}ms 应 < 50ms")

    def test_check_all_30_recipes_under_50ms(self):
        """30 配方全表 check, p99 < 50ms(验收 ②④ 模拟:UI 每次刷新要全表 re-check)。"""
        book = _book()
        inv = _inv({"wood": 100, "stone": 100, "flint": 100, "rope": 100, "grass": 100})
        probe = _probe({StationType.WORKBENCH, StationType.COOKPOT})
        engine = CraftingEngine()
        recipes = book.all()

        # Warm up
        for _ in range(5):
            for r in recipes:
                engine.check_can_craft(r, inv, probe)

        timings = []
        for _ in range(200):
            t0 = time.perf_counter()
            for r in recipes:
                engine.check_can_craft(r, inv, probe)
            t1 = time.perf_counter()
            timings.append((t1 - t0) * 1000)
        timings.sort()
        p99 = timings[198]  # 200 取 p99 ≈ 198
        # 200 次内 34 配方全表 re-check,p99 < 50ms
        self.assertLess(p99, 50, f"34 配方全表 p99={p99:.3f}ms 应 < 50ms")

    def test_craft_with_large_inventory_under_50ms(self):
        """50 库存物品,合成 p99 < 50ms。"""
        inv = _inv({f"item_{i}": 5 for i in range(50)})
        inv.add("wood", 10)
        inv.add("flint", 10)
        probe = _probe({StationType.WORKBENCH})
        r = _book().find_by_id("craft.tool.axe")
        engine = CraftingEngine()

        timings = []
        for _ in range(1000):
            fresh = _inv({f"item_{i}": 5 for i in range(50)})
            fresh.add("wood", 10)
            fresh.add("flint", 10)
            t0 = time.perf_counter()
            engine.craft(r, fresh, probe)
            t1 = time.perf_counter()
            timings.append((t1 - t0) * 1000)
        timings.sort()
        p99 = timings[990]
        self.assertLess(p99, 50, f"50 库存合成 p99={p99:.3f}ms 应 < 50ms")


# ==================== UI 状态测试 ====================

class TestGetUIState(unittest.TestCase):
    """M2.9 验收 ② + ④:缺料标红 / 无工作台灰显。"""

    def test_ui_state_full_materials_with_station(self):
        book = _book()
        inv = _inv({"wood": 3})
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        state = engine.get_ui_state(r, inv, probe)
        self.assertTrue(state["can_craft_now"])
        self.assertTrue(state["craftable_button_enabled"])
        self.assertEqual(state["missing_materials"], [])
        # 与 GDScript 端 SEMANTICS.md 对齐:None 也用 "" 表示
        self.assertEqual(state["blocked_reason"], "")
        self.assertEqual(state["station_required"], "workbench")

    def test_ui_state_missing_materials(self):
        book = _book()
        inv = _inv({})  # 库存空
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        state = engine.get_ui_state(r, inv, probe)
        self.assertFalse(state["can_craft_now"])
        self.assertFalse(state["craftable_button_enabled"])
        self.assertEqual(len(state["missing_materials"]), 1)
        miss = state["missing_materials"][0]
        self.assertEqual(miss["item_id"], "wood")
        self.assertEqual(miss["needed"], 3)
        self.assertEqual(miss["have"], 0)
        # 缺料是中文标红文案(给 UI 用)
        self.assertIn(miss["label"], ("wood", "木材"))  # 接受英文 id 或中文

    def test_ui_state_no_workbench_button_disabled(self):
        """M2.9 验收 ④:无工作台时配方灰显。"""
        book = _book()
        inv = _inv({"wood": 5})  # 材料够
        probe = _probe()  # 无工作台
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        state = engine.get_ui_state(r, inv, probe)
        self.assertFalse(state["can_craft_now"])
        self.assertFalse(state["craftable_button_enabled"])
        # 缺料列表为空(材料其实够)
        self.assertEqual(state["missing_materials"], [])
        # blocked_reason 是中文
        self.assertEqual(state["blocked_reason"], "需要工作台")
        # 灰显提示:UI 端根据 craftable_button_enabled 决定是否禁用按钮
        self.assertFalse(state["craftable_button_enabled"])

    def test_ui_state_no_cookpot_button_disabled(self):
        book = _book()
        inv = _inv({"berries": 5, "wood": 2})
        probe = _probe()  # 无烹饪锅
        r = book.find_by_id("craft.food.cooked_berries")
        engine = CraftingEngine()
        state = engine.get_ui_state(r, inv, probe)
        self.assertFalse(state["can_craft_now"])
        self.assertEqual(state["blocked_reason"], "需要烹饪锅")

    def test_ui_state_no_station_required_still_craftable(self):
        book = _book()
        inv = _inv({"wood": 3, "grass": 2})
        probe = _probe()  # 无工作站
        r = book.find_by_id("craft.building.campfire")  # NONE
        engine = CraftingEngine()
        state = engine.get_ui_state(r, inv, probe)
        self.assertTrue(state["can_craft_now"])
        self.assertTrue(state["craftable_button_enabled"])
        self.assertEqual(state["station_required"], "none")
        # 与 GDScript 端 SEMANTICS.md 对齐
        self.assertEqual(state["blocked_reason"], "")

    def test_ui_state_missing_uses_ingredient_label(self):
        """缺料显示中文 label(给 UI 用)。"""
        book = _book()
        inv = _inv({})
        probe = _probe({StationType.WORKBENCH})
        r = book.find_by_id("craft.tool.axe")
        engine = CraftingEngine()
        state = engine.get_ui_state(r, inv, probe)
        miss = state["missing_materials"][0]
        # 缺料字段一定含 item_id / needed / have;label 是可读名(中英都可)
        self.assertIn("item_id", miss)
        self.assertIn("needed", miss)
        self.assertIn("have", miss)
        self.assertIn("label", miss)


if __name__ == "__main__":
    unittest.main()
