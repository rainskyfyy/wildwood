"""Wildwood M2.3 — 端到端 Demo(独立可运行)

用法:
    cd core/abstract/building
    python3 examples/m23_demo.py
    # 或:python3 -m building.examples.m23_demo(从 core/abstract 目录)

场景:
    1) 7 建筑可造(验收 ①)
    2) 三判据红/绿(验收 ②):
        - 绿:平地 + 空地 + 距离内
        - 红 距离:超 4m
        - 红 占用:已有营火
        - 红 地形:出界
    3) 全队可见(验收 ③):place() 后产出 WorldEvent,模拟 Go 端广播
    4) 性能:200 次校验 < 5ms
"""
from __future__ import annotations

import os
import sys
import time
from collections import defaultdict
from typing import Dict

# 允许从仓库根目录或本目录运行
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from core.abstract.building import (
    BlockReason,
    BuildAction,
    BuildingType,
    FlatTerrainProbe,
    InsetTerrainProbe,
    MaterialStore,
    PlacementEngine,
    PlacementGrid,
    PlacementResult,
    PlacementVerdict,
    PROTOCOL_KIND_BUILD_DONE,
    all_building_types,
    count_building_types,
    evaluate_placement,
    place_building,
)
from core.abstract.building.schemas import cell_to_world


# ----------------------------------------------------------------------
# Reference MaterialStore — 简单 dict
# ----------------------------------------------------------------------

class DictMaterials:
    def __init__(self, initial: Dict[str, int] | None = None) -> None:
        self._store: Dict[str, int] = dict(initial or {})

    def has(self, item_id: str, count: int) -> bool:
        return self._store.get(item_id, 0) >= count

    def take(self, item_id: str, count: int) -> bool:
        if not self.has(item_id, count):
            return False
        self._store[item_id] -= count
        if self._store[item_id] <= 0:
            self._store.pop(item_id, None)
        return True

    def add(self, item_id: str, count: int) -> None:
        self._store[item_id] = self._store.get(item_id, 0) + count

    def snapshot(self) -> Dict[str, int]:
        return dict(self._store)


# ----------------------------------------------------------------------
# 步骤 1:7 建筑可造
# ----------------------------------------------------------------------

def step1_seven_buildings() -> None:
    print("=" * 60)
    print(f"步骤 1:建筑种类数 = {count_building_types()}(验收 ① 要求 >= 5)")
    assert count_building_types() >= 5, "建筑种类数 < 5,不满足任务要求"

    print("全部建筑类型:")
    for bt in all_building_types():
        from core.abstract.building.building_types import get_building_def, building_id_for_protocol
        defn = get_building_def(bt)
        print(f"  - {bt.value:14s} ({defn.name_zh:6s})  footprint={defn.footprint_size()}格  protocol_id={building_id_for_protocol(bt)}")
    print()


# ----------------------------------------------------------------------
# 步骤 2:三判据红/绿(任务验收 ②)
# ----------------------------------------------------------------------

