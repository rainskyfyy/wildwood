"""
Wildwood 数据层 — A/B 通用层 1(M1.4 关键路径)

A 线(主线,Godot 4.3 + Go 房间服务)与 B 线(备线,Unity 6 + Mirror + .NET 8)共用本层。
任何引擎层读写存档只走 DataStore 抽象接口;实现可换,业务零修改。

公开 API:
  - 数据类:WorldState / PlayerProfile / SaveGame / ClientConnection / PlayerStats / PlayerCurrentState
  - 校验:SchemaValidator
  - 版本:parse_version / is_compatible / is_newer
  - 实现:JsonFileStore(reference) / MockLiteDbStore(mock,模拟 LiteDB 语义)
  - 工厂:make_store(backend, **kwargs)— A/B 切换入口

详见:
  - SCHEMAS.md(同目录)— schema 字段文档
  - tests/unit/test_data_layer.py — 单元测试
"""

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
    # 版本号
    "parse_version",
    "is_compatible",
    "is_newer",
    "CURRENT_WORLD_STATE_VERSION",
    "CURRENT_PLAYER_PROFILE_VERSION",
    "CURRENT_SAVE_GAME_VERSION",
    # 校验器
    "SchemaValidator",
    # 抽象 + 实现
    "DataStore",
    "JsonFileStore",
    "MockLiteDbStore",
    # 适配器
    "make_store",
]
