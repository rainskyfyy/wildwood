"""
v0.7.1a 程序化生成器模板（新结构）

核心收益 vs 旧 generate.py:
  - 旧版：生成完成后才校验色板违例（PR 阶段发现 → 返工）
  - v0.7.1a：每加一色就 check_warm_budget(), 超预算立即换冷色（生成阶段修正 → 一次过）

调用流程:
  1. 创建 PaletteBudget(biome="snow") 实例
  2. palette.pick("snow_white") 添加色 (自动检查预算)
  3. 形状函数 draw_<element>(palette, img) 用 palette.color("snow_white") 取色
  4. 输出前 palette.summary() 打印暖色预算摘要

形状函数签名 (v0.7.1a):
  def draw_xxx(img: Image.Image, palette: PaletteBudget) -> None
  内部用 palette.color_rgb("snow_white") 取 (R,G,B) tuple, 直接给 PIL putpixel

向后兼容:
  - 旧 generate.py 用 PALETTE_LEGACY_24.get("snow_white") 直接查 hex
  - 新版用 palette.color("snow_white") 返回 hex, 同时记录已用色
  - 旧 generate.py 调 PIL putpixel((x,y), "#e8f0f8") 也可继续用, 不强求
"""

import sys
import os
from typing import Optional

# 让 generate.py 可独立运行（不在包内）
# 路径：generate_v2.py 在 .../generate/, palette_v2.py 在 .../palette/
_HERE = os.path.dirname(os.path.abspath(__file__))
_PALETTE_DIR = os.path.join(_HERE, "..", "palette")
sys.path.insert(0, _PALETTE_DIR)

from PIL import Image, ImageDraw  # noqa: E402
from palette_v2 import (  # noqa: E402
    NEW_PALETTE_29,
    LOCKED_24,
    EXTENDED_5,
    get_color_hex,
    get_colors_for_biome,
    check_warm_budget,
    warm_ratio,
    BIOME_WARM_BUDGET,
)


def hex_to_rgb(hex_str: str) -> tuple:
    """#RRGGBB → (R, G, B) tuple, 给 PIL putpixel 用"""
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


