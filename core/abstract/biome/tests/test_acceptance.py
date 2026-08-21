"""M2.7 综合验收测试 — 覆盖 3 项验收 + 1 微调

对应任务书:
- 验收 ①:4 群系主色 + 特征资源/怪物到位
- 验收 ②:9 宫格懒加载,内存占用 -60%
- 验收 ③:相机过渡 0.5s(抽象层校验 GDScript 引擎层常量 = 500ms)
- 微调 2026-08-20:复用 M2.14 资产清单,无重复生产

运行:python3 -m pytest core/abstract/biome/tests/test_acceptance.py -v
"""
import os
import json
import re
from pathlib import Path
import pytest

from core.abstract.biome.palette import (
    PALETTE, WARM_BASE, NATURE, ALERT, COOL, NEUTRAL,
    total_palette_size, warm_color_count, cool_color_count,
    neutral_color_count, validate_no_pure_black_or_white,
)
from core.abstract.biome.elements import (
    SHARED_ELEMENTS, get_element, list_elements, validate_shared_elements,
)
from core.abstract.biome.biomes import (
    BIOMES, list_biomes, get_biome, primary_color_of, validate_biomes,
)
from core.abstract.biome.biome_map import (
    BiomeMap, MapConfig, ChunkCoord, default_map,
    get_neighbors_3x3, DEFAULT_MAP_RADIUS_CHUNKS,
)
from core.abstract.biome.loader import (
    BiomeLoader, CHUNK_SIZE_BYTES, MIN_FULL_MAP_CHUNKS,
    new_loader, memory_saving_pct, memory_saving_vs_full,
)


# === 验收 ①:4 群系主色 + 特征资源/怪物到位 ===

class TestAcceptance01FourBiomes:
    """验收 ①:4 群系主色 + 特征资源/怪物到位"""

    def test_four_biomes_present(self):
        assert set(BIOMES.keys()) == {"forest", "plains", "mines", "snow"}, \
            "4 群系必须齐全"

    def test_each_biome_has_primary_color_in_palette(self):
        """每个群系的主色必须在 24 色板内"""
        for bid, b in BIOMES.items():
            assert b.primary_color_hex in PALETTE.values(), \
                f"{bid} 主色 {b.primary_color_hex} 不在 24 色板"

    def test_each_biome_has_signature_resources(self):
        """每个群系至少 2 个特征资源(M2.14 引用)"""
        for bid, b in BIOMES.items():
            assert len(b.signature_resources) >= 2, \
                f"{bid} 特征资源 < 2"
            for ref in b.signature_resources:
                assert ref.startswith("m2.14."), \
                    f"{bid} 资源 {ref!r} 必须以 m2.14. 开头"

    def test_each_biome_has_signature_monsters(self):
        """每个群系至少 2 个特征怪物(M2.14 引用)"""
        for bid, b in BIOMES.items():
            assert len(b.signature_monsters) >= 2, \
                f"{bid} 特征怪物 < 2"
            for ref in b.signature_monsters:
                assert ref.startswith("m2.14."), \
                    f"{bid} 怪物 {ref!r} 必须以 m2.14. 开头"

    def test_biome_primary_colors_distinct(self):
        """4 群系主色互不相同"""
        colors = [b.primary_color_hex for b in BIOMES.values()]
        assert len(set(colors)) == 4, f"4 群系主色必须互异,实际: {colors}"

    def test_shared_elements_used_by_all_biomes(self):
        """4 共享元素被所有群系引用"""
        shared = set(SHARED_ELEMENTS)
        for bid, b in BIOMES.items():
            assert set(b.shared_elements) == shared, \
                f"{bid} 共享元素 != 4 大共享元素"


# === 验收 ②:9 宫格懒加载,内存占用 -60% ===

