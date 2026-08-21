"""
Wildwood 数据层 — M2.6 单元测试(分块存储 + 版本迁移 + 跨模式 + 满存档 < 10MB)

跑法:
  cd wildwood
  python3 -m unittest tests.unit.test_m26_world_persistence -v

覆盖:
  - SchemaMigrator 注册 / 链式升级 / 缺失迁移 / 内置迁移链路
  - ChunkManager split/merge roundtrip / chunk_id 工具 / 原子写
  - JsonFileStore 分块粒度 IO(terrain chunk / inventory chunk)
  - JsonFileStore save_size_bytes
  - MockLiteDbStore 分块粒度 IO
  - 跨模式:单机 / 联机 host 互转(验收 ④)
  - 4 季 30 日满存档 < 10MB(验收 ③)
  - 退出后重进完全一致(验收 ①)
  - 版本号不匹配时迁移成功(验收 ②)
"""

import json
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List

from core.abstract.data import (
    CHUNK_SIZE,
    CURRENT_PLAYER_PROFILE_VERSION,
    CURRENT_SAVE_GAME_VERSION,
    CURRENT_WORLD_STATE_VERSION,
    GameMode,
    InventoryChunk,
    JsonFileStore,
    MigrationError,
    MockLiteDbStore,
    PlayerProfile,
    SaveGame,
    SchemaError,
    SchemaMigrator,
    SchemaValidator,
    Season,
    TerrainChunk,
    VersionIncompatibleError,
    WorldState,
    extract_inventory,
    get_migrator,
    inject_inventory,
    inventory_chunk_id,
    inventory_file_path,
    is_compatible,
    is_newer,
    make_store,
    merge_terrain_chunks,
    parse_version,
    reset_migrator,
    split_world_modifications,
    terrain_chunk_file_path,
    terrain_chunk_id,
)
from core.abstract.data.chunks import measure_save_dir_size
from core.abstract.data.store import DataStore


# === Fixture helpers ===

def make_world(seed: int = 42, day: int = 1) -> WorldState:
    w = WorldState.create_new(world_seed=seed, biome_layout={"forest": 5, "marsh": 1})
    w.day = day
    return w


def make_profile(name: str = "Astone", char_class: str = "scout") -> PlayerProfile:
    return PlayerProfile.create_new(display_name=name, character_class=char_class)


def make_save(seed: int = 42, n_players: int = 1, day: int = 1, mode: str = "single") -> SaveGame:
    world = make_world(seed=seed, day=day)
    profiles: Dict[str, PlayerProfile] = {}
    for i in range(n_players):
        p = make_profile(name=f"Player{i}")
        profiles[p.player_id] = p
        world.players[p.player_id] = {
            "position": {"x": 16.0 * (i + 1), "y": 32.0},
            "current_state": {
                "hp": p.current_state.hp,
                "hunger": p.current_state.hunger,
                "sanity": p.current_state.sanity,
                "temperature": p.current_state.temperature,
            },
        }
    host = next(iter(profiles))
    return SaveGame.from_world_and_profiles(
        world, profiles, host_player_id=host, game_mode=mode
    )


# ==================== SchemaMigrator 单元测试 ====================