class PaletteBudget:
    """v0.7.1a 调色板预算管理器。

    用法:
        p = PaletteBudget(biome="snow")
        p.pick("snow_white")          # 加色 + 自动校验暖色预算
        p.pick("snow_white", force=True)  # 强制加色不校验（应急）
        p.color("snow_white")         # 拿 hex 字符串
        p.color_rgb("snow_white")     # 拿 (R,G,B) tuple, 直接给 PIL
        p.summary()                   # 打印暖色预算摘要
    """

    def __init__(self, biome: str, strict: bool = True):
        self.biome = biome
        self.strict = strict
        self.used: dict[str, int] = {}  # color_name -> count
        self.warnings: list[str] = []
        if biome not in BIOME_WARM_BUDGET:
            raise KeyError(f"群系 '{biome}' 未配置暖色预算")
        self.budget = BIOME_WARM_BUDGET[biome]

    def pick(self, color_name: str, force: bool = False) -> str:
        """加一色，返回 hex 字符串。

        非 force 模式下，若加完会超暖色预算，**自动找冷色替代**。
        """
        if color_name not in NEW_PALETTE_29:
            raise KeyError(f"色 '{color_name}' 不在 29 色新字典中")

        # 模拟加色后状态
        simulated = dict(self.used)
        simulated[color_name] = simulated.get(color_name, 0) + 1
        sim_set = {k: NEW_PALETTE_29[k] for k in simulated}

        passed, actual, rule = check_warm_budget(self.biome, sim_set)

        if not passed and not force:
            replacement = self._suggest_cold_replacement()
            if replacement:
                self.warnings.append(
                    f"[WARN] '{color_name}' 加完会超暖色预算 ({actual}% > {rule['max_warm_pct']}%) "
                    f"→ 自动换为冷色替代 '{replacement}'"
                )
                color_name = replacement
                simulated[color_name] = simulated.get(color_name, 0) + 1
                sim_set = {k: NEW_PALETTE_29[k] for k in simulated}
            else:
                if self.strict:
                    raise RuntimeError(
                        f"加色 '{color_name}' 超暖色预算 ({actual}%) "
                        f"且无冷色替代可用, 拒绝加色（strict=True）"
                    )
                self.warnings.append(
                    f"[WARN] '{color_name}' 超暖色预算 ({actual}%) 且无冷色替代（strict=False 仍加）"
                )

        self.used[color_name] = self.used.get(color_name, 0) + 1
        return NEW_PALETTE_29[color_name]["hex"]

    def _suggest_cold_replacement(self) -> Optional[str]:
        """从 biome 亲缘色中找一个还没用过的冷色或中性色。"""
        candidates = get_colors_for_biome(self.biome, include_extended=True)
        for name, meta in candidates.items():
            if meta["category"] in ("cold", "neutral") and name not in self.used:
                return name
        return None

    def color(self, color_name: str) -> str:
        """查色 hex 字符串（不加色）。"""
        return get_color_hex(color_name)

    def color_rgb(self, color_name: str) -> tuple:
        """查色 (R,G,B) tuple（不加色），给 PIL putpixel 用。"""
        return hex_to_rgb(self.color(color_name))

    def used_set(self) -> dict:
        """返回已用色集合（去重）"""
        return {k: NEW_PALETTE_29[k] for k in self.used}

    def summary(self) -> dict:
        """返回暖色预算摘要 dict。"""
        used_set = self.used_set()
        actual_pct = warm_ratio(used_set)
        passed, _, rule = check_warm_budget(self.biome, used_set)
        n_warm = sum(1 for c in used_set.values() if c["category"] == "warm")
        n_cold = sum(1 for c in used_set.values() if c["category"] == "cold")
        n_neutral = sum(1 for c in used_set.values() if c["category"] == "neutral")
        return {
            "biome": self.biome,
            "used_colors": list(self.used.keys()),
            "n_total": len(used_set),
            "n_warm": n_warm,
            "n_cold": n_cold,
            "n_neutral": n_neutral,
            "warm_pct": actual_pct,
            "budget": rule,
            "passed": passed,
            "warnings": list(self.warnings),
        }

    def print_summary(self) -> None:
        """打印暖色预算摘要到 stdout。"""
        s = self.summary()
        print(f"\n=== PaletteBudget[{self.biome}] 摘要 ===")
        print(f"已用色 ({s['n_total']}): {', '.join(s['used_colors'])}")
        print(f"暖色 {s['n_warm']} / 冷色 {s['n_cold']} / 中性 {s['n_neutral']}")
        print(f"暖色占比 = {s['warm_pct']}% / 预算 {s['budget']['min_warm_pct']}-{s['budget']['max_warm_pct']}%")
        print(f"结果: {'PASS' if s['passed'] else 'FAIL'}")
        if s["warnings"]:
            print(f"警告 {len(s['warnings'])} 条:")
            for w in s["warnings"]:
                print(f"  - {w}")


# =============================================================================
# 形状函数（snow 群系 demo）
# =============================================================================
def draw_snow_tile(img: Image.Image, p: PaletteBudget) -> None:
    """tile_snow 32×32 — 雪地基底（4 边对称无缝）"""
    base = p.pick("snow_white")
    mid = p.pick("frost_silver")
    dark = p.pick("deep_blue")
    pix = img.load()
    for y in range(32):
        for x in range(32):
            if (x + y) % 8 == 0:
                pix[x, y] = hex_to_rgb(mid)
            elif (x * y) % 17 == 0:
                pix[x, y] = hex_to_rgb(dark)
            else:
                pix[x, y] = hex_to_rgb(base)


def draw_glacier_tile(img: Image.Image, p: PaletteBudget) -> None:
    """tile_glacier 32×32 — 冰川（冰裂纹）"""
    base = p.pick("ice_blue")
    deep = p.pick("deep_blue")
    light = p.pick("snow_white")
    pix = img.load()
    for y in range(32):
        for x in range(32):
            if abs(x - y) < 2 or abs(x + y - 31) < 2:
                pix[x, y] = hex_to_rgb(deep)
            elif (x + y) % 6 == 0:
                pix[x, y] = hex_to_rgb(light)
            else:
                pix[x, y] = hex_to_rgb(base)


