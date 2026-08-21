"""
Wildwood 数据层 — Mock 实现(模拟 B 线 LiteDB 的"单文件嵌入式 NoSQL",M2.6 升级:分块)

设计动机(对应项目总方案 §3.2 / §3.3.1):
  - B 线使用 LiteDB(.NET 嵌入式 NoSQL,单文件 .db)。
  - 本 mock 不引入 LiteDB 二进制(沙箱无 .NET 运行时),只模拟其语义:
      * 单文件持久化(整个数据库存成 1 个 JSON 文件)
      * 多 collection(集合):saves / world_states / player_profiles / terrain_chunks / inventory_chunks
      * 通过 doc_id 主键存取(BsonId 风格)
  - 暴露 LiteRepository 风格的 insert_one / find_one / update_one / delete_one,
    便于 A→B 切换时直接映射到 LiteRepository<T>()。

M2.6 升级:
  - terrain_chunks 集合:每个 terrain chunk 一个文档,doc_id = chunk_id
  - inventory_chunks 集合:每个玩家库存一个文档,doc_id = inventory_chunk_id(player_id)
  - saves 集合不再冗余 world_modifications / inventory(切到独立 collection,真 LiteDB 风格)
  - 跨模式:同 JsonFileStore,mode 字段决定行为
  - save_size_bytes:返回整个 db 文件的字节数(因为 mock 是单文件)

性能说明:
  - 每次写都 flush 到磁盘(模拟 LiteDB 持久化),不做缓冲,便于测试一致性。
  - M3 联机场景会替换为 LiteDB + MemoryCache,本 mock 只用于 A/B 切换契约验证。
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .chunks import (
    InventoryChunk,
    TerrainChunk,
    extract_inventory,
    inject_inventory,
    inventory_chunk_id,
    merge_terrain_chunks,
    split_world_modifications,
    terrain_chunk_id,
)
from .migrations import get_migrator
from .schemas import (
    CURRENT_PLAYER_PROFILE_VERSION,
    CURRENT_SAVE_GAME_VERSION,
    CURRENT_WORLD_STATE_VERSION,
    ClientConnection,
    PlayerProfile,
    SaveGame,
    SchemaError,
    SchemaValidator,
    VersionIncompatibleError,
    WorldState,
    is_compatible,
    is_newer,
    profile_from_dict,
)
from .store import DataStore


class MockLiteDbStore(DataStore):
    """单文件 JSON 数据库,模拟 LiteDB 的 collection/document 模型(M2.6 加 chunk collection)。"""

    SCHEMA_VERSION = "2.0.0"  # 本数据库文件自身的 schema

    def __init__(self, db_path: str | Path):
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._init_empty_db()
        self._cache: Optional[Dict[str, Any]] = None

    def _init_empty_db(self) -> None:
        db = {
            "version": self.SCHEMA_VERSION,
            "collections": {
                "saves": {},
                "world_states": {},
                "player_profiles": {},
                "terrain_chunks": {},
                "inventory_chunks": {},
            },
        }
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)

    def _load(self) -> Dict[str, Any]:
        if self._cache is None:
            with open(self.path, "r", encoding="utf-8") as f:
                self._cache = json.load(f)
        return self._cache

    def _flush(self) -> None:
        if self._cache is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".tmp_litedb_", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)
        except Exception:
            if os.path.exists(tmp):
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
            raise

    def _invalidate(self) -> None:
        self._cache = None

    # --- LiteDB 风格 API(供 B 线代码参考) ---
    def collection(self, name: str) -> Dict[str, Any]:
        db = self._load()
        if name not in db["collections"]:
            raise KeyError(f"collection 不存在: {name!r}")
        return db["collections"][name]

    def insert_one(self, collection_name: str, doc_id: str, doc: Dict[str, Any]) -> None:
        coll = self.collection(collection_name)
        if doc_id in coll:
            raise ValueError(f"已存在 {collection_name}.{doc_id}")
        coll[doc_id] = doc
        self._flush()

    def update_one(self, collection_name: str, doc_id: str, doc: Dict[str, Any]) -> None:
        coll = self.collection(collection_name)
        coll[doc_id] = doc
        self._flush()

    def find_one(self, collection_name: str, doc_id: str) -> Dict[str, Any]:
        coll = self.collection(collection_name)
        if doc_id not in coll:
            raise KeyError(f"未找到 {collection_name}.{doc_id}")
        return coll[doc_id]

    def delete_one(self, collection_name: str, doc_id: str) -> bool:
        coll = self.collection(collection_name)
        if doc_id in coll:
            del coll[doc_id]
            self._flush()
            return True
        return False

    def count(self, collection_name: str) -> int:
        return len(self.collection(collection_name))

    # --- 迁移工具(同 JsonFileStore) ---
    def _migrate_world_state(self, ws: Dict[str, Any]) -> Dict[str, Any]:
        cur = ws.get("schema_version")
        if cur is None:
            raise SchemaError("WorldState 缺少 schema_version")
        if not is_compatible(CURRENT_WORLD_STATE_VERSION, cur) and not is_compatible(cur, CURRENT_WORLD_STATE_VERSION):
            raise VersionIncompatibleError(
                f"WorldState 无法迁移: reader={CURRENT_WORLD_STATE_VERSION}, writer={cur}"
            )
        if cur == CURRENT_WORLD_STATE_VERSION:
            return ws
        if is_newer(CURRENT_WORLD_STATE_VERSION, cur):
            return get_migrator().migrate("world_state", ws, cur, CURRENT_WORLD_STATE_VERSION)
        raise VersionIncompatibleError(
            f"WorldState 比 reader 新: reader={CURRENT_WORLD_STATE_VERSION}, writer={cur}"
        )

    def _migrate_profile(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        cur = profile.get("schema_version")
        if cur is None:
            raise SchemaError("PlayerProfile 缺少 schema_version")
        if not is_compatible(CURRENT_PLAYER_PROFILE_VERSION, cur) and not is_compatible(cur, CURRENT_PLAYER_PROFILE_VERSION):
            raise VersionIncompatibleError(
                f"PlayerProfile 无法迁移: reader={CURRENT_PLAYER_PROFILE_VERSION}, writer={cur}"
            )
        if cur == CURRENT_PLAYER_PROFILE_VERSION:
            return profile
        if is_newer(CURRENT_PLAYER_PROFILE_VERSION, cur):
            return get_migrator().migrate("player_profile", profile, cur, CURRENT_PLAYER_PROFILE_VERSION)
        raise VersionIncompatibleError(
            f"PlayerProfile 比 reader 新: reader={CURRENT_PLAYER_PROFILE_VERSION}, writer={cur}"
        )

    def _migrate_save_game(self, save_data: Dict[str, Any]) -> Dict[str, Any]:
        cur = save_data.get("schema_version")
        if cur is None:
            raise SchemaError("SaveGame 缺少 schema_version")
        if not is_compatible(CURRENT_SAVE_GAME_VERSION, cur) and not is_compatible(cur, CURRENT_SAVE_GAME_VERSION):
            raise VersionIncompatibleError(
                f"SaveGame 跨 major 无法迁移: reader={CURRENT_SAVE_GAME_VERSION}, writer={cur}"
            )
        if cur == CURRENT_SAVE_GAME_VERSION:
            return save_data
        if is_newer(CURRENT_SAVE_GAME_VERSION, cur):
            return get_migrator().migrate("save_game", save_data, cur, CURRENT_SAVE_GAME_VERSION)
        # writer 比 reader 新 — 不在 M2.6 范围
        raise VersionIncompatibleError(
            f"SaveGame 比 reader 新: reader={CURRENT_SAVE_GAME_VERSION}, writer={cur}"
        )

    def _purge_chunks_for_save(self, save_id: str) -> None:
        """删除该 save_id 关联的所有 chunk 文档(terrain / inventory)。"""
        # 这里采用 doc_id 前缀策略,简单可靠
        terrain = self.collection("terrain_chunks")
        inventory = self.collection("inventory_chunks")
        # 地形 chunk doc_id = "{save_id}::{chunk_id}"(加 save_id 前缀以支持多 save 隔离)
        prefix_t = f"{save_id}::"
        for k in list(terrain.keys()):
            if k.startswith(prefix_t):
                del terrain[k]
        # 库存 chunk doc_id = "{save_id}::inv::{player_id}"
        prefix_i = f"{save_id}::inv::"
        for k in list(inventory.keys()):
            if k.startswith(prefix_i):
                del inventory[k]
        self._flush()

    # --- DataStore 接口实现 ---
    def list_saves(self) -> List[Dict[str, Any]]:
        coll = self.collection("saves")
        out: List[Dict[str, Any]] = []
        for save in coll.values():
            out.append({
                "save_id": save["save_id"],
                "game_mode": save["game_mode"],
                "created_at": save["created_at"],
                "updated_at": save["updated_at"],
                "host_player_id": save["host_player_id"],
            })
        return out

    def exists(self, save_id: str) -> bool:
        try:
            self.find_one("saves", save_id)
            return True
        except KeyError:
            return False

    def load_save(self, save_id: str) -> SaveGame:
        save = self.find_one("saves", save_id)
        # 迁移 + 重组 chunks
        ws = save["world_state"]
        ws = self._migrate_world_state(ws)
        # 加载 terrain chunks
        terrain = self.collection("terrain_chunks")
        prefix_t = f"{save_id}::"
        terrain_chunks: Dict[str, TerrainChunk] = {}
        for k, v in terrain.items():
            if k.startswith(prefix_t):
                cid = k[len(prefix_t):]
                terrain_chunks[cid] = TerrainChunk.from_dict(v)
        ws["world_modifications"] = merge_terrain_chunks(terrain_chunks)
        # 迁移 + 加载 profiles
        profiles: Dict[str, Dict[str, Any]] = {}
        for pid, pdata in save["player_profiles"].items():
            pdata = self._migrate_profile(pdata)
            profiles[pid] = pdata
        # 加载 inventory chunks
        inventory_coll = self.collection("inventory_chunks")
        prefix_i = f"{save_id}::inv::"
        for pid in list(profiles.keys()):
            key = f"{prefix_i}{pid}"
            if key in inventory_coll:
                inv_chunk = InventoryChunk.from_dict(inventory_coll[key])
                profiles[pid] = inject_inventory(profiles[pid], inv_chunk)
        SchemaValidator.validate_world_state(ws)
        for pid, pdata in profiles.items():
            SchemaValidator.validate_player_profile(pdata)
        clients = [ClientConnection(**c) for c in save.get("clients", [])]
        save_data = {
            "schema_version": save["schema_version"],
            "save_id": save["save_id"],
            "created_at": save["created_at"],
            "updated_at": save["updated_at"],
            "game_mode": save["game_mode"],
            "host_player_id": save["host_player_id"],
            "world_state": ws,
            "player_profiles": profiles,
            "clients": [c.__dict__ for c in clients],
            "settings": save.get("settings", {}),
        }
        save_data = self._migrate_save_game(save_data)
        SchemaValidator.validate_save_game(save_data)
        return SaveGame(
            schema_version=save_data["schema_version"],
            save_id=save_data["save_id"],
            created_at=save_data["created_at"],
            updated_at=save_data["updated_at"],
            game_mode=save_data["game_mode"],
            host_player_id=save_data["host_player_id"],
            world_state=save_data["world_state"],
            player_profiles=save_data["player_profiles"],
            clients=clients,
            settings=save_data["settings"],
        )

    def save_save(self, save: SaveGame) -> None:
        SchemaValidator.validate_save_game(save.to_dict())
        # 写 saves 集合(剔除 world_modifications/chunks,留空列表;剔除 profile inventory,留空)
        save_doc = save.to_dict()
        ws_doc = dict(save_doc["world_state"])
        world_mods = ws_doc.pop("world_modifications", [])
        ws_doc["world_modifications"] = []  # chunks 是真相
        ws_doc["chunks"] = {}
        save_doc["world_state"] = ws_doc
        # 切分 profile inventory
        profiles_doc: Dict[str, Dict[str, Any]] = {}
        inventory_chunks: Dict[str, InventoryChunk] = {}
        for pid, pdata in save.player_profiles.items():
            pdata2 = dict(pdata)
            inv_chunk = extract_inventory(pdata2)
            pdata2["inventory"] = dict(inv_chunk.items)
            pdata2["inventory_capacity"] = int(inv_chunk.capacity)
            profiles_doc[pid] = pdata2
            inventory_chunks[pid] = inv_chunk
        save_doc["player_profiles"] = profiles_doc
        self.collection("saves")[save.save_id] = save_doc
        # 冗余写入子集合(world_states)
        self.collection("world_states")[ws_doc.get("world_id", "")] = ws_doc
        # 冗余写入 player_profiles 集合
        for pid, p in profiles_doc.items():
            self.collection("player_profiles")[pid] = p
        # 清理 + 写 terrain chunks
        self._purge_chunks_for_save(save.save_id)
        terrain_coll = self.collection("terrain_chunks")
        for cid, chunk in split_world_modifications(world_mods).items():
            terrain_coll[f"{save.save_id}::{cid}"] = chunk.to_dict()
        # 写 inventory chunks
        inventory_coll = self.collection("inventory_chunks")
        for pid, chunk in inventory_chunks.items():
            inventory_coll[f"{save.save_id}::inv::{pid}"] = chunk.to_dict()
        self._flush()

    def delete_save(self, save_id: str) -> bool:
        if not self.delete_one("saves", save_id):
            return False
        self._purge_chunks_for_save(save_id)
        return True

    def load_world_state(self, save_id: str) -> WorldState:
        save = self.load_save(save_id)
        ws = save.world_state
        return WorldState(
            schema_version=ws["schema_version"],
            world_id=ws["world_id"],
            world_seed=ws["world_seed"],
            created_at=ws["created_at"],
            day=ws["day"],
            season=ws["season"],
            time_of_day=ws["time_of_day"],
            day_in_season=ws["day_in_season"],
            biome_layout=ws["biome_layout"],
            players=ws["players"],
            entities=ws["entities"],
            world_modifications=ws["world_modifications"],
        )

    def save_world_state(self, save_id: str, world: WorldState) -> None:
        save = self.load_save(save_id)
        save.world_state = world.to_dict()
        save.updated_at = time.time()
        self.save_save(save)

    def upsert_player_profile(self, save_id: str, profile: PlayerProfile) -> None:
        save = self.load_save(save_id)
        save.player_profiles[profile.player_id] = profile.to_dict()
        save.updated_at = time.time()
        self.save_save(save)

    def load_player_profile(self, save_id: str, player_id: str) -> PlayerProfile:
        save = self.load_save(save_id)
        if player_id not in save.player_profiles:
            raise KeyError(f"玩家档案不存在: {player_id} in {save_id}")
        return profile_from_dict(save.player_profiles[player_id])

    # --- M2.6 新增:分块粒度 IO ---
    def save_terrain_chunk(self, save_id: str, chunk: TerrainChunk) -> None:
        if not self.exists(save_id):
            raise KeyError(f"存档不存在: {save_id}")
        self.collection("terrain_chunks")[f"{save_id}::{chunk.chunk_id}"] = chunk.to_dict()
        # 更新 saves.updated_at
        save = self.find_one("saves", save_id)
        save["updated_at"] = time.time()
        self._flush()

    def load_terrain_chunk(self, save_id: str, chunk_id: str) -> TerrainChunk:
        if not self.exists(save_id):
            raise KeyError(f"存档不存在: {save_id}")
        key = f"{save_id}::{chunk_id}"
        try:
            data = self.find_one("terrain_chunks", key)
        except KeyError:
            raise KeyError(f"terrain chunk 不存在: {chunk_id} in {save_id}")
        return TerrainChunk.from_dict(data)

    def list_terrain_chunks(self, save_id: str) -> List[str]:
        if not self.exists(save_id):
            return []
        prefix = f"{save_id}::"
        out = []
        for k in self.collection("terrain_chunks").keys():
            if k.startswith(prefix):
                out.append(k[len(prefix):])
        return sorted(out)

    def save_inventory_chunk(self, save_id: str, chunk: InventoryChunk) -> None:
        if not self.exists(save_id):
            raise KeyError(f"存档不存在: {save_id}")
        # 校验 profile 存在
        save = self.find_one("saves", save_id)
        if chunk.player_id not in save["player_profiles"]:
            raise KeyError(f"玩家档案不存在: {chunk.player_id}")
        self.collection("inventory_chunks")[f"{save_id}::inv::{chunk.player_id}"] = chunk.to_dict()
        save["updated_at"] = time.time()
        self._flush()

    def load_inventory_chunk(self, save_id: str, player_id: str) -> InventoryChunk:
        if not self.exists(save_id):
            raise KeyError(f"存档不存在: {save_id}")
        key = f"{save_id}::inv::{player_id}"
        try:
            data = self.find_one("inventory_chunks", key)
        except KeyError:
            raise KeyError(f"inventory chunk 不存在: {player_id} in {save_id}")
        return InventoryChunk.from_dict(data)

    def save_size_bytes(self, save_id: str) -> int:
        if not self.exists(save_id):
            raise KeyError(f"存档不存在: {save_id}")
        if not self.path.exists():
            return 0
        return self.path.stat().st_size


__all__ = ["MockLiteDbStore"]
