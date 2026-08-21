"""
Wildwood 数据层 — Mock 实现(模拟 B 线 LiteDB 的"单文件嵌入式 NoSQL")

设计动机(对应项目总方案 §3.2 / §3.3.1):
  - B 线使用 LiteDB(.NET 嵌入式 NoSQL,单文件 .db)。
  - 本 mock 不引入 LiteDB 二进制(沙箱无 .NET 运行时),只模拟其语义:
      * 单文件持久化(整个数据库存成 1 个 JSON 文件)
      * 多 collection(集合):saves / world_states / player_profiles
      * 通过 doc_id 主键存取(BsonId 风格)
  - 暴露 LiteRepository 风格的 insert_one / find_one / update_one / delete_one,
    便于 A→B 切换时直接映射到 LiteRepository<T>()。

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

from .schemas import (
    ClientConnection,
    PlayerProfile,
    SaveGame,
    SchemaValidator,
    WorldState,
    profile_from_dict,
)
from .store import DataStore


class MockLiteDbStore(DataStore):
    """单文件 JSON 数据库,模拟 LiteDB 的 collection/document 模型。"""

    SCHEMA_VERSION = "1.0.0"  # 本数据库文件自身的 schema

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

    def load_save(self, save_id: str) -> SaveGame:
        save = self.find_one("saves", save_id)
        SchemaValidator.validate_save_game(save)
        clients = [ClientConnection(**c) for c in save.get("clients", [])]
        return SaveGame(
            schema_version=save["schema_version"],
            save_id=save["save_id"],
            created_at=save["created_at"],
            updated_at=save["updated_at"],
            game_mode=save["game_mode"],
            host_player_id=save["host_player_id"],
            world_state=save["world_state"],
            player_profiles=save["player_profiles"],
            clients=clients,
            settings=save.get("settings", {}),
        )

    def save_save(self, save: SaveGame) -> None:
        SchemaValidator.validate_save_game(save.to_dict())
        coll = self.collection("saves")
        coll[save.save_id] = save.to_dict()
        # 冗余写入子集合,模拟 LiteDB 多 collection 的扁平化
        # (LiteDB 实际不需要冗余,这里冗余是工程权衡:方便按 world_id / player_id 单独查询)
        self.collection("world_states")[save.world_state["world_id"]] = save.world_state
        for pid, p in save.player_profiles.items():
            self.collection("player_profiles")[pid] = p
        self._flush()

    def delete_save(self, save_id: str) -> bool:
        if not self.delete_one("saves", save_id):
            return False
        # 注:world_states / player_profiles 仍保留 — 真实 B 线 LiteDB 应做引用计数,
        # 这里为简化不清理子集合,后续接入 LiteDB 时按外键策略处理。
        return True

    def exists(self, save_id: str) -> bool:
        try:
            self.find_one("saves", save_id)
            return True
        except KeyError:
            return False

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


__all__ = ["MockLiteDbStore"]