def draw_pine_element(img: Image.Image, p: PaletteBudget) -> None:
    """elem_pine 32×64 — 松树（雪盖）

    v0.7.1a 关键测试点：snow 群系暖色预算 0-40%
    pine 需要 mud_brown (树干, 暖) + dark_green (树冠, 暖) + forest_green (中色, 暖) + snow_white (雪盖, 冷)
    → 暖色 3/4 = 75% 远超 snow 预算 40%
    → PaletteBudget 自动替换多个暖色为冷色
    """
    trunk = p.pick("mud_brown")
    leaves_dark = p.pick("dark_green")
    leaves_mid = p.pick("forest_green")
    snow_cap = p.pick("snow_white")
    pix = img.load()
    # 树干 (中央 4 列, y=44-63)
    for y in range(44, 64):
        for x in range(14, 18):
            pix[x, y] = hex_to_rgb(trunk)
    # 树冠 (倒三角, y=0-43)
    for y in range(44):
        for x in range(32):
            dx = abs(x - 16)
            max_dx = (44 - y) // 2
            if dx <= max_dx:
                if y < 8:
                    pix[x, y] = hex_to_rgb(snow_cap)  # 雪盖
                elif dx < max_dx - 2:
                    pix[x, y] = hex_to_rgb(leaves_dark)
                else:
                    pix[x, y] = hex_to_rgb(leaves_mid)


def draw_ice_crystal(img: Image.Image, p: PaletteBudget) -> None:
    """elem_ice_crystal 16×16 — 冰晶（6 角）"""
    base = p.pick("ice_blue")
    light = p.pick("snow_white")
    dark = p.pick("deep_blue")
    pix = img.load()
    cx, cy = 8, 8
    for y in range(16):
        for x in range(16):
            dx, dy = x - cx, y - cy
            r2 = dx * dx + dy * dy
            if r2 > 36:
                continue
            angle = (abs(dx) + abs(dy)) % 6
            if angle == 0:
                pix[x, y] = hex_to_rgb(light)
            elif r2 < 9:
                pix[x, y] = hex_to_rgb(light)
            else:
                pix[x, y] = hex_to_rgb(base) if (dx + dy) % 2 == 0 else hex_to_rgb(dark)


# =============================================================================
# 主流程
# =============================================================================
def generate_snow_demo(output_dir: str) -> int:
    """生成 4 张 snow 群系 demo 图，每张都跑暖色预算。

    Returns:
        生成的 PNG 数量
    """
    os.makedirs(output_dir, exist_ok=True)
    n = 0

    # 1) tile_snow
    p = PaletteBudget(biome="snow")
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    draw_snow_tile(img, p)
    img.save(os.path.join(output_dir, "tile_snow.png"))
    p.print_summary()
    n += 1

    # 2) tile_glacier
    p = PaletteBudget(biome="snow")
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    draw_glacier_tile(img, p)
    img.save(os.path.join(output_dir, "tile_glacier.png"))
    p.print_summary()
    n += 1

    # 3) elem_pine —— 测试点：3 暖色 + 1 冷色 = 4 色，暖色 75% 超 snow 预算 40%
    p = PaletteBudget(biome="snow")
    img = Image.new("RGBA", (32, 64), (0, 0, 0, 0))
    draw_pine_element(img, p)
    img.save(os.path.join(output_dir, "elem_pine.png"))
    p.print_summary()
    n += 1

    # 4) elem_ice_crystal
    p = PaletteBudget(biome="snow")
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw_ice_crystal(img, p)
    img.save(os.path.join(output_dir, "elem_ice_crystal.png"))
    p.print_summary()
    n += 1

    return n


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "..", "demo", "output")
    n = generate_snow_demo(out_dir)
    print(f"\n=== 已生成 {n} 张 snow demo PNG 到 {out_dir} ===")