class TestSchemaMigratorRegistration(unittest.TestCase):
    def setUp(self):
        reset_migrator()

    def tearDown(self):
        reset_migrator()

    def test_register_and_migrate_single_step(self):
        m = SchemaMigrator()
        m.register("world_state", "1.0.0", "1.1.0", lambda d: {**d, "x": 1})
        out = m.migrate("world_state", {"a": 1}, from_version="1.0.0", to_version="1.1.0")
        self.assertEqual(out["a"], 1)
        self.assertEqual(out["x"], 1)
        self.assertEqual(out["schema_version"], "1.1.0")

    def test_register_duplicate_raises(self):
        m = SchemaMigrator()
        m.register("world_state", "1.0.0", "1.1.0", lambda d: d)
        with self.assertRaises(MigrationError):
            m.register("world_state", "1.0.0", "1.1.1", lambda d: d)

    def test_register_downgrade_raises(self):
        m = SchemaMigrator()
        with self.assertRaises(MigrationError):
            m.register("world_state", "1.1.0", "1.0.0", lambda d: d)

    def test_register_equal_version_raises(self):
        m = SchemaMigrator()
        with self.assertRaises(MigrationError):
            m.register("world_state", "1.0.0", "1.0.0", lambda d: d)

    def test_migrate_same_version_noop(self):
        m = SchemaMigrator()
        out = m.migrate("world_state", {"a": 1}, "1.0.0", "1.0.0")
        self.assertEqual(out["a"], 1)

    def test_migrate_downgrade_raises(self):
        m = SchemaMigrator()
        with self.assertRaises(MigrationError):
            m.migrate("world_state", {"a": 1}, "1.1.0", "1.0.0")

    def test_migrate_chained_path(self):
        """1.0.0 -> 1.1.0 -> 1.2.0 链路式升级。"""
        m = SchemaMigrator()
        m.register("world_state", "1.0.0", "1.1.0", lambda d: {**d, "v11": True})
        m.register("world_state", "1.1.0", "1.2.0", lambda d: {**d, "v12": True})
        out = m.migrate("world_state", {"a": 1}, "1.0.0", "1.2.0")
        self.assertEqual(out["v11"], True)
        self.assertEqual(out["v12"], True)
        self.assertEqual(out["schema_version"], "1.2.0")

    def test_migrate_missing_step_raises(self):
        m = SchemaMigrator()
        m.register("world_state", "1.0.0", "1.1.0", lambda d: d)
        # 缺 1.1.0 -> 1.2.0
        with self.assertRaises(MigrationError):
            m.migrate("world_state", {"a": 1}, "1.0.0", "1.2.0")

    def test_migrate_infinite_loop_guard(self):
        """注册错误链路(假设误配,指向自己)时,应被安全防护捕获。"""
        m = SchemaMigrator()
        # 故意构造循环:1.0.0 -> 1.1.0,1.1.0 -> 1.0.0(注册检查会拒绝倒退)
        # 这里测试安全防护(假设有循环):通过 monkey patch 注入
        m._registry["world_state"] = {
            "1.0.0": ("1.1.0", lambda d: d),
            "1.1.0": ("1.0.0", lambda d: d),
        }
        with self.assertRaises(MigrationError):
            m.migrate("world_state", {"a": 1}, "1.0.0", "1.2.0")

    def test_list_known_paths(self):
        m = SchemaMigrator()
        m.register("world_state", "1.0.0", "1.1.0", lambda d: d)
        m.register("world_state", "1.1.0", "1.2.0", lambda d: d)
        paths = m.list_known_paths("world_state")
        self.assertEqual(set(paths), {("1.0.0", "1.1.0"), ("1.1.0", "1.2.0")})


class TestBuiltinMigrations(unittest.TestCase):
    """验证内置迁移函数(1.0.0 -> 1.2.0 world; 1.0.0 -> 1.1.0 profile)。"""

    def setUp(self):
        reset_migrator()
        self.migrator = get_migrator()  # 触发内置迁移注册

    def tearDown(self):
        reset_migrator()

    def test_world_v1_to_v1_1_adds_seed_hash(self):
        data = {
            "schema_version": "1.0.0",
            "world_id": "w-1",
            "world_seed": 12345,
            "created_at": 0.0,
            "day": 1,
            "season": "spring",
            "time_of_day": 0.5,
            "day_in_season": 1,
            "biome_layout": {},
            "players": {},
            "entities": {},
            "world_modifications": [],
        }
        out = self.migrator.migrate("world_state", data, "1.0.0", "1.1.0")
        self.assertEqual(out["schema_version"], "1.1.0")
        self.assertIn("world_seed_hash", out)
        self.assertEqual(len(out["world_seed_hash"]), 8)

    def test_world_v1_1_to_v1_2_chunks(self):
        data = {
            "schema_version": "1.1.0",
            "world_id": "w-1",
            "world_seed": 42,
            "world_seed_hash": "0000002a",
            "created_at": 0.0,
            "day": 5,
            "season": "summer",
            "time_of_day": 0.5,
            "day_in_season": 1,
            "biome_layout": {},
            "players": {},
            "entities": {},
            "world_modifications": [
                {"type": "dig", "position": {"x": 5.0, "y": 5.0}},
                {"type": "dig", "position": {"x": 18.0, "y": 18.0}},  # chunk 1:1
                {"type": "plant", "position": {"x": 100.0, "y": 100.0}},  # chunk 6:6
            ],
        }
        out = self.migrator.migrate("world_state", data, "1.1.0", "1.2.0")
        self.assertEqual(out["schema_version"], "1.2.0")
        self.assertIn("chunks", out)
        self.assertIn("0:0", out["chunks"])
        self.assertIn("1:1", out["chunks"])
        self.assertIn("6:6", out["chunks"])
        self.assertEqual(len(out["chunks"]["0:0"]), 1)
        self.assertEqual(len(out["chunks"]["1:1"]), 1)
        self.assertEqual(len(out["chunks"]["6:6"]), 1)

    def test_world_v1_0_to_v1_2_full_chain(self):
        data = {
            "schema_version": "1.0.0",
            "world_id": "w-1",
            "world_seed": 7,
            "created_at": 0.0,
            "day": 1,
            "season": "spring",
            "time_of_day": 0.5,
            "day_in_season": 1,
            "biome_layout": {},
            "players": {},
            "entities": {},
            "world_modifications": [
                {"type": "dig", "position": {"x": 32.0, "y": 32.0}},  # chunk 2:2
            ],
        }
        out = self.migrator.migrate("world_state", data, "1.0.0", "1.2.0")
        self.assertEqual(out["schema_version"], "1.2.0")
        self.assertIn("world_seed_hash", out)
        self.assertIn("chunks", out)
        self.assertIn("2:2", out["chunks"])

    def test_profile_v1_0_to_v1_1(self):
        data = {
            "schema_version": "1.0.0",
            "player_id": "p-1",
            "display_name": "Astone",
            "character_class": "scout",
            "appearance": {},
            "stats": {"hp_max": 100, "hunger_max": 100, "sanity_max": 100, "temperature_max": 100},
            "current_state": {"hp": 100, "hunger": 100, "sanity": 100, "temperature": 50},
            "inventory": {"twig": 5},
            "equipment": {"head": None, "body": None, "hand_main": None, "hand_off": None},
            "buffs": [],
            "unlocked_codex": [],
            "deaths": 0,
            "survival_days": 1,
        }
        out = self.migrator.migrate("player_profile", data, "1.0.0", "1.1.0")
        self.assertEqual(out["schema_version"], "1.1.0")
        self.assertIn("last_known_position", out)
        self.assertIsNone(out["last_known_position"])


