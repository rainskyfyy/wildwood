"""
M2.9 端到端 Demo 验收测试 — 模拟 crafting_demo.gd 的全用户操作流程

覆盖 M2.9 任务 4 项验收标准:
  ① 30+ 配方可合成
  ② 材料全有按钮可点(can_craft)
  ③ 合成 ≤ 400ms 反馈
  ④ 无工作台时配方灰显(can_craft=False + blocked_reason)

注:沙箱无 Godot binary,无法实际跑 crafting_demo.gd;
   这里用 Python 端 CraftingEngine(与 GDScript 端语义对齐,见 SEMANTICS.md)
   模拟 demo 的 UI 状态计算,确保所有验收点在引擎层通过。
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from core.abstract.crafting.crafting_engine import CraftingEngine
from core.abstract.crafting.recipe_book import RecipeBook
from core.abstract.crafting.schemas import (
    Ingredient,
    Recipe,
    StationType,
)


class DictInventory:
    """GDScript 端 inventory Dictionary 在 Python 的等价实现(对齐 .gd::apply_craft_result 语义)。"""
    def __init__(self, d=None):
        self._d: dict = dict(d or {})
    def get_count(self, item_id):
        return self._d.get(item_id, 0)
    def consume(self, ingredient: Ingredient) -> bool:
        have = self._d.get(ingredient.item_id, 0)
        if have < ingredient.count:
            return False
        self._d[ingredient.item_id] = have - ingredient.count
        return True
    def add(self, item_id, count) -> bool:
        self._d[item_id] = self._d.get(item_id, 0) + count
        return True
    def snapshot(self):
        return dict(self._d)
    def __getitem__(self, k):
        return self._d.get(k, 0)


class DictStation:
    def __init__(self, d):
        self._d = d
    def has_station(self, station: StationType) -> bool:
        return bool(self._d.get(station.value, False))


# === 验收 ① 30+ 配方可合成 ===

def test_acc01_at_least_30_recipes():
    """验收 ① 30+ 配方可合成。"""
    book = RecipeBook.default_book()
    assert len(book.all()) >= 30, f"仅 {len(book.all())} 配方,< 30"
    print(f"  ✓ 验收 ①: 共 {len(book.all())} 配方(≥30 达标)")


def test_acc01_all_recipes_unique_ids():
    """验收 ① 辅助:配方 id 必须唯一。"""
    book = RecipeBook.default_book()
    ids = [r.id for r in book.all()]
    assert len(ids) == len(set(ids)), f"id 重复:{len(ids)} != {len(set(ids))}"
    print(f"  ✓ 验收 ① 辅助: {len(ids)} id 全部唯一")


def test_acc01_all_recipes_craftable_when_materials_full():
    """验收 ① 辅助:材料 + 工作站齐时,每个配方都能 craft。"""
    book = RecipeBook.default_book()
    inv = DictInventory({
        "wood": 999, "stone": 999, "flint": 999, "grass": 999, "rope": 999,
        "berries": 999, "mushroom": 999, "meat": 999, "fish": 999, "honey": 999,
        "ice": 999, "fur": 999, "leather": 999,
    })
    station = DictStation({"workbench": True, "cookpot": True})
    engine = CraftingEngine()
    for r in book.all():
        result = engine.craft(r, inv, station)
        assert result.recipe_id == r.id, f"{r.id} craft 返 {result.recipe_id}"
        assert len(result.consumed) == len(r.ingredients), f"{r.id} 扣料数量错"
    print(f"  ✓ 验收 ① 辅助: 全部 {len(book.all())} 配方在满材料 + 双工作站下 craft 成功")


# === 验收 ② 材料全有按钮可点 ===

def test_acc02_button_enabled_when_materials_full():
    """验收 ②:材料全有 → can_craft=True → 按钮可点(GDScript 端 craftable_button_enabled=True)。"""
    book = RecipeBook.default_book()
    inv = DictInventory({"wood": 99, "stone": 99, "flint": 99, "grass": 99, "rope": 99,
                          "berries": 99, "mushroom": 99, "meat": 99, "fish": 99, "honey": 99,
                          "ice": 99, "fur": 99, "leather": 99})
    station = DictStation({"workbench": True, "cookpot": True})
    engine = CraftingEngine()
    for r in book.all():
        ui = engine.get_ui_state(r, inv, station)
        assert ui["can_craft_now"] is True, f"{r.id} 材料全有却 can_craft_now=False"
        assert ui["craftable_button_enabled"] is True, f"{r.id} 按钮没启用"
        assert ui["missing_materials"] == [], f"{r.id} 缺料 list 非空"
    print(f"  ✓ 验收 ②: {len(book.all())} 配方全有材料时按钮均可点")


def test_acc02_button_disabled_when_missing_one():
    """验收 ② 辅助:仅缺 1 个 → 按钮禁用 + 缺料 list 标出。"""
    book = RecipeBook.default_book()
    recipe = book.find_by_id("craft.tool.axe")  # 3 wood → axe
    inv_missing = DictInventory({"wood": 2})  # 差 1
    station = DictStation({"workbench": True, "cookpot": True})
    ui = CraftingEngine().get_ui_state(recipe, inv_missing, station)
    assert ui["can_craft_now"] is False
    assert ui["craftable_button_enabled"] is False
    assert len(ui["missing_materials"]) == 1
    m = ui["missing_materials"][0]
    assert m["item_id"] == "wood" and m["missing"] == 1
    assert m["have"] == 2 and m["needed"] == 3
    print(f"  ✓ 验收 ② 辅助: 缺 1 wood → 按钮禁用 + 缺料标出 'wood 2/3'")


# === 验收 ③ 合成 ≤ 400ms 反馈 ===

def test_acc03_single_craft_under_400ms():
    """验收 ③:单次合成 p99 ≤ 400ms(实测 < 1ms,远小于预算)。"""
    book = RecipeBook.default_book()
    inv = DictInventory({"wood": 99, "stone": 99, "flint": 99, "grass": 99, "rope": 99,
                          "berries": 99, "mushroom": 99, "meat": 99, "fish": 99, "honey": 99,
                          "ice": 99, "fur": 99, "leather": 99})
    station = DictStation({"workbench": True, "cookpot": True})
    engine = CraftingEngine()
    # 选 5 个典型配方 × 1000 次循环
    samples = [book.find_by_id(r) for r in [
        "craft.tool.axe", "craft.food.cooked_berries",
        "craft.building.workbench", "craft.equipment.wooden_armor",
        "craft.food.fish_stew",
    ]]
    timings_ms = []
    full_snapshot = dict(inv._d)
    for _ in range(1000):
        for r in samples:
            inv._d = dict(full_snapshot)  # 每次 craft 前重置(避免被扣光)
            t0 = time.perf_counter_ns()
            engine.craft(r, inv, station)
            t1 = time.perf_counter_ns()
            timings_ms.append((t1 - t0) / 1_000_000)
    timings_ms.sort()
    p99 = timings_ms[int(len(timings_ms) * 0.99)]
    assert p99 < 400, f"p99={p99:.2f}ms,超过 400ms 预算"
    print(f"  ✓ 验收 ③: 5000 次合成 p99 = {p99:.3f}ms (预算 400ms)")


def test_acc03_full_recipe_recheck_under_400ms():
    """验收 ③ 辅助:34 配方全表 re-check(每帧) ≤ 400ms。"""
    book = RecipeBook.default_book()
    inv = DictInventory({"wood": 99, "stone": 99, "flint": 99, "grass": 99, "rope": 99,
                          "berries": 99, "mushroom": 99, "meat": 99, "fish": 99, "honey": 99,
                          "ice": 99, "fur": 99, "leather": 99})
    station = DictStation({"workbench": True, "cookpot": True})
    engine = CraftingEngine()
    timings_ms = []
    for _ in range(200):
        t0 = time.perf_counter_ns()
        for r in book.all():
            engine.get_ui_state(r, inv, station)
        t1 = time.perf_counter_ns()
        timings_ms.append((t1 - t0) / 1_000_000)
    timings_ms.sort()
    p99 = timings_ms[int(len(timings_ms) * 0.99)]
    assert p99 < 400, f"34 配方 re-check p99={p99:.2f}ms"
    print(f"  ✓ 验收 ③ 辅助: 34 配方 re-check p99 = {p99:.3f}ms (预算 400ms)")


# === 验收 ④ 无工作台时配方灰显 ===

def test_acc04_no_workbench_grays_workbench_recipes():
    """验收 ④:无工作台 → workbench 配方 can_craft=False + blocked_reason='需要工作台'。"""
    book = RecipeBook.default_book()
    inv = DictInventory({"wood": 99, "stone": 99, "flint": 99, "grass": 99, "rope": 99,
                          "berries": 99, "mushroom": 99, "meat": 99, "fish": 99, "honey": 99,
                          "ice": 99, "fur": 99, "leather": 99})
    station = DictStation({"workbench": False, "cookpot": False})  # 双无
    engine = CraftingEngine()
    workbench_recipes = [r for r in book.all() if r.station == StationType.WORKBENCH]
    cookpot_recipes = [r for r in book.all() if r.station == StationType.COOKPOT]
    none_recipes = [r for r in book.all() if r.station == StationType.NONE]
    assert len(workbench_recipes) > 0, "应有 workbench 配方"
    assert len(cookpot_recipes) > 0, "应有 cookpot 配方"
    assert len(none_recipes) > 0, "应有 none 配方"
    for r in workbench_recipes:
        ui = engine.get_ui_state(r, inv, station)
        assert ui["can_craft_now"] is False, f"{r.id} 无工作台却 can_craft_now=True"
        assert ui["craftable_button_enabled"] is False
        assert ui["blocked_reason"] == "需要工作台", f"{r.id} blocked_reason={ui['blocked_reason']!r}"
    for r in cookpot_recipes:
        ui = engine.get_ui_state(r, inv, station)
        assert ui["blocked_reason"] == "需要烹饪锅", f"{r.id} blocked_reason={ui['blocked_reason']!r}"
    # none 配方不受影响
    for r in none_recipes:
        ui = engine.get_ui_state(r, inv, station)
        assert ui["can_craft_now"] is True, f"{r.id} none 配方应能合成"
        assert ui["blocked_reason"] == ""
    print(f"  ✓ 验收 ④: {len(workbench_recipes)} workbench + {len(cookpot_recipes)} cookpot 配方无工作站时灰显 + 红字 blocked_reason")
    print(f"     {len(none_recipes)} none 配方不受工作站影响")


def test_acc04_workbench_enables_grayed_recipes():
    """验收 ④ 辅助:获得工作台后,灰显配方立即变可合成(模拟 demo 切换按钮)。"""
    book = RecipeBook.default_book()
    inv = DictInventory({"wood": 99, "stone": 99, "flint": 99, "grass": 99, "rope": 99,
                          "berries": 99, "mushroom": 99, "meat": 99, "fish": 99, "honey": 99,
                          "ice": 99, "fur": 99, "leather": 99})
    recipe = book.find_by_id("craft.tool.axe")  # WORKBENCH 配方
    station_off = DictStation({"workbench": False, "cookpot": False})
    station_on = DictStation({"workbench": True, "cookpot": False})

    ui_off = CraftingEngine().get_ui_state(recipe, inv, station_off)
    assert ui_off["can_craft_now"] is False and ui_off["blocked_reason"] == "需要工作台"

    ui_on = CraftingEngine().get_ui_state(recipe, inv, station_on)
    assert ui_on["can_craft_now"] is True and ui_on["blocked_reason"] == ""

    print("  ✓ 验收 ④ 辅助: 切换工作台 → workbench 配方立即从灰显变可合成")


# === 入口 ===

if __name__ == "__main__":
    tests = [
        test_acc01_at_least_30_recipes,
        test_acc01_all_recipes_unique_ids,
        test_acc01_all_recipes_craftable_when_materials_full,
        test_acc02_button_enabled_when_materials_full,
        test_acc02_button_disabled_when_missing_one,
        test_acc03_single_craft_under_400ms,
        test_acc03_full_recipe_recheck_under_400ms,
        test_acc04_no_workbench_grays_workbench_recipes,
        test_acc04_workbench_enables_grayed_recipes,
    ]
    print("[M2.9 E2E Demo 验收测试]")
    failures = []
    for t in tests:
        try:
            t()
        except AssertionError as e:
            print(f"  ✗ {t.__name__}: {e}")
            failures.append(t.__name__)
    print()
    if failures:
        print(f"FAIL: {len(failures)} 个验收测试失败")
        sys.exit(1)
    else:
        print(f"PASS: 全部 {len(tests)} 个验收测试通过")
        sys.exit(0)
