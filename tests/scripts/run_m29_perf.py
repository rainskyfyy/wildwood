"""
M2.9 性能基准验收脚本(验收 ③: 合成 ≤ 400ms 反馈)

用法:
  python3 tests/scripts/run_m29_perf.py

输出:
  - 单次合成 p50/p99/avg
  - 30+ 配方全表 re-check 总耗时 + 单项均值
  - 大库存(50 item)合成 p99
  - 全部断言 + 退出码 0/1

不依赖 pytest,纯 stdlib + 项目内模块。
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

# 允许从仓库根目录跑
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.abstract.crafting.crafting_engine import CraftingEngine
from core.abstract.crafting.inventory_view import DictInventoryView
from core.abstract.crafting.recipe_book import RecipeBook
from core.abstract.crafting.station_probe import StaticStationProbe
from core.abstract.crafting.schemas import StationType


BUDGET_MS = 400.0  # 验收 ③ 硬指标
INTERNAL_TARGET_MS = 50.0  # 内部目标(8x 余量)


def _timing_stats(timings_ms):
    timings_ms = sorted(timings_ms)
    n = len(timings_ms)
    return {
        "n": n,
        "min": timings_ms[0],
        "p50": timings_ms[n // 2],
        "p99": timings_ms[(n * 99) // 100],
        "max": timings_ms[-1],
        "avg": sum(timings_ms) / n,
    }


def bench_single_craft():
    """单次 craft 1000 次。"""
    book = RecipeBook.default_book()
    inv = DictInventoryView({"wood": 3})
    probe = StaticStationProbe({StationType.WORKBENCH})
    r = book.find_by_id("craft.tool.axe")
    engine = CraftingEngine()

    for _ in range(50):
        engine.craft(r, DictInventoryView({"wood": 3}), probe)

    timings = []
    for _ in range(1000):
        fresh = DictInventoryView({"wood": 3})
        t0 = time.perf_counter()
        engine.craft(r, fresh, probe)
        t1 = time.perf_counter()
        timings.append((t1 - t0) * 1000)

    return _timing_stats(timings)


def bench_check_all_recipes():
    """34 配方全表 check_can_craft 200 次。"""
    book = RecipeBook.default_book()
    inv = DictInventoryView({
        "wood": 100, "stone": 100, "flint": 100, "rope": 100, "grass": 100,
        "berries": 100, "mushroom": 100, "meat": 100, "fish": 100, "honey": 100,
        "ice": 100, "fur": 100, "leather": 100,
    })
    probe = StaticStationProbe({StationType.WORKBENCH, StationType.COOKPOT})
    engine = CraftingEngine()
    recipes = book.all()

    for _ in range(10):
        for r in recipes:
            engine.check_can_craft(r, inv, probe)

    timings = []
    for _ in range(200):
        t0 = time.perf_counter()
        for r in recipes:
            engine.check_can_craft(r, inv, probe)
        t1 = time.perf_counter()
        timings.append((t1 - t0) * 1000)

    return _timing_stats(timings), len(recipes)


def bench_large_inventory_craft():
    """50 item 大库存下 craft 1000 次。"""
    book = RecipeBook.default_book()
    r = book.find_by_id("craft.tool.axe")
    probe = StaticStationProbe({StationType.WORKBENCH})
    engine = CraftingEngine()

    for _ in range(50):
        fresh = DictInventoryView({f"item_{i}": 5 for i in range(50)})
        fresh.add("wood", 10)
        engine.craft(r, fresh, probe)

    timings = []
    for _ in range(1000):
        fresh = DictInventoryView({f"item_{i}": 5 for i in range(50)})
        fresh.add("wood", 10)
        t0 = time.perf_counter()
        engine.craft(r, fresh, probe)
        t1 = time.perf_counter()
        timings.append((t1 - t0) * 1000)

    return _timing_stats(timings)


def main():
    print("=" * 60)
    print("M2.9 性能基准验收")
    print(f"  验收预算: {BUDGET_MS:.0f}ms")
    print(f"  内部目标: {INTERNAL_TARGET_MS:.0f}ms(8x 余量)")
    print("=" * 60)

    print("\n[1] 单次 craft (1000 次)")
    s = bench_single_craft()
    print(f"  n={s['n']}  min={s['min']:.3f}ms  p50={s['p50']:.3f}ms  p99={s['p99']:.3f}ms  max={s['max']:.3f}ms  avg={s['avg']:.3f}ms")
    ok1 = s["p99"] < INTERNAL_TARGET_MS
    print(f"  {'✓' if ok1 else '✗'} p99 < {INTERNAL_TARGET_MS:.0f}ms")

    print("\n[2] 34 配方全表 check_can_craft (200 次扫描)")
    s, n_recipes = bench_check_all_recipes()
    print(f"  每次扫描 {n_recipes} 个配方,共 {s['n']} 次")
    print(f"  min={s['min']:.3f}ms  p50={s['p50']:.3f}ms  p99={s['p99']:.3f}ms  max={s['max']:.3f}ms  avg={s['avg']:.3f}ms")
    print(f"  单项均耗时: {s['avg'] / n_recipes * 1000:.2f}µs")
    ok2 = s["p99"] < INTERNAL_TARGET_MS
    print(f"  {'✓' if ok2 else '✗'} p99 < {INTERNAL_TARGET_MS:.0f}ms(等价于 34 配方 re-check 一帧内)")

    print("\n[3] 大库存(50 item) craft (1000 次)")
    s = bench_large_inventory_craft()
    print(f"  n={s['n']}  min={s['min']:.3f}ms  p50={s['p50']:.3f}ms  p99={s['p99']:.3f}ms  max={s['max']:.3f}ms  avg={s['avg']:.3f}ms")
    ok3 = s["p99"] < INTERNAL_TARGET_MS
    print(f"  {'✓' if ok3 else '✗'} p99 < {INTERNAL_TARGET_MS:.0f}ms")

    print("\n" + "=" * 60)
    all_ok = ok1 and ok2 and ok3
    if all_ok:
        print("[M2.9 perf] ✓ 全部指标达标,内部余量充裕")
    else:
        print("[M2.9 perf] ✗ 部分指标未达标,需优化")
    print("=" * 60)
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