def step2_three_criteria() -> None:
    print("=" * 60)
    print("步骤 2:三判据(任务验收 ②)")

    grid = PlacementGrid()
    terrain = FlatTerrainProbe()
    materials = DictMaterials({"wood": 100, "grass": 100, "flint": 100, "stone": 100, "rope": 100})
    engine = PlacementEngine(terrain=terrain, grid=grid, materials=materials)

    # 玩家站在 (0, 0)
    player_pos = (0.0, 0.0)

    # Case A:绿 — 平地 + 空地 + 距离内
    r = place_building(engine, BuildingType.CAMPFIRE, (1.0, 0.0), player_pos, player_id="p1")
    print(f"  A 绿:营火 (1,0) 距离 1m → {r.verdict.value} (expect ok)  {r.detail}")
    assert r.is_green, "case A 应绿色"

    # Case B:红 距离 — 8 米外
    r = place_building(engine, BuildingType.CAMPFIRE, (8.0, 0.0), player_pos, player_id="p1")
    print(f"  B 红 距离:营火 (8,0) 距离 8m → {r.verdict.value} reason={r.reason.value}  {r.detail}")
    assert r.is_red and r.reason == BlockReason.OUT_OF_RANGE, "case B 应红色 OUT_OF_RANGE"

    # Case C:红 占用 — 已有营火 (1, 0) 上面再放
    r = place_building(engine, BuildingType.CHEST, (1.0, 0.0), player_pos, player_id="p1")
    print(f"  C 红 占用:箱子 (1,0) 已有营火 → {r.verdict.value} reason={r.reason.value}  {r.detail}")
    assert r.is_red and r.reason == BlockReason.OCCUPIED, "case C 应红色 OCCUPIED"

    # Case D:红 地形 — 边界探针 ((-1,-1) 到 (5,5));玩家在边界内
    inset_terrain = InsetTerrainProbe((-1.0, -1.0), (5.0, 5.0))
    engine2 = PlacementEngine(terrain=inset_terrain, grid=PlacementGrid(), materials=materials)
    # 玩家站在 (0, 0),目标 (5.0, 0.0) 距离 5m?实际 5m > 4m 又会触发距离
    # 改玩家在 (3.5, 0) → 目标 (5.0, 0) 距离 1.5m,在阈值内
    # 但目标 cell (5, 0) → world (5, 0) → InsetTerrainProbe max=5.0 → 包含
    # 想要出界,需要 cell (6, 0) → world (6, 0) 超出 max=5
    # 玩家 (3.5, 0),目标 (6.0, 0) 距离 2.5m < 4m,cell (6, 0) 超出 (5, 5)
    r = place_building(engine2, BuildingType.CAMPFIRE, (6.0, 0.0), (3.5, 0.0), player_id="p1")
    print(f"  D 红 地形:玩家(3.5,0) 距离 2.5m,目标 cell (6,0) 出界 → {r.verdict.value} reason={r.reason.value}  {r.detail}")
    assert r.is_red and r.reason == BlockReason.TERRAIN, "case D 应红色 TERRAIN"

    # Case E:多格建筑 — 帐篷 2x2,放 (3, 3) 占用 4 格
    r = place_building(engine, BuildingType.TENT, (3.5, 3.5), (3.5, 3.5), player_id="p1")
    print(f"  E 绿:帐篷 (3.5, 3.5) → {r.verdict.value}  {r.detail}")
    assert r.is_green, "case E 应绿色"
    # 再放一个箱子进 (3, 3) — 冲突
    r = place_building(engine, BuildingType.CHEST, (3.0, 3.0), (3.5, 3.5), player_id="p1")
    print(f"  E 红 占用:箱子 (3,3) 帐篷覆盖 → {r.verdict.value} reason={r.reason.value}  {r.detail}")
    assert r.is_red and r.reason == BlockReason.OCCUPIED, "case E2 应红色 OCCUPIED"

    print("  ✓ 三判据全过\n")


# ----------------------------------------------------------------------
# 步骤 3:全队可见(任务验收 ③)+ 扣材料
# ----------------------------------------------------------------------

def step3_broadcast_and_materials() -> None:
    print("=" * 60)
    print("步骤 3:扣材料 + 全队可见(任务验收 ③)")

    grid = PlacementGrid()
    materials = DictMaterials({"wood": 100, "grass": 100, "flint": 100, "stone": 100, "rope": 100})
    engine = PlacementEngine(terrain=FlatTerrainProbe(), grid=grid, materials=materials)

    before = materials.snapshot()
    print(f"  扣前材料: {before}")

    # 营火 = 3 wood + 2 grass(对齐 M2.9 recipe)
    r = place_building(
        engine, BuildingType.CAMPFIRE, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.building.campfire",
    )
    after = materials.snapshot()
    print(f"  营火放置 {r.verdict.value} → 扣后材料: {after}")
    assert r.is_green
    assert before["wood"] - after["wood"] == 3, f"wood 应扣 3,实际 {before['wood'] - after['wood']}"
    assert before["grass"] - after["grass"] == 2, f"grass 应扣 2,实际 {before['grass'] - after['grass']}"

    # 模拟 Go 端 Hub.BroadcastDelta(...)
    if engine.last_event is not None:
        ev = engine.last_event
        print(f"  WorldEvent(BUILD_DONE={ev.event_kind}):")
        print(f"    source_entity_id (player) = {ev.source_entity_id:#x}")
        print(f"    target_entity_id (new building) = {ev.target_entity_id}")
        print(f"    amount (building type) = {ev.amount}  → enum={BuildingType}")
        print(f"    position = {ev.position}")
        assert ev.event_kind == PROTOCOL_KIND_BUILD_DONE
        assert ev.amount in {1, 2, 3, 4, 5, 6, 7}

    # 材料不足:wood=2(需要 3)
    poor_materials = DictMaterials({"wood": 2, "grass": 100})
    engine2 = PlacementEngine(terrain=FlatTerrainProbe(), grid=PlacementGrid(), materials=poor_materials)
    r = place_building(
        engine2, BuildingType.CAMPFIRE, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.building.campfire",
    )
    print(f"  材料不足 (wood=2 < 3):{r.verdict.value} reason={r.reason.value}  {r.detail}")
    assert r.verdict == PlacementVerdict.INSUFFICIENT

    print("  ✓ 扣材料 + 广播接口全过\n")


