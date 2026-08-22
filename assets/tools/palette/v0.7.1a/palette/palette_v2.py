"""
v0.7.1a 调色板字典（新结构）

口径：
  - 24 色锁版 = 18 暖色 + 5 冷色 + 1 中性(ash_grey) = 24
  - 5 色扩展 = basalt_black + charcoal + 3 共享锚点 (night_black/highlight_white/poison_orange)
  - 29 色字典 = 24 锁版 + 5 扩展

字段：
  - hex: 色值字符串（与 v0.5/v0.6 字典 100% 兼容）
  - category: warm / cold / neutral
  - biome_affinity: 群系亲缘度列表
  - role_hint: 用途提示

设计目的：
  让 generate 阶段能预算暖色占比（不再后置试错）。

兼容策略：
  - v0.5/v0.6 旧字典 (PALETTE_LEGACY_24) 共存于 palette_v1_legacy.py
  - 新群系必须用 NEW_PALETTE_29
  - 已上线的 v0.6.2a snow 群系仍用旧字典，不强制迁移

历史注：
  - 原 M3.13 spec 写"暖色系 16 色"，实际枚举是 18 色（4 森林 + 6 沙漠 + 4 沼泽 + 4 火山）
  - 原 spec 写"24 色锁版"，实际 18+5+3=26；本字典把中性从 3 缩到 1 还原"24 锁版"口径
"""

# =============================================================================
# 24 色锁版（按 warm/cold/neutral 三档重构）
# =============================================================================

# 暖色系（18 色）—— 用于 desert/forest/marsh/volcano 等暖色群系
WARM_COLORS = {
    # 森林绿系（4 色）
    "forest_green":   {"hex": "#2d5a1e", "category": "warm", "biome_affinity": ["forest", "plains"], "role_hint": "树冠深色"},
    "leaf_green":     {"hex": "#4a8c2a", "category": "warm", "biome_affinity": ["forest", "plains"], "role_hint": "叶面中色"},
    "grass_green":    {"hex": "#6db33f", "category": "warm", "biome_affinity": ["forest", "plains"], "role_hint": "草地亮色"},
    "dark_green":     {"hex": "#1a3a0e", "category": "warm", "biome_affinity": ["forest", "plains"], "role_hint": "树冠最深/暗部"},

    # 沙漠/泥土系（6 色）
    "desert_gold":    {"hex": "#c4a03a", "category": "warm", "biome_affinity": ["desert", "plains"], "role_hint": "沙金"},
    "sand_light":     {"hex": "#e8d89c", "category": "warm", "biome_affinity": ["desert"], "role_hint": "浅沙"},
    "sand_mid":       {"hex": "#d4b86a", "category": "warm", "biome_affinity": ["desert"], "role_hint": "中沙"},
    "sand_dark":      {"hex": "#8a6a2a", "category": "warm", "biome_affinity": ["desert"], "role_hint": "深沙/暗部"},
    "desert_orange":  {"hex": "#e07030", "category": "warm", "biome_affinity": ["desert", "volcano"], "role_hint": "沙岩"},
    "amber":          {"hex": "#d4a030", "category": "warm", "biome_affinity": ["desert", "volcano", "plains"], "role_hint": "暖光/谷物"},

    # 沼泽/泥土系（4 色）
    "marsh_purple":   {"hex": "#4a2c3e", "category": "warm", "biome_affinity": ["marsh"], "role_hint": "沼紫"},
    "mud_brown":      {"hex": "#5c3a1e", "category": "warm", "biome_affinity": ["marsh", "forest", "plains"], "role_hint": "泥土/树干"},
    "mud_dark":       {"hex": "#3a2210", "category": "warm", "biome_affinity": ["marsh"], "role_hint": "深泥"},
    "swamp_green":    {"hex": "#3a5a2a", "category": "warm", "biome_affinity": ["marsh", "forest"], "role_hint": "沼绿"},

    # 火山/熔岩系（4 色）
    "lava_red":       {"hex": "#e04020", "category": "warm", "biome_affinity": ["volcano"], "role_hint": "熔岩主色"},
    "magma_orange":   {"hex": "#f08030", "category": "warm", "biome_affinity": ["volcano"], "role_hint": "岩浆高光"},
    "flame_yellow":   {"hex": "#f0c040", "category": "warm", "biome_affinity": ["volcano", "desert"], "role_hint": "火焰黄"},
    "dark_red":       {"hex": "#801010", "category": "warm", "biome_affinity": ["volcano"], "role_hint": "焦红"},
}

