"""
Wildwood 数据层 — 使用示例

跑法:
  cd wildwood
  python3 -m core.abstract.data.examples.seed_data
"""
from __future__ import annotations

from core.abstract.data import (
    PlayerProfile,
    SaveGame,
    Season,
    WorldState,
    make_store,
)


def demo_reference():
    """Reference(A 线 SQLite 风格)演示。"""
    print("\n=== Demo: Reference(JsonFileStore) ===")
    import shutil, tempfile
    tmp = tempfile.mkdtemp(prefix="ww_ref_")
    try:
        store = make_store("reference", reference_root=tmp + "/saves")
        world = WorldState.create_new(world_seed=2026)
        profile = PlayerProfile.create_new("Astone", character_class="builder")
        world.players[profile.player_id] = {
            "position": {"x": 16.0, "y": 32.0},
            "current_state": {"hp": 100, "hunger": 80, "sanity": 90, "temperature": 50},
        }
        save = SaveGame.from_world_and_profiles(
            world, {profile.player_id: profile}, host_player_id=profile.player_id,
            settings={"difficulty": "normal", "music_volume": 0.7},
        )
        store.save_save(save)
        print(f"  saved: {save.save_id[:8]}... host={profile.display_name}")
        # 推进 5 天
        w = store.load_world_state(save.save_id)
        w.day = 6
        w.season = Season.SUMMER.value
        store.save_world_state(save.save_id, w)
        # 读
        s2 = store.load_save(save.save_id)
        print(f"  reloaded: day={s2.world_state['day']} season={s2.world_state['season']}")
        print(f"  saves on disk: {len(store.list_saves())}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def demo_mock():
    """Mock(B 线 LiteDB 风格)演示。"""
    print("\n=== Demo: Mock(MockLiteDbStore) ===")
    import os, tempfile
    tmp = tempfile.mkdtemp(prefix="ww_mock_")
    try:
        store = make_store("mock", mock_db_path=tmp + "/ww.litedb.json")
        world = WorldState.create_new(world_seed=2026, biome_layout={"forest": 3, "marsh": 1})
        # 4 人小队
        profiles = {}
        for name, cls in [("Astone", "scout"), ("Delacy", "builder"),
                          ("OldIron", "warrior"), ("Seven", "gatherer")]:
            p = PlayerProfile.create_new(name, character_class=cls)
            world.players[p.player_id] = {
                "position": {"x": 16.0 * len(profiles), "y": 0.0},
                "current_state": {"hp": 100, "hunger": 100, "sanity": 100, "temperature": 50},
            }
            profiles[p.player_id] = p
        save = SaveGame.from_world_and_profiles(
            world, profiles, host_player_id=list(profiles.keys())[0],
            settings={"difficulty": "hard", "auto_share": True},
        )
        store.save_save(save)
        print(f"  saved 4-player squad: {save.save_id[:8]}...")
        s2 = store.load_save(save.save_id)
        print(f"  reloaded: {len(s2.player_profiles)} players, season={s2.world_state['season']}")
        # LiteDB 风格 API
        cnt = store.count("saves")
        print(f"  LiteDB-style count('saves') = {cnt}")
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def demo_a_b_switch():
    """A/B 切换:同一份 workflow 在两种 backend 上产出等价结果。"""
    print("\n=== Demo: A/B Switching ===")
    import shutil, tempfile
    tmp = tempfile.mkdtemp(prefix="ww_switch_")
    try:
        for backend, kw in [
            ("reference", {"reference_root": tmp + "/ref"}),
            ("mock", {"mock_db_path": tmp + "/mock.json"}),
        ]:
            store = make_store(backend, **kw)
            world = WorldState.create_new(world_seed=7)
            profile = PlayerProfile.create_new("Switcher", character_class="scout")
            save = SaveGame.from_world_and_profiles(
                world, {profile.player_id: profile}, host_player_id=profile.player_id
            )
            store.save_save(save)
            s2 = store.load_save(save.save_id)
            print(f"  [{backend}] world_seed={s2.world_state['world_seed']} "
                  f"saves={len(store.list_saves())}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    demo_reference()
    demo_mock()
    demo_a_b_switch()
    print("\nAll demos passed ✓")


if __name__ == "__main__":
    main()
