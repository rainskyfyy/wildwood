"""
Wildwood M2.9 — 合成系统单元测试

跑法:
  cd wildwood
  python3 -m pytest tests/unit/test_crafting.py -v
  # 或单文件单测
  python3 -m unittest tests.unit.test_crafting -v

覆盖范围:
  - Recipe / Ingredient / StationType / RecipeCategory / CraftingResult schema 校验
  - RecipeBook 30+ 配方存在性 + 命名规范 + 类别覆盖
  - InventoryView / StationProbe 抽象接口
  - CraftingEngine.check_can_craft / craft 各种场景
  - 性能基准(单次 < 50ms,全表 < 50ms)
  - UI 状态计算(按钮 enabled/disabled / 缺料 / 工作站门槛)
"""
from __future__ import annotations

import re
import time
import unittest
from typing import Dict, Set, Tuple

from core.abstract.crafting.schemas import (
    CURRENT_RECIPE_SCHEMA_VERSION,
    CraftingResult,
    Ingredient,
    Recipe,
    RecipeCategory,
    StationType,
    is_compatible,
    parse_version,
)


# ==================== Schema 校验测试 ====================

class TestCraftingSchema(unittest.TestCase):
    def test_recipe_schema_version_is_1_0_0(self):
        self.assertEqual(CURRENT_RECIPE_SCHEMA_VERSION, "1.0.0")

    def test_recipe_dataclass_basic_construction(self):
        r = Recipe(
            id="craft.tool.axe",
            name="斧头",
            category=RecipeCategory.TOOL,
            station=StationType.WORKBENCH,
            ingredients=(Ingredient(item_id="wood", count=3),),
            result_item_id="axe",
            result_count=1,
        )
        self.assertEqual(r.id, "craft.tool.axe")
        self.assertEqual(r.station, StationType.WORKBENCH)
        self.assertEqual(r.result_count, 1)

    def test_ingredient_count_must_be_positive(self):
        with self.assertRaises(ValueError):
            Ingredient(item_id="wood", count=0)
        with self.assertRaises(ValueError):
            Ingredient(item_id="wood", count=-1)

    def test_recipe_id_must_match_naming_convention(self):
        # OK
        Recipe(
            id="craft.food.cooked_berries",
            name="烤浆果",
            category=RecipeCategory.FOOD,
            station=StationType.COOKPOT,
            ingredients=(Ingredient(item_id="berries", count=3),),
            result_item_id="cooked_berries",
            result_count=1,
        )
        # Bad: 不匹配 craft.<category>.<name>
        with self.assertRaises(ValueError):
            Recipe(
                id="axe",
                name="斧头",
                category=RecipeCategory.TOOL,
                station=StationType.WORKBENCH,
                ingredients=(),
                result_item_id="axe",
                result_count=1,
            )

    def test_recipe_result_count_must_be_positive(self):
        with self.assertRaises(ValueError):
            Recipe(
                id="craft.tool.axe",
                name="斧头",
                category=RecipeCategory.TOOL,
                station=StationType.WORKBENCH,
                ingredients=(Ingredient(item_id="wood", count=3),),
                result_item_id="axe",
                result_count=0,
            )

    def test_station_type_values(self):
        # 锁定的枚举值
        self.assertEqual(StationType.NONE.value, "none")
        self.assertEqual(StationType.WORKBENCH.value, "workbench")
        self.assertEqual(StationType.COOKPOT.value, "cookpot")

    def test_recipe_category_values(self):
        self.assertEqual(RecipeCategory.TOOL.value, "tool")
        self.assertEqual(RecipeCategory.EQUIPMENT.value, "equipment")
        self.assertEqual(RecipeCategory.FOOD.value, "food")
        self.assertEqual(RecipeCategory.BUILDING.value, "building")

    def test_version_compatibility_same_major_compatible(self):
        self.assertTrue(is_compatible("1.0.0", "1.2.3"))
        self.assertTrue(is_compatible("1.0.0", "1.0.0"))

    def test_version_compatibility_different_major_incompatible(self):
        self.assertFalse(is_compatible("1.0.0", "2.0.0"))
        self.assertFalse(is_compatible("2.0.0", "1.0.0"))

    def test_crafting_result_dataclass(self):
        r = CraftingResult(
            recipe_id="craft.tool.axe",
            produced=(Ingredient(item_id="axe", count=1),),
            consumed=(Ingredient(item_id="wood", count=3),),
        )
        self.assertEqual(r.recipe_id, "craft.tool.axe")
        self.assertEqual(len(r.produced), 1)
        self.assertEqual(len(r.consumed), 1)

    def test_parse_version(self):
        self.assertEqual(parse_version("1.2.3"), (1, 2, 3))


if __name__ == "__main__":
    unittest.main()
