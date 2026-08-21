"""
Wildwood 数据层 — A/B 通用层 1(M1.4 + M2.6 关键路径)

A 线(主线,Godot 4.3 + Go 房间服务)与 B 线(备线,Unity 6 + Mirror + .NET 8)共用本层。
任何引擎层读写存档只走 DataStore 抽象接口;实现可换,业务零修改。

公开 API:
  - 数据类:WorldState / PlayerProfile / SaveGame / ClientConnection / PlayerStats / PlayerCurrentState
  - 校验:SchemaValidator
  - 版本:parse_version / is_compatible / is_newer
  - 迁移:SchemaMigrator / get_migrator / MigrationError
  - 分块:TerrainChunk / InventoryChunk / terrain_chunk_id / inventory_chunk_id / split_world_modifications
  - 实现:JsonFileStore(reference, M2.6 默认分块) / MockLiteDbStore(mock, M2.6 加 terrain/inventory collection)
  - 工厂:make_store(backend, **kwargs)— A/B 切换入口

M2.6 升级点:
  - 数据类版本:CURRENT_WORLD_STATE_VERSION / CURRENT_PLAYER_PROFILE_VERSION / CURRENT_SAVE_GAME_VERSION -> "1.2.0" / "1.1.0" / "1.0.0"
  - JsonFileStore 默认 use_chunks=True:terrain/<cid>.json + profiles/<pid>_inventory.json
  - MockLiteDbStore 加 terrain_chunks / inventory_chunks collection
  - DataStore 抽象接口加 6 个 chunk 粒度方法 + save_size_bytes
  - load_* 自动检测 schema_version,旧版本通过 SchemaMigrator 升级

详见:
  - SCHEMAS.md(同目录)— schema 字段文档
  - tests/unit/test_data_layer.py — 单元测试(M2.6 加 ~50 个新测试)
"""

from .chunks import (
    CHUNK_SIZE,
    ChunkFile,
    InventoryChunk,
    TerrainChunk,
    atomic_write_json,
    extract_inventory,
    inject_inventory,
    inventory_chunk_id,
    inventory_file_path,
    list_terrain_chunk_files,
    measure_save_dir_size,
    merge_terrain_chunks,
    read_json,
    split_world_modifications,
    terrain_chunk_file_path,
    terrain_chunk_id,
)
from .migrations import (
    MigrationError,
    SchemaMigrator,
    get_migrator,
    reset_migrator,
)
from .adapter import make_store
from .schemas import (
    CURRENT_PLAYER_PROFILE_VERSION,
    CURRENT_SAVE_GAME_VERSION,
    CURRENT_WORLD_STATE_VERSION,
    BiomeId,
    ClientConnection,
    EntityType,
    GameMode,
    PlayerCurrentState,
    PlayerProfile,
    PlayerStats,
    SaveGame,
    SchemaError,
    SchemaValidator,
    Season,
    VersionIncompatibleError,
    WorldState,
    is_compatible,
    is_newer,
    parse_version,
)
from .store import DataStore, JsonFileStore
from .store_mock import MockLiteDbStore

__all__ = [
    # 数据类
    "WorldState",
    "PlayerProfile",
    "SaveGame",
    "ClientConnection",
    "PlayerStats",
    "PlayerCurrentState",
    # 枚举
    "Season",
    "GameMode",
    "EntityType",
    "BiomeId",
    # 异常
    "SchemaError",
    "VersionIncompatibleError",
    "MigrationError",
    # 版本号
    "parse_version",
    "is_compatible",
    "is_newer",
    # 迁移
    "SchemaMigrator",
    "get_migrator",
    "reset_migrator",
    # 当前版本
    "CURRENT_WORLD_STATE_VERSION",
    "CURRENT_PLAYER_PROFILE_VERSION",
    "CURRENT_SAVE_GAME_VERSION",
    # 校验器
    "SchemaValidator",
    # 分块
    "CHUNK_SIZE",
    "ChunkFile",
    "TerrainChunk",
    "InventoryChunk",
    "terrain_chunk_id",
    "inventory_chunk_id",
    "split_world_modifications",
    "merge_terrain_chunks",
    "extract_inventory",
    "inject_inventory",
    "inventory_file_path",
    "terrain_chunk_file_path",
    "atomic_write_json",
    "read_json",
    "list_terrain_chunk_files",
    "measure_save_dir_size",
    # 抽象 + 实现
    "DataStore",
    "JsonFileStore",
    "MockLiteDbStore",
    # 适配器
    "make_store",
]