# ==================== ChunkManager 单元测试 ====================

class TestChunkIds(unittest.TestCase):
    def test_terrain_chunk_id_positive(self):
        self.assertEqual(terrain_chunk_id(0, 0), "0:0")
        self.assertEqual(terrain_chunk_id(15.9, 15.9), "0:0")
        self.assertEqual(terrain_chunk_id(16.0, 16.0), "1:1")
        self.assertEqual(terrain_chunk_id(100.0, -50.0), "6:-4")

    def test_terrain_chunk_id_negative_coords(self):
        # 负坐标:Python // 是 floor,确保一致性
        self.assertEqual(terrain_chunk_id(-1.0, -1.0), "-1:-1")
        self.assertEqual(terrain_chunk_id(-16.0, -16.0), "-1:-1")

    def test_inventory_chunk_id(self):
        self.assertEqual(inventory_chunk_id("p-1"), "inv:p-1")


class TestSplitMergeRoundtrip(unittest.TestCase):
    def test_split_empty(self):
        chunks = split_world_modifications([])
        self.assertEqual(chunks, {})

    def test_split_single_modification(self):
        mods = [{"type": "dig", "position": {"x": 5.0, "y": 5.0}}]
        chunks = split_world_modifications(mods)
        self.assertIn("0:0", chunks)
        self.assertEqual(len(chunks["0:0"].items), 1)
        self.assertEqual(chunks["0:0"].items[0]["chunk_id"], "0:0")

    def test_split_multi_chunks(self):
        mods = [
            {"type": "dig", "position": {"x": 0.0, "y": 0.0}},  # 0:0
            {"type": "dig", "position": {"x": 32.0, "y": 0.0}},  # 2:0
            {"type": "plant", "position": {"x": 5.0, "y": 5.0}},  # 0:0
            {"type": "build", "position": {"x": 100.0, "y": 100.0}},  # 6:6
        ]
        chunks = split_world_modifications(mods)
        self.assertEqual(set(chunks.keys()), {"0:0", "2:0", "6:6"})
        self.assertEqual(len(chunks["0:0"].items), 2)
        self.assertEqual(len(chunks["2:0"].items), 1)
        self.assertEqual(len(chunks["6:6"].items), 1)

    def test_merge_roundtrip(self):
        mods = [
            {"type": "dig", "position": {"x": 5.0, "y": 5.0}},
            {"type": "plant", "position": {"x": 100.0, "y": 100.0}},
            {"type": "build", "position": {"x": 32.0, "y": 32.0}},
        ]
        chunks = split_world_modifications(mods)
        merged = merge_terrain_chunks(chunks)
        # 每个 mod 都有 chunk_id 字段
        self.assertEqual(len(merged), 3)
        for m in merged:
            self.assertIn("chunk_id", m)


