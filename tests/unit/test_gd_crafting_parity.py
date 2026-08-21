"""
GDScript ↔ Python 语义对齐测试(M2.9 parity check)

沙箱无 Godot binary,无法实际跑 .gd。本测试做"行为契约等价"验证:
  1. 从 GDScript 源文件 parse 出 API 签名
  2. 与 Python 端 dataclass / 方法签名做交叉校验
  3. 把 GDScript 端算法用 Python 翻译为 oracle,跑同样输入对比

如未来 GDScript 端接入真 Godot,本测试可补充为跑 .gd 并对比结果。
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GDSCRIPT_PATH = ROOT / "core" / "abstract" / "crafting" / "crafting.gd"
SEMANTICS_PATH = ROOT / "core" / "abstract" / "crafting" / "SEMANTICS.md"

# 把 repo 根加入 path,方便直接 import
sys.path.insert(0, str(ROOT))

from core.abstract.crafting.crafting_engine import (
    CheckResult,
    CraftingEngine,
    CraftingError,
)
from core.abstract.crafting.recipe_book import RecipeBook
from core.abstract.crafting.schemas import (
    CraftingResult,
    Ingredient,
    Recipe,
    StationType,
)


# === 1. 解析 GDScript 源 ===

def _parse_gd_signatures():
    """从 crafting.gd parse 出:
      - func_signatures: [(name, params_list, return_type), ...]
      - consts: [(name, value), ...]
    """
    text = GDSCRIPT_PATH.read_text()

    funcs = []
    for m in re.finditer(
        r'^(static\s+)?func\s+(\w+)\s*\((.*?)\)\s*(->\s*(\w+))?\s*:',
        text,
        re.M,
    ):
        is_static = bool(m.group(1))
        name = m.group(2)
        params_raw = m.group(3)
        ret = m.group(5) or ""
        params = []
        if params_raw.strip():
            for p in params_raw.split(","):
                p = p.strip()
                if p:
                    params.append(p)
        funcs.append({
            "name": name,
            "static": is_static,
            "params": params,
            "return": ret.strip(),
        })

    consts = []
    for m in re.finditer(
        r'^const\s+(\w+):\s*\w+\s*=\s*"?([\w\d_\.]+)"?',
        text,
        re.M,
    ):
        consts.append({"name": m.group(1), "value": m.group(2)})

    return {"funcs": funcs, "consts": consts}


# === 2. 把 GDScript 端算法翻译成 Python oracle(直接对照 GDScript 行为)===

def _gd_check_can_craft_oracle(recipe: Recipe, inventory: dict, station_state: dict) -> dict:
    """完整复刻 crafting.gd::check_can_craft 行为(字典形态)。"""
    # _station_block_reason
    station = recipe.station.value
    blocked = ""
    if station != StationType.NONE.value:
        if not station_state.get(station, False):
            blocked = {"workbench": "requires_workbench", "cookpot": "requires_cookpot"}.get(
                station, ""
            )
    # 缺料
    missing = []
    for ing in recipe.ingredients:
        have = inventory.get(ing.item_id, 0)
        if have < ing.count:
            missing.append({"item_id": ing.item_id, "count": ing.count - have})
    return {
        "can_craft": blocked == "" and len(missing) == 0,
        "missing": missing,
        "blocked": blocked,
        "station_required": station,
    }


def _gd_apply_craft_result(inventory: dict, craft_result: dict) -> bool:
    """复刻 crafting.gd::apply_craft_result 行为(原子扣 + 加)。"""
    if craft_result is None:
        return False
    for c in craft_result["consumed"]:
        have = inventory.get(c["item_id"], 0)
        if have < c["count"]:
            return False
    for c in craft_result["consumed"]:
        inventory[c["item_id"]] = inventory.get(c["item_id"], 0) - c["count"]
    for p in craft_result["produced"]:
        inventory[p["item_id"]] = inventory.get(p["item_id"], 0) + p["count"]
    return True


# === 3. 测试用例 ===

def test_gd_file_exists():
    assert GDSCRIPT_PATH.exists(), f"GDScript 包装不存在: {GDSCRIPT_PATH}"
    assert SEMANTICS_PATH.exists(), f"SEMANTICS 文档不存在: {SEMANTICS_PATH}"


def test_gd_three_main_apis():
    """GDScript 端必须暴露 3 个主 API。"""
    sigs = _parse_gd_signatures()
    names = {f["name"] for f in sigs["funcs"]}
    for required in ("check_can_craft", "craft", "get_ui_state"):
        assert required in names, f"GDScript 端缺少主 API: {required}"


def test_gd_main_apis_are_static():
    """3 个主 API 必须是 static func(无内部状态,纯计算)。"""
    sigs = _parse_gd_signatures()
    funcs_by_name = {f["name"]: f for f in sigs["funcs"]}
    for name in ("check_can_craft", "craft", "get_ui_state"):
        f = funcs_by_name[name]
        assert f["static"], f"GDScript {name} 必须是 static func,实际不是"


def test_gd_station_consts_match_python():
    """GDScript 端 STATION_* const 值与 Python 端 StationType.value 完全一致。"""
    sigs = _parse_gd_signatures()
    consts = {c["name"]: c["value"] for c in sigs["consts"]}
    assert consts.get("STATION_NONE") == StationType.NONE.value
    assert consts.get("STATION_WORKBENCH") == StationType.WORKBENCH.value
    assert consts.get("STATION_COOKPOT") == StationType.COOKPOT.value


def test_gd_block_reason_consts_match_python():
    """GDScript 端 BLOCK_REQUIRES_* const 值与 Python 端 _station_block_reason 返的 key 一致。"""
    sigs = _parse_gd_signatures()
    consts = {c["name"]: c["value"] for c in sigs["consts"]}
    assert consts.get("BLOCK_REQUIRES_WORKBENCH") == "requires_workbench"
    assert consts.get("BLOCK_REQUIRES_COOKPOT") == "requires_cookpot"


def test_gd_item_labels_cover_all_recipe_items():
    """GDScript 端 ITEM_LABELS 必须覆盖所有已知 item_id(配方 ingredients + result)。"""
    sigs = _parse_gd_signatures()
    # 解析 GDScript ITEM_LABELS dict
    text = GDSCRIPT_PATH.read_text()
    m = re.search(r"const\s+ITEM_LABELS:\s*Dictionary\s*=\s*\{(.*?)\n\}", text, re.S)
    assert m, "GDScript 端未找到 ITEM_LABELS dict"
    block = m.group(1)
    item_ids_in_gd = set(re.findall(r'"([\w_]+)":', block))

    # Python 端所有已知 item
    book = RecipeBook.default_book()
    py_item_ids = set()
    for r in book.all():
        for ing in r.ingredients:
            py_item_ids.add(ing.item_id)
        py_item_ids.add(r.result_item_id)
    missing = py_item_ids - item_ids_in_gd
    assert not missing, f"GDScript ITEM_LABELS 缺:{missing}"


# === 4. 行为对齐(用 Python oracle 复刻 GDScript 端算法,与 Python 原版输出对比)===

def test_gd_check_can_craft_behavior_matches_python():
    """GDScript 端 check_can_craft 行为必须与 Python 端语义一致(用 oracle 复刻对照)。"""
    book = RecipeBook.default_book()
    inv_full = {"wood": 99, "stone": 99, "flint": 99, "grass": 99, "rope": 99,
                "berries": 99, "mushroom": 99, "meat": 99, "fish": 99, "honey": 99,
                "ice": 99, "fur": 99, "leather": 99}
    inv_empty = {}
    inv_partial = {"wood": 1}
    station_full = {"workbench": True, "cookpot": True}
    station_none = {}

    for recipe in book.all():
        # 全材料 + 全工作站 → can_craft
        gd = _gd_check_can_craft_oracle(recipe, inv_full, station_full)
        py_check = CraftingEngine().check_can_craft(recipe, _make_inv_adapter(inv_full), _make_station_adapter(station_full))
        assert gd["can_craft"] == py_check.can_craft, f"{recipe.id} can_craft 不一致: gd={gd['can_craft']} py={py_check.can_craft}"
        # GDScript 缺料 shape
        if not py_check.can_craft and py_check.missing:
            for gd_m, py_m in zip(sorted(gd["missing"], key=lambda x: x["item_id"]),
                                  sorted(({"item_id": m.item_id, "count": m.count} for m in py_check.missing), key=lambda x: x["item_id"])):
                assert gd_m["item_id"] == py_m["item_id"] and gd_m["count"] == py_m["count"], f"{recipe.id} missing 不一致"
        # blocked shape
        assert (gd["blocked"] or None) == py_check.blocked, f"{recipe.id} blocked 不一致: gd={gd['blocked']!r} py={py_check.blocked!r}"
        # station_required
        assert gd["station_required"] == recipe.station.value

        # 空库存 → can_craft=False(若 recipe.ingredients 非空)
        gd_empty = _gd_check_can_craft_oracle(recipe, inv_empty, station_full)
        if recipe.ingredients:
            assert not gd_empty["can_craft"], f"{recipe.id} 空库存却 can_craft"
            assert len(gd_empty["missing"]) == len(recipe.ingredients), f"{recipe.id} 空库存 missing 数量不对"


def test_gd_apply_craft_result_atomic():
    """GDScript 端 apply_craft_result 必须原子:材料不够时整体失败,不动 inventory。"""
    book = RecipeBook.default_book()
    recipe = book.find_by_id("craft.tool.axe")  # 3 wood → 1 axe
    inv = {"wood": 1}  # 不够
    before = dict(inv)
    ok = _gd_apply_craft_result(inv, {
        "recipe_id": recipe.id,
        "produced": [{"item_id": "axe", "count": 1}],
        "consumed": [{"item_id": "wood", "count": 3}],
    })
    assert not ok
    assert inv == before, f"失败时 inventory 变化了:{inv} vs {before}"


def test_gd_apply_craft_result_success():
    """GDScript 端 apply_craft_result 成功路径:wood 3 → wood 0 + axe 1。"""
    inv = {"wood": 5}
    ok = _gd_apply_craft_result(inv, {
        "recipe_id": "craft.tool.axe",
        "produced": [{"item_id": "axe", "count": 1}],
        "consumed": [{"item_id": "wood", "count": 3}],
    })
    assert ok
    assert inv == {"wood": 2, "axe": 1}


# === 辅助 adapter(让 Python 端用 dict 跑,跟 GDScript 端语义一致)===

class _DictInventoryAdapter:
    """把 dict 包装成 Python 端 InventoryView(让 GDScript 端能跟 Python 端对比)。"""
    def __init__(self, d: dict):
        self._d = d
    def get_count(self, item_id):
        return self._d.get(item_id, 0)
    def consume(self, ingredient):
        have = self._d.get(ingredient.item_id, 0)
        if have < ingredient.count:
            return False
        self._d[ingredient.item_id] = have - ingredient.count
        return True
    def add(self, item_id, count):
        self._d[item_id] = self._d.get(item_id, 0) + count
        return True
    def snapshot(self):
        return dict(self._d)


class _DictStationAdapter:
    def __init__(self, d: dict):
        self._d = d
    def has_station(self, station):
        return bool(self._d.get(station.value, False))


def _make_inv_adapter(d):
    return _DictInventoryAdapter(d)


def _make_station_adapter(d):
    return _DictStationAdapter(d)


# === 5. 入口 ===

if __name__ == "__main__":
    failures = []
    tests = [
        test_gd_file_exists,
        test_gd_three_main_apis,
        test_gd_main_apis_are_static,
        test_gd_station_consts_match_python,
        test_gd_block_reason_consts_match_python,
        test_gd_item_labels_cover_all_recipe_items,
        test_gd_check_can_craft_behavior_matches_python,
        test_gd_apply_craft_result_atomic,
        test_gd_apply_craft_result_success,
    ]
    for t in tests:
        try:
            t()
            print(f"  ✓ {t.__name__}")
        except Exception as e:
            print(f"  ✗ {t.__name__}: {e}")
            failures.append(t.__name__)
    print()
    if failures:
        print(f"FAIL: {len(failures)} 个测试失败")
        sys.exit(1)
    else:
        print(f"PASS: 全部 {len(tests)} 个 GDScript-Python 对齐测试通过")
        sys.exit(0)
