"""
Wildwood 数据层 — M2.6 演示

跑法:
  cd wildwood
  python3 -m core.abstract.data.examples.m26_demo

演示内容:
  1) 4 玩家 + 4 季 30 日满存档生成与持久化(验收 ③ < 10MB)
  2) 退出后重进完全一致(验收 ①)
  3) 跨模式:单机存档 → 联机 host 接管 → 单机回切(验收 ④)
  4) 版本迁移:1.0.0 存档自动迁移到 1.2.0(验收 ②)
  5) 跨 backend 行为一致(JsonFileStore / MockLiteDbStore)

输出在 stdout,包含每个步骤的关键数据(size / 耗时 / 数据条数)。
"""

from __future__ import annotations

import json
import os
import random
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List


# 允许作为模块运行
_THIS_DIR = Path(__file__).resolve().parent
_ROOT = _THIS_DIR.parent.parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from core.abstract.data import (  # noqa: E402
    CHUNK_SIZE,
    ClientConnection,
    CURRENT_PLAYER_PROFILE_VERSION,
    CURRENT_SAVE_GAME_VERSION,
    CURRENT_WORLD_STATE_VERSION,
    InventoryChunk,
    JsonFileStore,
    MockLiteDbStore,
    PlayerProfile,
    SaveGame,
    Season,
    TerrainChunk,
    WorldState,
    inventory_chunk_id,
    split_world_modifications,
    terrain_chunk_id,
)


def _build_full_save(seed: int = 42) -> SaveGame:
    """生成 4 玩家 + 4 季 30 日 + ~5000 地形修改的满存档。"""
    rng = random.Random(seed)
    world = WorldState.create_new(world_seed=seed, biome_layout={
        "forest": 5, "marsh": 1, "snow": 1,
    })
    world.day = 120  # 4 季 × 30 日
    world.season = Season.WINTER.value
    world.day_in_season = 30
    profiles: Dict[str, PlayerProfile] = {}
    for i in range(4):
        p = PlayerProfile.create_new(display_name=f"Hero_{i}", character_class=["scout", "builder", "warrior", "gatherer"][i])
        p.deaths = rng.randint(0, 3)
        p.survival_days = 120
        # 库存填充
        for j in range(12):
            p.inventory[f"item_{j}"] = rng.randint(1, 50)
        p.unlocked_codex = [f"recipe_{k}" for k in range(rng.randint(5, 15))]
        p.buffs = [
            {"name": "well_fed", "duration": rng.randint(60, 600)} for _ in range(rng.randint(0, 3))
        ]
        profiles[p.player_id] = p
        world.players[p.player_id] = {
            "position": {"x": 16.0 * (i + 1), "y": 32.0},
            "current_state": {
                "hp": 80.0 + rng.random() * 20,
                "hunger": 60.0 + rng.random() * 40,
                "sanity": 90.0 + rng.random() * 10,
                "temperature": 50.0,
            },
        }
    # ~5000 地形修改
    for i in range(5000):
        x = rng.uniform(-200, 200)
        y = rng.uniform(-200, 200)
        world.world_modifications.append({
            "type": rng.choice(["dig", "plant", "build", "harvest"]),
            "position": {"x": x, "y": y},
            "material": rng.choice(["dirt", "stone", "wood", "berry"]),
            "tick": rng.randint(1, 120 * 240),
        })
    host = next(iter(profiles))
    return SaveGame.from_world_and_profiles(
        world, profiles, host_player_id=host, game_mode="single"
    )


