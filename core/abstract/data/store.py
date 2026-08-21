"""
Wildwood 数据层 — 抽象接口 + Reference 实现(JsonFileStore)

抽象层(对应项目总方案 §3.3.1 数据层):
  - DataStore:存档 CRUD + 子对象快捷操作(世界 / 玩家档案)
  - 任何引擎层(A: Godot / B: Unity)只通过本接口读写,实现可换。
  - 实现必须保证:save 与 load 是 roundtrip 等价的(经 SchemaValidator 校验)。

Reference 实现(JsonFileStore):
  - 每个存档一个子目录,内含:
      meta.json           存档元信息(save_id / 时间 / 模式 / 设置)
      world.json          世界状态(WorldState 完整 dump)
      profiles/<pid>.json 玩家档案(每个玩家单独文件,便于按需加载)
  - 写入:临时文件 + os.replace,保证原子性,防止半写。
  - 模拟 A 线 SQLite 的"按文件归档"风格(M1 阶段 0 依赖,后续 M2.x 改 SQLite 时接口不变)。
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from abc import ABC, abstractmethod
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


class DataStore(ABC):
    """数据存储抽象接口(A/B 通用层 1)。"""

    # --- 存档 CRUD ---
    @abstractmethod
    def list_saves(self) -> List[Dict[str, Any]]:
        """列出所有存档的摘要信息(save_id, game_mode, created_at, updated_at, host_player_id)。"""

    @abstractmethod
    def load_save(self, save_id: str) -> SaveGame:
        """加载完整存档;不存在抛 KeyError;版本不兼容抛 VersionIncompatibleError。"""

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
        """加载世界状态。"""

    @abstractmethod
    def save_world_state(self, save_id: str, world: WorldState) -> None:
        """仅更新世界状态(更新 updated_at)。"""

    @abstractmethod
    def upsert_player_profile(self, save_id: str, profile: PlayerProfile) -> None:
        """插入或更新单个玩家档案(更新 updated_at)。"""

    @abstractmethod
    def load_player_profile(self, save_id: str, player_id: str) -> PlayerProfile:
        """加载单个玩家档案;不存在抛 KeyError。"""


class JsonFileStore(DataStore):
    """Reference 实现:每个存档一个目录。"""

    def __init__(self, root_dir: str | Path):
        self.root = Path(root_dir)
        self.root.mkdir(parents=True, exist_ok=True)

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
        return d

    def _atomic_write(self, path: Path, data: Dict[str, Any]) -> None:
        """写到同目录临时文件,再 rename。失败时清理临时文件。"""
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

    # --- 接口实现 ---
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
                    # 损坏的 meta 跳过
                    continue
                out.append({
                    "save_id": meta.get("save_id", entry.name),
                    "game_mode": meta.get("game_mode", "unknown"),
                    "created_at": meta.get("created_at", 0.0),
                    "updated_at": meta.get("updated_at", 0.0),
                    "host_player_id": meta.get("host_player_id", ""),
                })
        return out

    def load_save(self, save_id: str) -> SaveGame:
        d = self._save_dir(save_id)
        with open(d / "meta.json", "r", encoding="utf-8") as f:
            meta = json.load(f)
        with open(d / "world.json", "r", encoding="utf-8") as f:
            world_data = json.load(f)
        SchemaValidator.validate_world_state(world_data)
        profiles: Dict[str, Dict[str, Any]] = {}
        profiles_dir = d / "profiles"
        if profiles_dir.exists():
            for pf in profiles_dir.iterdir():
                if pf.suffix == ".json":
                    with open(pf, "r", encoding="utf-8") as f:
                        pdata = json.load(f)
                    SchemaValidator.validate_player_profile(pdata)
                    profiles[pdata["player_id"]] = pdata
        # 客户端连接状态嵌在 meta.json(最多 4 人,体量小)
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
        self._atomic_write(d / "world.json", save.world_state)
        profiles_dir = d / "profiles"
        for old in profiles_dir.iterdir():
            if old.suffix == ".json":
                try:
                    old.unlink()
                except OSError:
                    pass
        for pid, pdata in save.player_profiles.items():
            self._atomic_write(profiles_dir / f"{pid}.json", pdata)

    def delete_save(self, save_id: str) -> bool:
        import shutil
        d = self.root / save_id
        if d.is_dir():
            shutil.rmtree(d)
            return True
        return False

    def exists(self, save_id: str) -> bool:
        return (self.root / save_id / "meta.json").exists()

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


__all__ = ["DataStore", "JsonFileStore"]
