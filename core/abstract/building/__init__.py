"""Wildwood M2.3 — 建造系统模块

子模块:
  - schemas:数据类型 + 抽象探针 + 默认实现
  - building_types:7 建筑静态定义
  - placement:三判据 + 实时红/绿验证
  - placement_engine:整合验证 + 扣材料 + 注册栅格
  - examples.m23_demo:端到端 demo

设计原则:
  - A/B 通用层(切换时不重写):纯 stdlib dataclass + enum,零外部依赖。
  - 与 M2.9 合成系统复用 7 个建筑配方(M2.9 制造 → M2.3 落地)。
  - 与 M2.1 移动坐标系一致(32px = 1m)。
"""
from .schemas import (
    BuildingDef,
    BuildingType,
    BuildAction,
    BlockReason,
    PlacementResult,
    PlacementVerdict,
    PlacementGrid,
    FlatTerrainProbe,
    InsetTerrainProbe,
    TerrainProbe,
    OccupancyGrid,
    MaterialStore,
    world_to_cell,
    cell_to_world,
    BUILDING_TYPE_ID,
    ID_TO_BUILDING_TYPE,
    CURRENT_BUILDING_SCHEMA_VERSION,
)
from .building_types import (
    get_building_def,
    all_building_types,
    count_building_types,
    building_id_for_protocol,
)
from .placement import (
    PlacementValidator,
    PlacementContext,
    DEFAULT_MAX_PLACE_RANGE_M,
    evaluate_placement,
)
from .placement_engine import (
    PlacementEngine,
    WorldEventPayload,
    PROTOCOL_KIND_BUILD_DONE,
    place_building,
)

__all__ = [
    "BuildingDef",
    "BuildingType",
    "BuildAction",
    "BlockReason",
    "PlacementResult",
    "PlacementVerdict",
    "PlacementGrid",
    "FlatTerrainProbe",
    "InsetTerrainProbe",
    "TerrainProbe",
    "OccupancyGrid",
    "MaterialStore",
    "world_to_cell",
    "cell_to_world",
    "BUILDING_TYPE_ID",
    "ID_TO_BUILDING_TYPE",
    "CURRENT_BUILDING_SCHEMA_VERSION",
    "get_building_def",
    "all_building_types",
    "count_building_types",
    "building_id_for_protocol",
    "PlacementValidator",
    "PlacementContext",
    "DEFAULT_MAX_PLACE_RANGE_M",
    "evaluate_placement",
    "PlacementEngine",
    "WorldEventPayload",
    "PROTOCOL_KIND_BUILD_DONE",
    "place_building",
]
