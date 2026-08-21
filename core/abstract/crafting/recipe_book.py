"""
Wildwood M2.9 — RecipeBook

34 个内置配方(覆盖工具/装备/食物/建筑四大类),支持:
  - all() / find_by_id(rid) / by_category(cat) / by_station(st) 查询
  - default_book() 工厂:返回带 34 配方的实例
  - with_recipe(r) 扩展:支持开发期 / Mod 注入自定义配方

设计原则:
  - 数据驱动:配方元组是不可变的,可被多份 RecipeBook 共享
  - id 唯一性:RecipeBook 构造时强制校验
  - 不耦合引擎层:所有数据从 schemas.py 来
"""
from __future__ import annotations

from typing import Iterable, List, Optional, Tuple

from .schemas import Ingredient, Recipe, RecipeCategory, StationType


class DuplicateRecipeError(ValueError):
    """重复的 Recipe id。"""


# === 34 内置配方(详细说明见 docs/plans/2026-08-20-m2.9-crafting.md Task 2) ===

def _r(id, name, cat, st, ingredients, result_item_id, result_count=1):
    return Recipe(
        id=id,
        name=name,
        category=cat,
        station=st,
        ingredients=tuple(Ingredient(item_id=i, count=c) for i, c in ingredients),
        result_item_id=result_item_id,
        result_count=result_count,
    )


_DEFAULT_RECIPES: Tuple[Recipe, ...] = (
    # ============ 工具 TOOL (9 个) ============
    _r("craft.tool.axe", "斧头", RecipeCategory.TOOL, StationType.WORKBENCH,
       (("wood", 3),), "axe"),
    _r("craft.tool.pickaxe", "镐", RecipeCategory.TOOL, StationType.WORKBENCH,
       (("wood", 3), ("flint", 2)), "pickaxe"),
    _r("craft.tool.shovel", "铲子", RecipeCategory.TOOL, StationType.WORKBENCH,
       (("wood", 2), ("flint", 2)), "shovel"),
    _r("craft.tool.hoe", "锄头", RecipeCategory.TOOL, StationType.WORKBENCH,
       (("wood", 2), ("flint", 2)), "hoe"),
    _r("craft.tool.spear", "长矛", RecipeCategory.TOOL, StationType.NONE,
       (("wood", 2), ("flint", 2)), "spear"),
    _r("craft.tool.knife", "小刀", RecipeCategory.TOOL, StationType.WORKBENCH,
       (("wood", 1), ("flint", 1)), "knife"),
    _r("craft.tool.hammer", "锤子", RecipeCategory.TOOL, StationType.WORKBENCH,
       (("wood", 3), ("stone", 2)), "hammer"),
    _r("craft.tool.torch", "火把", RecipeCategory.TOOL, StationType.NONE,
       (("wood", 1), ("grass", 1)), "torch"),
    _r("craft.tool.rope", "绳子", RecipeCategory.TOOL, StationType.NONE,
       (("grass", 3),), "rope"),

    # ============ 装备 EQUIPMENT (7 个) ============
    _r("craft.equipment.wooden_armor", "木甲", RecipeCategory.EQUIPMENT, StationType.WORKBENCH,
       (("wood", 8), ("rope", 4)), "wooden_armor"),
    _r("craft.equipment.stone_armor", "石甲", RecipeCategory.EQUIPMENT, StationType.WORKBENCH,
       (("stone", 6), ("rope", 4)), "stone_armor"),
    _r("craft.equipment.backpack", "背包", RecipeCategory.EQUIPMENT, StationType.WORKBENCH,
       (("rope", 4), ("grass", 4)), "backpack"),
    _r("craft.equipment.helmet_log", "木盔", RecipeCategory.EQUIPMENT, StationType.WORKBENCH,
       (("wood", 4), ("rope", 2)), "helmet_log"),
    _r("craft.equipment.warm_coat", "暖外套", RecipeCategory.EQUIPMENT, StationType.WORKBENCH,
       (("fur", 6), ("rope", 4)), "warm_coat"),
    _r("craft.equipment.boots", "靴子", RecipeCategory.EQUIPMENT, StationType.WORKBENCH,
       (("leather", 4), ("rope", 2)), "boots"),
    _r("craft.equipment.gloves", "手套", RecipeCategory.EQUIPMENT, StationType.WORKBENCH,
       (("leather", 3), ("rope", 1)), "gloves"),

    # ============ 食物 FOOD (11 个) ============
    _r("craft.food.cooked_berries", "烤浆果", RecipeCategory.FOOD, StationType.COOKPOT,
       (("berries", 3), ("wood", 1)), "cooked_berries"),
    _r("craft.food.cooked_mushroom", "烤蘑菇", RecipeCategory.FOOD, StationType.COOKPOT,
       (("mushroom", 2), ("wood", 1)), "cooked_mushroom"),
    _r("craft.food.meatballs", "肉丸", RecipeCategory.FOOD, StationType.COOKPOT,
       (("meat", 1), ("berries", 3)), "meatballs"),
    _r("craft.food.steak", "烤肉", RecipeCategory.FOOD, StationType.COOKPOT,
       (("meat", 1), ("wood", 1)), "steak"),
    _r("craft.food.stuffed_mushroom", "酿蘑菇", RecipeCategory.FOOD, StationType.COOKPOT,
       (("mushroom", 2), ("meat", 1)), "stuffed_mushroom"),
    _r("craft.food.fish_stew", "鱼汤", RecipeCategory.FOOD, StationType.COOKPOT,
       (("fish", 1), ("mushroom", 1)), "fish_stew"),
    _r("craft.food.honey_pie", "蜜饼", RecipeCategory.FOOD, StationType.COOKPOT,
       (("honey", 2), ("wood", 1)), "honey_pie"),
    _r("craft.food.tea", "茶", RecipeCategory.FOOD, StationType.COOKPOT,
       (("grass", 1), ("wood", 1)), "tea"),
    _r("craft.food.dried_meat", "肉干", RecipeCategory.FOOD, StationType.COOKPOT,
       (("meat", 1), ("wood", 1)), "dried_meat"),
    _r("craft.food.veggie_soup", "菜汤", RecipeCategory.FOOD, StationType.COOKPOT,
       (("berries", 2), ("mushroom", 1)), "veggie_soup"),
    _r("craft.food.ice_cream", "冰淇淋", RecipeCategory.FOOD, StationType.COOKPOT,
       (("ice", 1), ("honey", 1)), "ice_cream"),

    # ============ 建筑 BUILDING (7 个) ============
    _r("craft.building.campfire", "营火", RecipeCategory.BUILDING, StationType.NONE,
       (("wood", 3), ("grass", 2)), "campfire"),
    _r("craft.building.chest", "箱子", RecipeCategory.BUILDING, StationType.WORKBENCH,
       (("wood", 4),), "chest"),
    _r("craft.building.workbench", "工作台", RecipeCategory.BUILDING, StationType.NONE,
       (("wood", 4), ("flint", 2)), "workbench"),
    _r("craft.building.cookpot", "烹饪锅", RecipeCategory.BUILDING, StationType.NONE,
       (("stone", 3), ("wood", 2), ("rope", 1)), "cookpot"),
    _r("craft.building.tent", "帐篷", RecipeCategory.BUILDING, StationType.WORKBENCH,
       (("wood", 6), ("rope", 4)), "tent"),
    _r("craft.building.fire_pit", "火坑", RecipeCategory.BUILDING, StationType.NONE,
       (("stone", 6), ("wood", 4)), "fire_pit"),
    _r("craft.building.torch_stand", "火把架", RecipeCategory.BUILDING, StationType.NONE,
       (("wood", 2), ("grass", 1)), "torch_stand"),
)

