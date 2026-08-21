"""
Wildwood M2.9 — CraftingEngine

核心合成逻辑(纯函数风格,无引擎依赖):
  - check_can_craft:纯检查(不动库存)
  - craft:扣材料 + 加产出(配补偿回滚)
  - get_ui_state:UI 状态计算(中文文案 / 缺料详情 / 工作站门槛)

性能目标(验收 ③):
  - 单次合成 < 50ms(预算 400ms,留 8x 余量)
  - 30+ 配方全表 re-check < 50ms

回滚策略:
  - 顺序 consume 每个 ingredient
  - 任意一个失败 → 补偿:把已扣的 add 回去
  - add 也可能失败(背包满)→ 已 add 的不回滚(罕见;上层应对)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .inventory_view import InventoryView
from .schemas import (
    CraftingResult,
    Ingredient,
    Recipe,
    StationType,
)
from .station_probe import StationProbe


# === 异常 ===

class CraftingError(Exception):
    """合成失败(材料不足 / 工作站缺失 / 配方不存在 / 库存异常)。"""


# === 检查结果 ===

@dataclass(frozen=True)
class CheckResult:
    """check_can_craft 的返回值。"""
    can_craft: bool
    missing: Tuple[Ingredient, ...]
    blocked: Optional[str]  # "requires_workbench" / "requires_cookpot" / None
    station_required: StationType


# === UI 文案(中英 item_id → 中文 label) ===

_ITEM_LABELS: Dict[str, str] = {
    "wood": "木材",
    "stone": "石头",
    "flint": "燧石",
    "grass": "草",
    "rope": "绳子",
    "berries": "浆果",
    "mushroom": "蘑菇",
    "meat": "肉",
    "fish": "鱼",
    "honey": "蜂蜜",
    "ice": "冰",
    "fur": "毛皮",
    "leather": "皮革",
    # 产出物
    "axe": "斧头",
    "pickaxe": "镐",
    "shovel": "铲子",
    "hoe": "锄头",
    "spear": "长矛",
    "knife": "小刀",
    "hammer": "锤子",
    "torch": "火把",
    "wooden_armor": "木甲",
    "stone_armor": "石甲",
    "backpack": "背包",
    "helmet_log": "木盔",
    "warm_coat": "暖外套",
    "boots": "靴子",
    "gloves": "手套",
    "cooked_berries": "烤浆果",
    "cooked_mushroom": "烤蘑菇",
    "meatballs": "肉丸",
    "steak": "烤肉",
    "stuffed_mushroom": "酿蘑菇",
    "fish_stew": "鱼汤",
    "honey_pie": "蜜饼",
    "tea": "茶",
    "dried_meat": "肉干",
    "veggie_soup": "菜汤",
    "ice_cream": "冰淇淋",
    "campfire": "营火",
    "chest": "箱子",
    "workbench": "工作台",
    "cookpot": "烹饪锅",
    "tent": "帐篷",
    "fire_pit": "火坑",
    "torch_stand": "火把架",
}


def _label(item_id: str) -> str:
    """item_id → 中文 label;未知名 → 原 id(给 UI 当 fallback)。"""
    return _ITEM_LABELS.get(item_id, item_id)


# === 工作站门槛判定 ===

def _station_block_reason(station: StationType, probe: StationProbe) -> Optional[str]:
    """返 None = 满足;非 None = 不满足的原因(英文 key,UI 端翻译)。"""
    if station == StationType.NONE:
        return None
    if probe.has_station(station):
        return None
    return {
        StationType.WORKBENCH: "requires_workbench",
        StationType.COOKPOT: "requires_cookpot",
    }[station]


_BLOCK_REASON_ZH: Dict[str, str] = {
    "requires_workbench": "需要工作台",
    "requires_cookpot": "需要烹饪锅",
}


# === CraftingEngine ===

class CraftingEngine:
    """
    合成引擎(无状态,可全局共享 1 个实例)。
    """

    def check_can_craft(
        self,
        recipe: Recipe,
        inventory: InventoryView,
        station: StationProbe,
    ) -> CheckResult:
        """
        检查是否可合成(纯查询,不动库存)。
        配方不在 RecipeBook 内的合法性由调用方负责(本方法不校验 recipe.id 存在);
        不识别的 Recipe(无 ingredients / 异常结构)应抛 ValueError。
        """
        if not isinstance(recipe, Recipe):
            raise ValueError(f"recipe 必须是 Recipe 实例,实际 {type(recipe).__name__}")

        # 1. 工作站门槛
        blocked = _station_block_reason(recipe.station, station)

        # 2. 缺料检测
        missing: List[Ingredient] = []
        for ing in recipe.ingredients:
            have = inventory.get_count(ing.item_id)
            if have < ing.count:
                missing.append(
                    Ingredient(
                        item_id=ing.item_id,
                        count=ing.count - have,  # 缺的数量
                    )
                )

        return CheckResult(
            can_craft=blocked is None and len(missing) == 0,
            missing=tuple(missing),
            blocked=blocked,
            station_required=recipe.station,
        )

    def craft(
        self,
        recipe: Recipe,
        inventory: InventoryView,
        station: StationProbe,
    ) -> CraftingResult:
        """
        合成:扣材料 + 加产出。
        不可合成 → 抛 CraftingError(check 失败)。
        部分 consume 失败 → 补偿回滚(把已扣的 add 回去)+ 抛 CraftingError。
        """
        check = self.check_can_craft(recipe, inventory, station)
        if not check.can_craft:
            reasons: List[str] = []
            if check.blocked:
                reasons.append(f"station:{check.blocked}")
            if check.missing:
                reasons.append(
                    "missing:" + ",".join(f"{i.item_id}x{i.count}" for i in check.missing)
                )
            raise CraftingError(
                f"无法合成 {recipe.id} ({recipe.name}): " + "; ".join(reasons)
            )

        # 顺序 consume + 补偿
        consumed: List[Ingredient] = []
        for ing in recipe.ingredients:
            ok = inventory.consume(ing)
            if not ok:
                # 补偿:把已扣的 add 回去
                for prev in consumed:
                    inventory.add(prev.item_id, prev.count)
                raise CraftingError(
                    f"合成 {recipe.id} 中途失败:扣 {ing.item_id}x{ing.count} 失败,已回滚"
                )
            consumed.append(ing)

        # 加产出
        result_ing = Ingredient(item_id=recipe.result_item_id, count=recipe.result_count)
        ok = inventory.add(result_ing.item_id, result_ing.count)
        if not ok:
            # 罕见:背包满。已扣的应回滚(避免材料丢失)
            for prev in consumed:
                inventory.add(prev.item_id, prev.count)
            raise CraftingError(
                f"合成 {recipe.id} 失败:加 {result_ing.item_id}x{result_ing.count} 失败,已回滚"
            )

        return CraftingResult(
            recipe_id=recipe.id,
            produced=(result_ing,),
            consumed=tuple(consumed),
        )

    def get_ui_state(
        self,
        recipe: Recipe,
        inventory: InventoryView,
        station: StationProbe,
    ) -> dict:
        """
        UI 状态计算(给 HUD/合成面板用)。
        返回 dict 而非 dataclass 是为了 GDScript 端直接映射。
        """
        check = self.check_can_craft(recipe, inventory, station)
        missing_payload: List[dict] = []
        for ing in check.missing:
            have = inventory.get_count(ing.item_id)
            # ing.count = 缺的数量;needed = 实际配方要求 = have + ing.count
            # 但 check 内部没保留"配方要求",所以从 recipe 重算
            needed = next(
                (n.count for n in recipe.ingredients if n.item_id == ing.item_id),
                ing.count,
            )
            missing_payload.append({
                "item_id": ing.item_id,
                "label": _label(ing.item_id),
                "needed": needed,
                "have": have,
                "missing": ing.count,  # 缺多少(冗余便于 UI 直接渲染)
            })

        blocked_zh = _BLOCK_REASON_ZH.get(check.blocked) if check.blocked else None

        return {
            "recipe_id": recipe.id,
            "can_craft_now": check.can_craft,
            "craftable_button_enabled": check.can_craft,  # 缺料/无工作站 → 按钮禁用(灰显)
            "missing_materials": missing_payload,
            "blocked_reason": blocked_zh,  # 中文物文
            "station_required": recipe.station.value,
        }