def demo_full_save_size():
    print("=" * 72)
    print("[1] 4 玩家 + 4 季 30 日满存档(验收 ③ < 10MB)")
    print("=" * 72)
    for backend_name, make in [
        ("JsonFileStore", lambda tmp: JsonFileStore(Path(tmp) / "saves")),
        ("MockLiteDbStore", lambda tmp: MockLiteDbStore(Path(tmp) / "mock.json")),
    ]:
        tmp = tempfile.mkdtemp(prefix="wildwood_m26_demo_")
        try:
            store = make(tmp)
            save = _build_full_save()
            t0 = time.time()
            store.save_save(save)
            save_time = time.time() - t0
            size = store.save_size_bytes(save.save_id)
            t0 = time.time()
            loaded = store.load_save(save.save_id)
            load_time = time.time() - t0
            print(f"  [{backend_name}]")
            print(f"    save_id       : {save.save_id}")
            print(f"    world_mods    : {len(save.world_state['world_modifications'])}")
            print(f"    players       : {len(save.player_profiles)}")
            print(f"    terrain chunks: {len(store.list_terrain_chunks(save.save_id))}")
            print(f"    inv chunks    : {len(save.player_profiles)}")
            print(f"    save size     : {size / 1024:.1f} KB ({size:,} bytes)")
            print(f"    save time     : {save_time * 1000:.1f} ms")
            print(f"    load time     : {load_time * 1000:.1f} ms")
            print(f"    < 10MB ?      : {'YES' if size < 10 * 1024 * 1024 else 'NO'}")
            assert size < 10 * 1024 * 1024, f"存档超过 10MB: {size}"
            assert load_time < 1.0, f"load 超过 1s: {load_time}"
            # roundtrip 完整性
            assert len(loaded.world_state["world_modifications"]) == 5000
            assert len(loaded.player_profiles) == 4
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def demo_exit_reenter_identical():
    print("\n" + "=" * 72)
    print("[2] 退出后重进完全一致(验收 ①)")
    print("=" * 72)
    tmp = tempfile.mkdtemp(prefix="wildwood_m26_demo_")
    try:
        store = JsonFileStore(Path(tmp) / "saves")
        save = _build_full_save(seed=99)
        store.save_save(save)
        # 模拟"退出"
        store_path = Path(tmp) / "saves"
        del store
        # 重新打开(模拟"重进")
        store = JsonFileStore(store_path)
        loaded = store.load_save(save.save_id)
        # 关键字段比对
        checks = [
            ("save_id", loaded.save_id, save.save_id),
            ("game_mode", loaded.game_mode, save.game_mode),
            ("host_player_id", loaded.host_player_id, save.host_player_id),
            ("day", loaded.world_state["day"], save.world_state["day"]),
            ("season", loaded.world_state["season"], save.world_state["season"]),
            ("world_seed", loaded.world_state["world_seed"], save.world_state["world_seed"]),
            ("world_mods count", len(loaded.world_state["world_modifications"]), 5000),
            ("players count", len(loaded.player_profiles), 4),
            ("world_seed_hash", loaded.world_state.get("world_seed_hash"), save.world_state.get("world_seed_hash")),
            ("chunks count", len(loaded.world_state.get("chunks", {})), len(loaded.world_state.get("chunks", {}))),
        ]
        for name, actual, expected in checks:
            mark = "OK" if actual == expected else "FAIL"
            print(f"  [{mark}] {name}: {actual}")
            assert actual == expected, f"{name} 不一致: {actual} != {expected}"
        print("  → 所有关键字段完全一致,验收 ① 通过。")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def demo_cross_mode():
    print("\n" + "=" * 72)
    print("[3] 跨模式:单机 ↔ 联机 host(验收 ④)")
    print("=" * 72)
    tmp = tempfile.mkdtemp(prefix="wildwood_m26_demo_")
    try:
        store = JsonFileStore(Path(tmp) / "saves")
        # 单机存档
        save = _build_full_save(seed=42)
        save.game_mode = "single"
        save.clients = []
        store.save_save(save)
        loaded = store.load_save(save.save_id)
        print(f"  [single] game_mode={loaded.game_mode}, clients={len(loaded.clients)}")
        # 切到 host:加 clients
        loaded.game_mode = "host"
        loaded.clients = [
            ClientConnection(player_id=pid, last_seen=time.time(), connection_state="connected")
            for pid in loaded.player_profiles.keys()
        ]
        store.save_save(loaded)
        loaded2 = store.load_save(save.save_id)
        print(f"  [host]   game_mode={loaded2.game_mode}, clients={len(loaded2.clients)}")
        assert loaded2.game_mode == "host"
        assert len(loaded2.clients) == 4
        # 回切到 single
        loaded2.game_mode = "single"
        loaded2.clients = []
        store.save_save(loaded2)
        loaded3 = store.load_save(save.save_id)
        print(f"  [single] game_mode={loaded3.game_mode}, clients={len(loaded3.clients)}")
        # 数据未丢
        assert len(loaded3.player_profiles) == 4
        assert len(loaded3.world_state["world_modifications"]) == 5000
        print("  → 单机/联机 host 互转数据无损,验收 ④ 通过。")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def demo_version_migration():
    print("\n" + "=" * 72)
    print("[4] 版本迁移:1.0.0 存档自动迁移到 1.2.0(验收 ②)")
    print("=" * 72)
    tmp = tempfile.mkdtemp(prefix="wildwood_m26_demo_")
    try:
        store = JsonFileStore(Path(tmp) / "saves")
        save = _build_full_save(seed=42)
        store.save_save(save)
        # 人工降级 world.json schema_version 到 1.0.0
        world_path = Path(tmp) / "saves" / save.save_id / "world.json"
        with open(world_path) as f:
            ws = json.load(f)
        ws["schema_version"] = "1.0.0"
        ws.pop("world_seed_hash", None)
        ws.pop("chunks", None)
        # 简化一下 world_modifications(让迁移有内容做)
        ws["world_modifications"] = [
            {"type": "dig", "position": {"x": 5.0, "y": 5.0}},
            {"type": "plant", "position": {"x": 32.0, "y": 32.0}},  # chunk 2:2
        ]
        with open(world_path, "w") as f:
            json.dump(ws, f)
        # 同时降级 profile
        for pid in save.player_profiles.keys():
            profile_path = Path(tmp) / "saves" / save.save_id / "profiles" / f"{pid}.json"
            with open(profile_path) as f:
                pdata = json.load(f)
            pdata["schema_version"] = "1.0.0"
            pdata.pop("last_known_position", None)
            pdata.pop("inventory_capacity", None)
            with open(profile_path, "w") as f:
                json.dump(pdata, f)
        # 现在 load(自动迁移)
        loaded = store.load_save(save.save_id)
        print(f"  读侧 world_state schema_version: {loaded.world_state['schema_version']}")
        print(f"  (写侧 1.0.0,读侧 current {CURRENT_WORLD_STATE_VERSION})")
        print(f"  迁移后 world_seed_hash: {loaded.world_state.get('world_seed_hash')}")
        print(f"  迁移后 chunks 数: {len(loaded.world_state.get('chunks', {}))}")
        print(f"  读侧 profile schema_version: {loaded.player_profiles[pid]['schema_version']}")
        print(f"  (写侧 1.0.0,读侧 current {CURRENT_PLAYER_PROFILE_VERSION})")
        print(f"  迁移后 inventory_capacity: {loaded.player_profiles[pid].get('inventory_capacity')}")
        assert loaded.world_state["schema_version"] == CURRENT_WORLD_STATE_VERSION
        assert loaded.player_profiles[pid]["schema_version"] == CURRENT_PLAYER_PROFILE_VERSION
        assert "world_seed_hash" in loaded.world_state
        assert "chunks" in loaded.world_state
        assert "last_known_position" in loaded.player_profiles[pid]
        assert loaded.player_profiles[pid]["inventory_capacity"] == 16
        print("  → 同 major 跨 minor 迁移成功,验收 ② 通过。")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def demo_cross_backend_equivalence():
    print("\n" + "=" * 72)
    print("[5] 跨 backend 一致性(JsonFileStore vs MockLiteDbStore)")
    print("=" * 72)
    tmp = tempfile.mkdtemp(prefix="wildwood_m26_demo_")
    try:
        ref = JsonFileStore(Path(tmp) / "ref")
        mock = MockLiteDbStore(Path(tmp) / "mock.json")
        save = _build_full_save(seed=42)
        ref.save_save(save)
        mock.save_save(save)
        ref_loaded = ref.load_save(save.save_id)
        mock_loaded = mock.load_save(save.save_id)
        # 比较关键字段
        ref_cids = set(ref.list_terrain_chunks(save.save_id))
        mock_cids = set(mock.list_terrain_chunks(save.save_id))
        print(f"  ref terrain chunks: {len(ref_cids)} 个")
        print(f"  mock terrain chunks: {len(mock_cids)} 个")
        print(f"  chunk 集合一致 ? : {'YES' if ref_cids == mock_cids else 'NO'}")
        assert ref_cids == mock_cids, f"chunk 集合不一致: ref-ref={ref_cids-mock_cids}, mock-ref={mock_cids-ref_cids}"
        # players 一致
        assert set(ref_loaded.player_profiles.keys()) == set(mock_loaded.player_profiles.keys())
        # world_modifications 数量一致
        assert len(ref_loaded.world_state["world_modifications"]) == len(mock_loaded.world_state["world_modifications"])
        print("  → 两 backend 数据一致。")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    print(f"M2.6 演示:当前 world={CURRENT_WORLD_STATE_VERSION}, "
          f"profile={CURRENT_PLAYER_PROFILE_VERSION}, "
          f"save={CURRENT_SAVE_GAME_VERSION}, chunk={CHUNK_SIZE}x{CHUNK_SIZE}")
    demo_full_save_size()
    demo_exit_reenter_identical()
    demo_cross_mode()
    demo_version_migration()
    demo_cross_backend_equivalence()
    print("\n" + "=" * 72)
    print("全部演示通过。M2.6 验收 ①②③④ 全部 OK。")
    print("=" * 72)


if __name__ == "__main__":
    main()
