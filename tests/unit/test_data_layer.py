"""
Wildwood 数据层 — 单元测试(M1.4 验收 ④: A/B 切换 mock 适配器测试通过)

跑法:
  cd wildwood
  python3 -m unittest tests.unit.test_data_layer -v

覆盖范围:
  - 版本号工具(parse_version / is_compatible / is_newer)
  - Schema 校验(WorldState / PlayerProfile / SaveGame)
  - DataStore 抽象合约(对 reference 与 mock 同时跑,通过 DataStoreContractMixin)
  - A/B 适配器(env / 显式参数 / 缺参 / 切换等价性)
"""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict

from core.abstract.data import (
    CURRENT_PLAYER_PROFILE_VERSION,
    CURRENT_SAVE_GAME_VERSION,
    CURRENT_WORLD_STATE_VERSION,
    JsonFileStore,
    MockLiteDbStore,
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
    make_store,
    parse_version,
)
from core.abstract.data.store import DataStore


# === 测试用 fixture helpers ===

def make_world(seed: int = 42) -> WorldState:
    return WorldState.create_new(world_seed=seed, biome_layout={"forest": 5, "marsh": 1})


def make_profile(name: str = "Astone", char_class: str = "scout") -> PlayerProfile:
    return PlayerProfile.create_new(display_name=name, character_class=char_class)


def make_save(seed: int = 42) -> SaveGame:
    world = make_world(seed)
    profile = make_profile()
    # 玩家在世界中的位置(WorldState.players 是 player_id -> 内嵌 dict)
    world.players[profile.player_id] = {
        "position": {"x": 16.0, "y": 32.0},
        "current_state": {
            "hp": profile.current_state.hp,
            "hunger": profile.current_state.hunger,
            "sanity": profile.current_state.sanity,
            "temperature": profile.current_state.temperature,
        },
    }
    return SaveGame.from_world_and_profiles(
        world,
        {profile.player_id: profile},
        host_player_id=profile.player_id,
    )


# ==================== 版本号测试 ====================

class TestVersionUtils(unittest.TestCase):
    def test_parse_version_ok(self):
        self.assertEqual(parse_version("1.0.0"), (1, 0, 0))
        self.assertEqual(parse_version("1.2.3"), (1, 2, 3))
        self.assertEqual(parse_version("10.20.30"), (10, 20, 30))

    def test_parse_version_invalid(self):
        with self.assertRaises(SchemaError):
            parse_version("1.2")
        with self.assertRaises(SchemaError):
            parse_version("1.2.3.4")
        with self.assertRaises(SchemaError):
            parse_version("v1.2.3")
        with self.assertRaises(SchemaError):
            parse_version("abc")
        with self.assertRaises(SchemaError):
            parse_version("")  # type: ignore[arg-type]

    def test_compat_same_major(self):
        self.assertTrue(is_compatible("1.0.0", "1.0.0"))
        self.assertTrue(is_compatible("1.5.3", "1.0.0"))
        self.assertTrue(is_compatible("1.0.0", "1.5.3"))
        self.assertTrue(is_compatible("1.99.99", "1.0.0"))

    def test_compat_different_major(self):
        self.assertFalse(is_compatible("2.0.0", "1.0.0"))
        self.assertFalse(is_compatible("1.0.0", "2.0.0"))
        self.assertFalse(is_compatible("0.9.0", "1.0.0"))

    def test_is_newer(self):
        self.assertTrue(is_newer("1.1.0", "1.0.0"))
        self.assertTrue(is_newer("2.0.0", "1.99.99"))
        self.assertFalse(is_newer("1.0.0", "1.1.0"))
        self.assertFalse(is_newer("1.5.0", "1.5.0"))


# ==================== Schema 校验测试 ====================

