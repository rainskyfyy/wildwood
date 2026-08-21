"""
Wildwood 数据层 — Schema 定义 + 校验器 + 版本号兼容判断

设计原则(对应项目总方案 §3.3.1):
  - 通用层(A/B 切换时不重写):纯 stdlib,无外部依赖,不绑引擎 API。
  - 所有数据通过 schema_version 字段携带语义化版本号(X.Y.Z)。
  - 读侧 schema 等于 current_major 时兼容;不同 major 视为不兼容,需要迁移脚本。

向后兼容规则(详见 is_compatible):
  - 同一 major 版本(1.x.y)视为兼容;允许字段新增/默认值变更/类型放宽。
  - 不同 major(1.x.y vs 2.x.y)抛 VersionIncompatibleError。

M2.6 升级:
  - CURRENT_WORLD_STATE_VERSION: 1.0.0 -> 1.2.0
      v1.1.0 新增 world_seed_hash(从 world_seed 派生的缓存字段,便于跨进程验证)
      v1.2.0 新增 chunks:Dict[chunk_id, List[modification]] (分块存储的索引)
  - CURRENT_PLAYER_PROFILE_VERSION: 1.0.0 -> 1.1.0
      v1.1.0 新增 last_known_position:Optional[Dict] (联机断线最后已知位置)
      v1.1.0 新增 inventory_capacity:int (M2.6 引入,默认 16)
  - CURRENT_SAVE_GAME_VERSION: 1.0.0 -> 1.0.0(无结构变化)
  - 字段新增都使用 Optional/默认值,旧数据反序列化时不会出错(校验器 _check_optional_field 处理)。

单元测试入口:tests/unit/test_data_layer.py
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


# === Schema 当前版本(写侧) ===
# 修改这些常量即代表 schema 升级;读侧在 validate_xxx 中会拒绝 major 不一致的旧数据。

CURRENT_WORLD_STATE_VERSION = "1.2.0"
CURRENT_PLAYER_PROFILE_VERSION = "1.1.0"
CURRENT_SAVE_GAME_VERSION = "1.0.0"

# === 枚举 ===

class Season(str, Enum):
    """四季。对应方案 §2.7。"""
    SPRING = "spring"
    SUMMER = "summer"
    AUTUMN = "autumn"
    WINTER = "winter"


class GameMode(str, Enum):
    """游戏模式(单机 / 主机 / 联机客户端)。"""
    SINGLE = "single"
    HOST = "host"
    CLIENT = "client"


class EntityType(str, Enum):
    """世界实体大类。"""
    PLAYER = "player"
    MONSTER = "monster"
    RESOURCE = "resource"
    BUILDING = "building"
    ITEM_DROP = "item_drop"


class BiomeId(str, Enum):
    """生物群系 ID(对应方案 §2.6)。"""
    FOREST = "forest"
    PLAINS = "plains"
    DESERT = "desert"
    SNOW = "snow"
    MARSH = "marsh"
    LAVA = "lava"  # v1.1


# === 异常 ===

class SchemaError(Exception):
    """Schema 结构性或字段校验失败。"""


class VersionIncompatibleError(SchemaError):
    """schema_version major 不一致,需要迁移脚本。"""


# === 版本号工具 ===

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


def is_newer(a: str, b: str) -> bool:
    """a > b,用于决定是否需要 schema 迁移。"""
    return parse_version(a) > parse_version(b)


# === 数据类 ===

@dataclass
class PlayerStats:
    """四维属性上限(方案 §2.1 生存属性)。"""
    hp_max: float = 100.0
    hunger_max: float = 100.0
    sanity_max: float = 100.0
    temperature_max: float = 100.0


@dataclass
class PlayerCurrentState:
    """四维属性当前值。"""
    hp: float = 100.0
    hunger: float = 100.0
    sanity: float = 100.0
    temperature: float = 50.0  # 中性温度(摄氏度偏移无关紧要,只用于相对判定)

    def is_critical(self) -> bool:
        return any(v < 30.0 for v in (self.hp, self.hunger, self.sanity, self.temperature))


@dataclass
class WorldState:
    """
    世界状态 schema。

    注意:players 字段是 player_id -> 内嵌数据(位置/当前状态等),不直接放 PlayerProfile;
    PlayerProfile 单独存放在 SaveGame.player_profiles,这里只保留"在世界中的位置信息"。
    这样可让 WorldState 的序列化体积在大量实体时可控(方案 §3.4 同步包 < 4KB/tick)。

    M2.6 字段:
      - world_seed_hash:str(M2.6 v1.1.0 新增)从 world_seed 派生的缓存字段,便于跨进程验证。
      - chunks:Dict[chunk_id, List[modification]](M2.6 v1.2.0 新增)按 16x16 tile 切分的 modification 索引;
        真实持久化由 ChunkManager 切分/重组,这里保留 inline 视图便于单文件读侧。
    """
    schema_version: str
    world_id: str
    world_seed: int
    created_at: float
    day: int
    season: str
    time_of_day: float
    day_in_season: int
    biome_layout: Dict[str, Any]
    players: Dict[str, Dict[str, Any]]
    entities: Dict[str, Dict[str, Any]]
    world_modifications: List[Dict[str, Any]]
    world_seed_hash: Optional[str] = None  # v1.1.0
    chunks: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)  # v1.2.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def create_new(
        cls,
        world_seed: int,
        biome_layout: Optional[Dict[str, Any]] = None,
    ) -> "WorldState":
        # v1.1.0 同步计算 world_seed_hash
        h = 0
        s = str(world_seed)
        for ch in s:
            h = ((h * 31) + ord(ch)) & 0xFFFFFFFF
        return cls(
            schema_version=CURRENT_WORLD_STATE_VERSION,
            world_id=str(uuid.uuid4()),
            world_seed=world_seed,
            created_at=time.time(),
            day=1,
            season=Season.SPRING.value,
            time_of_day=0.5,
            day_in_season=1,
            biome_layout=biome_layout or {},
            players={},
            entities={},
            world_modifications=[],
            world_seed_hash=f"{h:08x}",
            chunks={},
        )


@dataclass
class PlayerProfile:
    """玩家档案 schema(独立于 WorldState 持久化)。

    M2.6 字段:
      - last_known_position:Optional[Dict](M2.6 v1.1.0 新增)联机断线时的最后已知位置。
      - inventory_capacity:int(M2.6 v1.1.0 新增)背包上限,默认 16(方案 §2.5)。
    """
    schema_version: str
    player_id: str
    display_name: str
    character_class: str
    appearance: Dict[str, Any]
    stats: PlayerStats
    current_state: PlayerCurrentState
    inventory: Dict[str, int]      # item_id -> count
    equipment: Dict[str, Optional[str]]  # slot -> item_id(None 表示空)
    buffs: List[Dict[str, Any]]
    unlocked_codex: List[str]
    deaths: int
    survival_days: int
    last_known_position: Optional[Dict[str, Any]] = None  # v1.1.0
    inventory_capacity: int = 16  # v1.1.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "player_id": self.player_id,
            "display_name": self.display_name,
            "character_class": self.character_class,
            "appearance": self.appearance,
            "stats": asdict(self.stats),
            "current_state": asdict(self.current_state),
            "inventory": self.inventory,
            "equipment": self.equipment,
            "buffs": self.buffs,
            "unlocked_codex": self.unlocked_codex,
            "deaths": self.deaths,
            "survival_days": self.survival_days,
            "last_known_position": self.last_known_position,
            "inventory_capacity": self.inventory_capacity,
        }

    @classmethod
    def create_new(
        cls,
        display_name: str,
        character_class: str = "scout",
    ) -> "PlayerProfile":
        if character_class not in ("scout", "builder", "warrior", "gatherer"):
            raise SchemaError(f"character_class 非法: {character_class!r}")
        return cls(
            schema_version=CURRENT_PLAYER_PROFILE_VERSION,
            player_id=str(uuid.uuid4()),
            display_name=display_name,
            character_class=character_class,
            appearance={},
            stats=PlayerStats(),
            current_state=PlayerCurrentState(),
            inventory={},
            equipment={
                "head": None,
                "body": None,
                "hand_main": None,
                "hand_off": None,
            },
            buffs=[],
            unlocked_codex=[],
            deaths=0,
            survival_days=0,
            last_known_position=None,
            inventory_capacity=16,
        )


@dataclass
class ClientConnection:
    """联机客户端连接状态(方案 §5.4 断线重连)。"""
    player_id: str
    last_seen: float
    connection_state: str  # "connected" | "reconnecting" | "offline"


@dataclass
class SaveGame:
    """完整存档 schema:世界状态 + 玩家档案 + 联机元信息。"""
    schema_version: str
    save_id: str
    created_at: float
    updated_at: float
    game_mode: str
    host_player_id: str
    world_state: Dict[str, Any]                       # inline WorldState
    player_profiles: Dict[str, Dict[str, Any]]        # player_id -> inline PlayerProfile
    clients: List[ClientConnection]
    settings: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "save_id": self.save_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "game_mode": self.game_mode,
            "host_player_id": self.host_player_id,
            "world_state": self.world_state,
            "player_profiles": self.player_profiles,
            "clients": [asdict(c) for c in self.clients],
            "settings": self.settings,
        }

    @classmethod
    def from_world_and_profiles(
        cls,
        world: WorldState,
        profiles: Dict[str, PlayerProfile],
        host_player_id: str,
        game_mode: str = GameMode.SINGLE.value,
        settings: Optional[Dict[str, Any]] = None,
    ) -> "SaveGame":
        if game_mode not in [m.value for m in GameMode]:
            raise SchemaError(f"game_mode 非法: {game_mode!r}")
        now = time.time()
        return cls(
            schema_version=CURRENT_SAVE_GAME_VERSION,
            save_id=str(uuid.uuid4()),
            created_at=now,
            updated_at=now,
            game_mode=game_mode,
            host_player_id=host_player_id,
            world_state=world.to_dict(),
            player_profiles={
                pid: profile.to_dict() for pid, profile in profiles.items()
            },
            clients=[],
            settings=settings or {},
        )


# === 重建辅助函数(DataStore 加载侧使用) ===

def stats_from_dict(d: Dict[str, Any]) -> PlayerStats:
    return PlayerStats(**d)


def current_state_from_dict(d: Dict[str, Any]) -> PlayerCurrentState:
    return PlayerCurrentState(**d)


def profile_from_dict(d: Dict[str, Any]) -> PlayerProfile:
    # M2.6 v1.1.0 新字段:last_known_position / inventory_capacity
    return PlayerProfile(
        schema_version=d["schema_version"],
        player_id=d["player_id"],
        display_name=d["display_name"],
        character_class=d["character_class"],
        appearance=d.get("appearance", {}),
        stats=stats_from_dict(d["stats"]),
        current_state=current_state_from_dict(d["current_state"]),
        inventory=dict(d.get("inventory", {})),
        equipment=dict(d.get("equipment", {})),
        buffs=list(d.get("buffs", [])),
        unlocked_codex=list(d.get("unlocked_codex", [])),
        deaths=int(d.get("deaths", 0)),
        survival_days=int(d.get("survival_days", 0)),
        last_known_position=d.get("last_known_position"),
        inventory_capacity=int(d.get("inventory_capacity", 16)),
    )


# === 校验器 ===

class SchemaValidator:
    """
    Schema 结构性 + 类型 + 范围校验器。
    不依赖 jsonschema,纯 stdlib,保持 A/B 通用层零外部依赖。
    """

    SCHEMAS = {
        "world_state": CURRENT_WORLD_STATE_VERSION,
        "player_profile": CURRENT_PLAYER_PROFILE_VERSION,
        "save_game": CURRENT_SAVE_GAME_VERSION,
    }

    @classmethod
    def validate_world_state(cls, data: Any) -> Dict[str, Any]:
        if not isinstance(data, dict):
            raise SchemaError(f"WorldState 必须是 dict,实际是 {type(data).__name__}")
        cls._check_schema_version("world_state", data.get("schema_version"))
        required = [
            "schema_version", "world_id", "world_seed", "created_at",
            "day", "season", "time_of_day", "day_in_season",
            "biome_layout", "players", "entities", "world_modifications",
        ]
        for key in required:
            if key not in data:
                raise SchemaError(f"WorldState 缺少字段: {key!r}")
        if not isinstance(data["world_id"], str) or not data["world_id"]:
            raise SchemaError("world_id 必须是非空字符串")
        if not isinstance(data["world_seed"], int) or isinstance(data["world_seed"], bool):
            raise SchemaError("world_seed 必须是 int(非 bool)")
        if not isinstance(data["created_at"], (int, float)):
            raise SchemaError("created_at 必须是 number")
        if not isinstance(data["day"], int) or data["day"] < 1:
            raise SchemaError("day 必须是 >= 1 的 int")
        if data["season"] not in [s.value for s in Season]:
            raise SchemaError(f"season 非法: {data['season']!r}")
        if not (0.0 <= data["time_of_day"] <= 1.0):
            raise SchemaError("time_of_day 必须在 [0.0, 1.0]")
        if not isinstance(data["day_in_season"], int) or data["day_in_season"] < 1:
            raise SchemaError("day_in_season 必须是 >= 1 的 int")
        if not isinstance(data["biome_layout"], dict):
            raise SchemaError("biome_layout 必须是 dict")
        if not isinstance(data["players"], dict):
            raise SchemaError("players 必须是 dict")
        if not isinstance(data["entities"], dict):
            raise SchemaError("entities 必须是 dict")
        if not isinstance(data["world_modifications"], list):
            raise SchemaError("world_modifications 必须是 list")
        # M2.6 v1.1.0+ 字段
        if "world_seed_hash" in data and not isinstance(data["world_seed_hash"], (str, type(None))):
            raise SchemaError("world_seed_hash 必须是 str 或 None")
        if "chunks" in data and not isinstance(data["chunks"], dict):
            raise SchemaError("chunks 必须是 dict")
        return data

    @classmethod
    def validate_player_profile(cls, data: Any) -> Dict[str, Any]:
        if not isinstance(data, dict):
            raise SchemaError(f"PlayerProfile 必须是 dict,实际是 {type(data).__name__}")
        cls._check_schema_version("player_profile", data.get("schema_version"))
        required = [
            "schema_version", "player_id", "display_name", "character_class",
            "appearance", "stats", "current_state", "inventory",
            "equipment", "buffs", "unlocked_codex", "deaths", "survival_days",
        ]
        for key in required:
            if key not in data:
                raise SchemaError(f"PlayerProfile 缺少字段: {key!r}")
        if not data["display_name"]:
            raise SchemaError("display_name 必须非空")
        if data["character_class"] not in ("scout", "builder", "warrior", "gatherer"):
            raise SchemaError(f"character_class 非法: {data['character_class']!r}")
        if not isinstance(data["stats"], dict):
            raise SchemaError("stats 必须是 dict")
        for k in ("hp_max", "hunger_max", "sanity_max", "temperature_max"):
            if k not in data["stats"] or not isinstance(data["stats"][k], (int, float)):
                raise SchemaError(f"stats.{k} 必须是 number")
            if data["stats"][k] <= 0:
                raise SchemaError(f"stats.{k} 必须是正数")
        if not isinstance(data["current_state"], dict):
            raise SchemaError("current_state 必须是 dict")
        for k in ("hp", "hunger", "sanity", "temperature"):
            if k not in data["current_state"] or not isinstance(data["current_state"][k], (int, float)):
                raise SchemaError(f"current_state.{k} 必须是 number")
        if not isinstance(data["inventory"], dict):
            raise SchemaError("inventory 必须是 dict")
        if not all(isinstance(v, int) and v >= 0 for v in data["inventory"].values()):
            raise SchemaError("inventory 值必须是非负整数")
        if not isinstance(data["equipment"], dict):
            raise SchemaError("equipment 必须是 dict")
        if not isinstance(data["buffs"], list):
            raise SchemaError("buffs 必须是 list")
        if not isinstance(data["unlocked_codex"], list):
            raise SchemaError("unlocked_codex 必须是 list")
        if not isinstance(data["deaths"], int) or data["deaths"] < 0:
            raise SchemaError("deaths 必须是非负整数")
        if not isinstance(data["survival_days"], int) or data["survival_days"] < 0:
            raise SchemaError("survival_days 必须是非负整数")
        # M2.6 v1.1.0+ 字段
        if "last_known_position" in data and not isinstance(data["last_known_position"], (dict, type(None))):
            raise SchemaError("last_known_position 必须是 dict 或 None")
        if "inventory_capacity" in data:
            if not isinstance(data["inventory_capacity"], int) or data["inventory_capacity"] <= 0:
                raise SchemaError("inventory_capacity 必须是正整数")
        return data

    @classmethod
    def validate_save_game(cls, data: Any) -> Dict[str, Any]:
        if not isinstance(data, dict):
            raise SchemaError(f"SaveGame 必须是 dict,实际是 {type(data).__name__}")
        cls._check_schema_version("save_game", data.get("schema_version"))
        required = [
            "schema_version", "save_id", "created_at", "updated_at",
            "game_mode", "host_player_id", "world_state",
            "player_profiles", "clients", "settings",
        ]
        for key in required:
            if key not in data:
                raise SchemaError(f"SaveGame 缺少字段: {key!r}")
        if not isinstance(data["save_id"], str) or not data["save_id"]:
            raise SchemaError("save_id 必须是非空字符串")
        if data["game_mode"] not in [m.value for m in GameMode]:
            raise SchemaError(f"game_mode 非法: {data['game_mode']!r}")
        # 内嵌校验
        cls.validate_world_state(data["world_state"])
        if not isinstance(data["player_profiles"], dict):
            raise SchemaError("player_profiles 必须是 dict")
        for pid, profile in data["player_profiles"].items():
            if not isinstance(profile, dict):
                raise SchemaError(f"player_profiles[{pid!r}] 必须是 dict")
            cls.validate_player_profile(profile)
        if not isinstance(data["clients"], list):
            raise SchemaError("clients 必须是 list")
        if not isinstance(data["settings"], dict):
            raise SchemaError("settings 必须是 dict")
        return data

    @classmethod
    def _check_schema_version(cls, schema_name: str, version: Any) -> None:
        if version is None:
            raise SchemaError(f"{schema_name}.schema_version 缺失")
        if not isinstance(version, str):
            raise SchemaError(f"{schema_name}.schema_version 必须是 str")
        current = cls.SCHEMAS[schema_name]
        if not is_compatible(current, version):
            raise VersionIncompatibleError(
                f"{schema_name} 版本不兼容: reader={current}, writer={version}, "
                f"major 版本号不同,需要迁移脚本(本任务不实现迁移,后续 W3-M2.x 补)"
            )


__all__ = [
    "CURRENT_WORLD_STATE_VERSION",
    "CURRENT_PLAYER_PROFILE_VERSION",
    "CURRENT_SAVE_GAME_VERSION",
    "Season", "GameMode", "EntityType", "BiomeId",
    "SchemaError", "VersionIncompatibleError",
    "parse_version", "is_compatible", "is_newer",
    "PlayerStats", "PlayerCurrentState",
    "WorldState", "PlayerProfile", "ClientConnection", "SaveGame",
    "stats_from_dict", "current_state_from_dict", "profile_from_dict",
    "SchemaValidator",
]
