"""M2.7 4 大群系测试 — 任务书 + 项目总方案 §2.6

| 群系 | 主色 | 特征资源 / 怪物 |
|------|------|------------------|
| 森林 | 暖黄绿 | 浆果 / 树苗 / 兔子 / 蜘蛛 |
| 平原 | 草绿 | 草 / 芦苇 / 牛 / 食人花 |
| 矿区 | 灰蓝 | 矿石 / 燧石 / 猎犬 / 巨鹿 |
| 雪原 | 蓝白 | 矿石 / 冰 / 企鹅 / 触须 |

注:任务书"森林/平原/矿区/雪原"与项目总方案 §2.6 表格的
"森林/草原/沙漠/雪山"在命名上略有差异 — M2.7 采用任务书
"矿区"替换"沙漠"(矿石资源更贴合矿区主题,且避开沙漠画师压力)。
"""
import json
import pytest
from core.abstract.biome.biomes import (
    Biome, Forest, Plains, Mines, Snow,
    BIOMES, get_biome, list_biomes,
    validate_biomes, primary_color_of,
)
from core.abstract.biome.elements import SHARED_ELEMENTS


def test_four_biomes_registered():
    """4 群系全部注册"""
    assert set(BIOMES.keys()) == {"forest", "plains", "mines", "snow"}


def test_each_biome_uses_all_shared_elements():
    """每群系复用全部 4 类共享元素(任务书硬约束)"""
    for bid, biome in BIOMES.items():
        assert set(biome.shared_elements) == set(SHARED_ELEMENTS), \
            f"{bid}: shared_elements != SHARED_ELEMENTS"


def test_forest_primary_color_warm_yellow_green():
    """森林主色:暖黄绿(leaf_green 派系)"""
    f = get_biome("forest")
    # leaf_green #7d8b4d 偏暖黄绿
    assert f.primary_color_hex == "#7d8b4d"


def test_plains_primary_color_grass_green():
    """平原主色:草绿(forest_moss 派系)"""
    p = get_biome("plains")
    # forest_moss #5a6b3a 草绿
    assert p.primary_color_hex == "#5a6b3a"


def test_mines_primary_color_grey_blue():
    """矿区主色:灰蓝(steel_blue 派系)"""
    m = get_biome("mines")
    assert m.primary_color_hex == "#5a7080"


def test_snow_primary_color_blue_white():
    """雪原主色:蓝白(ice_cyan + highlight_beige 平均偏向蓝白)"""
    s = get_biome("snow")
    # 雪原主色应是冰青或近似蓝白 — 用 ice_cyan
    assert s.primary_color_hex == "#8fb4c0"


def test_each_biome_has_signature_resources():
    """每群系 ≥ 1 个特征资源(M2.14 资产清单引用)"""
    for bid, biome in BIOMES.items():
        assert len(biome.signature_resources) >= 1, f"{bid}: no resources"
        for ref in biome.signature_resources:
            assert ref.startswith("m2.14."), f"{bid}: bad ref {ref!r}"


def test_each_biome_has_signature_monsters():
    """每群系 ≥ 1 个特征怪物"""
    for bid, biome in BIOMES.items():
        assert len(biome.signature_monsters) >= 1, f"{bid}: no monsters"
        for ref in biome.signature_monsters:
            assert ref.startswith("m2.14."), f"{bid}: bad ref {ref!r}"


def test_forest_signature_resources_match_task():
    """森林特征资源:浆果 / 树苗"""
    f = get_biome("forest")
    refs = f.signature_resources
    # 至少包含 berry 与 sapling
    assert any("berry" in r for r in refs), f"forest resources: {refs}"
    assert any("sapling" in r for r in refs), f"forest resources: {refs}"


def test_forest_signature_monsters_match_task():
    """森林特征怪物:兔子 / 蜘蛛(注意:兔子算 passive 怪,蜘蛛是 hostile)"""
    f = get_biome("forest")
    refs = f.signature_monsters
    assert any("rabbit" in r for r in refs)
    assert any("spider" in r for r in refs)


