"""
Wildwood 数据层 — Schema 版本迁移器(M2.6)

M1.4 已实现 `is_compatible` / `is_newer` / `VersionIncompatibleError`,
M1.4 的 `_check_schema_version` 在 major 不一致时直接抛错。

M2.6 补上真正的迁移能力:
  - 注册迁移函数:`register(version_from, schema_name, fn)`(version_to 隐式 = 链路下一版本)
  - 链式 upgrade:`migrate(data, schema_name, from_v, to_v)` 沿 (major.minor) 链路执行
  - 默认:无注册迁移函数时,空迁移(返回原数据,记录 warning)—— 适用于纯同 major 兼容升级
  - 测试:同一 major 内跨 minor 迁移、不同 major 迁移、缺失迁移函数报错

设计原则:
  - **同 major 视为兼容**:小版本号(minor / patch)的差异不需要迁移,数据已通过 SchemaValidator。
  - **跨 major 视为不兼容,需要迁移**:M1.4 抛 VersionIncompatibleError;M2.6 提供显式 `migrate_to` 升级接口。
  - **迁移函数纯函数**:输入 dict,输出 dict,无副作用(IO / 状态在调用方处理)。

数据示例(从 M1.4 升级到 M1.x):
  - WorldState v1.0.0 → v1.1.0:add `world_seed_hash`(从 `world_seed` 派生,仅缓存用途)。
  - WorldState v1.0.0 → v2.0.0:把 `world_modifications` 拆为 `chunks`,**结构性变化,需迁移**。
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from .schemas import (
    SchemaError,
    is_newer,
    parse_version,
)


class MigrationError(SchemaError):
    """迁移执行失败(找不到迁移函数、链路不完整、目标版本倒退等)。"""


MigrationFunc = Callable[[Dict[str, Any]], Dict[str, Any]]


class SchemaMigrator:
    """
    单例式迁移器,管理 schema_name -> {from_version -> migration_func} 注册表。

    用法:
        migrator = SchemaMigrator()
        migrator.register("world_state", "1.0.0", _v1_0_to_v1_1_world)
        new_data = migrator.migrate("world_state", data, from_v="1.0.0", to_v="1.1.0")
    """

    def __init__(self) -> None:
        # schema_name -> dict[from_version_str, (to_version_str, fn)]
        self._registry: Dict[str, Dict[str, Tuple[str, MigrationFunc]]] = {}

    def register(
        self,
        schema_name: str,
        from_version: str,
        to_version: str,
        func: MigrationFunc,
    ) -> None:
        """
        注册一个迁移函数。from→to 单向;不要求版本相邻(链路式执行时会逐步 upgrade)。

        Raises:
            MigrationError: 重复注册 / 倒退迁移。
        """
        if schema_name not in self._registry:
            self._registry[schema_name] = {}
        if from_version in self._registry[schema_name]:
            raise MigrationError(
                f"重复注册: {schema_name} from {from_version} -> 已存在"
            )
        # 校验 to_version > from_version
        if not is_newer(to_version, from_version):
            raise MigrationError(
                f"to_version 必须是更新的版本: from={from_version}, to={to_version}"
            )
        self._registry[schema_name][from_version] = (to_version, func)

    def has_migration(self, schema_name: str, from_version: str) -> bool:
        return (
            schema_name in self._registry
            and from_version in self._registry[schema_name]
        )

    def migrate(
        self,
        schema_name: str,
        data: Dict[str, Any],
        from_version: str,
        to_version: str,
    ) -> Dict[str, Any]:
        """
        从 from_version 升级到 to_version。沿注册表链路逐步执行。

        - 如果 from == to:返回原数据(无操作)。
        - 如果 from > to:抛 MigrationError(不允许 downgrade,本任务不实现)。
        - 如果存在中间缺失:抛 MigrationError(链路不完整)。
        - 如果数据本身是 forward-compatible(同 major 且 to >= from):只走严格大于的步骤。

        Returns:
            升级后的 data 字典(浅拷贝多次,迁移函数可能 return 新 dict)。
        """
        if from_version == to_version:
            return dict(data)
        if not is_newer(to_version, from_version):
            raise MigrationError(
                f"不支持 downgrade: from={from_version} > to={to_version}"
            )
        registry = self._registry.get(schema_name, {})
        current_version = from_version
        current_data = dict(data)
        # 防止链路死循环(防御性)
        safety = 0
        while current_version != to_version:
            safety += 1
            if safety > 100:
                raise MigrationError(
                    f"迁移链路异常终止(>100 步): {schema_name} {current_version} -> {to_version}"
                )
            entry = registry.get(current_version)
            if entry is None:
                raise MigrationError(
                    f"{schema_name} 缺少从 {current_version} 出发的迁移函数"
                )
            next_version, func = entry
            if not is_newer(next_version, current_version):
                raise MigrationError(
                    f"{schema_name} 迁移链路出现倒退: {current_version} -> {next_version}"
                )
            current_data = func(current_data)
            current_data["schema_version"] = next_version
            current_version = next_version
        return current_data

    def list_known_paths(self, schema_name: str) -> List[Tuple[str, str]]:
        """列出该 schema 已知的所有迁移链路(用于诊断 / 测试)。"""
        return [
            (frm, to) for frm, (to, _) in self._registry.get(schema_name, {}).items()
        ]


# === 模块级单例 ===

_default_migrator: Optional[SchemaMigrator] = None


def get_migrator() -> SchemaMigrator:
    """获取默认迁移器(单例,首次调用时自动装载内置迁移)。"""
    global _default_migrator
    if _default_migrator is None:
        _default_migrator = SchemaMigrator()
        _register_builtin_migrations(_default_migrator)
    return _default_migrator


def reset_migrator() -> None:
    """重置单例(测试用)。"""
    global _default_migrator
    _default_migrator = None


def _register_builtin_migrations(migrator: SchemaMigrator) -> None:
    """
    注册内置迁移函数。

    1) WorldState v1.0.0 -> v1.1.0:
       add `world_seed_hash`(从 `world_seed` 派生,只缓存用途,便于跨进程验证)。
    2) PlayerProfile v1.0.0 -> v1.1.0:
       add `last_known_position` 字段(默认 None,联机断线时最后已知位置)。
    3) WorldState v1.1.0 -> v1.2.0:
       `world_modifications` 拆为 `chunks` 引用,M2.6 分块存储引入。
       注:这里只做字段结构占位,实际 chunk 序列化由 ChunkManager 处理。
    """
    migrator.register(
        "world_state", "1.0.0", "1.1.0", _world_v1_0_to_v1_1
    )
    migrator.register(
        "player_profile", "1.0.0", "1.1.0", _profile_v1_0_to_v1_1
    )
    migrator.register(
        "world_state", "1.1.0", "1.2.0", _world_v1_1_to_v1_2_chunks
    )


def _world_v1_0_to_v1_1(data: Dict[str, Any]) -> Dict[str, Any]:
    """v1.0.0 -> v1.1.0:加 world_seed_hash(从 world_seed 派生)。"""
    out = dict(data)
    seed = out.get("world_seed")
    if seed is not None and "world_seed_hash" not in out:
        # 简单 32-bit hash 即可(实际工程可用 hashlib;但本任务保持 stdlib + 不引入新依赖)
        h = 0
        s = str(seed)
        for ch in s:
            h = ((h * 31) + ord(ch)) & 0xFFFFFFFF
        out["world_seed_hash"] = f"{h:08x}"
    return out


def _profile_v1_0_to_v1_1(data: Dict[str, Any]) -> Dict[str, Any]:
    """v1.0.0 -> v1.1.0:加 last_known_position 字段(联机断线时使用)。"""
    out = dict(data)
    if "last_known_position" not in out:
        out["last_known_position"] = None
    return out


def _world_v1_1_to_v1_2_chunks(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    v1.1.0 -> v1.2.0:把 world_modifications 按 chunk 切分(用坐标 hash 决定 chunk_id)。

    Chunk 切分规则:
      - chunk 大小 = 16x16 tiles(对应 Godot/Unity 网格 16 tile/边)
      - chunk_id = "x:y" where x = floor(tile_x / 16), y = floor(tile_y / 16)
      - 每个 modification 带 `chunk_id` 字段,运行时按 chunk 索引

    注:本迁移是**结构性的**——把 List[Dict] 重排为 Dict[chunk_id, List[Dict]],
    字段含义不变,ChunkManager 在加载时把 chunks 重组回 list。
    """
    out = dict(data)
    mods = out.get("world_modifications", [])
    if not mods:
        # 即使没有 modification,也要初始化 chunks 字段(便于新代码按 chunks 取数)
        out["chunks"] = {}
        return out
    # 如果已经是 chunks 结构,跳过
    if "chunks" in out and "world_modifications" not in out:
        return out
    chunks: Dict[str, list] = {}
    for m in mods:
        pos = m.get("position") or {}
        x = pos.get("x", 0)
        y = pos.get("y", 0)
        cx = int(x // 16)
        cy = int(y // 16)
        cid = f"{cx}:{cy}"
        m2 = dict(m)
        m2["chunk_id"] = cid
        chunks.setdefault(cid, []).append(m2)
    out["chunks"] = chunks
    # 保留 world_modifications 字段(向后兼容旧版读侧),值就是 chunks 平铺
    out["world_modifications"] = [
        m for ms in chunks.values() for m in ms
    ]
    return out


__all__ = [
    "MigrationError",
    "SchemaMigrator",
    "get_migrator",
    "reset_migrator",
]