class TestWorldStateSchema(unittest.TestCase):
    def test_create_new_defaults(self):
        w = WorldState.create_new(world_seed=1)
        self.assertEqual(w.schema_version, CURRENT_WORLD_STATE_VERSION)
        self.assertEqual(w.day, 1)
        self.assertEqual(w.season, Season.SPRING.value)
        self.assertEqual(w.players, {})
        self.assertEqual(w.entities, {})

    def test_validate_minimal(self):
        w = WorldState.create_new(world_seed=1)
        SchemaValidator.validate_world_state(w.to_dict())

    def test_missing_field(self):
        w = WorldState.create_new(world_seed=1)
        d = w.to_dict()
        del d["day"]
        with self.assertRaises(SchemaError) as ctx:
            SchemaValidator.validate_world_state(d)
        self.assertIn("day", str(ctx.exception))

    def test_invalid_season(self):
        w = WorldState.create_new(world_seed=1)
        w.season = "rainbow"
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_world_state(w.to_dict())

    def test_invalid_time_of_day(self):
        w = WorldState.create_new(world_seed=1)
        w.time_of_day = 1.5
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_world_state(w.to_dict())

    def test_negative_day(self):
        w = WorldState.create_new(world_seed=1)
        w.day = -1
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_world_state(w.to_dict())

    def test_world_seed_must_be_int(self):
        w = WorldState.create_new(world_seed=1)
        d = w.to_dict()
        d["world_seed"] = "42"  # str 而非 int
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_world_state(d)

    def test_major_version_mismatch(self):
        w = WorldState.create_new(world_seed=1)
        d = w.to_dict()
        d["schema_version"] = "2.0.0"
        with self.assertRaises(VersionIncompatibleError):
            SchemaValidator.validate_world_state(d)

    def test_not_a_dict(self):
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_world_state([1, 2, 3])  # type: ignore[arg-type]


class TestPlayerProfileSchema(unittest.TestCase):
    def test_create_minimal(self):
        p = PlayerProfile.create_new(display_name="Astone")
        SchemaValidator.validate_player_profile(p.to_dict())

    def test_empty_name_rejected(self):
        p = PlayerProfile.create_new(display_name="Astone")
        p.display_name = ""
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_player_profile(p.to_dict())

    def test_invalid_class_rejected(self):
        p = PlayerProfile.create_new(display_name="Astone")
        p.character_class = "wizard"
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_player_profile(p.to_dict())

    def test_negative_deaths_rejected(self):
        p = PlayerProfile.create_new(display_name="Astone")
        p.deaths = -1
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_player_profile(p.to_dict())

    def test_negative_inventory_rejected(self):
        p = PlayerProfile.create_new(display_name="Astone")
        d = p.to_dict()
        d["inventory"]["twig"] = -1
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_player_profile(d)

    def test_zero_hp_max_rejected(self):
        p = PlayerProfile.create_new(display_name="Astone")
        d = p.to_dict()
        d["stats"]["hp_max"] = 0
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_player_profile(d)

    def test_valid_classes(self):
        for cls in ("scout", "builder", "warrior", "gatherer"):
            p = PlayerProfile.create_new(display_name="X", character_class=cls)
            SchemaValidator.validate_player_profile(p.to_dict())

    def test_critical_state_detected(self):
        s = PlayerCurrentState(hp=20, hunger=50, sanity=50, temperature=50)
        self.assertTrue(s.is_critical())
        s2 = PlayerCurrentState(hp=80, hunger=50, sanity=50, temperature=50)
        self.assertFalse(s2.is_critical())


class TestSaveGameSchema(unittest.TestCase):
    def test_full_save_validates(self):
        s = make_save()
        SchemaValidator.validate_save_game(s.to_dict())

    def test_invalid_game_mode(self):
        s = make_save()
        d = s.to_dict()
        d["game_mode"] = "ranked"
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_save_game(d)

    def test_nested_profile_error_propagates(self):
        s = make_save()
        d = s.to_dict()
        # 篡改内嵌玩家档案
        d["player_profiles"][list(d["player_profiles"].keys())[0]]["display_name"] = ""
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_save_game(d)

    def test_nested_world_error_propagates(self):
        s = make_save()
        d = s.to_dict()
        d["world_state"]["season"] = "pumpkin"
        with self.assertRaises(SchemaError):
            SchemaValidator.validate_save_game(d)


# ==================== DataStore 合约测试(对 reference 与 mock 同时跑) ====================