class TestInventoryChunkExtractInject(unittest.TestCase):
    def test_extract_default(self):
        p = make_profile()
        pdata = p.to_dict()
        # 删 inventory_capacity(模拟老 schema)→ 默认 16
        pdata.pop("inventory_capacity", None)
        chunk = extract_inventory(pdata)
        self.assertEqual(chunk.player_id, p.player_id)
        self.assertEqual(chunk.capacity, 16)

    def test_inject_roundtrip(self):
        p = make_profile()
        pdata = p.to_dict()
        chunk = extract_inventory(pdata)
        out = inject_inventory(pdata, chunk)
        self.assertEqual(out["inventory"], pdata["inventory"])
        self.assertEqual(out["inventory_capacity"], 16)


class TestChunkFilePaths(unittest.TestCase):
    def test_inventory_file_path(self):
        self.assertEqual(
            str(inventory_file_path(Path("/saves/s1"), "p1")),
            "/saves/s1/profiles/p1_inventory.json",
        )

    def test_terrain_chunk_file_path(self):
        self.assertEqual(
            str(terrain_chunk_file_path(Path("/saves/s1"), "0:0")),
            "/saves/s1/terrain/0_0.json",
        )
        self.assertEqual(
            str(terrain_chunk_file_path(Path("/saves/s1"), "-1:2")),
            "/saves/s1/terrain/-1_2.json",
        )


# ==================== JsonFileStore 分块粒度 IO ====================

class JsonFileStoreChunkTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wildwood_m26_")
        self.root = Path(self.tmp) / "saves"
        self.store = JsonFileStore(self.root)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_minimal_save(self) -> SaveGame:
        s = make_save(seed=42, n_players=1)
        self.store.save_save(s)
        return s


class TestJsonFileStoreChunkIO(JsonFileStoreChunkTestBase):
    def test_save_and_load_terrain_chunk(self):
        s = self._write_minimal_save()
        chunk = TerrainChunk(chunk_id="0:0", items=[
            {"type": "dig", "position": {"x": 5.0, "y": 5.0}, "material": "dirt"},
            {"type": "dig", "position": {"x": 10.0, "y": 10.0}, "material": "dirt"},
        ])
        self.store.save_terrain_chunk(s.save_id, chunk)
        loaded = self.store.load_terrain_chunk(s.save_id, "0:0")
        self.assertEqual(loaded.chunk_id, "0:0")
        self.assertEqual(len(loaded.items), 2)

    def test_load_terrain_chunk_missing_raises(self):
        s = self._write_minimal_save()
        with self.assertRaises(KeyError):
            self.store.load_terrain_chunk(s.save_id, "99:99")

    def test_list_terrain_chunks(self):
        s = self._write_minimal_save()
        # 初始没有 terrain chunk(空 world)
        self.assertEqual(self.store.list_terrain_chunks(s.save_id), [])
        # 写 3 个 chunk
        for cid in ["0:0", "1:1", "-1:2"]:
            self.store.save_terrain_chunk(s.save_id, TerrainChunk(chunk_id=cid, items=[]))
        listed = self.store.list_terrain_chunks(s.save_id)
        self.assertEqual(listed, ["-1:2", "0:0", "1:1"])

    def test_save_and_load_inventory_chunk(self):
        s = self._write_minimal_save()
        pid = next(iter(s.player_profiles.keys()))
        chunk = InventoryChunk(player_id=pid, items={"twig": 5, "flint": 2}, capacity=16)
        self.store.save_inventory_chunk(s.save_id, chunk)
        loaded = self.store.load_inventory_chunk(s.save_id, pid)
        self.assertEqual(loaded.items, {"twig": 5, "flint": 2})
        self.assertEqual(loaded.capacity, 16)

    def test_load_inventory_chunk_missing_raises(self):
        s = self._write_minimal_save()
        with self.assertRaises(KeyError):
            self.store.load_inventory_chunk(s.save_id, "ghost")

    def test_save_terrain_chunk_updates_meta(self):
        s = self._write_minimal_save()
        meta_path = self.root / s.save_id / "meta.json"
        with open(meta_path) as f:
            meta_before = json.load(f)
        time.sleep(0.005)
        self.store.save_terrain_chunk(s.save_id, TerrainChunk(chunk_id="0:0", items=[]))
        with open(meta_path) as f:
            meta_after = json.load(f)
        self.assertGreater(meta_after["updated_at"], meta_before["updated_at"])

    def test_save_inventory_chunk_to_missing_player_raises(self):
        s = self._write_minimal_save()
        chunk = InventoryChunk(player_id="ghost", items={}, capacity=16)
        with self.assertRaises(KeyError):
            self.store.save_inventory_chunk(s.save_id, chunk)

    def test_save_size_bytes(self):
        s = self._write_minimal_save()
        size = self.store.save_size_bytes(s.save_id)
        self.assertGreater(size, 0)
        # 加 terrain chunk 后 size 增大
        self.store.save_terrain_chunk(s.save_id, TerrainChunk(
            chunk_id="0:0",
            items=[{"type": "dig", "position": {"x": 1.0, "y": 1.0}, "data": "x" * 100}],
        ))
        size2 = self.store.save_size_bytes(s.save_id)
        self.assertGreater(size2, size)


