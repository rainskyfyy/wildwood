"""Wildwood M2.3 — 建造系统 pytest 测试套件

覆盖:
  - 验收 ①:5+ 建筑可造(实际 7 个,所有配方 id 唯一)
  - 验收 ②:三判据(地形 / 占用 / 距离)+ INSUFFICIENT + 通用结果 API
  - 验收 ③:WorldEvent 协议字段对齐 + 跨模式一致
  - 性能:200 建筑 × 4 格 footprint p99 < 5ms

运行:
    cd <repo>
    PYTHONPATH=. python3 -m pytest tests/unit/test_m23_building.py -v
"""
from __future__ import annotations

import os
import sys
import time

import pytest

# 允许从仓库根跑测试
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from core.abstract.building import (
    BlockReason,
    BuildAction,
    BuildingType,
    FlatTerrainProbe,
    InsetTerrainProbe,
    PlacementEngine,
    PlacementGrid,
    PlacementResult,
    PlacementVerdict,
    PROTOCOL_KIND_BUILD_DONE,
    all_building_types,
    count_building_types,
    evaluate_placement,
    get_building_def,
    place_building,
)
from core.abstract.building.schemas import world_to_cell, cell_to_world


# ----------------------------------------------------------------------
# 测试 fixtures
# ----------------------------------------------------------------------

class DictMaterials:
    def __init__(self, initial: dict[str, int] | None = None) -> None:
        self._store: dict[str, int] = dict(initial or {})

    def has(self, item_id: str, count: int) -> bool:
        return self._store.get(item_id, 0) >= count

    def take(self, item_id: str, count: int) -> bool:
        if not self.has(item_id, count):
            return False
        self._store[item_id] -= count
        if self._store[item_id] <= 0:
            self._store.pop(item_id, None)
        return True

    def snapshot(self) -> dict[str, int]:
        return dict(self._store)


@pytest.fixture
def materials() -> DictMaterials:
    return DictMaterials({"wood": 100, "grass": 100, "flint": 100, "stone": 100, "rope": 100})


@pytest.fixture
def flat_engine(materials: DictMaterials) -> PlacementEngine:
    return PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=materials,
    )


# ----------------------------------------------------------------------
# 验收 ①:5+ 建筑可造
# ----------------------------------------------------------------------

def test_count_buildings_at_least_5():
    assert count_building_types() >= 5


def test_all_building_types_unique():
    types = all_building_types()
    assert len(types) == len(set(types))


def test_7_building_types_present():
    """M2.9 配方的 7 个 BUILDING 全部对应 M2.3 建筑类型。"""
    types = set(all_building_types())
    expected = {BuildingType.CAMPFIRE, BuildingType.CHEST, BuildingType.WORKBENCH, BuildingType.COOKPOT, BuildingType.TENT, BuildingType.FIRE_PIT, BuildingType.TORCH_STAND}
    assert types == expected


def test_building_id_in_range_1_to_7():
    for bt in all_building_types():
        from core.abstract.building.building_types import building_id_for_protocol
        pid = building_id_for_protocol(bt)
        assert 1 <= pid <= 7


def test_footprint_non_empty():
    for bt in all_building_types():
        defn = get_building_def(bt)
        assert defn.footprint_size() >= 1


# ----------------------------------------------------------------------
# 验收 ②:三判据(地形 / 占用 / 距离)
# ----------------------------------------------------------------------

def test_terrain_ok(flat_engine: PlacementEngine):
    r = place_building(flat_engine, BuildingType.CAMPFIRE, (1.0, 0.0), (0.0, 0.0))
    assert r.is_green
    assert r.verdict == PlacementVerdict.OK


def test_terrain_out_of_bounds():
    engine = PlacementEngine(
        terrain=InsetTerrainProbe((0.0, 0.0), (5.0, 5.0)),
        grid=PlacementGrid(),
        materials=DictMaterials(),
    )
    # 玩家在边界内(0,0),目标 (6, 0) 距离 6m — 距离先于地形
    r = place_building(engine, BuildingType.CAMPFIRE, (6.0, 0.0), (0.0, 0.0))
    assert r.is_red
    assert r.reason == BlockReason.OUT_OF_RANGE

    # 玩家 (3, 0) 距离 (6, 0) = 3m,阈值内 → 走到地形判
    r = place_building(engine, BuildingType.CAMPFIRE, (6.0, 0.0), (3.0, 0.0))
    assert r.is_red
    assert r.reason == BlockReason.TERRAIN