class DataStoreContractMixin:
    """对任意 DataStore 实现的合约测试。子类只需实现 _make_store。"""

    tmp: str  # 由 setUp 注入

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store: DataStore = self._make_store(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _make_store(self, tmp: str) -> DataStore:
        raise NotImplementedError

    def _corrupt_to_old_major(self, store: DataStore, save_id: str) -> None:
        """把存档的 schema_version 改成 0.9.0(不同 major)以触发不兼容。"""
        raise NotImplementedError

    # --- 测试用例 ---

    def test_empty_list(self):
        self.assertEqual(self.store.list_saves(), [])

    def test_exists_false_on_empty(self):
        self.assertFalse(self.store.exists("nonexistent"))

    def test_save_and_load_roundtrip(self):
        s = make_save(seed=1)
        self.store.save_save(s)
        self.assertTrue(self.store.exists(s.save_id))
        s2 = self.store.load_save(s.save_id)
        self.assertEqual(s2.save_id, s.save_id)
        self.assertEqual(s2.game_mode, s.game_mode)
        self.assertEqual(s2.world_state["world_seed"], 1)
        self.assertEqual(len(s2.player_profiles), 1)
        self.assertEqual(s2.host_player_id, s.host_player_id)

    def test_delete(self):
        s = make_save()
        self.store.save_save(s)
        self.assertTrue(self.store.exists(s.save_id))
        self.assertTrue(self.store.delete_save(s.save_id))
        self.assertFalse(self.store.exists(s.save_id))
        # 二次删除返回 False
        self.assertFalse(self.store.delete_save(s.save_id))

    def test_load_missing_raises(self):
        with self.assertRaises(KeyError):
            self.store.load_save("nope")

    def test_upsert_and_load_profile(self):
        s = make_save()
        self.store.save_save(s)
        pid = next(iter(s.player_profiles.keys()))
        p = self.store.load_player_profile(s.save_id, pid)
        self.assertEqual(p.player_id, pid)
        self.assertEqual(p.deaths, 0)
        # 更新 deaths
        p.deaths = 3
        self.store.upsert_player_profile(s.save_id, p)
        p2 = self.store.load_player_profile(s.save_id, pid)
        self.assertEqual(p2.deaths, 3)

    def test_load_missing_profile_raises(self):
        s = make_save()
        self.store.save_save(s)
        with self.assertRaises(KeyError):
            self.store.load_player_profile(s.save_id, "ghost")

    def test_save_world_state(self):
        s = make_save()
        self.store.save_save(s)
        w = self.store.load_world_state(s.save_id)
        w.day = 5
        w.season = Season.AUTUMN.value
        self.store.save_world_state(s.save_id, w)
        w2 = self.store.load_world_state(s.save_id)
        self.assertEqual(w2.day, 5)
        self.assertEqual(w2.season, Season.AUTUMN.value)

    def test_list_saves(self):
        s1 = make_save(seed=1)
        s2 = make_save(seed=2)
        self.store.save_save(s1)
        self.store.save_save(s2)
        all_saves = self.store.list_saves()
        ids = {x["save_id"] for x in all_saves}
        self.assertEqual(ids, {s1.save_id, s2.save_id})
        # 摘要字段完整
        for entry in all_saves:
            self.assertIn("save_id", entry)
            self.assertIn("game_mode", entry)
            self.assertIn("created_at", entry)
            self.assertIn("updated_at", entry)
            self.assertIn("host_player_id", entry)

    def test_incompatible_version_rejected(self):
        s = make_save()
        self.store.save_save(s)
        self._corrupt_to_old_major(self.store, s.save_id)
        with self.assertRaises(VersionIncompatibleError):
            self.store.load_save(s.save_id)

    def test_update_updated_at(self):
        s = make_save()
        self.store.save_save(s)
        first_updated = s.updated_at
        # 强制 updated_at 改变
        import time
        time.sleep(0.01)
        w = self.store.load_world_state(s.save_id)
        w.day = 10
        self.store.save_world_state(s.save_id, w)
        s2 = self.store.load_save(s.save_id)
        self.assertGreater(s2.updated_at, first_updated)


class TestJsonFileStore(DataStoreContractMixin, unittest.TestCase):
    def _make_store(self, tmp: str) -> DataStore:
        return JsonFileStore(Path(tmp) / "saves")

    def _corrupt_to_old_major(self, store: DataStore, save_id: str) -> None:
        meta_path = Path(self.tmp) / "saves" / save_id / "meta.json"
        with open(meta_path, "r", encoding="utf-8") as f:
            m = json.load(f)
        m["schema_version"] = "0.9.0"  # 不同 major
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(m, f)

    def test_files_created(self):
        s = make_save()
        self.store.save_save(s)
        save_dir = Path(self.tmp) / "saves" / s.save_id
        self.assertTrue((save_dir / "meta.json").exists())
        self.assertTrue((save_dir / "world.json").exists())
        self.assertTrue((save_dir / "profiles").is_dir())
        self.assertEqual(len(list((save_dir / "profiles").iterdir())), 1)

    def test_atomic_write_no_leftovers(self):
        s = make_save()
        self.store.save_save(s)
        save_dir = Path(self.tmp) / "saves" / s.save_id
        leftovers = [p for p in save_dir.iterdir() if p.name.startswith(".tmp_")]
        self.assertEqual(leftovers, [])


class TestMockLiteDbStore(DataStoreContractMixin, unittest.TestCase):
    def _make_store(self, tmp: str) -> DataStore:
        return MockLiteDbStore(Path(tmp) / "wildwood.litedb.json")

    def _corrupt_to_old_major(self, store: DataStore, save_id: str) -> None:
        # 直接操作 mock 的内部 cache,然后 flush
        assert isinstance(store, MockLiteDbStore)
        store._load()  # 确保 cache 加载
        store._cache["collections"]["saves"][save_id]["schema_version"] = "0.9.0"
        store._flush()

    def test_litedb_style_api(self):
        """LiteRepository 风格的 API 可用。"""
        assert isinstance(self.store, MockLiteDbStore)
        s = make_save()
        self.store.insert_one("saves", s.save_id, s.to_dict())
        loaded = self.store.find_one("saves", s.save_id)
        self.assertEqual(loaded["save_id"], s.save_id)

        # update_one
        loaded["settings"]["difficulty"] = "hard"
        self.store.update_one("saves", s.save_id, loaded)
        loaded2 = self.store.find_one("saves", s.save_id)
        self.assertEqual(loaded2["settings"]["difficulty"], "hard")

        # count
        self.assertEqual(self.store.count("saves"), 1)

        # delete_one
        self.assertTrue(self.store.delete_one("saves", s.save_id))
        self.assertEqual(self.store.count("saves"), 0)

    def test_insert_duplicate_raises(self):
        s = make_save()
        self.store.insert_one("saves", s.save_id, s.to_dict())
        with self.assertRaises(ValueError):
            self.store.insert_one("saves", s.save_id, s.to_dict())

    def test_find_missing_raises(self):
        with self.assertRaises(KeyError):
            self.store.find_one("saves", "ghost")

    def test_collection_unknown_raises(self):
        with self.assertRaises(KeyError):
            self.store.collection("nope")

    def test_db_file_is_single_file(self):
        """Mock 必须把所有数据存在单个 .json 文件中(模拟 LiteDB 单文件 .db)。"""
        s = make_save()
        self.store.save_save(s)
        # 数据库文件存在且包含 saves + world_states + player_profiles 三个 collection
        with open(Path(self.tmp) / "wildwood.litedb.json", "r", encoding="utf-8") as f:
            db = json.load(f)
        self.assertIn("collections", db)
        self.assertIn("saves", db["collections"])
        self.assertIn("world_states", db["collections"])
        self.assertIn("player_profiles", db["collections"])


# ==================== A/B 适配器测试(任务验收 ④) ====================

class TestAdapter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # 清理 env 避免污染
        self._old_env = os.environ.get("WILDSWOOD_DATA_BACKEND")
        os.environ.pop("WILDSWOOD_DATA_BACKEND", None)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        if self._old_env is not None:
            os.environ["WILDSWOOD_DATA_BACKEND"] = self._old_env
        else:
            os.environ.pop("WILDSWOOD_DATA_BACKEND", None)

    def test_default_is_reference(self):
        """无参数 + 无 env → reference。"""
        s = make_store(reference_root=str(Path(self.tmp) / "saves"))
        self.assertIsInstance(s, JsonFileStore)

    def test_explicit_reference(self):
        s = make_store("reference", reference_root=str(Path(self.tmp) / "saves"))
        self.assertIsInstance(s, JsonFileStore)

    def test_explicit_mock(self):
        s = make_store("mock", mock_db_path=str(Path(self.tmp) / "db.json"))
        self.assertIsInstance(s, MockLiteDbStore)

    def test_env_mock(self):
        os.environ["WILDSWOOD_DATA_BACKEND"] = "mock"
        s = make_store(mock_db_path=str(Path(self.tmp) / "db.json"))
        self.assertIsInstance(s, MockLiteDbStore)

    def test_env_reference(self):
        os.environ["WILDSWOOD_DATA_BACKEND"] = "reference"
        s = make_store(reference_root=str(Path(self.tmp) / "saves"))
        self.assertIsInstance(s, JsonFileStore)

    def test_aliases(self):
        for alias, expected in [("ref", JsonFileStore), ("json_files", JsonFileStore),
                                 ("a", JsonFileStore), ("litedb", MockLiteDbStore),
                                 ("b", MockLiteDbStore)]:
            with self.subTest(alias=alias):
                if expected is JsonFileStore:
                    s = make_store(alias, reference_root=str(Path(self.tmp) / "saves"))
                else:
                    s = make_store(alias, mock_db_path=str(Path(self.tmp) / f"db_{alias}.json"))
                self.assertIsInstance(s, expected)

    def test_unknown_backend_raises(self):
        with self.assertRaises(ValueError):
            make_store("oracle", reference_root="/tmp/x")

    def test_reference_missing_root_raises(self):
        with self.assertRaises(ValueError):
            make_store("reference")

    def test_mock_missing_path_raises(self):
        with self.assertRaises(ValueError):
            make_store("mock")

    def test_a_b_switch_same_workflow(self):
        """关键:同一份存档 workflow 在 reference 与 mock 上产出等价结果。"""
        ref = make_store("reference", reference_root=str(Path(self.tmp) / "ref_saves"))
        mock = make_store("mock", mock_db_path=str(Path(self.tmp) / "mock_db.json"))
        for backend, store in [("reference", ref), ("mock", mock)]:
            with self.subTest(backend=backend):
                # 写
                s = make_save(seed=99)
                store.save_save(s)
                # 读
                s2 = store.load_save(s.save_id)
                self.assertEqual(s2.world_state["world_seed"], 99)
                self.assertEqual(s2.game_mode, s.game_mode)
                self.assertEqual(len(s2.player_profiles), 1)
                # 列表
                listed = store.list_saves()
                self.assertEqual(len(listed), 1)
                # 子对象操作
                w = store.load_world_state(s.save_id)
                w.day = 7
                w.season = Season.WINTER.value
                store.save_world_state(s.save_id, w)
                w2 = store.load_world_state(s.save_id)
                self.assertEqual(w2.day, 7)
                self.assertEqual(w2.season, Season.WINTER.value)
                # 删
                self.assertTrue(store.delete_save(s.save_id))
                self.assertFalse(store.exists(s.save_id))

    def test_switch_preserves_data_across_instances(self):
        """同一 backend 重新打开,数据应保持。"""
        path = str(Path(self.tmp) / "persistent_db.json")
        s1 = make_store("mock", mock_db_path=path)
        s = make_save(seed=123)
        s1.save_save(s)
        # 重新打开
        s2 = make_store("mock", mock_db_path=path)
        s_loaded = s2.load_save(s.save_id)
        self.assertEqual(s_loaded.world_state["world_seed"], 123)


if __name__ == "__main__":
    unittest.main(verbosity=2)