# 防御性断言:在模块加载时校验 34 配方 + 命名规范 + id 唯一性 + 类别前缀一致。
# 失败 = RecipeBook 启动即崩,提醒开发者修复。
assert len(_DEFAULT_RECIPES) >= 30, f"内置配方应 >= 30,实际 {len(_DEFAULT_RECIPES)}"

_seen_ids: set = set()
for _r_obj in _DEFAULT_RECIPES:
    assert _r_obj.id not in _seen_ids, f"重复 id: {_r_obj.id}"
    _seen_ids.add(_r_obj.id)
    _cat_slug = _r_obj.category.value
    assert _r_obj.id.startswith(f"craft.{_cat_slug}."), (
        f"id {_r_obj.id} 与 category {_r_obj.category} 不一致"
    )


class RecipeBook:
    """配方集合 + 查询 API。"""

    def __init__(self, recipes: Iterable[Recipe]):
        self._by_id: dict[str, Recipe] = {}
        for r in recipes:
            if r.id in self._by_id:
                raise DuplicateRecipeError(f"重复 recipe id: {r.id}")
            self._by_id[r.id] = r

    @classmethod
    def default_book(cls) -> "RecipeBook":
        """返回带 34 内置配方的实例。"""
        return cls(_DEFAULT_RECIPES)

    def with_recipe(self, recipe: Recipe) -> "RecipeBook":
        """返回新实例,追加 1 个配方(原实例不可变)。"""
        return RecipeBook(list(self._by_id.values()) + [recipe])

    def all(self) -> List[Recipe]:
        """所有配方列表(按 id 排序,便于测试确定性)。"""
        return [self._by_id[k] for k in sorted(self._by_id.keys())]

    def find_by_id(self, recipe_id: str) -> Optional[Recipe]:
        """按 id 查;未找到返 None。"""
        return self._by_id.get(recipe_id)

    def by_category(self, category: RecipeCategory) -> List[Recipe]:
        """按类别过滤(返回列表,按 id 排序)。"""
        return sorted(
            (r for r in self._by_id.values() if r.category == category),
            key=lambda r: r.id,
        )

    def by_station(self, station: StationType) -> List[Recipe]:
        """按 station 过滤(返回列表,按 id 排序)。"""
        return sorted(
            (r for r in self._by_id.values() if r.station == station),
            key=lambda r: r.id,
        )

    def known_result_item_ids(self) -> set:
        """配方产出的所有 item_id 集合(给 M2.2 集成的契约 — M2.2 采集系统应至少能产出这些)。"""
        return {r.result_item_id for r in self._by_id.values()}

    def known_ingredient_item_ids(self) -> set:
        """配方的所有材料 item_id 集合。"""
        out: set = set()
        for r in self._by_id.values():
            for ing in r.ingredients:
                out.add(ing.item_id)
        return out

    def __len__(self) -> int:
        return len(self._by_id)
