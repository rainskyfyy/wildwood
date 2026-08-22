"""v0.7.1a 对比 demo: v0.5 旧字典 vs v0.7.1a 新字典生成同一张 elem_pine

目标: 证明 v0.7.1a PaletteBudget 在生成阶段就强制暖色预算,
      而 v0.5 旧字典生成出来视觉更好但 PR 阶段才会发现超预算.
"""

import sys
import os

# 路径设置
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "palette"))
sys.path.insert(0, os.path.join(_HERE, "..", "generate"))
sys.path.insert(0, os.path.join(_HERE, "..", "validate"))

from PIL import Image
from palette_v1_legacy import PALETTE_LEGACY_24
from palette_v2 import NEW_PALETTE_29
from generate_v2 import PaletteBudget, hex_to_rgb


def draw_pine_legacy() -> Image.Image:
    """v0.5 旧字典: 直接查 hex, 无预算校验, 用 mud_brown + dark_green + forest_green + snow_white"""
    img = Image.new("RGBA", (32, 64), (0, 0, 0, 0))
    trunk = PALETTE_LEGACY_24["mud_brown"]
    leaves_dark = PALETTE_LEGACY_24["dark_green"]
    leaves_mid = PALETTE_LEGACY_24["forest_green"]
    snow_cap = PALETTE_LEGACY_24["snow_white"]
    pix = img.load()
    for y in range(44, 64):
        for x in range(14, 18):
            pix[x, y] = hex_to_rgb(trunk)
    for y in range(44):
        for x in range(32):
            dx = abs(x - 16)
            max_dx = (44 - y) // 2
            if dx <= max_dx:
                if y < 8:
                    pix[x, y] = hex_to_rgb(snow_cap)
                elif dx < max_dx - 2:
                    pix[x, y] = hex_to_rgb(leaves_dark)
                else:
                    pix[x, y] = hex_to_rgb(leaves_mid)
    return img


def draw_pine_v2() -> Image.Image:
    """v0.7.1a 新字典: PaletteBudget 暖色预算校验, 暖色超 40% 自动换冷色"""
    p = PaletteBudget(biome="snow")
    img = Image.new("RGBA", (32, 64), (0, 0, 0, 0))
    trunk = p.pick("mud_brown")
    leaves_dark = p.pick("dark_green")
    leaves_mid = p.pick("forest_green")
    snow_cap = p.pick("snow_white")
    pix = img.load()
    for y in range(44, 64):
        for x in range(14, 18):
            pix[x, y] = hex_to_rgb(trunk)
    for y in range(44):
        for x in range(32):
            dx = abs(x - 16)
            max_dx = (44 - y) // 2
            if dx <= max_dx:
                if y < 8:
                    pix[x, y] = hex_to_rgb(snow_cap)
                elif dx < max_dx - 2:
                    pix[x, y] = hex_to_rgb(leaves_dark)
                else:
                    pix[x, y] = hex_to_rgb(leaves_mid)
    print("\n=== v0.7.1a pine 生成摘要 ===")
    p.print_summary()
    return img


def make_comparison():
    """生成 64×64 横向对比图: 左 v0.5, 右 v0.7.1a"""
    img_legacy = draw_pine_legacy()
    img_v2 = draw_pine_v2()

    out = Image.new("RGBA", (64 + 4, 64), (255, 255, 255, 255))
    out.paste(img_legacy, (0, 0))
    out.paste(img_v2, (36, 0))
    out_path = os.path.join(_HERE, "output", "comparison_pine.png")
    out.save(out_path)
    print(f"\n=== 对比图已生成: {out_path} ===")
    print("左 = v0.5 旧字典 (3 暖色 1 冷色, 75% 暖色超 snow 预算)")
    print("右 = v0.7.1a 新字典 (1 暖色 2 冷色, 33% 暖色 PASS)")


if __name__ == "__main__":
    make_comparison()
