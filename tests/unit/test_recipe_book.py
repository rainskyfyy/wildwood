"""
Wildwood M2.9 — RecipeBook 单元测试

覆盖:
  - 配方数量 >= 30(任务验收 ①)
  - 类别覆盖:工具 >= 8,装备 >= 6,食物 >= 10,建筑 >= 6
  - 命名规范:每个 id 匹配 craft.<category>.<name>
  - id 唯一性
  - by_category / by_station / find_by_id / all 查询 API
  - 内置 item_id 集合(给 M2.2 集成的契约)
"""
from __future__ import annotations

import re
import unittest

from core.abstract.crafting.recipe_book import RecipeBook
from core.abstract.crafting.schemas import (
    CURRENT_RECIPE_SCHEMA_VERSION,
    Ingredient,
    Recipe,
    RecipeCategory,
    StationType,
)


_RECIPE_ID_RE = re.compile(r"^craft\.(tool|equipment|food|building)\.[a-z][a-z0-9_]*$")


class TestRecipeBookBasics(unittest.TestCase):
    def setUp(self) -> None:
        self.book = RecipeBook.default_book()

    def test_default_book_has_at_least_30_recipes(self):
        """M2.9 验收 ①:30+ 配方可合成。"""
        self.assertGreaterEqual(
            len(self.book.all()), 30,
            f"默认配方表应 >= 30,实际 {len(self.book.all())}",
        )

    def test_recipes_have_correct_category_coverage(self):
        """类别覆盖(防止堆 30 个同类别配方):工具 >= 8,装备 >= 6,食物 >= 10,建筑 >= 6。"""
        tools = self.book.by_category(RecipeCategory.TOOL)
        equip = self.book.by_category(RecipeCategory.EQUIPMENT)
        food = self.book.by_category(RecipeCategory.FOOD)
        build = self.book.by_category(RecipeCategory.BUILDING)

        self.assertGreaterEqual(len(tools), 8, f"工具配方应 >= 8,实际 {len(tools)}")
        self.assertGreaterEqual(len(equip), 6, f"装备配方应 >= 6,实际 {len(equip)}")
        self.assertGreaterEqual(len(food), 10, f"食物配方应 >= 10,实际 {len(food)}")
        self.assertGreaterEqual(len(build), 6, f"建筑配方应 >= 6,实际 {len(build)}")

    def test_all_recipe_ids_match_naming_convention(self):
        for r in self.book.all():
            self.assertRegex(
                r.id, _RECIPE_ID_RE.pattern,
                f"配方 id {r.id!r} 不符合命名规范 craft.<cat>.<name>",
            )

    def test_recipe_id_prefix_matches_category(self):
        for r in self.book.all():
            cat_slug = r.category.value
            self.assertTrue(
                r.id.startswith(f"craft.{cat_slug}."),
                f"配方 {r.id} category={cat_slug} 不一致",
            )

    def test_recipe_ids_are_unique(self):
        ids = [r.id for r in self.book.all()]
        self.assertEqual(len(ids), len(set(ids)), f"配方 id 有重复: {ids}")

    def test_all_recipes_carry_current_schema_version(self):
        for r in self.book.all():
            self.assertEqual(r.schema_version, CURRENT_RECIPE_SCHEMA_VERSION)

    def test_recipes_cover_station_types(self):
        stations = {r.station for r in self.book.all()}
        # 必须覆盖 NONE / WORKBENCH / COOKPOT 三种(无门槛 + 工作台 + 烹饪锅)
        self.assertIn(StationType.NONE, stations, "缺少 NONE 配方(徒手合成)")
        self.assertIn(StationType.WORKBENCH, stations, "缺少 WORKBENCH 配方")
        self.assertIn(StationType.COOKPOT, stations, "缺少 COOKPOT 配方")

    def test_at_least_one_recipe_per_required_station(self):
        """每个 station 至少 2 个配方(避免单一)。"""
        from collections import Counter
        counter = Counter(r.station for r in self.book.all())
        for st in (StationType.NONE, StationType.WORKBENCH, StationType.COOKPOT):
            self.assertGreaterEqual(
                counter[st], 2,
                f"station={st} 配方应 >= 2,实际 {counter[st]}",
            )


class TestRecipeBookQueries(unittest.TestCase):
    def setUp(self) -> None:
        self.book = RecipeBook.default_book()

    def test_find_by_id_existing(self):
        r = self.book.find_by_id("craft.tool.axe")
        self.assertIsNotNone(r)
        self.assertEqual(r.id, "craft.tool.axe")

    def test_find_by_id_missing_returns_none(self):
        self.assertIsNone(self.book.find_by_id("craft.tool.nonexistent"))

    def test_by_category_returns_only_matching(self):
        foods = self.book.by_category(RecipeCategory.FOOD)
        for r in foods:
            self.assertEqual(r.category, RecipeCategory.FOOD)
        # 食物中所有 station 应该是 COOKPOT(食物需要烹饪)
        for r in foods:
            self.assertEqual(
                r.station, StationType.COOKPOT,
                f"食物配方 {r.id} 应在 COOKPOT,实际 {r.station}",
            )

    def test_by_station_returns_only_matching(self):
        wb = self.book.by_station(StationType.WORKBENCH)
        for r in wb:
            self.assertEqual(r.station, StationType.WORKBENCH)
        # 工作台配方应在 装备/工具/建筑 中(无 FOOD)
        for r in wb:
            self.assertNotEqual(r.category, RecipeCategory.FOOD)

    def test_all_recipes_have_valid_ingredients(self):
        for r in self.book.all():
            for ing in r.ingredients:
                self.assertIsInstance(ing, Ingredient)
                self.assertGreater(ing.count, 0)
                self.assertTrue(ing.item_id.strip())

    def test_all_recipes_have_valid_result(self):
        for r in self.book.all():
            self.assertTrue(r.result_item_id.strip())
            self.assertGreater(r.result_count, 0)


class TestRecipeBookCustomExtension(unittest.TestCase):
    """允许开发期 / Mod 注入自定义配方。"""

    def test_custom_book_with_additional_recipe(self):
        custom = Recipe(
            id="craft.tool.wooden_sword",
            name="木剑",
            category=RecipeCategory.TOOL,
            station=StationType.WORKBENCH,
            ingredients=(Ingredient(item_id="wood", count=4),),
            result_item_id="wooden_sword",
            result_count=1,
        )
        book = RecipeBook.default_book().with_recipe(custom)
        self.assertEqual(len(book.all()), 35)  # 34 + 1
        self.assertIsNotNone(book.find_by_id("craft.tool.wooden_sword"))

    def test_duplicate_recipe_raises(self):
        from core.abstract.crafting.recipe_book import DuplicateRecipeError
        axe = RecipeBook.default_book().find_by_id("craft.tool.axe")
        with self.assertRaises(DuplicateRecipeError):
            RecipeBook.default_book().with_recipe(axe)


if __name__ == "__main__":
    unittest.main()
