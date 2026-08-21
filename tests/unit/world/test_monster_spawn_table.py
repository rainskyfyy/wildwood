"""
Wildwood M2.8 — MonsterSpawnTable 测试

覆盖:
  - 默认从 SEASON_PROFILES 初始化(空池, M2.7 未发布)
  - 4 季节都返回列表
  - pool_for 返回副本(外部修改不影响内部)
  - set_pool / add_to_pool
  - 类型校验
"""

import os
import sys
import unittest

sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
    ),
)

from core.abstract.world.monster_spawn_table import MonsterSpawnTable  # noqa: E402
from core.abstract.world.season import Season  # noqa: E402


class TestMonsterSpawnTableDefault(unittest.TestCase):
    def test_all_seasons_return_list(self) -> None:
        t = MonsterSpawnTable()
        for s in Season:
            pool = t.pool_for(s)
            self.assertIsInstance(pool, list)

    def test_default_pools_empty(self) -> None:
        # M2.7 未发布, 怪物池默认为空
        t = MonsterSpawnTable()
        for s in Season:
            self.assertEqual(t.pool_for(s), [])

    def test_pool_for_unknown_raises(self) -> None:
        t = MonsterSpawnTable()
        with self.assertRaises(ValueError):
            t.pool_for("not_a_season")  # type: ignore[arg-type]


class TestMonsterSpawnTableModify(unittest.TestCase):
    def test_set_pool(self) -> None:
        t = MonsterSpawnTable()
        t.set_pool(Season.SPRING, ["tree_spirit", "spider"])
        self.assertEqual(
            t.pool_for(Season.SPRING), ["tree_spirit", "spider"]
        )

    def test_set_pool_validates_str(self) -> None:
        t = MonsterSpawnTable()
        with self.assertRaises(ValueError):
            t.set_pool(Season.SPRING, ["valid", 123])  # type: ignore[list-item]

    def test_add_to_pool(self) -> None:
        t = MonsterSpawnTable()
        t.add_to_pool(Season.SUMMER, "scorpion")
        t.add_to_pool(Season.SUMMER, "deerclops")
        self.assertEqual(
            t.pool_for(Season.SUMMER), ["scorpion", "deerclops"]
        )

    def test_add_to_pool_dedup(self) -> None:
        t = MonsterSpawnTable()
        t.add_to_pool(Season.WINTER, "ice_deerclops")
        t.add_to_pool(Season.WINTER, "ice_deerclops")
        self.assertEqual(t.pool_for(Season.WINTER), ["ice_deerclops"])

    def test_add_to_pool_validates_type(self) -> None:
        t = MonsterSpawnTable()
        with self.assertRaises(ValueError):
            t.add_to_pool(Season.AUTUMN, 42)  # type: ignore[arg-type]

    def test_pool_returns_copy(self) -> None:
        t = MonsterSpawnTable()
        t.set_pool(Season.SPRING, ["tree_spirit"])
        pool = t.pool_for(Season.SPRING)
        pool.append("mutated")
        # 内部状态应当不受影响
        self.assertEqual(t.pool_for(Season.SPRING), ["tree_spirit"])


class TestAllPools(unittest.TestCase):
    def test_all_pools_snapshot(self) -> None:
        t = MonsterSpawnTable()
        t.set_pool(Season.SPRING, ["a"])
        t.set_pool(Season.SUMMER, ["b", "c"])
        snap = t.all_pools()
        self.assertEqual(
            snap,
            {
                Season.SPRING: ["a"],
                Season.SUMMER: ["b", "c"],
                Season.AUTUMN: [],
                Season.WINTER: [],
            },
        )
        # 快照应与内部隔离
        snap[Season.AUTUMN].append("x")
        self.assertEqual(t.pool_for(Season.AUTUMN), [])


if __name__ == "__main__":
    unittest.main()
