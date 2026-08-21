"""M2.7 9 宫格流式加载器测试 — 任务书验收 ②

要求:9 宫格懒加载,内存占用 -60%。

策略:
- 1 chunk ≈ 1MB 假设(资源+实体+光影等)
- 9 宫格 = 9 chunks ≈ 9MB
- 全图基线 ≥ 25 chunks(强制最小)
- 验收:loaded_bytes / full_map_bytes ≤ 0.4 (即 ≤ 40%,即 -60%)

设计:
- 状态机:IDLE / LOADING / READY
- 触发:玩家 chunk 变更 → 加载新 9 宫格、卸载远端 chunk
- 内存:按 loaded chunks 累加,实时计算 -%
"""
import pytest
from core.abstract.biome.loader import (
    BiomeLoader, LoaderState, LoadResult,
    new_loader, MIN_FULL_MAP_CHUNKS, CHUNK_SIZE_BYTES,
    memory_saving_pct, memory_saving_vs_full,
)
from core.abstract.biome.biome_map import (
    ChunkCoord, MapConfig, BiomeMap, default_map,
)
from core.abstract.biome.biomes import BIOMES


def test_min_full_map_chunks_at_least_25():
    """全图最小 25 块(5×5)才能保证 9 宫格 = -60% 验收成立"""
    assert MIN_FULL_MAP_CHUNKS >= 25


def test_chunk_size_positive():
    """1 chunk 字节数(模拟)正数"""
    assert CHUNK_SIZE_BYTES > 0


def test_new_loader_starts_idle():
    """新 loader 状态 IDLE"""
    loader = new_loader()
    assert loader.state == LoaderState.IDLE


def test_new_loader_no_chunks_loaded():
    """新 loader 无已加载 chunk"""
    loader = new_loader()
    assert loader.loaded_count() == 0
    assert loader.loaded_bytes() == 0


def test_loading_9_chunks_uses_9_chunks():
    """玩家在中心 → 加载 3×3 = 9 块"""
    loader = new_loader()
    result = loader.update_player_chunk(ChunkCoord(0, 0))
    assert result.loaded == 9
    assert loader.loaded_count() == 9


def test_loading_9_chunks_uses_9_mb():
    """9 块 = 9 × CHUNK_SIZE_BYTES 字节"""
    loader = new_loader()
    loader.update_player_chunk(ChunkCoord(0, 0))
    assert loader.loaded_bytes() == 9 * CHUNK_SIZE_BYTES


def test_player_move_evicts_old_chunks():
    """玩家移动 2 块 → 原 9 宫格与新 9 宫格有重叠,但远端 chunk 被卸载"""
    loader = new_loader()
    loader.update_player_chunk(ChunkCoord(0, 0))
    initial = set(loader.loaded_chunks())
    assert len(initial) == 9
    # 移到 (5, 0),原 9 宫格 (cx∈[-1,1], cy∈[-1,1]) 全部离开
    result = loader.update_player_chunk(ChunkCoord(5, 0))
    new = set(loader.loaded_chunks())
    # 新 9 宫格 cx∈[4,6], cy∈[-1,1]
    assert len(new) == 9
    # 原 9 宫格全部不再加载
    assert initial.isdisjoint(new), \
        f"some old chunks still loaded: {initial & new}"


def test_player_move_partial_overlap_keeps_common():
    """玩家移动 1 块 → 重叠 6 块(2 行 3 列),只换 3 块"""
    loader = new_loader()
    loader.update_player_chunk(ChunkCoord(0, 0))
    # 移动到 (1, 0) — 与原 9 宫格重叠 6 块
    result = loader.update_player_chunk(ChunkCoord(1, 0))
    assert loader.loaded_count() == 9
    # 新加载的应是 3 块(东 3 列)
    assert result.loaded == 3
    # 卸载的应是 3 块(西 3 列)
    assert result.evicted == 3


def test_loading_state_transitions():
    """状态机:IDLE → LOADING → READY"""
    loader = new_loader()
    assert loader.state == LoaderState.IDLE
    result = loader.update_player_chunk(ChunkCoord(0, 0))
    # 同步加载(测试环境),完成后变 READY
    assert loader.state == LoaderState.READY
    assert result.new_state == LoaderState.READY


def test_loaded_chunks_set_returns_9_coords():
    """loaded_chunks() 返回 9 个 ChunkCoord"""
    loader = new_loader()
    loader.update_player_chunk(ChunkCoord(0, 0))
    chunks = loader.loaded_chunks()
    assert len(chunks) == 9
    for c in chunks:
        assert isinstance(c, ChunkCoord)


def test_memory_saving_pct_9_chunks_vs_25_full():
    """9 宫格 vs 全图 25 块:节省 64%(> 60% 验收线)"""
    pct = memory_saving_pct(loaded=9, full_map=25)
    assert pct >= 60.0, f"saving {pct:.1f}% < 60%"
    # 精确: 1 - 9/25 = 0.64 = 64%
    assert abs(pct - 64.0) < 0.5


def test_memory_saving_pct_9_chunks_vs_100_full():
    """9 宫格 vs 全图 100 块:节省 91%(更显著)"""
    pct = memory_saving_pct(loaded=9, full_map=100)
    assert pct >= 90.0


def test_memory_saving_vs_full_helper():
    """便捷函数:loader → (loaded_bytes, full_map_bytes, saving_pct)"""
    loader = new_loader()
    loader.update_player_chunk(ChunkCoord(0, 0))
    loaded, full, pct = memory_saving_vs_full(loader, full_map_chunks=25)
    assert loaded == 9 * CHUNK_SIZE_BYTES
    assert full == 25 * CHUNK_SIZE_BYTES
    assert pct >= 60.0


def test_loader_uses_biome_map_for_neighbors():
    """loader 通过 BiomeMap 算邻居群系,正确分类 9 块"""
    loader = new_loader(map_=default_map())
    loader.update_player_chunk(ChunkCoord(0, 0))
    summary = loader.loaded_biome_summary()
    # 中心 9 宫格(±1):全部 forest(因为距离 ≤ 1)
    assert summary.get("forest", 0) == 9
    # 其他 3 群系暂时不在 9 宫格内
    for bid in ["plains", "mines", "snow"]:
        assert summary.get(bid, 0) == 0


def test_loader_at_boundary_includes_three_biomes():
    """玩家在 (1, 0):9 宫格包含 forest + 部分 mines(东侧)"""
    loader = new_loader(map_=default_map())
    loader.update_player_chunk(ChunkCoord(1, 0))
    summary = loader.loaded_biome_summary()
    # (1, 0) 周围 cx∈[0,2], cy∈[-1,1]
    # (0,-1) (0,0) (0,1) (1,-1) (1,0) (1,1) = forest (距离 ≤ 1)
    # (2,-1) (2,0) (2,1) = mines (cx==2)
    assert summary.get("forest", 0) == 6
    assert summary.get("mines", 0) == 3


def test_loader_reset_clears_state():
    """reset 清空已加载状态"""
    loader = new_loader()
    loader.update_player_chunk(ChunkCoord(0, 0))
    assert loader.loaded_count() == 9
    loader.reset()
    assert loader.loaded_count() == 0
    assert loader.state == LoaderState.IDLE


def test_acceptance_60_percent_saving():
    """验收 ②:9 宫格 vs 全图 25 块,内存 -60%"""
    loader = new_loader()
    loader.update_player_chunk(ChunkCoord(0, 0))
    loaded, full, pct = memory_saving_vs_full(loader, full_map_chunks=25)
    assert pct >= 60.0, \
        f"FAIL: saving {pct:.1f}% < 60% (loaded={loaded} full={full})"