# 冷色系（5 色）—— v0.6.2a 雪山/冰川群系主用
COLD_COLORS = {
    "snow_white":     {"hex": "#e8f0f8", "category": "cold", "biome_affinity": ["snow", "tundra"], "role_hint": "雪白主色"},
    "frost_silver":   {"hex": "#c0d0e0", "category": "cold", "biome_affinity": ["snow", "tundra"], "role_hint": "霜银"},
    "ice_blue":       {"hex": "#90c8e0", "category": "cold", "biome_affinity": ["snow", "tundra"], "role_hint": "冰蓝"},
    "deep_blue":      {"hex": "#406080", "category": "cold", "biome_affinity": ["snow", "tundra", "marsh_winter"], "role_hint": "深海蓝/暗冰"},
    "shadow_grey":    {"hex": "#606878", "category": "cold", "biome_affinity": ["snow", "tundra", "volcano"], "role_hint": "冷影灰"},
}

# 中性系（1 色）—— ash_grey 是唯一锁版中性
NEUTRAL_COLORS = {
    "ash_grey":       {"hex": "#888888", "category": "neutral", "biome_affinity": ["volcano", "universal"], "role_hint": "中性灰/烟雾"},
}

# 24 色锁版 = 18 暖 + 5 冷 + 1 中性
LOCKED_24 = {**WARM_COLORS, **COLD_COLORS, **NEUTRAL_COLORS}

# =============================================================================
# 5 色扩展（不在 24 锁版内，但属历史色板延续）
# =============================================================================
EXTENDED_5 = {
    "basalt_black":   {"hex": "#202020", "category": "neutral", "biome_affinity": ["volcano", "universal"], "role_hint": "玄武岩深色（非锁版）"},
    "charcoal":       {"hex": "#303030", "category": "neutral", "biome_affinity": ["volcano", "universal"], "role_hint": "炭黑（非锁版）"},
    "night_black":    {"hex": "#101820", "category": "neutral", "biome_affinity": ["universal"], "role_hint": "深轮廓线（共享锚点）"},
    "highlight_white":{"hex": "#f8f8f8", "category": "neutral", "biome_affinity": ["universal"], "role_hint": "高光（共享锚点）"},
    "poison_orange":  {"hex": "#f0a030", "category": "warm", "biome_affinity": ["marsh", "volcano", "universal"], "role_hint": "毒橙/警示（共享锚点）"},
}

# 29 色合并字典
NEW_PALETTE_29 = {**LOCKED_24, **EXTENDED_5}

# 群系暖色预算规则（生成阶段预校验用）
# 设计原则：
#   - 暖色预算 = 群系设计语言的可接受暖色占比区间
#   - 群系亲缘色数 + 中性色数 = 实际色板总数, 暖色预算按色板总数计算
#   - 沙漠/草原/森林天然暖色高(60-100%), 火山以暖为主中性辅, 雪/苔原冷色主导
#   - 设计师在 generate 阶段每加一色, 就 check_warm_budget(), 超预算立刻换冷色
BIOME_WARM_BUDGET = {
    "forest":        {"max_warm_pct": 100, "min_warm_pct": 70, "rationale": "暖色主导（森林绿系属暖色档）"},
    "plains":        {"max_warm_pct": 100, "min_warm_pct": 60, "rationale": "暖色主导（草原+作物色系）"},
    "desert":        {"max_warm_pct": 100, "min_warm_pct": 60, "rationale": "暖色主导，允许中性灰画远山/沙岩阴影"},
    "marsh":         {"max_warm_pct": 80,  "min_warm_pct": 50, "rationale": "暖色为主，紫色点缀"},
    "volcano":       {"max_warm_pct": 90,  "min_warm_pct": 50, "rationale": "暖色为主（火山红+橙），中性灰为辅（烟雾/岩灰）"},
    "snow":          {"max_warm_pct": 40,  "min_warm_pct": 0,  "rationale": "冷色主导（≤40% 暖色，v0.6 新规）"},
    "tundra":        {"max_warm_pct": 40,  "min_warm_pct": 10, "rationale": "冷色为主，少量暖色点缀"},
    "marsh_winter":  {"max_warm_pct": 50,  "min_warm_pct": 20, "rationale": "沼泽+冬季混合"},
}