def test_plains_signature_resources_match_task():
    """平原特征资源:草 / 芦苇"""
    p = get_biome("plains")
    refs = p.signature_resources
    assert any("grass" in r or "reed" in r for r in refs)


def test_plains_signature_monsters_match_task():
    """平原特征怪物:牛 / 食人花"""
    p = get_biome("plains")
    refs = p.signature_monsters
    assert any("cow" in r or "beef" in r for r in refs)
    assert any("tenta" in r or "plant" in r for r in refs)


def test_mines_signature_resources_match_task():
    """矿区特征资源:矿石 / 燧石"""
    m = get_biome("mines")
    refs = m.signature_resources
    assert any("ore" in r for r in refs)
    assert any("flint" in r for r in refs)


def test_mines_signature_monsters_match_task():
    """矿区特征怪物:猎犬 / 巨鹿"""
    m = get_biome("mines")
    refs = m.signature_monsters
    assert any("hound" in r for r in refs)
    assert any("deerclops" in r or "deer" in r for r in refs)


def test_snow_signature_resources_match_task():
    """雪原特征资源:矿石 / 冰"""
    s = get_biome("snow")
    refs = s.signature_resources
    assert any("ore" in r for r in refs)
    assert any("ice" in r for r in refs)


def test_snow_signature_monsters_match_task():
    """雪原特征怪物:企鹅 / 触须"""
    s = get_biome("snow")
    refs = s.signature_monsters
    assert any("pengull" in r or "penguin" in r for r in refs)
    assert any("tenta" in r for r in refs)


def test_each_biome_has_density_dict():
    """元素组合比例 density 字典非空(任务书:仅替换组合比例)"""
    for bid, biome in BIOMES.items():
        assert isinstance(biome.density, dict), f"{bid}: density not dict"
        assert len(biome.density) > 0, f"{bid}: empty density"
        # 比例合计 ≈ 1.0(允许 ±0.05 误差)
        total = sum(biome.density.values())
        assert abs(total - 1.0) < 0.05, f"{bid}: density sum {total} not ~1.0"


def test_density_keys_subset_of_shared_elements():
    """density 的 key 必须是共享元素子集"""
    for bid, biome in BIOMES.items():
        for k in biome.density.keys():
            assert k in SHARED_ELEMENTS, f"{bid}: density key {k!r} not shared"


def test_primary_color_palette_member():
    """每群系主色必须在 24 色板内(避免色板违例)"""
    from core.abstract.biome.palette import PALETTE
    for bid, biome in BIOMES.items():
        assert biome.primary_color_hex in PALETTE.values(), \
            f"{bid}: primary {biome.primary_color_hex} not in 24-color palette"


def test_validate_biomes_passes():
    """4 群系 + JSON 同步校验通过"""
    violations = validate_biomes()
    assert violations == [], f"violations: {violations}"


def test_list_biomes_returns_four():
    """list_biomes 返回 4 个"""
    bs = list_biomes()
    assert len(bs) == 4
    assert {b.id for b in bs} == {"forest", "plains", "mines", "snow"}


def test_get_biome_unknown_raises():
    """未知群系抛 KeyError"""
    with pytest.raises(KeyError):
        get_biome("desert")  # 沙漠属 M3,不在 M2.7


def test_primary_color_of_helper():
    """primary_color_of 便捷函数"""
    assert primary_color_of("forest") == "#7d8b4d"
    assert primary_color_of("snow") == "#8fb4c0"


def test_biome_round_trip_json():
    """4 群系 JSON 双向 round-trip 一致"""
    from core.abstract.biome.biomes import biome_to_dict, biome_from_dict
    for bid in ["forest", "plains", "mines", "snow"]:
        original = get_biome(bid)
        d = biome_to_dict(original)
        s = json.dumps(d, ensure_ascii=False, indent=2)
        loaded = biome_from_dict(json.loads(s))
        assert loaded.id == original.id
        assert loaded.primary_color_hex == original.primary_color_hex
        assert set(loaded.shared_elements) == set(original.shared_elements)
        assert loaded.signature_resources == original.signature_resources
        assert loaded.signature_monsters == original.signature_monsters