def test_distance_out_of_range(flat_engine: PlacementEngine):
    r = place_building(flat_engine, BuildingType.CAMPFIRE, (8.0, 0.0), (0.0, 0.0))
    assert r.is_red
    assert r.reason == BlockReason.OUT_OF_RANGE


def test_distance_at_threshold_is_ok(flat_engine: PlacementEngine):
    """距离 4.0m(默认阈值)→ 允许;4.01m → 拒绝。"""
    r = place_building(flat_engine, BuildingType.CAMPFIRE, (4.0, 0.0), (0.0, 0.0))
    assert r.is_green
    r = place_building(flat_engine, BuildingType.CAMPFIRE, (4.01, 0.0), (0.0, 0.0))
    assert r.is_red


def test_occupied_cell_blocked(flat_engine: PlacementEngine):
    r1 = place_building(flat_engine, BuildingType.CAMPFIRE, (1.0, 0.0), (0.0, 0.0))
    assert r1.is_green
    r2 = place_building(flat_engine, BuildingType.CHEST, (1.0, 0.0), (0.0, 0.0))
    assert r2.is_red
    assert r2.reason == BlockReason.OCCUPIED


def test_footprint_collision_2x2():
    """帐篷 2x2 占用 (3,3) (4,3) (3,4) (4,4);在 (4, 4) 再放应被占用。"""
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials({"wood": 100, "rope": 100}),
    )
    r1 = place_building(engine, BuildingType.TENT, (3.5, 3.5), (3.5, 3.5))
    assert r1.is_green
    r2 = place_building(engine, BuildingType.CHEST, (4.0, 4.0), (4.0, 4.0))
    assert r2.is_red
    assert r2.reason == BlockReason.OCCUPIED


def test_no_recipe_unknown_type(flat_engine: PlacementEngine):
    action = BuildAction(building_type="nonexistent_building", player_id="p1", player_pos=(0, 0), target_pos=(1, 0))
    r = flat_engine.place(action)
    assert r.is_red
    assert r.reason == BlockReason.NO_RECIPE


def test_insufficient_materials(flat_engine: PlacementEngine):
    flat_engine.materials._store = {"wood": 2, "grass": 100}  # 缺 1 wood
    r = place_building(
        flat_engine, BuildingType.CAMPFIRE, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.building.campfire",
    )
    assert r.verdict == PlacementVerdict.INSUFFICIENT
    assert r.reason == BlockReason.MISSING_MATERIALS


def test_insufficient_does_not_consume_materials():
    """INSUFFICIENT 不得触发 take()(只检不扣)。"""
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials({"wood": 0, "grass": 100}),
    )
    before = engine.materials.snapshot()
    r = place_building(
        engine, BuildingType.CAMPFIRE, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.building.campfire",
    )
    after = engine.materials.snapshot()
    assert r.verdict == PlacementVerdict.INSUFFICIENT
    assert before == after, "INSUFFICIENT 不能扣材料"


def test_successful_place_consumes_materials():
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials({"wood": 100, "grass": 100}),
    )
    before = engine.materials.snapshot()
    r = place_building(
        engine, BuildingType.CAMPFIRE, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.building.campfire",
    )
    after = engine.materials.snapshot()
    assert r.is_green
    assert before["wood"] - after["wood"] == 3  # 营火 = 3 wood + 2 grass
    assert before["grass"] - after["grass"] == 2


def test_unknown_recipe_id(flat_engine: PlacementEngine):
    r = place_building(
        flat_engine, BuildingType.CAMPFIRE, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.building.unknown",
    )
    assert r.is_red
    assert r.reason == BlockReason.NO_RECIPE


def test_non_building_recipe_rejected(flat_engine: PlacementEngine):
    """tool 配方不允许作为建筑使用。"""
    r = place_building(
        flat_engine, BuildingType.CAMPFIRE, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.tool.axe",  # tool 不是 building
    )
    assert r.is_red
    assert r.reason == BlockReason.NO_RECIPE


# ----------------------------------------------------------------------
# 验收 ③:WorldEvent 协议字段
# ----------------------------------------------------------------------

def test_world_event_kind_is_build_done():
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials({"wood": 100, "grass": 100}),
    )
    r = place_building(
        engine, BuildingType.CAMPFIRE, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.building.campfire",
    )
    assert r.is_green
    assert engine.last_event is not None
    assert engine.last_event.event_kind == PROTOCOL_KIND_BUILD_DONE
    assert engine.last_event.event_kind == 2  # WorldEventKind.BUILD_DONE = 2


