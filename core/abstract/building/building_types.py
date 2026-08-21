"""Wildwood M2.3 — 7 建筑静态定义

约束:
  - 与 M2.9 RecipeBook 中 7 个 BUILDING 配方 1:1 对应(共享 result_item_id == type.value)
  - footprint 单位:32px 网格(整数偏移)
  - 命名 / 占地必须与 M2.14 资产清单(美术资源)对齐
"""
from __future__ import annotations

from typing import Dict, Tuple

from .schemas import BuildingDef, BuildingType, BUILDING_TYPE_ID


# === 7 建筑静态定义 ===

_BUILDING_DEFS: Dict[BuildingType, BuildingDef] = {
    BuildingType.CAMPFIRE: BuildingDef(
        type=BuildingType.CAMPFIRE,
        name_zh="营火",
        footprint=((0, 0),),            # 1x1 单格
        max_stack=1,
        is_walkable=True,                # 营火上可走过
    ),
    BuildingType.CHEST: BuildingDef(
        type=BuildingType.CHEST,
        name_zh="箱子",
        footprint=((0, 0),),            # 1x1 单格
        max_stack=99,                   # 箱子可堆叠多个
        is_walkable=False,
    ),
    BuildingType.WORKBENCH: BuildingDef(
        type=BuildingType.WORKBENCH,
        name_zh="工作台",
        footprint=((0, 0), (1, 0)),     # 2x1 双格
        max_stack=1,
        is_walkable=False,
    ),
    BuildingType.COOKPOT: BuildingDef(
        type=BuildingType.COOKPOT,
        name_zh="烹饪锅",
        footprint=((0, 0),),            # 1x1 单格
        max_stack=1,
        is_walkable=True,
    ),
    BuildingType.TENT: BuildingDef(
        type=BuildingType.TENT,
        name_zh="帐篷",
        footprint=((0, 0), (1, 0), (0, 1), (1, 1)),  # 2x2 四格
        max_stack=1,
        is_walkable=False,               # 帐篷内部不可走
    ),
    BuildingType.FIRE_PIT: BuildingDef(
        type=BuildingType.FIRE_PIT,
        name_zh="火坑",
        footprint=((0, 0), (1, 0), (0, 1), (1, 1)),  # 2x2 四格
        max_stack=1,
        is_walkable=True,                # 火坑可走(只是受伤)
    ),
    BuildingType.TORCH_STAND: BuildingDef(
        type=BuildingType.TORCH_STAND,
        name_zh="火把架",
        footprint=((0, 0),),            # 1x1 单格
        max_stack=1,
        is_walkable=True,
    ),
}


def get_building_def(building_type: BuildingType) -> BuildingDef:
    """取建筑静态定义;未知类型抛 KeyError。"""
    return _BUILDING_DEFS[building_type]


def all_building_types() -> Tuple[BuildingType, ...]:
    """返回所有支持的建筑类型(M2.3 任务要求 ≥ 5;本系统提供 7 个)。"""
    return tuple(_BUILDING_DEFS.keys())


def count_building_types() -> int:
    """建筑种类数(验收 ①: >= 5)。"""
    return len(_BUILDING_DEFS)


def building_id_for_protocol(building_type: BuildingType) -> int:
    """协议 WorldEvent.amount 字段使用的建筑 id(1-7)。"""
    return BUILDING_TYPE_ID[building_type]
