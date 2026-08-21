"""M2.7 9 宫格坐标 → 群系 映射 — 项目总方案 §3.4.1

设计:
- 1 chunk = 32 网格 × 32 网格(32 × 32px = 1024 × 1024 像素)
- 9 宫格:1 中心 + 8 邻居 = 3×3 块
- 映射确定性:相同 chunk 坐标 → 相同群系(无随机)
- 默认布局:中心森林,4 方向规则展开,角落回退到最接近的群系

布局规则(默认半径 1):
- 中心 (0,0) = forest
- 距离 ≤ 1:forest
- 北/南方向 (0, ±2) = plains
- 东方向 (+2, 0) = mines
- 西方向 (-2, 0) = snow
- 角落 ±2,±2:取相邻方向主色(规则回退)
- 距离 ≥ 3:周期性复用 4 群系(保证全部可达)
"""
from dataclasses import dataclass, field
from typing import List, Tuple, Set, Dict


# chunk 网格默认 32(32×32px 一块,32 grid × 32 grid)
DEFAULT_CHUNK_GRID: int = 32

# 默认半径 1 chunk = 3×3 = 9 宫格
DEFAULT_MAP_RADIUS_CHUNKS: int = 1


@dataclass(frozen=True)
class ChunkCoord:
    """块坐标(整数网格索引)"""
    cx: int
    cy: int


@dataclass
class MapConfig:
    """地图配置"""
    chunk_grid: int = DEFAULT_CHUNK_GRID           # 单块网格数
    map_radius_chunks: int = DEFAULT_MAP_RADIUS_CHUNKS  # 加载半径(9 宫格=1)

    def chunk_px(self) -> int:
        """单块像素大小"""
        return self.chunk_grid * 32  # 32px/grid

    def map_px(self) -> int:
        """全图像素大小(9 宫格 1 边 = 2*radius+1 块)"""
        side_chunks = 2 * self.map_radius_chunks + 1
        return side_chunks * self.chunk_px()


class BiomeMap:
    """群系地图:chunk 坐标 → 群系 ID 确定性映射"""

    def __init__(self, config: MapConfig | None = None):
        self.config = config or MapConfig()

    def coord_to_biome(self, c: ChunkCoord) -> str:
        """块 (cx, cy) → 群系 ID (forest/plains/mines/snow)

        规则:
        - 距离 ≤ 1:中心森林
        - 北/南(0, ±2):plains
        - 东(+2, 0):mines
        - 西(-2, 0):snow
        - 角落(±2, ±2):取相邻方向主色
        - 距离 ≥ 3:按 cx,cy 的奇偶 + 象限确定群系(保证覆盖 4 群系)
        """
        cx, cy = c.cx, c.cy
        # 中心森林圈(距离 ≤ 1)
        if abs(cx) <= 1 and abs(cy) <= 1:
            return "forest"
        # 主轴(必在 cx == 2/-2/0 之前判断,避免 cx=2 落到 cy>0 分支)
        if cx == 2:
            return "mines"    # 东 = 矿区(整列)
        if cx == -2:
            return "snow"     # 西 = 雪原(整列)
        if cx == 0 and abs(cy) == 2:
            return "plains"   # 北/南 = 平原
        # 角落(±2, ±2):取相邻主色
        if abs(cx) == 2 and abs(cy) == 2:
            return "mines" if cx > 0 else "snow"
        # 距离 ≥ 3:按象限扩展,确保 4 群系全覆盖
        if cy > 0:
            return "plains"
        if cx > 0:
            return "mines"
        if cx < 0:
            return "snow"
        return "plains"  # cy<0 且 cx=0


def default_map() -> BiomeMap:
    """默认群系地图(中央森林)"""
    return BiomeMap(MapConfig())


def get_neighbors_3x3(c: ChunkCoord) -> List[ChunkCoord]:
    """取 c 的 3×3 邻居(含 c 自身),共 9 个"""
    return [
        ChunkCoord(c.cx + dx, c.cy + dy)
        for dx in (-1, 0, 1)
        for dy in (-1, 0, 1)
    ]


def in_same_biome(m: BiomeMap, a: ChunkCoord, b: ChunkCoord) -> bool:
    """a, b 是否在同一群系(用于相机过渡触发判定)"""
    return m.coord_to_biome(a) == m.coord_to_biome(b)


# 模块级便捷函数
def coord_to_biome(c: ChunkCoord) -> str:
    return default_map().coord_to_biome(c)