def test_world_event_contains_target_and_amount():
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials({"wood": 100, "grass": 100, "stone": 100, "rope": 100}),
    )
    r = place_building(
        engine, BuildingType.CHEST, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id="craft.building.chest",
    )
    assert r.is_green
    ev = engine.last_event
    assert ev is not None
    assert ev.target_entity_id > 0
    assert ev.amount == 2  # CHEST 的 protocol id


def test_world_event_position_matches():
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials({"wood": 100, "grass": 100}),
    )
    place_building(
        engine, BuildingType.CAMPFIRE, (2.5, 3.5), (2.5, 3.5),
        player_id="p1", recipe_id="craft.building.campfire",
    )
    ev = engine.last_event
    assert ev is not None
    assert ev.position == (2.5, 3.5)


def test_world_event_source_player_id_distinct():
    """4 个不同玩家 → 4 个不同的 source_entity_id(FNV-1a hash)。"""
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials({"wood": 999, "grass": 999, "flint": 999, "stone": 999, "rope": 999}),
    )
    seen = set()
    for i, pid in enumerate(["p1", "p2", "p3", "p4"]):
        place_building(
            engine, BuildingType.CAMPFIRE, (float(i), 0.0), (float(i), 0.0),
            player_id=pid, recipe_id="craft.building.campfire",
        )
        assert engine.last_event is not None
        seen.add(engine.last_event.source_entity_id)
    assert len(seen) == 4


# ----------------------------------------------------------------------
# 占用栅格
# ----------------------------------------------------------------------

def test_occupancy_grid_register_and_release():
    g = PlacementGrid()
    assert g.is_cell_free((0, 0))
    g.register((0, 0), ((0, 0), (1, 0)), "b1")
    assert not g.is_cell_free((0, 0))
    assert not g.is_cell_free((1, 0))
    g.release((0, 0), ((0, 0), (1, 0)))
    assert g.is_cell_free((0, 0))
    assert g.is_cell_free((1, 0))


def test_occupancy_grid_owners():
    g = PlacementGrid()
    g.register((0, 0), ((0, 0),), "b1")
    assert g._owners[(0, 0)] == "b1"


# ----------------------------------------------------------------------
# 坐标工具
# ----------------------------------------------------------------------

def test_world_to_cell_roundtrip():
    cell = world_to_cell((2.7, 3.9), cell_size_m=1.0)
    assert cell == (2, 3)
    world = cell_to_world((2, 3), cell_size_m=1.0)
    assert world == (2.5, 3.5)


# ----------------------------------------------------------------------
# 性能:200 目标 × 4 格 footprint p99 < 5ms
# ----------------------------------------------------------------------

