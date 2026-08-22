"""
v0.5/v0.6 调色板字典（旧结构,已弃用但保留兼容）

字段：仅 hex
用途：v0.5 沙漠/沼泽/雪山/熔岩 + v0.6.2a snow 群系已上线资产使用本字典。
v0.7.1a 起新群系必须改用 palette_v2.NEW_PALETTE_29。

历史:
  - v0.5: M3.13 阶段, 暖色 16/24 锁版 + 火山暖色 7 色 (含 basalt_black/ash_grey/charcoal 重复) + 共享锚点
  - v0.6: v0.6.2a snow 群系沿用本字典, 加 5 冷色扩展 (ice_cyan/snow_pale/glacier_blue/frost_purple/aurora_green)
"""

PALETTE_LEGACY_24 = {
    # 暖色系（16 色 - 实际枚举, 含重复色视为 16 个色名）
    "forest_green":   "#2d5a1e",
    "leaf_green":     "#4a8c2a",
    "grass_green":    "#6db33f",
    "dark_green":     "#1a3a0e",
    "desert_gold":    "#c4a03a",
    "sand_light":     "#e8d89c",
    "sand_mid":       "#d4b86a",
    "sand_dark":      "#8a6a2a",
    "desert_orange":  "#e07030",
    "amber":          "#d4a030",
    "marsh_purple":   "#4a2c3e",
    "mud_brown":      "#5c3a1e",
    "mud_dark":       "#3a2210",
    "swamp_green":    "#3a5a2a",
    "lava_red":       "#e04020",
    "magma_orange":   "#f08030",

    # 冷色系（5 色）
    "snow_white":     "#e8f0f8",
    "frost_silver":   "#c0d0e0",
    "ice_blue":       "#90c8e0",
    "deep_blue":      "#406080",
    "shadow_grey":    "#606878",

    # 火山扩展暖色（3 色 - 与上面 lava_red/magma_orange 重叠）
    "basalt_black":   "#202020",
    "ash_grey":       "#888888",
    "flame_yellow":   "#f0c040",
    "dark_red":       "#801010",
    "charcoal":       "#303030",

    # 共享锚点（3 色）
    "night_black":    "#101820",
    "highlight_white": "#f8f8f8",
    "poison_orange":  "#f0a030",
}

# v0.6.2a snow 群系的 5 冷色扩展（不在 24 锁版内）
PALETTE_V062A_SNOW_EXT = {
    "ice_cyan":       "#6ec8d8",
    "snow_pale":      "#f0f8ff",
    "glacier_blue":   "#5080a0",
    "frost_purple":   "#7080a0",
    "aurora_green":   "#80c8a0",
}


def get(name: str) -> str:
    """旧字典查色 API, 保持向后兼容。"""
    if name in PALETTE_LEGACY_24:
        return PALETTE_LEGACY_24[name]
    if name in PALETTE_V062A_SNOW_EXT:
        return PALETTE_V062A_SNOW_EXT[name]
    raise KeyError(f"色 '{name}' 不在 v0.5/v0.6 旧字典中")


if __name__ == "__main__":
    print(f"v0.5/v0.6 旧字典: {len(PALETTE_LEGACY_24)} 色（含暖/冷/共享）")
    print(f"v0.6.2a snow 扩展: {len(PALETTE_V062A_SNOW_EXT)} 色")
    print(f"合计: {len(PALETTE_LEGACY_24) + len(PALETTE_V062A_SNOW_EXT)} 色")
    print()
    print("兼容策略: 已上线 v0.6.2a snow 群系沿用本字典, 不强制迁移到 v0.7.1a。")
    print("v0.7.1a 起新群系必须用 NEW_PALETTE_29 + warm/cold 预算校验。")
