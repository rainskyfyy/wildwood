"""M2.7 9 宫格坐标 → 群系 映射测试 — 项目总方案 §3.4.1 必须 day-1 引入

设计:
- chunk_size = 32 网格(32 × 32px = 1024 × 1024 像素/块)
- 9 宫格:1 中心 + 8 邻居 = 3×3 块
- 映射确定性:相同 chunk 坐标 → 相同群系(无随机)
- 默认布局:中央森林、外围按方位规则展开
"""
import pytest
from core.abstract.biome.biome_map import (
    BiomeMap, ChunkCoord, MapConfig, default_map,
    coord_to_biome, get_neighbors_3x3, in_same_biome,
    DEFAULT_CHUNK_GRID, DEFAULT_MAP_RADIUS_CHUNKS,
)
from core.abstract.biome.biomes import BIOMES


def test_default_chunk_grid_32():
    """chunk 网格 32 × 32(项目总方案 §3.4.1 + 美术风格指南 32px)"""
    assert DEFAULT_CHUNK_GRID == 32


def test_default_map_radius_is_3x3():
    """默认 3×3 半径(9 宫格 = 1 中心 + 8 邻居)"""
    assert DEFAULT_MAP_RADIUS_CHUNKS == 1
    # 验证 9 宫格 = (2r+1)² = 9
    n = (2 * DEFAULT_MAP_RADIUS_CHUNKS + 1) ** 2
    assert n == 9


def test_chunk_coord_hashable():
    """ChunkCoord 必须可哈希(用作 dict key)"""
    c = ChunkCoord(cx=0, cy=0)
    s = {c: "forest"}
    assert s[c] == "forest"


def test_chunk_coord_equality():
    """ChunkCoord 按值比较"""
    a = ChunkCoord(0, 0)
    b = ChunkCoord(0, 0)
    assert a == b
    assert hash(a) == hash(b)


def test_default_map_origin_is_forest():
    """默认布局:中心 chunk = 森林(新玩家出生地)"""
    m = default_map()
    center = ChunkCoord(0, 0)
    assert m.coord_to_biome(center) == "forest"


def test_coord_to_biome_deterministic():
    """相同输入 → 相同群系(无随机性)"""
    m = default_map()
    c = ChunkCoord(5, -3)
    b1 = m.coord_to_biome(c)
    b2 = m.coord_to_biome(c)
    assert b1 == b2


def test_coord_to_biome_known_layout():
    """验证默认布局:中央森林、北/南=平原、东=矿区、西=雪原(规则布局)"""
    m = default_map()
    assert m.coord_to_biome(ChunkCoord(0, 0)) == "forest"      # 中心
    assert m.coord_to_biome(ChunkCoord(0, 2)) == "plains"      # 北(0,2)
    assert m.coord_to_biome(ChunkCoord(0, -2)) == "plains"     # 南(0,-2)
    assert m.coord_to_biome(ChunkCoord(2, 0)) == "mines"       # 东
    assert m.coord_to_biome(ChunkCoord(-2, 0)) == "snow"       # 西
    # 角落(2,2)/(2,-2)/(-2,2)/(-2,-2) = ?
    for corner in [ChunkCoord(2, 2), ChunkCoord(2, -2), ChunkCoord(-2, 2), ChunkCoord(-2, -2)]:
        b = m.coord_to_biome(corner)
        assert b in BIOMES, f"corner {corner}: unknown biome {b}"


def test_all_four_biomes_reachable():
    """4 群系在默认布局中都能到达(覆盖完整性)"""
    m = default_map()
    seen = set()
    # 扫 (5,5) 范围内所有 chunk
    for cx in range(-5, 6):
        for cy in range(-5, 6):
            seen.add(m.coord_to_biome(ChunkCoord(cx, cy)))
    assert {"forest", "plains", "mines", "snow"}.issubset(seen), \
        f"missing biomes: {{'forest','plains','mines','snow'}} - {seen}"


def test_get_neighbors_3x3_returns_9():
    """3×3 邻居 = 9 个"""
    center = ChunkCoord(0, 0)
    nbrs = get_neighbors_3x3(center)
    assert len(nbrs) == 9
    assert center in nbrs


def test_get_neighbors_3x3_shape():
    """3×3 邻居覆盖 (cx-1..cx+1) × (cy-1..cy+1)"""
    center = ChunkCoord(5, 5)
    nbrs = get_neighbors_3x3(center)
    expected = {
        ChunkCoord(cx, cy)
        for cx in range(4, 7)
        for cy in range(4, 7)
    }
    assert set(nbrs) == expected


def test_in_same_biome_true():
    """同群系:True"""
    a = ChunkCoord(0, 0)
    b = ChunkCoord(1, 0)
    m = default_map()
    # 中央森林
    if m.coord_to_biome(a) == m.coord_to_biome(b):
        assert in_same_biome(m, a, b)


def test_in_same_biome_false():
    """不同群系:False"""
    m = default_map()
    # 中央森林(0,0) vs 矿区(2,0)
    assert not in_same_biome(m, ChunkCoord(0, 0), ChunkCoord(2, 0))


def test_map_config_optional_chunk_size():
    """MapConfig 可覆盖默认 chunk 网格(便于测试)"""
    cfg = MapConfig(chunk_grid=16, map_radius_chunks=2)
    m = BiomeMap(cfg)
    # 中心仍应是森林
    assert m.coord_to_biome(ChunkCoord(0, 0)) == "forest"


def test_coord_to_biome_helper_function():
    """模块级便捷函数 coord_to_biome"""
    b = coord_to_biome(ChunkCoord(0, 0))
    assert b == "forest"