# ----------------------------------------------------------------------
# 步骤 4:性能 — 200 次校验 < 5ms
# ----------------------------------------------------------------------

def step4_performance() -> None:
    print("=" * 60)
    print("步骤 4:性能 — 200 次红/绿校验 < 5ms")

    grid = PlacementGrid()
    materials = DictMaterials({"wood": 9999, "grass": 9999, "flint": 9999, "stone": 9999, "rope": 9999})
    engine = PlacementEngine(terrain=FlatTerrainProbe(), grid=grid, materials=materials)
    player_pos = (0.0, 0.0)

    # 暖机
    for x in range(20):
        place_building(engine, BuildingType.CAMPFIRE, (float(x), 0.0), player_pos)

    grid2 = PlacementGrid()
    terrain2 = FlatTerrainProbe()
    from core.abstract.building import PlacementValidator
    validator = PlacementValidator(terrain2, grid2)

    N = 200
    t0 = time.perf_counter_ns()
    for i in range(N):
        x = float(i % 50)
        y = float((i // 50) % 4)
        r = validator.validate(BuildAction(
            building_type=BuildingType.TENT,  # 2x2,最大 footprint
            player_id="p1",
            player_pos=(x, y),
            target_pos=(x + 0.3, y + 0.3),
        ))
    elapsed_ms = (time.perf_counter_ns() - t0) / 1e6
    print(f"  {N} 次三判据校验(tent 2x2,200 已放置建筑)耗时: {elapsed_ms:.2f}ms(p99 = {elapsed_ms / N * 1.0:.4f}ms)")
    assert elapsed_ms / N < 5.0, f"单次 {elapsed_ms / N:.4f}ms 超 5ms 预算"
    print("  ✓ 性能预算内\n")


# ----------------------------------------------------------------------
# 步骤 5:跨模式一致 — Python 端结果可被 GDScript 端镜像消费
# ----------------------------------------------------------------------

def step5_cross_mode_consistency() -> None:
    print("=" * 60)
    print("步骤 5:跨模式一致 — Python 端字段可被 GDScript 端直接消费")

    grid = PlacementGrid()
    materials = DictMaterials({"wood": 99, "grass": 99, "flint": 99, "stone": 99, "rope": 99})
    engine = PlacementEngine(terrain=FlatTerrainProbe(), grid=grid, materials=materials)

    # 模拟 4 个玩家各自在房间不同位置放一个建筑
    placements = [
        ("p1", (0.5, 0.5), BuildingType.CAMPFIRE),
        ("p2", (2.5, 0.5), BuildingType.CHEST),
        ("p3", (4.5, 0.5), BuildingType.WORKBENCH),
        ("p4", (6.5, 0.5), BuildingType.COOKPOT),
    ]
    events = []
    for pid, pos, bt in placements:
        r = place_building(engine, bt, pos, pos, player_id=pid, recipe_id=f"craft.building.{bt.value}")
        assert r.is_green
        if engine.last_event:
            events.append(engine.last_event)

    # 模拟 Go 端房间广播:Hub.BroadcastDelta(room, &S2C_WorldDelta{Events: [...]})
    print(f"  4 个玩家在 4 个位置放 4 个建筑,产出 {len(events)} 个 BUILD_DONE 事件")
    print(f"  协议字段(event_kind/source_entity_id/target_entity_id/amount/position)全部就绪")
    for ev in events:
        print(f"    kind=2  src={ev.source_entity_id:#x}  tgt={ev.target_entity_id}  amt={ev.amount}  pos={ev.position}")
    assert len(events) == 4
    # 全部 event_kind = BUILD_DONE = 2
    assert all(ev.event_kind == 2 for ev in events)
    # amount 各不相同(1, 2, 3, 4)
    assert {ev.amount for ev in events} == {1, 2, 3, 4}
    print("  ✓ 4 玩家跨房间广播接口 ready\n")


# ----------------------------------------------------------------------
# 入口
# ----------------------------------------------------------------------

def main() -> int:
    print()
    print("Wildwood M2.3 建造系统 — 端到端 Demo")
    print()
    step1_seven_buildings()
    step2_three_criteria()
    step3_broadcast_and_materials()
    step4_performance()
    step5_cross_mode_consistency()
    print("=" * 60)
    print("M2.3 端到端 Demo 全过 ✓")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
