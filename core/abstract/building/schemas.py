"""Wildwood M2.3 — Building Placement Schemas (通用层)

设计原则:
  - A/B 通用层(切换时不重写):纯 stdlib dataclass + enum,零外部依赖。
  - 建筑定义/放置规则/占用栅格全部 frozen / 不可变,运行期只读。
  - 跨端字段命名严格对齐 Godot 端 placement_validator.gd 与 Go 端 room/build.go。

边界:
  - 不感知引擎 API(无 Vector2、无 Node),只用 (x, y) 二元组表示世界坐标(米)。
  - 不做碰撞检测 — 由 TerrainProbe / OccupancyGrid 抽象提供。
  - 距离度量:欧几里得,32 像素 = 1 米(与 lmb_decide.py 一致)。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, List, Optional, Protocol, Set, Tuple, runtime_checkable

# === Schema 版本(写侧) ===
CURRENT_BUILDING_SCHEMA_VERSION = "1.0.0"


# -----------------------------------------------------------------------
# 建筑类型
# -----------------------------------------------------------------------

class BuildingType(str, Enum):
    """可建造的建筑类型(7 个 — 覆盖任务要求 5+ 的下限)。

    编号 == M2.9 Recipe.id 中的 "craft.building.<key>" 一一对应,详见 building_types.py。
    """
    CAMPFIRE = "campfire"        # 营火
    CHEST = "chest"              # 箱子
    WORKBENCH = "workbench"      # 工作台
    COOKPOT = "cookpot"          # 烹饪锅
    TENT = "tent"                # 帐篷
    FIRE_PIT = "fire_pit"        # 火坑
    TORCH_STAND = "torch_stand"  # 火把架


# === 类型 id 映射(用于协议 WorldEvent.amount 字段) ===
BUILDING_TYPE_ID: dict[BuildingType, int] = {
    BuildingType.CAMPFIRE: 1,
    BuildingType.CHEST: 2,
    BuildingType.WORKBENCH: 3,
    BuildingType.COOKPOT: 4,
    BuildingType.TENT: 5,
    BuildingType.FIRE_PIT: 6,
    BuildingType.TORCH_STAND: 7,
}

# === 反向映射(协议 → 枚举) ===
ID_TO_BUILDING_TYPE: dict[int, BuildingType] = {v: k for k, v in BUILDING_TYPE_ID.items()}


# -----------------------------------------------------------------------
# 建筑定义(尺寸/材料/占地)
# -----------------------------------------------------------------------

@dataclass(frozen=True)
class BuildingDef:
    """建筑静态定义(尺寸、材料、占地)。

    设计:不绑引擎资源 ID;美术资源由 M2.14 资产清单统一管理。
    """
    type: BuildingType
    name_zh: str
    footprint: Tuple[Tuple[int, int], ...]   # 占地格(相对建筑原点,单位 = 32px 网格)
    max_stack: int = 1                         # 同位置可叠加数量(箱子=99 物品,其他=1)
    is_walkable: bool = False                  # 内部是否可走(箱子/工作台=False,营火=True)

    def footprint_size(self) -> int:
        """占地格数(用于占用栅格注册)。"""
        return len(self.footprint)

    def contains_cell(self, ox: int, oy: int) -> bool:
        """相对原点 (ox, oy) 是否在 footprint 内(用于栅格查询)。"""
        return (ox, oy) in set(self.footprint)


# -----------------------------------------------------------------------
# 放置结果(红/绿信号灯)
# -----------------------------------------------------------------------

class PlacementVerdict(str, Enum):
    """放置判定三态。"""
    OK = "ok"                    # 绿色可放
    BLOCKED = "blocked"          # 红色不可放
    INSUFFICIENT = "insufficient"  # 红色 — 材料不足(预检在 placement 之前)

    @property
    def is_green(self) -> bool:
        """绿色 = 仅 OK。"""
        return self == PlacementVerdict.OK

    @property
    def is_red(self) -> bool:
        """红色 = BLOCKED + INSUFFICIENT。"""
        return self != PlacementVerdict.OK


class BlockReason(str, Enum):
    """不可放置原因(用于 UI 提示)。"""
    NONE = "none"
    TERRAIN = "terrain"              # 地形不允许(水中/岩浆/不可达)
    OCCUPIED = "occupied"            # 已被其他建筑/实体占用
    OUT_OF_RANGE = "out_of_range"    # 距离玩家过远
    OUT_OF_BOUNDS = "out_of_bounds"  # 越界
    NO_RECIPE = "no_recipe"          # 配方不存在
    MISSING_MATERIALS = "missing_materials"  # 材料不足


@dataclass(frozen=True)
class PlacementResult:
    """放置校验结果。"""
    verdict: PlacementVerdict
    reason: BlockReason = BlockReason.NONE
    detail: str = ""            # 自由文本,UI 展示
    candidate_pos: Optional[Tuple[float, float]] = None  # 吸附/对齐后的最终坐标

    @property
    def is_green(self) -> bool:
        return self.verdict.is_green

    @property
    def is_red(self) -> bool:
        return self.verdict.is_red

    @staticmethod
    def ok(candidate_pos: Tuple[float, float]) -> "PlacementResult":
        return PlacementResult(verdict=PlacementVerdict.OK, candidate_pos=candidate_pos)

    @staticmethod
    def blocked(
        reason: BlockReason,
        detail: str = "",
        candidate_pos: Optional[Tuple[float, float]] = None,
    ) -> "PlacementResult":
        return PlacementResult(
            verdict=PlacementVerdict.BLOCKED,
            reason=reason,
            detail=detail,
            candidate_pos=candidate_pos,
        )

    @staticmethod
    def insufficient(detail: str = "") -> "PlacementResult":
        return PlacementResult(
            verdict=PlacementVerdict.INSUFFICIENT,
            reason=BlockReason.MISSING_MATERIALS,
            detail=detail,
        )


# -----------------------------------------------------------------------
# 放置请求(玩家 → 引擎 → 协议)
# -----------------------------------------------------------------------

@dataclass(frozen=True)
class BuildAction:
    """玩家尝试放置一个建筑的请求。"""
    building_type: BuildingType
    player_id: str
    player_pos: Tuple[float, float]
    target_pos: Tuple[float, float]   # 玩家点击处的世界坐标
    recipe_id: Optional[str] = None   # 关联 M2.9 配方,None = 用默认 1 个


# -----------------------------------------------------------------------
# 抽象探针 — 地形 / 占用 / 材料
# -----------------------------------------------------------------------

@runtime_checkable
class TerrainProbe(Protocol):
    """地形抽象:查询一个世界坐标的 (x, y) 是否可建造。

    NONE 表示"地表";实现可以返回 False 表示水中/岩浆/不可达。
    """

    def is_buildable(self, pos: Tuple[float, float]) -> bool:
        ...


@runtime_checkable
class OccupancyGrid(Protocol):
    """占用栅格:已放置的实体集合。

    实现:PlacementGrid 同时支持整数栅格(footprint 落格)与单点占用查询。
    """

    def is_cell_free(self, cell: Tuple[int, int]) -> bool:
        """栅格单元是否空闲。"""
        ...

    def occupied_cells(self) -> Set[Tuple[int, int]]:
        """返回所有被占用的栅格单元(用于 broadcast 后其他客户端渲染)。"""
        ...


@runtime_checkable
class MaterialStore(Protocol):
    """材料仓库抽象:问"我有 X 物品 N 个吗?" + 扣减。

    与 M2.9 InventoryView 兼容 — 任何实现 InventoryView 的实例都满足本契约。
    """

    def has(self, item_id: str, count: int) -> bool:
        ...

    def take(self, item_id: str, count: int) -> bool:
        """尝试扣减,成功返 True;不足返 False 且不扣。"""
        ...


# -----------------------------------------------------------------------
# 占用栅格 — 默认实现(纯 dict 索引,O(1) 查询)
# -----------------------------------------------------------------------

class PlacementGrid:
    """占用栅格 — 维护已放置建筑的 footprint 单元集合。

    设计:整数栅格(32px = 1 格)而非浮点碰撞,降低 M2.14 联机压测的带宽成本。
    """

    def __init__(self) -> None:
        self._cells: Set[Tuple[int, int]] = set()
        # 记录每格对应哪个 building,方便撤销 / 调试
        self._owners: dict[Tuple[int, int], str] = {}

    def is_cell_free(self, cell: Tuple[int, int]) -> bool:
        return cell not in self._cells

    def occupied_cells(self) -> Set[Tuple[int, int]]:
        return set(self._cells)

    def register(self, origin_cell: Tuple[int, int], footprint: Tuple[Tuple[int, int], ...], owner: str) -> None:
        """注册一个建筑的 footprint 到栅格。"""
        for off in footprint:
            cell = (origin_cell[0] + off[0], origin_cell[1] + off[1])
            self._cells.add(cell)
            self._owners[cell] = owner

    def release(self, origin_cell: Tuple[int, int], footprint: Tuple[Tuple[int, int], ...]) -> None:
        """释放一个建筑的 footprint。"""
        for off in footprint:
            cell = (origin_cell[0] + off[0], origin_cell[1] + off[1])
            self._cells.discard(cell)
            self._owners.pop(cell, None)


# -----------------------------------------------------------------------
# 地形探针 — 默认实现(均匀平地)
# -----------------------------------------------------------------------

class FlatTerrainProbe:
    """Reference / 测试用实现:全部地点都可建(平地)。"""

    def is_buildable(self, pos: Tuple[float, float]) -> bool:
        return True


class InsetTerrainProbe:
    """矩形边界内的地点可建,出界返 False(用于测试 OUT_OF_BOUNDS 判据)。"""

    def __init__(self, min_xy: Tuple[float, float], max_xy: Tuple[float, float]) -> None:
        self._min = min_xy
        self._max = max_xy

    def is_buildable(self, pos: Tuple[float, float]) -> bool:
        return self._min[0] <= pos[0] <= self._max[0] and self._min[1] <= pos[1] <= self._max[1]


# -----------------------------------------------------------------------
# 杂项工具
# -----------------------------------------------------------------------

def world_to_cell(pos: Tuple[float, float], cell_size_m: float = 1.0) -> Tuple[int, int]:
    """世界坐标(米)→ 栅格坐标(整数)。

    默认 1 米 = 1 格;若与 32px 网格耦合,cell_size_m=1.0 即可(GDScript 端 32px=1m)。
    """
    return (int(pos[0] // cell_size_m), int(pos[1] // cell_size_m))


def cell_to_world(cell: Tuple[int, int], cell_size_m: float = 1.0) -> Tuple[float, float]:
    """栅格坐标 → 世界坐标(格中心点)。"""
    return (cell[0] * cell_size_m + cell_size_m / 2, cell[1] * cell_size_m + cell_size_m / 2)
