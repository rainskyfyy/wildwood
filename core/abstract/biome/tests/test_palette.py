"""M2.7 调色板测试 — TDD RED 阶段(项目总方案 §4.1 + 美术风格指南 §色板)

色板硬约束:
- 24 色,5 类(暖色基底/自然色/警示色/冷色点缀/中性色)
- 暖色族(基底+自然+警示)色数 ≥ 17 (即 70%+,保证 AI 画师实际填色时容易达 70% 视觉占比)
- 冷色点缀 ≤ 3 色 (15% 上限)
- 禁止纯黑(用 #1a1410)、纯白(用 #f4e4c1)
- 全部颜色用 6 位 hex 表示
"""
import pytest
from core.abstract.biome.palette import (
    WARM_BASE, NATURE, ALERT, COOL, NEUTRAL,
    PALETTE, total_palette_size, palette_color_ratio,
    hex_to_rgb, validate_no_pure_black_or_white,
    warm_color_count, cool_color_count, neutral_color_count,
)


def test_palette_exactly_24_colors():
    """项目总方案 §4.1 硬约束:24 色调色板"""
    assert total_palette_size() == 24, f"expected 24 colors, got {total_palette_size()}"


def test_warm_color_count_geq_17():
    """暖色族(基底+自然+警示) ≥ 17 色,支撑场景暖色 ≥ 70% 视觉占比"""
    warm = warm_color_count()
    assert warm >= 17, f"warm colors {warm} < 17 (need >= 70% of 24)"


def test_cool_color_count_leq_3():
    """冷色点缀 ≤ 3 色(15% 上限)"""
    cool = cool_color_count()
    assert cool <= 3, f"cool colors {cool} > 3 (15% cap)"


def test_neutral_color_count_eq_24_minus_others():
    """中性色 = 24 - 暖色 - 冷色"""
    n = neutral_color_count()
    assert n == 24 - warm_color_count() - cool_color_count(), \
        f"neutral {n} != 24 - warm - cool"


def test_no_pure_black_or_white():
    """禁止纯黑 #000000 与纯白 #ffffff"""
    violations = validate_no_pure_black_or_white()
    assert violations == [], f"违例色: {violations}"


def test_all_hexes_six_digit_lowercase():
    """所有 hex 必须 # + 6 位小写"""
    for name, hex_val in PALETTE.items():
        assert hex_val.startswith("#"), f"{name}: missing #"
        assert len(hex_val) == 7, f"{name}: bad length {len(hex_val)}"
        # 6 hex digits, lowercase
        for ch in hex_val[1:]:
            assert ch in "0123456789abcdef", f"{name}: non-lowercase {hex_val}"


def test_palette_no_duplicate_hex():
    """所有 hex 唯一"""
    seen = {}
    for name, hex_val in PALETTE.items():
        assert hex_val not in seen, f"duplicate {hex_val} ({name} vs {seen[hex_val]})"
        seen[hex_val] = name


def test_hex_to_rgb_conversion():
    """hex 颜色 → (r,g,b) 元组"""
    r, g, b = hex_to_rgb("#1a1410")
    assert (r, g, b) == (0x1a, 0x14, 0x10)
    r, g, b = hex_to_rgb("#f4e4c1")
    assert (r, g, b) == (0xf4, 0xe4, 0xc1)
    r, g, b = hex_to_rgb("#7d8b4d")
    assert (r, g, b) == (0x7d, 0x8b, 0x4d)


def test_palette_contains_required_warm_hexes():
    """美术风格指南 §色板规范 规定的暖色 hex 必须存在"""
    required = {
        "burnt_umber": "#7d4a2a",
        "parchment": "#c8b694",
        "torchlight_amber": "#d4a056",
        "forest_moss": "#5a6b3a",
        "bark_brown": "#3d2f24",
        "leaf_green": "#7d8b4d",
        "rust_red": "#a85a3a",
        "blood_crimson": "#7a2e1f",
        "ember_orange": "#d97a3a",
    }
    for name, hex_val in required.items():
        assert hex_val in PALETTE.values(), f"missing {name} ({hex_val})"


def test_palette_contains_cool_and_neutral_hexes():
    """冷色 + 中性色 必须存在"""
    required = {
        "steel_blue": "#5a7080",
        "moonlit_grey": "#3a3f47",
        "ice_cyan": "#8fb4c0",
        "night_black": "#1a1410",
        "shadow_brown": "#2a211b",
        "highlight_beige": "#f4e4c1",
    }
    for name, hex_val in required.items():
        assert hex_val in PALETTE.values(), f"missing {name} ({hex_val})"


def test_palette_color_ratio_returns_all_categories():
    """色比字典包含 warm / cool / neutral 三类"""
    ratio = palette_color_ratio()
    assert "warm" in ratio
    assert "cool" in ratio
    assert "neutral" in ratio
    assert ratio["warm"] + ratio["cool"] + ratio["neutral"] == 24
