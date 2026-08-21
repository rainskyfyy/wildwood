"""
Wildwood M2.8 — MonsterSpawnTable(怪物生成表)

设计:
  - 每个季节指定一组可生成怪物 ID(由 M2.7 怪物类型决定, M2.7 尚未发布)
  - 当前 M2.7 阻塞, 此模块只提供接口 + 占位实现
  - M2.7 完成后, 由该模块的 maintainer 填入真实怪物 ID 即可
  - 季节 + 生物群系 → 怪物池 的二维过滤在 M2.7 实现
    (本模块只做 season → pool 的一维, M2.7 加 biome 过滤)
"""

from __future__ import annotations

from typing import Dict, List

from core.abstract.world.season import Season
from core.abstract.world.season_table import lookup as lookup_season


# 怪物 ID 的别名, 写起来简洁
MonsterId = str


class MonsterSpawnTable:
    """季节 → 怪物 ID 池(预留 M2.7 接口).

    用法:
        table = MonsterSpawnTable(SEASON_PROFILES)  # 默认从季节表读
        spring_pool = table.pool_for(Season.SPRING)
    """

    __slots__ = ("_pools",)

    def __init__(self, season_profiles: Dict[Season, object] | None = None) -> None:
        # 防御: season_profiles 若为 None, 仍允许; pool_for() 查时再校验
        self._pools: Dict[Season, List[MonsterId]] = {}
        if season_profiles is None:
            from core.abstract.world.season_table import SEASON_PROFILES
            season_profiles = SEASON_PROFILES
        # 初始每个季节的池从 profile.monster_pool 读(M2.8 阶段是空 tuple)
        for s, prof in season_profiles.items():
            self._pools[s] = list(prof.monster_pool)

    def pool_for(self, season: Season) -> List[MonsterId]:
        """返回该季节的怪物 ID 列表(副本, 避免外部修改)."""
        if season not in self._pools:
            raise ValueError(f"unknown season: {season}")
        return list(self._pools[season])

    def set_pool(self, season: Season, ids: List[MonsterId]) -> None:
        """覆盖某季节的怪物池. M2.7 完成后由 maintainer 调用一次注入真实 ID."""
        if season not in self._pools:
            raise ValueError(f"unknown season: {season}")
        if not all(isinstance(i, str) for i in ids):
            raise ValueError("all monster ids must be str")
        self._pools[season] = list(ids)

    def add_to_pool(self, season: Season, monster_id: MonsterId) -> None:
        """追加一个怪物 ID(用于 M2.7 增量填充)."""
        if season not in self._pools:
            raise ValueError(f"unknown season: {season}")
        if not isinstance(monster_id, str):
            raise ValueError("monster_id must be str")
        if monster_id not in self._pools[season]:
            self._pools[season].append(monster_id)

    def all_pools(self) -> Dict[Season, List[MonsterId]]:
        """全部季节池(快照, 用于调试 / 调试器)."""
        return {s: list(ids) for s, ids in self._pools.items()}

    def __repr__(self) -> str:
        parts = ", ".join(
            f"{s.value}=[{','.join(self._pools[s])}]" for s in Season
        )
        return f"MonsterSpawnTable({parts})"