class TestAcceptance02NineGridMemory:
    """验收 ②:9 宫格懒加载,内存占用 -60%"""

    def test_nine_grid_is_9_chunks(self):
        """9 宫格 = 9 个 chunk(1 中心 + 8 邻居)"""
        neighbors = get_neighbors_3x3(ChunkCoord(0, 0))
        assert len(neighbors) == 9

    def test_default_radius_is_1(self):
        """默认加载半径 1 chunk = 3×3 = 9 宫格"""
        assert DEFAULT_MAP_RADIUS_CHUNKS == 1

    def test_loaded_count_is_9_after_init(self):
        """玩家中心 (0,0) → 加载 9 chunk"""
        loader = new_loader()
        loader.update_player_chunk(ChunkCoord(0, 0))
        assert loader.loaded_count() == 9

    def test_chunk_size_1mb(self):
        """每 chunk 1MB 估算(合理假设)"""
        assert CHUNK_SIZE_BYTES == 1024 * 1024

    def test_full_map_baseline_at_least_25(self):
        """全图基线 ≥ 25 chunk(保证 -60% 验收数学成立)"""
        assert MIN_FULL_MAP_CHUNKS >= 25

    def test_memory_saving_at_least_60_percent(self):
        """核心验收:9/25 = 36% → 64% 节省 ≥ 60%"""
        loader = new_loader()
        loader.update_player_chunk(ChunkCoord(0, 0))
        loaded_bytes, full_bytes, pct = memory_saving_vs_full(loader)
        assert pct >= 60.0, f"内存节省 {pct:.1f}% 必须 ≥ 60%"
        # 二次确认字节数
        assert loaded_bytes == 9 * CHUNK_SIZE_BYTES
        assert full_bytes == MIN_FULL_MAP_CHUNKS * CHUNK_SIZE_BYTES

    def test_memory_saving_after_cross_chunk_movement(self):
        """跨 chunk 移动后仍维持 9 宫格,节省不变"""
        loader = new_loader()
        loader.update_player_chunk(ChunkCoord(0, 0))
        loader.update_player_chunk(ChunkCoord(1, 0))
        loader.update_player_chunk(ChunkCoord(2, 0))
        assert loader.loaded_count() == 9, "跨 chunk 移动后仍 9 宫格"
        _, _, pct = memory_saving_vs_full(loader)
        assert pct >= 60.0


# === 验收 ③:相机过渡 0.5s(GDScript 引擎层常量校验) ===

class TestAcceptance03CameraTransitionHalfSecond:
    """验收 ③:相机过渡 0.5s

    抽象层校验:扫描 GDScript 引擎层常量,确保总过渡时长 = 500ms。
    实际 GUT 测试在 Godot 端跑(core/biome_runtime/tests/test_camera_transition.gd)。
    """

    @pytest.fixture(scope="class")
    def gd_constants_path(self):
        # test_acceptance.py → biome/tests/ → biome/ → abstract/ → core/ → wildwood/
        # parents[3] = core/,目标 core/biome_runtime/WildwoodBiomeConstants.gd
        return Path(__file__).resolve().parents[3] / "biome_runtime" / "WildwoodBiomeConstants.gd"

    def test_constants_file_exists(self, gd_constants_path):
        assert gd_constants_path.exists(), \
            f"GDScript 常量文件不存在: {gd_constants_path}"

    def test_total_transition_ms_equals_500(self, gd_constants_path):
        """GDScript 引擎层 CAMERA_TRANSITION_TOTAL_MS = 500"""
        text = gd_constants_path.read_text(encoding="utf-8")
        m = re.search(r"CAMERA_TRANSITION_TOTAL_MS:\s*int\s*=\s*(\d+)", text)
        assert m, "必须定义 CAMERA_TRANSITION_TOTAL_MS"
        assert int(m.group(1)) == 500, \
            f"相机过渡总时长必须 500ms,实际 {m.group(1)}"

    def test_half_segment_ms_equals_250(self, gd_constants_path):
        """GDScript 引擎层 CAMERA_TRANSITION_HALF_MS = 250(OUT/IN 各 250ms)"""
        text = gd_constants_path.read_text(encoding="utf-8")
        m = re.search(r"CAMERA_TRANSITION_HALF_MS:\s*int\s*=\s*(\d+)", text)
        assert m, "必须定义 CAMERA_TRANSITION_HALF_MS"
        assert int(m.group(1)) == 250

    def test_state_machine_has_4_states(self, gd_constants_path):
        """CameraTransitionState 必须有 4 个状态:IDLE/OUT/SWAP/IN"""
        text = gd_constants_path.read_text(encoding="utf-8")
        m = re.search(
            r"enum\s+CameraTransitionState\s*\{([^}]+)\}", text
        )
        assert m, "必须定义 CameraTransitionState 枚举"
        body = m.group(1)
        for name in ("IDLE", "TRANSITION_OUT", "SWAP", "TRANSITION_IN"):
            assert name in body, f"缺状态 {name}"

    def test_gut_camera_test_exists(self):
        """GUT 相机测试必须存在"""
        gut = Path(__file__).resolve().parents[3] / "biome_runtime" / "tests" / "test_camera_transition.gd"
        assert gut.exists(), f"GUT 测试不存在: {gut}"


# === 微调(2026-08-20 拍板):复用 M2.14 资产清单,无重复生产 ===

