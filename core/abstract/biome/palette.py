"""M2.7 24 暖色调色板 — 项目总方案 §4.1 + 美术风格指南 §色板规范

设计原则:
- 24 色,5 类(暖色基底/自然色/警示色/冷色点缀/中性色)
- 暖色族(基底+自然+警示)共 17 色,保证 AI 画师出图时容易达 70% 视觉占比
- 冷色点缀 3 色(15% 上限 = 3.6,取 ≤ 3)
- 中性色 4 色
- 禁止纯黑/纯白:用 #1a1410 和 #f4e4c1 替代

注:色板的"暖色视觉占比 ≥ 70%"指场景像素占比,不是色板色数比。
   但为了让 AI 画师在 24 色可选中容易凑出 70% 暖色场景,色板本身
   也按暖色多、冷色少的原则分配。
"""
from typing import Dict, Tuple


# 5 类色板(各类色数按暖色 ≥ 17,冷色 ≤ 3 设计)
# 命名:snake_case,值:6 位小写 hex
WARM_BASE: Dict[str, str] = {
    "burnt_umber":       "#7d4a2a",  # 主 — 烧赭,深暖褐
    "parchment":         "#c8b694",  # 次 — 羊皮纸,浅暖
    "torchlight_amber":  "#d4a056",  # 点缀 — 火把琥珀
    "honey_gold":        "#c8923c",  # 扩展 — 蜜金
    "clay_red":          "#9c4a2a",  # 扩展 — 陶土红
}
NATURE: Dict[str, str] = {
    "forest_moss":       "#5a6b3a",  # 主 — 森林苔藓
    "bark_brown":        "#3d2f24",  # 次 — 树皮棕
    "leaf_green":        "#7d8b4d",  # 点缀 — 叶绿
    "pine_needle":       "#4a5a3a",  # 扩展 — 松针
    "dry_grass":         "#a89968",  # 扩展 — 干草
    "moss_green":        "#6b8a4a",  # 扩展 — 鲜苔
    "earth_ochre":       "#8a6a3a",  # 扩展 — 赭土
}
ALERT: Dict[str, str] = {
    "rust_red":          "#a85a3a",  # 主 — 锈红
    "blood_crimson":     "#7a2e1f",  # 次 — 血红
    "ember_orange":      "#d97a3a",  # 点缀 — 余烬橙
    "warm_amber":        "#b87a2a",  # 扩展 — 暖琥珀
    "sienna":            "#8a4a2a",  # 扩展 — 赭石
}
COOL: Dict[str, str] = {
    "steel_blue":        "#5a7080",  # 主 — 钢蓝
    "moonlit_grey":      "#3a3f47",  # 次 — 月灰
    "ice_cyan":          "#8fb4c0",  # 点缀 — 冰青
}
NEUTRAL: Dict[str, str] = {
    "night_black":       "#1a1410",  # 替代纯黑
    "shadow_brown":      "#2a211b",  # 暗影
    "highlight_beige":   "#f4e4c1",  # 替代纯白
    "warm_grey":         "#5a5048",  # 暖灰
}


# 统一调色板(name → hex),共 24 色
PALETTE: Dict[str, str] = {
    **WARM_BASE,
    **NATURE,
    **ALERT,
    **COOL,
    **NEUTRAL,
}

assert len(PALETTE) == 24, f"色板色数错误: {len(PALETTE)} (要求 24)"


def total_palette_size() -> int:
    """返回调色板色数"""
    return len(PALETTE)


def warm_color_count() -> int:
    """暖色族(基底+自然+警示)色数"""
    return len(WARM_BASE) + len(NATURE) + len(ALERT)


def cool_color_count() -> int:
    """冷色族色数"""
    return len(COOL)


def neutral_color_count() -> int:
    """中性色族色数"""
    return len(NEUTRAL)


def palette_color_ratio() -> Dict[str, int]:
    """色比字典(色数)"""
    return {
        "warm": warm_color_count(),
        "cool": cool_color_count(),
        "neutral": neutral_color_count(),
    }


def hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    """6 位 hex 颜色 → (r, g, b) 元组(0-255)"""
    if not (isinstance(hex_str, str) and len(hex_str) == 7 and hex_str.startswith("#")):
        raise ValueError(f"invalid hex: {hex_str!r}")
    return (int(hex_str[1:3], 16), int(hex_str[3:5], 16), int(hex_str[5:7], 16))


def validate_no_pure_black_or_white() -> list:
    """检测纯黑/纯白违例;返回违例 hex 列表(空 = 全部合规)"""
    violations = []
    for name, hex_val in PALETTE.items():
        if hex_val == "#000000":
            violations.append(f"{name}={hex_val} (use #1a1410)")
        if hex_val == "#ffffff":
            violations.append(f"{name}={hex_val} (use #f4e4c1)")
    return violations