class TestJsonFileStoreUseChunksFalse(unittest.TestCase):
    """use_chunks=False 退化模式:单文件,分块 API 应抛错。"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wildwood_m26_legacy_")
        self.root = Path(self.tmp) / "saves"
        self.store = JsonFileStore(self.root, use_chunks=False)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_chunk_io_raises_when_chunks_disabled(self):
        s = make_save()
        self.store.save_save(s)
        with self.assertRaises(SchemaError):
            self.store.save_terrain_chunk(s.save_id, TerrainChunk(chunk_id="0:0", items=[]))
        with self.assertRaises(SchemaError):
            self.store.load_terrain_chunk(s.save_id, "0:0")
        with self.assertRaises(SchemaError):
            self.store.save_inventory_chunk(s.save_id, InventoryChunk(player_id="x", items={}, capacity=16))


# ==================== MockLiteDbStore 分块粒度 IO ====================

class MockLiteDbStoreChunkTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wildwood_m26_mock_")
        self.db_path = Path(self.tmp) / "wildwood.litedb.json"
        self.store = MockLiteDbStore(self.db_path)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_minimal_save(self) -> SaveGame:
        s = make_save(seed=42, n_players=1)
        self.store.save_save(s)
        return s


class TestMockLiteDbStoreChunkIO(MockLiteDbStoreChunkTestBase):
    def test_save_and_load_terrain_chunk(self):
        s = self._write_minimal_save()
        chunk = TerrainChunk(chunk_id="0:0", items=[{"type": "dig", "x": 1.0, "y": 1.0}])
        self.store.save_terrain_chunk(s.save_id, chunk)
        loaded = self.store.load_terrain_chunk(s.save_id, "0:0")
        self.assertEqual(len(loaded.items), 1)

    def test_save_and_load_inventory_chunk(self):
        s = self._write_minimal_save()
        pid = next(iter(s.player_profiles.keys()))
        chunk = InventoryChunk(player_id=pid, items={"stone": 3}, capacity=20)
        self.store.save_inventory_chunk(s.save_id, chunk)
        loaded = self.store.load_inventory_chunk(s.save_id, pid)
        self.assertEqual(loaded.items, {"stone": 3})
        self.assertEqual(loaded.capacity, 20)

    def test_list_terrain_chunks(self):
        s = self._write_minimal_save()
        for cid in ["0:0", "1:1"]:
            self.store.save_terrain_chunk(s.save_id, TerrainChunk(chunk_id=cid, items=[]))
        self.assertEqual(self.store.list_terrain_chunks(s.save_id), ["0:0", "1:1"])

    def test_save_size_bytes(self):
        s = self._write_minimal_save()
        size = self.store.save_size_bytes(s.save_id)
        self.assertGreater(size, 0)

    def test_multi_save_isolation(self):
        """多个 save 的 chunks 互不污染。"""
        s1 = make_save(seed=1, n_players=1)
        s2 = make_save(seed=2, n_players=1)
        self.store.save_save(s1)
        self.store.save_save(s2)
        # 给 s1 加 chunk,s2 不应有
        self.store.save_terrain_chunk(s1.save_id, TerrainChunk(chunk_id="0:0", items=[]))
        self.assertIn("0:0", self.store.list_terrain_chunks(s1.save_id))
        self.assertNotIn("0:0", self.store.list_terrain_chunks(s2.save_id))

    def test_delete_save_purges_chunks(self):
        s = self._write_minimal_save()
        self.store.save_terrain_chunk(s.save_id, TerrainChunk(chunk_id="0:0", items=[]))
        self.store.save_inventory_chunk(s.save_id, InventoryChunk(
            player_id=next(iter(s.player_profiles.keys())), items={}, capacity=16
        ))
        self.store.delete_save(s.save_id)
        # chunks 已被清理
        self.assertEqual(self.store.list_terrain_chunks(s.save_id), [])


# ==================== 跨模式:单机 / 联机 ====================

class TestCrossModeRoundtrip(unittest.TestCase):
    """验收 ④:单机 / 联机共用一套存档(数据格式完全一致)。"""

    def _roundtrip(self, store: DataStore, save: SaveGame) -> SaveGame:
        store.save_save(save)
        return store.load_save(save.save_id)

    def test_single_to_host_preserves_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=4, mode="single")
            s.clients = []  # 单机无联机连接
            s2 = self._roundtrip(store, s)
            self.assertEqual(s2.game_mode, "single")
            self.assertEqual(len(s2.player_profiles), 4)
            self.assertEqual(len(s2.clients), 0)

    def test_host_with_clients_can_be_loaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=4, mode="host")
            from core.abstract.data import ClientConnection
            s.clients = [
                ClientConnection(player_id=pid, last_seen=time.time(), connection_state="connected")
                for pid in s.player_profiles.keys()
            ]
            s2 = self._roundtrip(store, s)
            self.assertEqual(s2.game_mode, "host")
            self.assertEqual(len(s2.clients), 4)
            # world_state 与 player_profiles 完整保留
            self.assertEqual(len(s2.player_profiles), 4)

    def test_host_save_loadable_as_single(self):
        """联机存档可被单机读取(只是忽略 clients 字段)。"""
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=4, mode="host")
            from core.abstract.data import ClientConnection
            s.clients = [
                ClientConnection(player_id=pid, last_seen=time.time(), connection_state="connected")
                for pid in s.player_profiles.keys()
            ]
            store.save_save(s)
            loaded = store.load_save(s.save_id)
            # 切换为单机模式(模拟 host 退出后单机接管存档,这里只验证数据可读)
            loaded.game_mode = "single"
            store.save_save(loaded)
            final = store.load_save(s.save_id)
            self.assertEqual(final.game_mode, "single")
            # world/profiles 数据未丢失
            self.assertEqual(len(final.player_profiles), 4)
            # clients 已被覆盖为空(因为 loaded.clients 保留)
            self.assertEqual(len(final.clients), 4)

    def test_cross_mode_mock_equivalence(self):
        """reference 和 mock 的跨模式 roundtrip 数据一致。"""
        with tempfile.TemporaryDirectory() as tmp:
            ref = JsonFileStore(Path(tmp) / "ref")
            mock = MockLiteDbStore(Path(tmp) / "mock.json")
            s = make_save(seed=42, n_players=2, mode="host")
            from core.abstract.data import ClientConnection
            s.clients = [
                ClientConnection(player_id=pid, last_seen=1.0, connection_state="connected")
                for pid in s.player_profiles.keys()
            ]
            ref.save_save(s)
            mock.save_save(s)
            ref_loaded = ref.load_save(s.save_id)
            mock_loaded = mock.load_save(s.save_id)
            self.assertEqual(ref_loaded.game_mode, mock_loaded.game_mode)
            self.assertEqual(
                set(ref_loaded.player_profiles.keys()),
                set(mock_loaded.player_profiles.keys()),
            )
            self.assertEqual(len(ref_loaded.clients), len(mock_loaded.clients))


# ==================== 满存档 验收 ③ (< 10MB) ====================

class TestFullSaveSizeBudget(unittest.TestCase):
    """验收 ③:4 季 30 日满存档 < 10MB。"""

    @staticmethod
    def _build_full_save(seed: int = 42) -> SaveGame:
        world = make_world(seed=seed, day=120)  # 4 季 × 30 日 = 120 日
        # 4 玩家
        profiles: Dict[str, PlayerProfile] = {}
        for i in range(4):
            p = make_profile(name=f"P{i}")
            profiles[p.player_id] = p
            world.players[p.player_id] = {
                "position": {"x": 16.0 * (i + 1), "y": 32.0},
                "current_state": {
                    "hp": 80.0, "hunger": 60.0, "sanity": 90.0, "temperature": 50.0,
                },
            }
        # ~5000 地形修改(挖坑 + 种树 + 建造,随机分布在 -200~200 范围)
        import random
        rng = random.Random(seed)
        for i in range(5000):
            x = rng.uniform(-200, 200)
            y = rng.uniform(-200, 200)
            world.world_modifications.append({
                "type": rng.choice(["dig", "plant", "build", "harvest"]),
                "position": {"x": x, "y": y},
                "material": rng.choice(["dirt", "stone", "wood", "berry"]),
                "tick": rng.randint(1, 120 * 240),  # 1 tick = 0.5s, 4 季 30 日 = 120 * 240 tick
            })
        # 玩家库存(每玩家 12 个槽位)
        for p in profiles.values():
            for j in range(12):
                p.inventory[f"item_{j}"] = rng.randint(1, 50)
            p.unlocked_codex = [f"recipe_{k}" for k in range(rng.randint(5, 15))]
            p.buffs = [
                {"name": "well_fed", "duration": rng.randint(60, 600)} for _ in range(rng.randint(0, 3))
            ]
        host = next(iter(profiles))
        return SaveGame.from_world_and_profiles(
            world, profiles, host_player_id=host, game_mode="single"
        )

    def test_full_save_under_10mb_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            save = self._build_full_save()
            t0 = time.time()
            store.save_save(save)
            save_time = time.time() - t0
            size = store.save_size_bytes(save.save_id)
            self.assertLess(size, 10 * 1024 * 1024, f"存档过大: {size} bytes")
            # 性能基准:save 应 < 2s
            self.assertLess(save_time, 2.0, f"save 耗时过长: {save_time}s")

    def test_full_save_under_10mb_mock(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = MockLiteDbStore(Path(tmp) / "mock.json")
            save = self._build_full_save()
            store.save_save(save)
            size = store.save_size_bytes(save.save_id)
            self.assertLess(size, 10 * 1024 * 1024, f"mock 存档过大: {size} bytes")

    def test_full_save_load_roundtrip_under_1s(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            save = self._build_full_save()
            store.save_save(save)
            t0 = time.time()
            loaded = store.load_save(save.save_id)
            load_time = time.time() - t0
            self.assertLess(load_time, 1.0, f"load 耗时过长: {load_time}s")
            # 数据完整性
            self.assertEqual(len(loaded.world_state["world_modifications"]), 5000)
            self.assertEqual(len(loaded.player_profiles), 4)
            for p in loaded.player_profiles.values():
                self.assertEqual(len(p["inventory"]), 12)


# ==================== 退出后重进完全一致 验收 ① ====================

class TestExitReenterIdentical(unittest.TestCase):
    """验收 ①:save → load → 每个字段完全一致。"""

    def test_basic_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=2)
            # 加一些 terrain mods
            s.world_state["world_modifications"] = [
                {"type": "dig", "position": {"x": 5.0, "y": 5.0}},
                {"type": "plant", "position": {"x": 100.0, "y": 100.0}},
            ]
            store.save_save(s)
            loaded = store.load_save(s.save_id)
            self.assertEqual(loaded.save_id, s.save_id)
            self.assertEqual(loaded.game_mode, s.game_mode)
            self.assertEqual(loaded.host_player_id, s.host_player_id)
            self.assertEqual(loaded.world_state["day"], s.world_state["day"])
            self.assertEqual(loaded.world_state["season"], s.world_state["season"])
            self.assertEqual(
                len(loaded.world_state["world_modifications"]),
                len(s.world_state["world_modifications"]),
            )
            self.assertEqual(len(loaded.player_profiles), len(s.player_profiles))

    def test_roundtrip_inventory_consistency(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=2)
            for p in s.player_profiles.values():
                p["inventory"] = {"twig": 10, "flint": 5, "grass": 8}
            store.save_save(s)
            loaded = store.load_save(s.save_id)
            for pid, p in loaded.player_profiles.items():
                self.assertEqual(p["inventory"], {"twig": 10, "flint": 5, "grass": 8})

    def test_roundtrip_inventory_via_chunk(self):
        """直接走 inventory chunk 路径(roundtrip 应一致)。"""
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=1)
            store.save_save(s)
            pid = next(iter(s.player_profiles.keys()))
            chunk = InventoryChunk(player_id=pid, items={"stone": 3, "flint": 1}, capacity=16)
            store.save_inventory_chunk(s.save_id, chunk)
            loaded_chunk = store.load_inventory_chunk(s.save_id, pid)
            self.assertEqual(loaded_chunk.items, {"stone": 3, "flint": 1})
            # 整体 load_save 应反映 inventory
            save = store.load_save(s.save_id)
            self.assertEqual(save.player_profiles[pid]["inventory"], {"stone": 3, "flint": 1})

    def test_roundtrip_after_terrain_chunk_edit(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=1)
            store.save_save(s)
            # 编辑 0:0 chunk
            chunk = TerrainChunk(chunk_id="0:0", items=[{"type": "build", "position": {"x": 1.0, "y": 1.0}}])
            store.save_terrain_chunk(s.save_id, chunk)
            save = store.load_save(s.save_id)
            mods = save.world_state["world_modifications"]
            self.assertEqual(len(mods), 1)
            self.assertEqual(mods[0]["type"], "build")
            self.assertEqual(mods[0]["chunk_id"], "0:0")


# ==================== 版本迁移 验收 ② ====================

class TestVersionMigrationOnLoad(unittest.TestCase):
    """验收 ②:版本号不匹配时迁移成功。"""

    def test_load_v1_0_world_auto_migrates(self):
        """写入 1.0.0 WorldState(load 时自动迁移到 1.2.0)。"""
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=1)
            # 手动降级 world 字段 schema_version
            s.world_state["schema_version"] = "1.0.0"
            s.world_state.pop("world_seed_hash", None)
            s.world_state.pop("chunks", None)
            # 写一个完整存档(包含 world_state)
            store.save_save(s)
            # 但 world_state 在 save_save 时会被覆盖(因为 save_save 用 save.to_dict()),
            # 所以这里需要走另一条路:先 save 一次,再覆盖 world.json
            save_dir = Path(tmp) / "saves" / s.save_id
            with open(save_dir / "world.json") as f:
                ws = json.load(f)
            ws["schema_version"] = "1.0.0"
            ws.pop("world_seed_hash", None)
            ws.pop("chunks", None)
            with open(save_dir / "world.json", "w") as f:
                json.dump(ws, f)
            # 现在 load 应自动迁移
            loaded = store.load_save(s.save_id)
            self.assertEqual(loaded.world_state["schema_version"], CURRENT_WORLD_STATE_VERSION)
            self.assertIn("world_seed_hash", loaded.world_state)
            self.assertIn("chunks", loaded.world_state)

    def test_load_v1_0_profile_auto_migrates(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JsonFileStore(Path(tmp) / "saves")
            s = make_save(seed=42, n_players=1)
            store.save_save(s)
            # 覆盖 profile 为 1.0.0(无 last_known_position / inventory_capacity)
            save_dir = Path(tmp) / "saves" / s.save_id
            pid = next(iter(s.player_profiles.keys()))
            profile_path = save_dir / "profiles" / f"{pid}.json"
            with open(profile_path) as f:
                pdata = json.load(f)
            pdata["schema_version"] = "1.0.0"
            pdata.pop("last_known_position", None)
            pdata.pop("inventory_capacity", None)
            with open(profile_path, "w") as f:
                json.dump(pdata, f)
            loaded = store.load_save(s.save_id)
            self.assertEqual(
                loaded.player_profiles[pid]["schema_version"],
                CURRENT_PLAYER_PROFILE_VERSION,
            )
            self.assertIn("last_known_position", loaded.player_profiles[pid])
            self.assertEqual(loaded.player_profiles[pid]["inventory_capacity"], 16)


# ==================== DataStore 合约:跨 backend 一致 ====================

class DataStoreChunkContractMixin:
    """两 backend 共用的分块合约测试(混入两个 TestCase 跑)。"""

    store: DataStore
    tmp: str

    def _make_save_with_mods(self) -> SaveGame:
        s = make_save(seed=42, n_players=1)
        s.world_state["world_modifications"] = [
            {"type": "dig", "position": {"x": 5.0, "y": 5.0}},
            {"type": "dig", "position": {"x": 32.0, "y": 32.0}},  # chunk 2:2
        ]
        return s

    def test_chunk_io_roundtrip(self):
        s = self._make_save_with_mods()
        self.store.save_save(s)
        # 列出 chunks
        cids = self.store.list_terrain_chunks(s.save_id)
        # 应该有 0:0 和 2:2
        self.assertIn("0:0", cids)
        self.assertIn("2:2", cids)
        # 修改 0:0 chunk
        c = self.store.load_terrain_chunk(s.save_id, "0:0")
        c.items.append({"type": "plant", "position": {"x": 1.0, "y": 1.0}})
        self.store.save_terrain_chunk(s.save_id, c)
        # load 整个 save 验证
        loaded = self.store.load_save(s.save_id)
        types = [m["type"] for m in loaded.world_state["world_modifications"]]
        self.assertIn("plant", types)

    def test_inventory_chunk_io_roundtrip(self):
        s = make_save(seed=42, n_players=2)
        self.store.save_save(s)
        pid = next(iter(s.player_profiles.keys()))
        chunk = InventoryChunk(player_id=pid, items={"twig": 99, "stone": 1}, capacity=20)
        self.store.save_inventory_chunk(s.save_id, chunk)
        loaded = self.store.load_inventory_chunk(s.save_id, pid)
        self.assertEqual(loaded.items, {"twig": 99, "stone": 1})
        self.assertEqual(loaded.capacity, 20)

    def test_save_size_bytes_nonzero(self):
        s = make_save(seed=42, n_players=1)
        self.store.save_save(s)
        self.assertGreater(self.store.save_size_bytes(s.save_id), 0)


class TestChunkContractJsonFile(DataStoreChunkContractMixin, unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wildwood_m26_contract_json_")
        self.store = JsonFileStore(Path(self.tmp) / "saves")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class TestChunkContractMockLiteDb(DataStoreChunkContractMixin, unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wildwood_m26_contract_mock_")
        self.store = MockLiteDbStore(Path(self.tmp) / "mock.json")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
