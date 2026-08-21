"""
Wildwood 数据层 — 抽象接口 + Reference 实现(JsonFileStore,支持 M2.6 分块)

抽象层(对应项目总方案 §3.3.1 数据层):
  - DataStore:存档 CRUD + 子对象快捷操作(世界 / 玩家档案)
  - 任何引擎层(A: Godot / B: Unity)只通过本接口读写,实现可换。
  - 实现必须保证:save 与 load 是 roundtrip 等价的(经 SchemaValidator 校验)。

Reference 实现(JsonFileStore) — M2.6 升级:
  - 分块存储(默认 use_chunks=True):
      meta.json            存档元信息(save_id / 时间 / 模式 / 设置 / clients)
      world.json           WorldState 核心字段(季节 / 时间 / biome / world_id / entities)
      terrain/             地形修改 chunk 目录(每 chunk 一个 .json)
        0_0.json
        0_1.json
        ...
      profiles/<pid>.json  玩家档案核心字段(stats / current_state / equipment / buffs / ...)
      profiles/<pid>_inventory.json  玩家库存 chunk(频繁更新,独立 IO)
  - use_chunks=False 关闭分块,退化为 M1.4 单文件版(用于 A/B 兼容性测试)。
  - 写入:临时文件 + os.replace,保证原子性,防止半写。
  - 跨模式:单机 / 联机 host 模式存档格式完全相同(只是 meta.game_mode 字段不同,
    联机有 clients[]);联机存档可被单机模式加载(读取时忽略 clients[])。
  - 版本迁移:读取时若 schema_version < CURRENT_*,自动调用 SchemaMigrator 升级后再校验。
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional

from .chunks import (
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
    parse_version,
    profile_from_dict,
)


class DataStore(ABC):
    """数据存储抽象接口(A/B 通用层 1, M2.6 升级:加 chunk 快捷操作)。"""

    # --- 存档 CRUD ---
    @abstractmethod
    def list_saves(self) -> List[Dict[str, Any]]:
        """列出所有存档的摘要信息(save_id, game_mode, created_at, updated_at, host_player_id)。"""

    @abstractmethod
    def load_save(self, save_id: str) -> SaveGame:
        """加载完整存档;不存在抛 KeyError;版本不兼容会自动迁移后返回;跨模式自动适配。"""

    @abstractmethod
    def save_save(self, save: SaveGame) -> None:
        """写入/覆盖存档,原子写。"""

    @abstractmethod
    def delete_save(self, save_id: str) -> bool:
        """删除存档;返回是否真的删除了。"""

    @abstractmethod
    def exists(self, save_id: str) -> bool:
        """检查存档是否存在(不需要加载整个存档)。"""

    # --- 子对象快捷操作(供 M2+ 在不做全量反序列化时使用) ---
    @abstractmethod
    def load_world_state(self, save_id: str) -> WorldState:
        """加载世界状态(自动重组 chunks)。"""

    @abstractmethod
    def save_world_state(self, save_id: str, world: WorldState) -> None:
        """仅更新世界状态(更新 updated_at,自动切分 chunks)。"""

    @abstractmethod
    def upsert_player_profile(self, save_id: str, profile: PlayerProfile) -> None:
        """插入或更新单个玩家档案(更新 updated_at,自动切 inventory chunk)。"""

    @abstractmethod
    def load_player_profile(self, save_id: str, player_id: str) -> PlayerProfile:
        """加载单个玩家档案(自动合并 inventory chunk);不存在抛 KeyError。"""

    # --- M2.6 新增:分块粒度的 IO ---
    @abstractmethod
    def save_terrain_chunk(self, save_id: str, chunk: TerrainChunk) -> None:
        """仅更新一个 terrain chunk(更新 updated_at,其它 chunk 保持原状)。"""

    @abstractmethod
    def load_terrain_chunk(self, save_id: str, chunk_id: str) -> TerrainChunk:
        """加载单个 terrain chunk;不存在抛 KeyError。"""

    @abstractmethod
    def list_terrain_chunks(self, save_id: str) -> List[str]:
        """列出该存档所有 terrain chunk 的 chunk_id 列表。"""

    @abstractmethod
    def save_inventory_chunk(self, save_id: str, chunk: InventoryChunk) -> None:
        """仅更新一个玩家库存 chunk。"""

    @abstractmethod
    def load_inventory_chunk(self, save_id: str, player_id: str) -> InventoryChunk:
        """加载单个玩家库存 chunk;不存在抛 KeyError。"""

    @abstractmethod
    def save_size_bytes(self, save_id: str) -> int:
        """返回存档占用的总字节数(M2.6 验收 ③:满存档 < 10MB)。"""


class JsonFileStore(DataStore):
    """Reference 实现:每个存档一个目录,默认分块存储(M2.6)。"""

    def __init__(self, root_dir: str | Path, *, use_chunks: bool = True):
        self.root = Path(root_dir)
        self.root.mkdir(parents=True, exist_ok=True)
        self.use_chunks = use_chunks

    # --- 内部工具 ---
    def _save_dir(self, save_id: str) -> Path:
        d = self.root / save_id
        meta = d / "meta.json"
        if not (d.is_dir() and meta.exists()):
            raise KeyError(f"存档不存在: {save_id}")
        return d

    def _ensure_save_dir(self, save_id: str) -> Path:
        d = self.root / save_id
        d.mkdir(parents=True, exist_ok=True)
        (d / "profiles").mkdir(exist_ok=True)
        if self.use_chunks:
            (d / ChunkFile.TERRAIN_DIR).mkdir(exist_ok=True)
        return d

    def _atomic_write(self, path: Path, data: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".tmp_", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
            os.replace(tmp, path)
        except Exception:
            if os.path.exists(tmp):
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
            raise

    def _migrate_world_state(self, ws: Dict[str, Any]) -> Dict[str, Any]:
        """M1.4 -> M2.6 迁移;如已是 current 则原样返回。"""
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
            new_ws = get_migrator().migrate("world_state", ws, cur, CURRENT_WORLD_STATE_VERSION)
            return new_ws
        # writer 比 reader 新 — 不在 M2.6 范围,抛错
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

    # --- 接口实现:存档 CRUD ---
    def list_saves(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        if not self.root.exists():
            return out
        for entry in sorted(self.root.iterdir()):
            meta_path = entry / "meta.json"
            if entry.is_dir() and meta_path.exists():
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                except (OSError, json.JSONDecodeError):
                    continue
                out.append({
                    "save_id": meta.get("save_id", entry.name),
                    "game_mode": meta.get("game_mode", "unknown"),
                    "created_at": meta.get("created_at", 0.0),
                    "updated_at": meta.get("updated_at", 0.0),
                    "host_player_id": meta.get("host_player_id", ""),
                })
        return out

    def exists(self, save_id: str) -> bool:
        return (self.root / save_id / "meta.json").exists()

    def load_save(self, save_id: str) -> SaveGame:
        d = self._save_dir(save_id)
        with open(d / "meta.json", "r", encoding="utf-8") as f:
            meta = json.load(f)
        # meta 自身不做 schema 校验(meta 是 SaveGame 顶层字段的并集)
        with open(d / "world.json", "r", encoding="utf-8") as f:
            world_data = json.load(f)
        # M1.4 -> M2.6 迁移
        world_data = self._migrate_world_state(world_data)
        SchemaValidator.validate_world_state(world_data)
        # 加载玩家档案
        profiles: Dict[str, Dict[str, Any]] = {}
        profiles_dir = d / "profiles"
        if profiles_dir.exists():
            for pf in profiles_dir.iterdir():
                # 跳过 inventory chunk(独立 IO,会在下面合并)
                if not pf.suffix == ".json":
                    continue
                if pf.name.endswith(ChunkFile.PROFILE_INV_SUFFIX):
                    continue
                with open(pf, "r", encoding="utf-8") as f:
                    pdata = json.load(f)
                pdata = self._migrate_profile(pdata)
                SchemaValidator.validate_player_profile(pdata)
                profiles[pdata["player_id"]] = pdata
        # 加载 terrain chunks(分块)或 inline world_modifications(legacy)
        if self.use_chunks:
            terrain_chunks: Dict[str, TerrainChunk] = {}
            for cf in list_terrain_chunk_files(d):
                cid_raw = cf.stem  # "0_0"
                cid = cid_raw.replace("_", ":")
                data = read_json(cf)
                terrain_chunks[cid] = TerrainChunk.from_dict(data)
            world_mods = merge_terrain_chunks(terrain_chunks)
            world_data["world_modifications"] = world_mods
            # 同步设置 chunks 索引(便于调用方按 chunk_id 快速取数)
            world_data["chunks"] = {
                cid: list(chunk.items) for cid, chunk in terrain_chunks.items()
            }
        # 加载 inventory chunks(分块)或 inline inventory(profile 内的 inventory 字段)
        for pid in list(profiles.keys()):
            inv_path = inventory_file_path(d, pid)
            if self.use_chunks and inv_path.exists():
                inv_data = read_json(inv_path)
                inv_chunk = InventoryChunk.from_dict(inv_data)
                profiles[pid] = inject_inventory(profiles[pid], inv_chunk)
        # 客户端连接状态(最多 4 人,体量小,放在 meta)
        clients = [ClientConnection(**c) for c in meta.get("clients", [])]
        save_data = {
            "schema_version": meta["schema_version"],
            "save_id": meta["save_id"],
            "created_at": meta["created_at"],
            "updated_at": meta["updated_at"],
            "game_mode": meta["game_mode"],
            "host_player_id": meta["host_player_id"],
            "world_state": world_data,
            "player_profiles": profiles,
            "clients": [c.__dict__ for c in clients],
            "settings": meta.get("settings", {}),
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
        d = self._ensure_save_dir(save.save_id)
        meta = {
            "schema_version": save.schema_version,
            "save_id": save.save_id,
            "created_at": save.created_at,
            "updated_at": save.updated_at,
            "game_mode": save.game_mode,
            "host_player_id": save.host_player_id,
            "clients": [c.__dict__ for c in save.clients],
            "settings": save.settings,
        }
        self._atomic_write(d / "meta.json", meta)
        # 写 world 核心字段(strip 出 world_modifications,放到 chunks)
        world_data = dict(save.world_state)
        world_mods = world_data.pop("world_modifications", [])
        if self.use_chunks:
            # chunks 是真相:terrain/{cid}.json 是分块存储;
            # world.json 不存 inline world_modifications/chunks(避免数据漂移)
            world_data["world_modifications"] = []
            world_data["chunks"] = {}
        self._atomic_write(d / "world.json", world_data)
        if self.use_chunks:
            # 清理旧 terrain chunks,再写新
            terrain_dir = d / ChunkFile.TERRAIN_DIR
            for old in terrain_dir.iterdir():
                if old.suffix == ".json":
                    try:
                        old.unlink()
                    except OSError:
                        pass
            terrain_chunks = split_world_modifications(world_mods)
            for cid, chunk in terrain_chunks.items():
                atomic_write_json(terrain_chunk_file_path(d, cid), chunk.to_dict())
        else:
            # 关闭分块:把 world_modifications 放回 world_data
            world_data["world_modifications"] = world_mods
            self._atomic_write(d / "world.json", world_data)
        # 写 profiles + inventory chunks
        profiles_dir = d / "profiles"
        # 清理旧 profile / inv 文件
        for old in profiles_dir.iterdir():
            if old.suffix == ".json":
                try:
                    old.unlink()
                except OSError:
                    pass
        for pid, pdata in save.player_profiles.items():
            pdata = dict(pdata)
            if self.use_chunks:
                # 抽 inventory 出去
                inv_chunk = extract_inventory(pdata)
                pdata2 = dict(pdata)
                # profile 字典保留 inventory 字段(供 M1.4 风格读侧),但 chunks 是真相
                pdata2["inventory"] = dict(inv_chunk.items)
                pdata2["inventory_capacity"] = int(inv_chunk.capacity)
                self._atomic_write(profiles_dir / f"{pid}.json", pdata2)
                atomic_write_json(inventory_file_path(d, pid), inv_chunk.to_dict())
            else:
                self._atomic_write(profiles_dir / f"{pid}.json", pdata)

    def delete_save(self, save_id: str) -> bool:
        d = self.root / save_id
        if d.is_dir():
            shutil.rmtree(d)
            return True
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

    # --- M2.6 新增:分块粒度 IO ---
    def save_terrain_chunk(self, save_id: str, chunk: TerrainChunk) -> None:
        d = self._save_dir(save_id)
        if not self.use_chunks:
            raise SchemaError("JsonFileStore(use_chunks=False) 不支持分块粒度 IO")
        # 写 chunk
        atomic_write_json(terrain_chunk_file_path(d, chunk.chunk_id), chunk.to_dict())
        # 同步更新 world.json 中该 chunk_id 对应的 inline 字段(可选,本任务保持 chunks 真相)
        # 更新 meta.updated_at
        meta_path = d / "meta.json"
        meta = read_json(meta_path)
        meta["updated_at"] = time.time()
        self._atomic_write(meta_path, meta)

    def load_terrain_chunk(self, save_id: str, chunk_id: str) -> TerrainChunk:
        d = self._save_dir(save_id)
        if not self.use_chunks:
            raise SchemaError("JsonFileStore(use_chunks=False) 不支持分块粒度 IO")
        path = terrain_chunk_file_path(d, chunk_id)
        if not path.exists():
            raise KeyError(f"terrain chunk 不存在: {chunk_id} in {save_id}")
        return TerrainChunk.from_dict(read_json(path))

    def list_terrain_chunks(self, save_id: str) -> List[str]:
        d = self._save_dir(save_id)
        if not self.use_chunks:
            # 退化模式:从 world.json 推一个伪 chunk 列表
            world_data = read_json(d / "world.json")
            mods = world_data.get("world_modifications", [])
            cids = set()
            for m in mods:
                pos = m.get("position") or {}
                x = float(pos.get("x", 0))
                y = float(pos.get("y", 0))
                cx = int(x) // 16
                cy = int(y) // 16
                cids.add(f"{cx}:{cy}")
            return sorted(cids)
        out = []
        for p in list_terrain_chunk_files(d):
            out.append(p.stem.replace("_", ":"))
        return sorted(out)

    def save_inventory_chunk(self, save_id: str, chunk: InventoryChunk) -> None:
        d = self._save_dir(save_id)
        if not self.use_chunks:
            raise SchemaError("JsonFileStore(use_chunks=False) 不支持分块粒度 IO")
        # 校验 profile 存在
        profile_path = d / "profiles" / f"{chunk.player_id}.json"
        if not profile_path.exists():
            raise KeyError(f"玩家档案不存在: {chunk.player_id}")
        atomic_write_json(inventory_file_path(d, chunk.player_id), chunk.to_dict())
        # 更新 meta.updated_at
        meta_path = d / "meta.json"
        meta = read_json(meta_path)
        meta["updated_at"] = time.time()
        self._atomic_write(meta_path, meta)

    def load_inventory_chunk(self, save_id: str, player_id: str) -> InventoryChunk:
        d = self._save_dir(save_id)
        if not self.use_chunks:
            raise SchemaError("JsonFileStore(use_chunks=False) 不支持分块粒度 IO")
        path = inventory_file_path(d, player_id)
        if not path.exists():
            raise KeyError(f"inventory chunk 不存在: {player_id} in {save_id}")
        return InventoryChunk.from_dict(read_json(path))

    def save_size_bytes(self, save_id: str) -> int:
        d = self._save_dir(save_id)
        return measure_save_dir_size(d)


__all__ = ["DataStore", "JsonFileStore"]