# =============================================================================
# 工具函数
# =============================================================================
def get_color_hex(name: str) -> str:
    """查色（向后兼容旧字典调用方式）"""
    if name not in NEW_PALETTE_29:
        raise KeyError(f"色 '{name}' 不在 29 色新字典中")
    return NEW_PALETTE_29[name]["hex"]


def get_colors_by_category(category: str) -> dict:
    """按 category 过滤色（warm/cold/neutral）"""
    return {k: v for k, v in NEW_PALETTE_29.items() if v["category"] == category}


def get_colors_for_biome(biome: str, include_extended: bool = True) -> dict:
    """取群系亲缘色（按 biome_affinity 匹配）

    Args:
        biome: 群系名
        include_extended: 是否包含 5 色扩展（默认 True）
    """
    src = NEW_PALETTE_29 if include_extended else LOCKED_24
    return {
        k: v for k, v in src.items()
        if biome in v["biome_affinity"] or "universal" in v["biome_affinity"]
    }


def warm_ratio(color_set: dict) -> float:
    """计算给定色集合的暖色占比（%）。"""
    if not color_set:
        return 0.0
    n_warm = sum(1 for c in color_set.values() if c["category"] == "warm")
    return round(n_warm / len(color_set) * 100, 2)


def check_warm_budget(biome: str, color_set: dict) -> tuple:
    """预算校验：群系 + 色集合 → (是否通过, 实际占比, 原因)。

    用法：在 generate 阶段，先 pick_color() 选色，每加一色就 check_warm_budget()，
    超预算时立刻换冷色，**不再等 PR 阶段才发现**。
    """
    if biome not in BIOME_WARM_BUDGET:
        raise KeyError(f"群系 '{biome}' 未配置暖色预算")
    rule = BIOME_WARM_BUDGET[biome]
    actual = warm_ratio(color_set)
    passed = rule["min_warm_pct"] <= actual <= rule["max_warm_pct"]
    return passed, actual, rule


# =============================================================================
# 自检（独立运行：python3 palette_v2.py）
# =============================================================================
if __name__ == "__main__":
    print(f"=== v0.7.1a 24 锁版 + 5 扩展 = 29 色新字典 ===")
    print(f"暖色: {len(WARM_COLORS)} 色")
    print(f"冷色: {len(COLD_COLORS)} 色")
    print(f"中性: {len(NEUTRAL_COLORS)} 色")
    print(f"24 锁版总数: {len(LOCKED_24)}")
    print(f"5 扩展: {len(EXTENDED_5)} 色")
    print(f"29 字典: {len(NEW_PALETTE_29)}")
    print()

    # 演示：snow 群系取色 + 暖色预算校验
    print("=== 演示 1：snow 群系取色（含扩展） ===")
    snow_colors = get_colors_for_biome("snow", include_extended=True)
    print(f"snow 亲缘色: {len(snow_colors)} 色")
    passed, actual, rule = check_warm_budget("snow", snow_colors)
    print(f"暖色占比 = {actual}% / 预算 {rule['min_warm_pct']}-{rule['max_warm_pct']}% → {'PASS' if passed else 'FAIL'}")
    print()

    # 演示：desert 群系
    print("=== 演示 2：desert 群系取色 ===")
    desert_colors = get_colors_for_biome("desert", include_extended=True)
    print(f"desert 亲缘色: {len(desert_colors)} 色")
    passed, actual, rule = check_warm_budget("desert", desert_colors)
    print(f"暖色占比 = {actual}% / 预算 {rule['min_warm_pct']}-{rule['max_warm_pct']}% → {'PASS' if passed else 'FAIL'}")
    print()

    # 演示：volcano 群系
    print("=== 演示 3：volcano 群系取色 ===")
    volcano_colors = get_colors_for_biome("volcano", include_extended=True)
    print(f"volcano 亲缘色: {len(volcano_colors)} 色")
    passed, actual, rule = check_warm_budget("volcano", volcano_colors)
    print(f"暖色占比 = {actual}% / 预算 {rule['min_warm_pct']}-{rule['max_warm_pct']}% → {'PASS' if passed else 'FAIL'}")
