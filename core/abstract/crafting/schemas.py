"""
Wildwood M2.9 — 合成系统 Schema

设计原则(对应项目总方案 §3.3.1 + M2.9 任务):
  - 通用层(A/B 切换时不重写):纯 stdlib,无外部依赖,不绑引擎 API。
  - 配方数据走 schema_version 字段携带版本号;major 不同视为不兼容。
  - Recipe / Ingredient 是 frozen dataclass(配方不可变,运行期只读)。

命名规范:
  - Recipe.id = "craft.<category>.<name>" 全小写下划线
  - 例如 craft.tool.axe / craft.food.cooked_berries / craft.building.campfire

边界:
  - Ingredient.count 必须 > 0
  - Recipe.result_count 必须 > 0
  - Recipe.ingredients 允许空(理论上,虽然不实用),实操中 RecipeBook 不会收入
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Tuple


# === Schema 当前版本(写侧) ===
CURRENT_RECIPE_SCHEMA_VERSION = "1.0.0"

# === 命名规范 ===
_RECIPE_ID_RE = re.compile(r"^craft\.(tool|equipment|food|building)\.[a-z][a-z0-9_]*$")


# === 枚举 ===

class StationType(str, Enum):
    """合成所需的工作站类型。"""
    NONE = "none"          # 徒手合成(无门槛)
    WORKBENCH = "workbench"  # 需要工作台
    COOKPOT = "cookpot"    # 需要烹饪锅


class RecipeCategory(str, Enum):
    """配方类别。对应 UI 中的 tab。"""
    TOOL = "tool"
    EQUIPMENT = "equipment"
    FOOD = "food"
    BUILDING = "building"


# === 异常 ===

class SchemaError(Exception):
    """Schema 结构性或字段校验失败。"""


class VersionIncompatibleError(SchemaError):
    """schema_version major 不一致,需要迁移脚本。"""


# === 版本号工具(从 M1.4 移植,接口一致) ===

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def parse_version(version: str) -> Tuple[int, int, int]:
    """'1.2.3' -> (1, 2, 3)。解析失败抛 SchemaError。"""
    if not isinstance(version, str):
        raise SchemaError(f"版本号必须是 str,实际是 {type(version).__name__}")
    m = _VERSION_RE.match(version.strip())
    if not m:
        raise SchemaError(f"非法 schema 版本号: {version!r}(期望 X.Y.Z)")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def is_compatible(reader_version: str, writer_version: str) -> bool:
    """
    读侧(reader)能否解析写侧(writer)写入的数据。
    同一 major 版本视为兼容;不同 major 不兼容(需要迁移)。
    """
    r = parse_version(reader_version)
    w = parse_version(writer_version)
    return r[0] == w[0]


# === 数据类 ===

@dataclass(frozen=True)
class Ingredient:
    """合成所需的一种材料。"""
    item_id: str
    count: int

    def __post_init__(self) -> None:
        if not isinstance(self.item_id, str) or not self.item_id.strip():
            raise ValueError(f"Ingredient.item_id 必须是非空字符串,实际是 {self.item_id!r}")
        if not isinstance(self.count, int) or isinstance(self.count, bool):
            raise ValueError(f"Ingredient.count 必须是 int,实际是 {type(self.count).__name__}: {self.count!r}")
        if self.count <= 0:
            raise ValueError(f"Ingredient.count 必须 > 0,实际是 {self.count}")


@dataclass(frozen=True)
class CraftingResult:
    """合成引擎产出的结果描述(供 UI 反馈 + 上层落库)。"""
    recipe_id: str
    produced: Tuple[Ingredient, ...]
    consumed: Tuple[Ingredient, ...]


@dataclass(frozen=True)
class Recipe:
    """单个合成配方。frozen:运行期不可变。"""
    id: str
    name: str
    category: RecipeCategory
    station: StationType
    ingredients: Tuple[Ingredient, ...]
    result_item_id: str
    result_count: int
    schema_version: str = CURRENT_RECIPE_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not _RECIPE_ID_RE.match(self.id):
            raise ValueError(
                f"Recipe.id 必须匹配 ^craft\\.(tool|equipment|food|building)\\.[a-z][a-z0-9_]*$,"
                f"实际是 {self.id!r}"
            )
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError(f"Recipe.name 必须是非空字符串,实际是 {self.name!r}")
        if not isinstance(self.category, RecipeCategory):
            raise ValueError(f"Recipe.category 必须是 RecipeCategory,实际是 {type(self.category).__name__}")
        if not isinstance(self.station, StationType):
            raise ValueError(f"Recipe.station 必须是 StationType,实际是 {type(self.station).__name__}")
        if not isinstance(self.ingredients, tuple):
            raise ValueError(f"Recipe.ingredients 必须是 tuple,实际是 {type(self.ingredients).__name__}")
        for ing in self.ingredients:
            if not isinstance(ing, Ingredient):
                raise ValueError(f"Recipe.ingredients 元素必须是 Ingredient,实际是 {type(ing).__name__}")
        if not isinstance(self.result_item_id, str) or not self.result_item_id.strip():
            raise ValueError(f"Recipe.result_item_id 必须是非空字符串,实际是 {self.result_item_id!r}")
        if not isinstance(self.result_count, int) or isinstance(self.result_count, bool):
            raise ValueError(
                f"Recipe.result_count 必须是 int,实际是 {type(self.result_count).__name__}: {self.result_count!r}"
            )
        if self.result_count <= 0:
            raise ValueError(f"Recipe.result_count 必须 > 0,实际是 {self.result_count}")
        # 注:RecipeCategory 与 id 前缀一致性由 RecipeBook 强制(因为 dataclass 不能引用外部模块);
        # 不在此处校验,避免循环依赖。
