"""
Wildwood 数据层 — 分块管理(M2.6 核心)

设计目标:
  - 把 WorldState / PlayerProfile 中"频繁变化 / 体量较大"的部分拆成独立 chunk,降低单文件 IO 压力。
  - JsonFileStore 一个存档内的文件布局:
      meta.json            存档元信息(模式 / 时间 / clients / 联机设置)
      world.json           WorldState 核心字段(季节 / 时间 / biome_layout / world_id / entities)
      terrain/             地形修改 chunk 目录(每 chunk 一个 .json)
        0:0.json
        0:1.json
        ...
      profiles/<pid>.json  玩家档案核心字段(stats / current_state / equipment / buffs / ...)
      profiles/<pid>_inventory.json  玩家库存 chunk(频繁更新,独立 IO)
  - MockLiteDbStore 一个存档内的 collection 布局:
      saves 集合
      terrain_chunks 集合(chunk_id 为主键)
      inventory_chunks 集合(player_id 为主键)
  - 任何 backend 的 `load_save` 必须把 chunks 重组为完整 WorldState / PlayerProfile
    (透明,对调用方零修改);`save_save` 同样透明地把完整数据切分到 chunks。

约束:
  - 纯 stdlib,零外部依赖(对应项目总方案 §3.3.1 A/B 通用层 1)。
  - chunk_id 格式稳定,跨 backend 兼容(JsonFileStore 和 MockLiteDbStore 用同一套 chunk_id)。
  - 满存档(4 玩家 + 4 季 30 日)应 < 10MB(测试用例覆盖)。
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# === 常量 ===
# Chunk 尺寸: 16x16 tiles — 与 Godot 4.3 / Unity 6 网格划分一致(项目总方案 §2.6 biome 网格)。
CHUNK_SIZE = 16


# === Chunk 类型 ===

@dataclass
class TerrainChunk:
    """地形修改 chunk:同一 16x16 tile 区块内的所有 modification。"""
    chunk_id: str  # 格式 "{cx}:{cy}"
    items: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return {"chunk_id": self.chunk_id, "items": list(self.items)}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TerrainChunk":
        return cls(
            chunk_id=str(d.get("chunk_id", "0:0")),
            items=list(d.get("items", [])),
        )


@dataclass
class InventoryChunk:
    """玩家库存 chunk:某玩家的所有物品。"""
    player_id: str
    items: Dict[str, int]  # item_id -> count
    capacity: int  # 上限(M2.6 引入,与方案 §2.5 背包一致)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "player_id": self.player_id,
            "items": dict(self.items),
            "capacity": int(self.capacity),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "InventoryChunk":
        return cls(
            player_id=str(d.get("player_id", "")),
            items=dict(d.get("items", {})),
            capacity=int(d.get("capacity", 16)),
        )


# === Chunk id 工具 ===

def terrain_chunk_id(x: float, y: float) -> str:
    """根据世界坐标计算 terrain chunk id(16x16 tile 网格)。"""
    cx = int(x) // CHUNK_SIZE
    cy = int(y) // CHUNK_SIZE
    return f"{cx}:{cy}"


def inventory_chunk_id(player_id: str) -> str:
    return f"inv:{player_id}"


# === Chunk 切分与重组 ===

def split_world_modifications(
    world_modifications: List[Dict[str, Any]],
) -> Dict[str, TerrainChunk]:
    """把 WorldState.world_modifications 拆成 TerrainChunk 字典。"""
    chunks: Dict[str, List[Dict[str, Any]]] = {}
    for m in world_modifications:
        pos = m.get("position") or {}
        x = float(pos.get("x", 0.0))
        y = float(pos.get("y", 0.0))
        cid = terrain_chunk_id(x, y)
        m2 = dict(m)
        m2["chunk_id"] = cid
        chunks.setdefault(cid, []).append(m2)
    return {cid: TerrainChunk(chunk_id=cid, items=items) for cid, items in chunks.items()}


def merge_terrain_chunks(chunks: Dict[str, TerrainChunk]) -> List[Dict[str, Any]]:
    """把 TerrainChunk 字典合并回 WorldState.world_modifications 列表。"""
    out: List[Dict[str, Any]] = []
    # 按 chunk_id 排序确保 roundtrip 稳定
    for cid in sorted(chunks.keys()):
        c = chunks[cid]
        for m in c.items:
            m2 = dict(m)
            m2["chunk_id"] = cid
            out.append(m2)
    return out


def extract_inventory(profile: Dict[str, Any]) -> InventoryChunk:
    """从 PlayerProfile 字典抽出 InventoryChunk。"""
    return InventoryChunk(
        player_id=profile.get("player_id", ""),
        items=dict(profile.get("inventory", {})),
        capacity=int(profile.get("inventory_capacity", 16)),
    )


def inject_inventory(profile: Dict[str, Any], chunk: InventoryChunk) -> Dict[str, Any]:
    """把 InventoryChunk 写回 PlayerProfile 字典。"""
    out = dict(profile)
    out["inventory"] = dict(chunk.items)
    out["inventory_capacity"] = int(chunk.capacity)
    return out


# === 文件 IO 工具(分块专用) ===

def atomic_write_json(path: Path, data: Dict[str, Any]) -> None:
    """写到同目录临时文件,再 rename(复用 store.py 的原子写逻辑,这里独立实现便于单测)。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp_chunk_", dir=str(path.parent))
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


def read_json(path: Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# === 存档文件布局常量 ===

class ChunkFile:
    """存档目录内的固定文件名(便于单测断言 + 跨 backend 对齐)。"""
    META = "meta.json"
    WORLD = "world.json"
    TERRAIN_DIR = "terrain"
    PROFILES_DIR = "profiles"
    # profile 文件命名:<pid>.json / <pid>_inventory.json
    PROFILE_INV_SUFFIX = "_inventory.json"


def list_terrain_chunk_files(save_dir: Path) -> List[Path]:
    """列出存档目录下所有 terrain chunk 文件(按 chunk_id 排序)。"""
    d = save_dir / ChunkFile.TERRAIN_DIR
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.suffix == ".json")


def inventory_file_path(save_dir: Path, player_id: str) -> Path:
    """玩家库存 chunk 文件路径。"""
    return save_dir / ChunkFile.PROFILES_DIR / f"{player_id}{ChunkFile.PROFILE_INV_SUFFIX}"


def terrain_chunk_file_path(save_dir: Path, chunk_id: str) -> Path:
    safe = chunk_id.replace(":", "_")  # 文件系统安全(0:0 -> 0_0.json)
    return save_dir / ChunkFile.TERRAIN_DIR / f"{safe}.json"


# === 满存档大小基准(测试用) ===

def measure_save_dir_size(save_dir: Path) -> int:
    """返回存档目录内所有 .json 文件的总字节数。"""
    total = 0
    for p in save_dir.rglob("*.json"):
        try:
            total += p.stat().st_size
        except OSError:
            pass
    return total


__all__ = [
    "CHUNK_SIZE",
    "TerrainChunk",
    "InventoryChunk",
    "terrain_chunk_id",
    "inventory_chunk_id",
    "split_world_modifications",
    "merge_terrain_chunks",
    "extract_inventory",
    "inject_inventory",
    "atomic_write_json",
    "read_json",
    "ChunkFile",
    "list_terrain_chunk_files",
    "inventory_file_path",
    "terrain_chunk_file_path",
    "measure_save_dir_size",
]
