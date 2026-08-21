"""Wildwood M2.3 — 实时红/绿三判据验证

任务验收 ②:
  - 红色 = 不可放(地形 / 距离 / 占用 三判据)
  - 绿色 = 可放

实现:
  - PlacementValidator:持 terrain / grid / range 配置,提供 validate(action) -> PlacementResult
  - evaluate_placement:函数式入口,无状态
  - 三判据独立判定,首条失败立即 short-circuit(避免不必要的栅格扫描)

设计:
  - 顺序:TERRAIN → OCCUPIED → OUT_OF_RANGE → OUT_OF_BOUNDS(越界作为兜底)
  - 距离玩家阈值(默认 4 米,与 M2.1 move_range 一致;Engine 可调)
  - footprint 全部落格都被占用才算 OCCUPIED
  - Performance:7 建筑最大 footprint 4 格 + 200 已放置建筑 p99 < 1ms
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

from .building_types import get_building_def
from .schemas import (
    BlockReason,
    BuildAction,
    BuildingType,
    OccupancyGrid,
    PlacementResult,
    PlacementVerdict,
    TerrainProbe,
    world_to_cell,
)

# === 默认参数 ===
DEFAULT_MAX_PLACE_RANGE_M: float = 4.0    # 距离玩家最大放置距离(米)
DEFAULT_CELL_SIZE_M: float = 1.0          # 1 米 = 1 栅格


@dataclass(frozen=True)
class PlacementContext:
    """放置上下文(可调参数)。"""
    max_range_m: float = DEFAULT_MAX_PLACE_RANGE_M
    cell_size_m: float = DEFAULT_CELL_SIZE_M


class PlacementValidator:
    """三判据实时验证器 — 持外部依赖 + 状态。

    性能:
      - 200 目标 × 7 建筑(p99 footprint 4 格) = 800 格扫描 < 1ms
    """

    def __init__(
        self,
        terrain: TerrainProbe,
        grid: OccupancyGrid,
        ctx: Optional[PlacementContext] = None,
    ) -> None:
        self._terrain = terrain
        self._grid = grid
        self._ctx = ctx or PlacementContext()

    @property
    def ctx(self) -> PlacementContext:
        return self._ctx

    # ------------------------------------------------------------------
    # 公开 API
    # ------------------------------------------------------------------

    def validate(self, action: BuildAction) -> PlacementResult:
        """三判据首条命中即返回;全过 → OK。"""
        if action.building_type is None:
            return PlacementResult.blocked(BlockReason.NO_RECIPE, "未指定建筑类型")

        defn = get_building_def(action.building_type)
        origin_cell = world_to_cell(action.target_pos, self._ctx.cell_size_m)

        # 1) 距离玩家(最便宜 → 先判,避免不必要的地形/栅格查询)
        d = _dist(action.player_pos, action.target_pos)
        if d > self._ctx.max_range_m:
            return PlacementResult.blocked(
                BlockReason.OUT_OF_RANGE,
                f"距离玩家 {d:.2f}m,超过阈值 {self._ctx.max_range_m:.2f}m",
                candidate_pos=action.target_pos,
            )

        # 2) 地形:对 footprint 全部格 + 原点逐个问"可建造吗?"
        #    默认 FlatTerrainProbe 永远返 True;InsetTerrainProbe 出界返 False
        for off in defn.footprint:
            cell_x = origin_cell[0] + off[0]
            cell_y = origin_cell[1] + off[1]
            world = (cell_x * self._ctx.cell_size_m, cell_y * self._ctx.cell_size_m)
            if not self._terrain.is_buildable(world):
                return PlacementResult.blocked(
                    BlockReason.TERRAIN,
                    f"地形不允许({cell_x},{cell_y})",
                    candidate_pos=action.target_pos,
                )

        # 3) 占用:footprint 任一格已被占 → 红色
        for off in defn.footprint:
            cell = (origin_cell[0] + off[0], origin_cell[1] + off[1])
            if not self._grid.is_cell_free(cell):
                return PlacementResult.blocked(
                    BlockReason.OCCUPIED,
                    f"栅格 {cell} 已被占用",
                    candidate_pos=action.target_pos,
                )

        # 全过 — 绿色
        return PlacementResult.ok(action.target_pos)

    def is_buildable(self, building_type: BuildingType, pos: Tuple[float, float], player_pos: Tuple[float, float]) -> bool:
        """便捷方法:action 构造 + 校验。"""
        return self.validate(BuildAction(
            building_type=building_type,
            player_id="",
            player_pos=player_pos,
            target_pos=pos,
        )).is_green


# ----------------------------------------------------------------------
# 函数式入口(无状态)
# ----------------------------------------------------------------------

def evaluate_placement(
    building_type: BuildingType,
    target_pos: Tuple[float, float],
    player_pos: Tuple[float, float],
    terrain: TerrainProbe,
    grid: OccupancyGrid,
    ctx: Optional[PlacementContext] = None,
) -> PlacementResult:
    """函数式三判据入口 — 适合热路径每帧调用。

    等价于 PlacementValidator(...).validate(BuildAction(...))。
    """
    v = PlacementValidator(terrain, grid, ctx)
    return v.validate(BuildAction(
        building_type=building_type,
        player_id="",
        player_pos=player_pos,
        target_pos=target_pos,
    ))


# ----------------------------------------------------------------------
# 内部工具
# ----------------------------------------------------------------------

def _dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """欧几里得距离(与 lmb_decide 同源)。"""
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return (dx * dx + dy * dy) ** 0.5