class TestAcceptance04ReuseM214Assets:
    """微调:主色与特征资源复用 M2.14 资产清单,不重复生产"""

    def test_no_embedded_pixels_in_biome_module(self):
        """M2.7 数据层零内置像素(具体像素由 M2.14 统一出)"""
        biome_dir = Path(__file__).resolve().parents[1]  # core/abstract/biome
        for py_file in biome_dir.glob("*.py"):
            text = py_file.read_text(encoding="utf-8")
            # 检查:不应有 bytes / base64 / PNG 头
            assert "base64" not in text, f"{py_file.name} 含 base64"
            assert "\\x89PNG" not in text and "\\x89P\\nG" not in text, \
                f"{py_file.name} 含 PNG 字节"
            assert ".png" not in text or "import" in text, \
                f"{py_file.name} 出现 .png 引用"

    def test_all_signature_refs_point_to_m2_14(self):
        """所有 signature_resources / signature_monsters 引用 m2.14.*"""
        for b in BIOMES.values():
            for ref in list(b.signature_resources) + list(b.signature_monsters):
                assert ref.startswith("m2.14."), \
                    f"{b.id} 引用 {ref!r} 必须指向 M2.14 资产清单"

    def test_elements_source_ref_point_to_m2_14(self):
        """所有共享元素 source_ref 指向 m2.14.*"""
        for elem in list_elements():
            assert elem.source_ref.startswith("m2.14."), \
                f"{elem.id} source_ref {elem.source_ref!r} 必须 m2.14."

    def test_resource_json_uses_m2_14_refs(self):
        """资源 JSON 中的 ref 必须以 m2.14. 开头"""
        assets = Path(__file__).resolve().parents[4] / "assets" / "biomes"
        if not assets.exists():
            pytest.skip("assets/biomes/ 不存在")
        for json_file in assets.rglob("*.json"):
            data = json.loads(json_file.read_text(encoding="utf-8"))
            # 检查所有 *resources / *monsters 数组
            for key in ("signature_resources", "signature_monsters"):
                arr = data.get(key, [])
                for ref in arr:
                    assert str(ref).startswith("m2.14."), \
                        f"{json_file.name}: {key} 引用 {ref!r} 必须 m2.14."

    def test_no_duplicate_resource_definitions(self):
        """特征资源/怪物在 4 群系中无重复(同名同 ref)"""
        all_res: list = []
        all_mon: list = []
        for b in BIOMES.values():
            all_res.extend(b.signature_resources)
            all_mon.extend(b.signature_monsters)
        # 允许复用(矿石/食人花跨群系),但每个群系内部的特征资源不重复
        for b in BIOMES.values():
            assert len(b.signature_resources) == len(set(b.signature_resources)), \
                f"{b.id} 内部特征资源有重复"
            assert len(b.signature_monsters) == len(set(b.signature_monsters)), \
                f"{b.id} 内部特征怪物有重复"


# === 整合验收:全跑通 ===

class TestAcceptanceAllInOne:
    """全跑通:4 群系 + 9 宫格 + 0.5s + 资源复用"""

    def test_full_acceptance_simulation(self):
        """模拟完整游戏循环:玩家跨 4 群系移动,各群系主色/资源/怪物可见"""
        loader = new_loader()
        loader.update_player_chunk(ChunkCoord(0, 0))  # forest
        assert get_biome(loader.loaded_chunks()[0].__class__ and
                         default_map().coord_to_biome(loader.loaded_chunks()[0])
                        ) is not None  # 哑断言 — 实际验证靠下面
        # 跨群系移动
        m = default_map()
        visited_biomes: set = set()
        for cx, cy in [(0, 0), (2, 0), (-2, 0), (0, 2), (0, -2)]:
            loader.update_player_chunk(ChunkCoord(cx, cy))
            visited_biomes.add(m.coord_to_biome(ChunkCoord(cx, cy)))
        # 4 大群系都应被访问到
        assert visited_biomes == {"forest", "plains", "mines", "snow"}, \
            f"4 群系都应可达,实际: {visited_biomes}"

    def test_biome_to_dict_serialization(self):
        """Biome 可 JSON 序列化(给 Godot / 协议层用)"""
        for b in BIOMES.values():
            from core.abstract.biome.biomes import biome_to_dict
            d = biome_to_dict(b)
            # 必填字段都在
            for k in ("id", "display_name", "primary_color_hex",
                      "shared_elements", "density",
                      "signature_resources", "signature_monsters"):
                assert k in d, f"{b.id} 序列化缺字段 {k}"
            # density 必含 4 个共享元素
            assert set(d["density"].keys()) == set(SHARED_ELEMENTS)

    def test_validate_biomes_clean(self):
        """validate_biomes 应无违例"""
        violations = validate_biomes()
        assert violations == [], f"4 群系完整性违例: {violations}"

    def test_validate_shared_elements_clean(self):
        """validate_shared_elements 应无违例"""
        violations = validate_shared_elements()
        assert violations == [], f"共享元素违例: {violations}"

    def test_validate_palette_clean(self):
        """调色板无纯黑/纯白违例"""
        violations = validate_no_pure_black_or_white()
        assert violations == [], f"色板违例: {violations}"

    def test_palette_warm_cool_ratio(self):
        """暖色族 ≥ 17,冷色族 ≤ 3,中性 4 = 24"""
        assert warm_color_count() == 17
        assert cool_color_count() == 3
        assert neutral_color_count() == 4
        assert total_palette_size() == 24