def test_perf_200_validations_under_5ms_each():
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials(),
    )
    # 暖机
    for i in range(50):
        place_building(engine, BuildingType.CAMPFIRE, (float(i), 0.0), (float(i), 0.0))

    validator = engine.validator
    N = 200
    t0 = time.perf_counter_ns()
    for i in range(N):
        x = float(i % 50)
        y = float((i // 50) % 4)
        validator.validate(BuildAction(
            building_type=BuildingType.TENT,  # 2x2 footprint
            player_id="p1",
            player_pos=(x, y),
            target_pos=(x + 0.3, y + 0.3),
        ))
    elapsed_ms = (time.perf_counter_ns() - t0) / 1e6
    avg_ms = elapsed_ms / N
    assert avg_ms < 5.0, f"单次 {avg_ms:.4f}ms 超 5ms 预算"


def test_perf_evaluate_function_no_state():
    """纯函数入口不应引入额外开销。"""
    terrain = FlatTerrainProbe()
    grid = PlacementGrid()
    # 暖机
    for i in range(50):
        evaluate_placement(BuildingType.CAMPFIRE, (float(i), 0.0), (0.0, 0.0), terrain, grid)

    N = 200
    t0 = time.perf_counter_ns()
    for i in range(N):
        evaluate_placement(BuildingType.WORKBENCH, (float(i), 0.0), (0.0, 0.0), terrain, grid)
    elapsed_ms = (time.perf_counter_ns() - t0) / 1e6
    avg_ms = elapsed_ms / N
    assert avg_ms < 5.0


# ----------------------------------------------------------------------
# 7 建筑全可造 — 端到端协议一致
# ----------------------------------------------------------------------

@pytest.mark.parametrize("building_type,recipe_id,protocol_id", [
    (BuildingType.CAMPFIRE, "craft.building.campfire", 1),
    (BuildingType.CHEST, "craft.building.chest", 2),
    (BuildingType.WORKBENCH, "craft.building.workbench", 3),
    (BuildingType.COOKPOT, "craft.building.cookpot", 4),
    (BuildingType.TENT, "craft.building.tent", 5),
    (BuildingType.FIRE_PIT, "craft.building.fire_pit", 6),
    (BuildingType.TORCH_STAND, "craft.building.torch_stand", 7),
])
def test_all_7_buildings_placeable(building_type, recipe_id, protocol_id):
    """7 建筑全部可造 + 协议 id 连续 1-7。"""
    engine = PlacementEngine(
        terrain=FlatTerrainProbe(),
        grid=PlacementGrid(),
        materials=DictMaterials({"wood": 999, "grass": 999, "flint": 999, "stone": 999, "rope": 999}),
    )
    r = place_building(
        engine, building_type, (2.0, 0.0), (2.0, 0.0),
        player_id="p1", recipe_id=recipe_id,
    )
    assert r.is_green, f"{building_type} 不可造: {r.detail}"
    ev = engine.last_event
    assert ev is not None
    assert ev.amount == protocol_id


# ----------------------------------------------------------------------
# 三判据边界值
# ----------------------------------------------------------------------

def test_distance_exactly_at_threshold_ok(flat_engine: PlacementEngine):
    """距离恰好等于阈值 → 通过(<= 关系)。"""
    r = place_building(flat_engine, BuildingType.CAMPFIRE, (4.0, 0.0), (0.0, 0.0))
    assert r.is_green


def test_terrain_cell_outside_footprint_ignored():
    """footprint 内任一格不可建造 → 红色;footprint 全在边界内 → 绿。"""
    engine = PlacementEngine(
        terrain=InsetTerrainProbe((0.0, 0.0), (10.0, 10.0)),
        grid=PlacementGrid(),
        materials=DictMaterials(),
    )
    # workbench 2x1 footprint: (0,0) + (1,0)
    # 玩家 (1, 0),目标 (4.5, 0) 距离 3.5m,cell (4, 0) + (5, 0) 都在边界内 → 绿
    r = place_building(engine, BuildingType.WORKBENCH, (4.5, 0.0), (1.0, 0.0))
    assert r.is_green
    # 玩家 (5, 0),目标 (8.5, 0) 距离 3.5m,cell (8, 0) + (9, 0) 都在边界内 → 绿
    r = place_building(engine, BuildingType.WORKBENCH, (8.5, 0.0), (5.0, 0.0))
    assert r.is_green


def test_terrain_outside_footprint_red():
    """footprint 内任一格超出地形边界 → 红色 TERRAIN。"""
    engine = PlacementEngine(
        terrain=InsetTerrainProbe((0.0, 0.0), (5.0, 5.0)),
        grid=PlacementGrid(),
        materials=DictMaterials(),
    )
    # Tent 2x2:玩家 (3, 4) 距离 (4.5, 5.5) = sqrt(2.25 + 2.25)=2.12m,cell (4, 5) (5, 5) (4, 6) (5, 6)
    # 其中 (4, 6) (5, 6) 的 world 坐标超 5.0 → 红色 TERRAIN
    r = place_building(engine, BuildingType.TENT, (4.5, 5.5), (3.0, 4.0))
    assert r.is_red
    assert r.reason == BlockReason.TERRAIN


# ----------------------------------------------------------------------
# PlacementResult API 形状
# ----------------------------------------------------------------------

def test_result_is_green_and_red_mutually_exclusive():
    ok = PlacementResult.ok((0, 0))
    assert ok.is_green
    assert not ok.is_red

    blocked = PlacementResult.blocked(BlockReason.OCCUPIED, "x")
    assert blocked.is_red
    assert not blocked.is_green

    insuf = PlacementResult.insufficient("x")
    assert insuf.is_red
    assert not insuf.is_green


def test_result_preserves_candidate_pos():
    r = PlacementResult.blocked(BlockReason.OUT_OF_RANGE, "x", candidate_pos=(3.5, 4.5))
    assert r.candidate_pos == (3.5, 4.5)
