"""Wildwood M2.3 — PlacementEngine 整合层

职责:
  1. 预检:材料是否足够(放之前) → INSUFFICIENT(红色,UI 灰显)
  2. 校验:三判据(地形 / 占用 / 距离) → BLOCKED 或 OK
  3. 落地:扣材料 + 注册栅格 + 生成 entity_id
  4. 广播:产出 WorldEvent payload(供 Go 房间服务 + GDScript 客户端使用)

设计:
  - 无外部依赖,纯函数 + dataclass 输出
  - 状态可变(注册栅格需要)但封装在 PlacementEngine 内部
  - place_building() 函数式入口,适合 Godot 端每帧 hot path

任务验收 ③(全队可见):
  - to_world_event() 产出 BUILD_DONE 事件字段,Go 端 Hub.HandleBuildPlace 直接广播
  - 即使单机 demo,接口必须先打通(协议层 ready)
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

from .building_types import building_id_for_protocol, get_building_def
from .placement import PlacementContext, PlacementValidator
from .schemas import (
    BlockReason,
    BuildAction,
    BuildingType,
    MaterialStore,
    OccupancyGrid,
    PlacementGrid,
    PlacementResult,
    TerrainProbe,
    world_to_cell,
)

# === 协议常量 ===
PROTOCOL_KIND_BUILD_DONE: int = 2  # WorldEventKind.BUILD_DONE = 2,见 M1.5 wildwood_common.gd


@dataclass(frozen=True)
class WorldEventPayload:
    """M2.3 产出的 WorldEvent 字段 — Go 端 Hub.HandleBuildPlace 广播用。

    字段名与 S2C_WorldDelta.events[i] (WildwoodEvent) 1:1 对齐:
      - event_kind   = PROTOCOL_KIND_BUILD_DONE (= 2)
      - source_entity_id = player_entity_id (建造者)
      - target_entity_id = 新生成的 building_entity_id
      - amount       = building_id_for_protocol(building_type) (1-7)
      - position     = (x, y) 落地坐标(米)
    """
    event_kind: int
    source_entity_id: int
    target_entity_id: int
    amount: int
    position: Tuple[float, float]


@dataclass
class PlacementEngine:
    """建造引擎 — 封装 验证 + 扣材料 + 注册栅格。

    用法:
        engine = PlacementEngine(terrain, grid, materials)
        result = engine.place(action)  # 单次放置
        if result.is_green:
            event = engine.last_event  # 给 Go 端广播
    """

    terrain: TerrainProbe
    grid: PlacementGrid
    materials: MaterialStore
    ctx: PlacementContext = field(default_factory=PlacementContext)
    validator: PlacementValidator = field(init=False)

    # 内部状态(运行期递增)
    _next_building_entity_id: int = field(default=1000, init=False)
    last_event: Optional[WorldEventPayload] = field(default=None, init=False)

    def __post_init__(self) -> None:
        # validator 不读 self,只读 self.terrain/grid/ctx;直接构造即可
        self.validator = PlacementValidator(self.terrain, self.grid, self.ctx)

    # ------------------------------------------------------------------
    # 公开 API
    # ------------------------------------------------------------------

    def place(self, action: BuildAction) -> PlacementResult:
        """放置流程:预检 → 校验 → 落地 → 广播事件。

        返回:
          - INSUFFICIENT:材料不足,未落地
          - BLOCKED:三判据失败,未落地
          - OK:已扣材料 + 已注册栅格 + 已生成 last_event(供调用方广播)
        """
        # 0) 配方存在性
        try:
            defn = get_building_def(action.building_type)
        except KeyError:
            return PlacementResult.blocked(BlockReason.NO_RECIPE, f"未知建筑类型: {action.building_type}")

        # 1) 材料预检(用 M2.9 RecipeBook 的配方)
        if action.recipe_id is not None:
            from ..crafting.recipe_book import RecipeBook
            from ..crafting.schemas import RecipeCategory
            book = RecipeBook.default_book()
            recipe = book.find_by_id(action.recipe_id)
            if recipe is None:
                return PlacementResult.blocked(BlockReason.NO_RECIPE, f"未知 recipe: {action.recipe_id}")
            if recipe.category != RecipeCategory.BUILDING:
                return PlacementResult.blocked(BlockReason.NO_RECIPE, f"recipe {action.recipe_id} 不是建筑配方")
            missing = [ing for ing in recipe.ingredients if not self.materials.has(ing.item_id, ing.count)]
            if missing:
                detail = ", ".join(f"{m.item_id}×{m.count}" for m in missing)
                return PlacementResult.insufficient(detail=f"缺:{detail}")

        # 2) 三判据(地形 / 占用 / 距离)
        v = self.validator.validate(action)
        if not v.is_green:
            return v

        # 3) 落地(扣材料 + 注册栅格)
        if action.recipe_id is not None:
            from ..crafting.recipe_book import RecipeBook
            recipe = RecipeBook.default_book().find_by_id(action.recipe_id)
            for ing in recipe.ingredients:
                ok = self.materials.take(ing.item_id, ing.count)
                if not ok:
                    # 理论上 has 已经验过,但防御性 rollback
                    return PlacementResult.insufficient(detail=f"扣材料失败:{ing.item_id}×{ing.count}")

        origin_cell = world_to_cell(action.target_pos, self.ctx.cell_size_m)
        entity_id = self._next_building_entity_id
        self._next_building_entity_id += 1
        self.grid.register(origin_cell, defn.footprint, f"building:{entity_id}:{action.building_type.value}")

        # 4) 生成广播事件(供 Go 端 Hub.HandleBuildPlace 用)
        self.last_event = WorldEventPayload(
            event_kind=PROTOCOL_KIND_BUILD_DONE,
            source_entity_id=_player_entity_id(action.player_id),
            target_entity_id=entity_id,
            amount=building_id_for_protocol(action.building_type),
            position=action.target_pos,
        )
        return PlacementResult.ok(action.target_pos)

    # ------------------------------------------------------------------
    # 纯函数入口
    # ------------------------------------------------------------------

    def to_world_event(self, action: BuildAction) -> WorldEventPayload:
        """便捷:从已落地的 action 产出 WorldEvent(默认走 place() 流程,失败抛 RuntimeError)。"""
        if self.last_event is None or self.last_event.target_entity_id >= self._next_building_entity_id:
            raise RuntimeError("no recent place() to convert")
        return self.last_event


# ----------------------------------------------------------------------
# 函数式入口
# ----------------------------------------------------------------------

def place_building(
    engine: PlacementEngine,
    building_type: BuildingType,
    target_pos: Tuple[float, float],
    player_pos: Tuple[float, float],
    player_id: str = "",
    recipe_id: Optional[str] = None,
) -> PlacementResult:
    """函数式入口 — 适合 Godot 端 GDScript 调用。"""
    return engine.place(BuildAction(
        building_type=building_type,
        player_id=player_id,
        player_pos=player_pos,
        target_pos=target_pos,
        recipe_id=recipe_id,
    ))


# ----------------------------------------------------------------------
# 内部:player_id → entity_id(简易 hash)
# ----------------------------------------------------------------------

def _player_entity_id(player_id: str) -> int:
    """player_id 字符串 → entity_id(单调正数,稳定 hash)。

    真实环境由房间服务分配;此处仅作 wire format 演示,生产端用 service。
    """
    if not player_id:
        return 0
    # FNV-1a 32-bit,稳定且无依赖
    h = 0x811C9DC5
    for ch in player_id:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h | 0x80000000  # 高位置 1,避免与系统预置 id 冲突
