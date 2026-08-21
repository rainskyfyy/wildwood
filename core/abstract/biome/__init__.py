"""M2.7 生物群系抽象层 — 4 大群系 + 9 宫格流式加载

A/B 通用层,与引擎解耦。提供:
- palette:24 暖色调色板(美术风格指南 §色板规范)
- elements:4 共享元素(grass/rock/tree/mushroom)骨架
- biomes:4 群系定义(forest/plains/mines/snow)
- biome_map:chunk 坐标 → 群系 ID 映射(9 宫格布局)
- loader:9 宫格流式加载器(内存 -60%)

引擎层适配:
- A 线(Godot 4.3):core/biome_runtime/*.gd
- B 线(Unity 6 + .NET):core/biome_runtime/Assets/...

资源 JSON 真相源:assets/biomes/*.json
"""
from core.abstract.biome.palette import (
    PALETTE, WARM_BASE, NATURE, ALERT, COOL, NEUTRAL,
    total_palette_size, warm_color_count, cool_color_count,
    neutral_color_count, palette_color_ratio, hex_to_rgb,
    validate_no_pure_black_or_white,
)
from core.abstract.biome.elements import (
    ElementSpec, SHARED_ELEMENTS,
    get_element, list_elements, validate_shared_elements,
)
from core.abstract.biome.biomes import (
    Biome, Forest, Plains, Mines, Snow, BIOMES,
    get_biome, list_biomes, primary_color_of,
    biome_to_dict, biome_from_dict, validate_biomes,
)
from core.abstract.biome.biome_map import (
    BiomeMap, MapConfig, ChunkCoord,
    DEFAULT_CHUNK_GRID, DEFAULT_MAP_RADIUS_CHUNKS,
    default_map, get_neighbors_3x3, in_same_biome,
)
from core.abstract.biome.loader import (
    BiomeLoader, LoadResult, LoaderState,
    CHUNK_SIZE_BYTES, MIN_FULL_MAP_CHUNKS,
    new_loader, memory_saving_pct, memory_saving_vs_full,
)

__all__ = [
    # palette
    "PALETTE", "WARM_BASE", "NATURE", "ALERT", "COOL", "NEUTRAL",
    "total_palette_size", "warm_color_count", "cool_color_count",
    "neutral_color_count", "palette_color_ratio", "hex_to_rgb",
    "validate_no_pure_black_or_white",
    # elements
    "ElementSpec", "SHARED_ELEMENTS",
    "get_element", "list_elements", "validate_shared_elements",
    # biomes
    "Biome", "Forest", "Plains", "Mines", "Snow", "BIOMES",
    "get_biome", "list_biomes", "primary_color_of",
    "biome_to_dict", "biome_from_dict", "validate_biomes",
    # biome_map
    "BiomeMap", "MapConfig", "ChunkCoord",
    "DEFAULT_CHUNK_GRID", "DEFAULT_MAP_RADIUS_CHUNKS",
    "default_map", "get_neighbors_3x3", "in_same_biome",
    # loader
    "BiomeLoader", "LoadResult", "LoaderState",
    "CHUNK_SIZE_BYTES", "MIN_FULL_MAP_CHUNKS",
    "new_loader", "memory_saving_pct", "memory_saving_vs_full",
]
