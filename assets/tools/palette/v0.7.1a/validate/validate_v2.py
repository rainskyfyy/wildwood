"""
v0.7.1a 校验器（新结构）

适配 NEW_PALETTE_29 字典 + warm/cold/neutral 分类。
对生成的 PNG 做 5 项 PR 硬约束自检:
  1. 调色板违例: 所有颜色都在 NEW_PALETTE_29 内 (锁版 24 + 扩展 5)
  2. 暖色预算: 群系 + 已用色 → 实际暖色占比 ∈ 预算区间
  3. 网格: 坐标在整数像素上 (PIL putpixel 保证)
  4. 抗锯齿: 无中间灰阶像素 (palette-only putpixel 保证)
  5. 尺寸: 16×16 / 32×32 / 32×64 (按文件名前缀)

vs 旧 validate.py:
  - 旧版：只查"颜色是否在 PALETTE_LEGACY_24 内"
  - v0.7.1a：升级到 5 项 + 暖色预算 + 群系匹配

用法:
  python3 validate_v2.py <png_dir> --biome snow
  python3 validate_v2.py <png_file> --biome snow
"""

import sys
import os
import argparse
import json
from typing import Optional

# 路径: validate_v2.py 在 .../validate/, palette_v2.py 在 .../palette/
_HERE = os.path.dirname(os.path.abspath(__file__))
_PALETTE_DIR = os.path.join(_HERE, "..", "palette")
sys.path.insert(0, _PALETTE_DIR)

from PIL import Image  # noqa: E402
from palette_v2 import (  # noqa: E402
    NEW_PALETTE_29,
    LOCKED_24,
    EXTENDED_5,
    check_warm_budget,
    warm_ratio,
    BIOME_WARM_BUDGET,
)

# 期望尺寸（按文件名前缀）
EXPECTED_SIZES = {
    "tile_": (32, 32),
    "elem_": None,  # elem 尺寸多样, 后面按具体名判断
    "deco_": (16, 16),
}

# elem 尺寸特例
ELEM_SIZES = {
    "elem_pine": (32, 64),
    "elem_snowflake_1": (16, 16),
    "elem_snowflake_2": (16, 16),
    "elem_ice_crystal": (16, 16),
    "elem_footprint": (16, 16),
    "elem_snowpile": (32, 32),
}


def hex_of_pixel(rgba: tuple) -> str:
    """(R,G,B,A) → #RRGGBB, 忽略 alpha 通道。"""
    r, g, b = rgba[0], rgba[1], rgba[2]
    return f"#{r:02x}{g:02x}{b:02x}"


def collect_used_colors(img_path: str) -> set:
    """扫描 PNG, 返回所有出现过的 hex 色集合。"""
    img = Image.open(img_path).convert("RGBA")
    colors = set()
    for px in img.getdata():
        if px[3] == 0:  # 透明像素不算
            continue
        colors.add(hex_of_pixel(px))
    return colors


def hex_to_rgb(hex_str: str) -> tuple:
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def check_palette_compliance(img_path: str) -> tuple:
    """PR 项 2: 调色板违例检查。

    Returns:
        (passed, violations, used_hex_set, used_palette_set)
    """
    used_hex = collect_used_colors(img_path)
    # 24 锁版 + 5 扩展 = 29 色 hex 集合
    palette_hex = {c["hex"].lower() for c in NEW_PALETTE_29.values()}
    # 兼容大小写
    used_hex_lower = {h.lower() for h in used_hex}

    violations = used_hex_lower - palette_hex
    used_palette = used_hex_lower & palette_hex

    passed = len(violations) == 0
    return passed, violations, used_hex, used_palette


def check_warm_pct(img_path: str, biome: str) -> tuple:
    """PR 项: 暖色占比预算。

    Returns:
        (passed, warm_pct, used_warm_colors, used_cold_colors, used_neutral_colors)
    """
    used_hex = collect_used_colors(img_path)
    used_hex_lower = {h.lower() for h in used_hex}

    # 找到每个 hex 对应的色名 + category
    name_by_hex = {c["hex"].lower(): n for n, c in NEW_PALETTE_29.items()}
    used_names = {name_by_hex[h] for h in used_hex_lower if h in name_by_hex}
    used_set = {n: NEW_PALETTE_29[n] for n in used_names}

    actual_pct = warm_ratio(used_set)
    passed, _, rule = check_warm_budget(biome, used_set)

    warm = [n for n, c in used_set.items() if c["category"] == "warm"]
    cold = [n for n, c in used_set.items() if c["category"] == "cold"]
    neutral = [n for n, c in used_set.items() if c["category"] == "neutral"]

    return passed, actual_pct, warm, cold, neutral, rule


def check_grid_and_aliasing(img_path: str) -> tuple:
    """PR 项 3+4: 网格 + 抗锯齿。

    像素整数坐标由 PIL putpixel 保证; 抗锯齿由 palette-only putpixel 保证
    (不会出现中间灰阶). 这里用启发式: 检查色数是否过多 (>32 色则可能抗锯齿)
    """
    used_hex = collect_used_colors(img_path)
    # palette-only PNG 通常 ≤24 色 (锁版 24) + 少量扩展; 超过 32 高度怀疑抗锯齿
    n_colors = len(used_hex)
    suspicious = n_colors > 32
    return not suspicious, n_colors


def check_size(img_path: str) -> tuple:
    """PR 项 5: 尺寸检查。"""
    img = Image.open(img_path)
    fname = os.path.basename(img_path)
    actual = img.size

    if fname.startswith("tile_"):
        expected = (32, 32)
    elif fname.startswith("elem_"):
        # 查特例表
        stem = fname[:-4]  # 去 .png
        expected = ELEM_SIZES.get(stem)
        if expected is None:
            # 默认 elem 32x32
            expected = (32, 32)
    elif fname.startswith("deco_"):
        expected = (16, 16)
    else:
        # 未知前缀, 不校验
        return True, actual, None

    passed = actual == expected
    return passed, actual, expected


def validate_one(img_path: str, biome: str) -> dict:
    """校验一张 PNG, 返回 5 项 PR 报告。"""
    fname = os.path.basename(img_path)
    result = {"file": fname, "biome": biome}

    # PR 2: 调色板
    pal_pass, violations, used_hex, used_pal = check_palette_compliance(img_path)
    result["palette"] = {
        "passed": pal_pass,
        "n_used": len(used_hex),
        "n_violations": len(violations),
        "violations": sorted(violations)[:5],  # 只列前 5 个
    }

    # PR 暖色预算
    warm_pass, warm_pct, warm_list, cold_list, neutral_list, rule = check_warm_pct(img_path, biome)
    result["warm_budget"] = {
        "passed": warm_pass,
        "warm_pct": warm_pct,
        "budget": f"{rule['min_warm_pct']}-{rule['max_warm_pct']}%",
        "warm_colors": warm_list,
        "cold_colors": cold_list,
        "neutral_colors": neutral_list,
    }

    # PR 3+4: 网格 + 抗锯齿
    grid_pass, n_colors = check_grid_and_aliasing(img_path)
    result["grid_aa"] = {
        "passed": grid_pass,
        "n_distinct_colors": n_colors,
    }

    # PR 5: 尺寸
    size_pass, actual, expected = check_size(img_path)
    result["size"] = {
        "passed": size_pass,
        "actual": actual,
        "expected": expected,
    }

    # 综合
    all_pass = pal_pass and warm_pass and grid_pass and size_pass
    result["all_pass"] = all_pass
    return result


def print_report(results: list) -> None:
    """打印 5 项 PR 报告。"""
    n_total = len(results)
    n_pass = sum(1 for r in results if r["all_pass"])
    print(f"\n=== v0.7.1a 校验报告（{n_total} 张）===")
    print(f"PASS: {n_pass}/{n_total}\n")
    for r in results:
        mark = "✓" if r["all_pass"] else "✗"
        print(f"{mark} {r['file']} (biome={r['biome']})")
        print(f"   调色板: {r['palette']['n_used']} 色, 违例 {r['palette']['n_violations']} → {'PASS' if r['palette']['passed'] else 'FAIL'}")
        print(f"   暖色占比: {r['warm_budget']['warm_pct']}% / 预算 {r['warm_budget']['budget']} → {'PASS' if r['warm_budget']['passed'] else 'FAIL'}")
        print(f"   暖/冷/中性: {len(r['warm_budget']['warm_colors'])}/{len(r['warm_budget']['cold_colors'])}/{len(r['warm_budget']['neutral_colors'])}")
        print(f"   网格+抗锯齿: {r['grid_aa']['n_distinct_colors']} 色 → {'PASS' if r['grid_aa']['passed'] else 'FAIL'}")
        print(f"   尺寸: {r['size']['actual']} / 预期 {r['size']['expected']} → {'PASS' if r['size']['passed'] else 'FAIL'}")
        print()


def main():
    parser = argparse.ArgumentParser(description="v0.7.1a 像素美术 PR 校验器")
    parser.add_argument("path", help="PNG 文件或目录")
    parser.add_argument("--biome", required=True, choices=list(BIOME_WARM_BUDGET.keys()),
                        help="群系名（决定暖色预算）")
    parser.add_argument("--json", action="store_true", help="输出 JSON 报告")
    args = parser.parse_args()

    # 收集体 PNG
    png_files = []
    if os.path.isfile(args.path):
        png_files = [args.path]
    elif os.path.isdir(args.path):
        for root, _, files in os.walk(args.path):
            for f in files:
                if f.lower().endswith(".png"):
                    png_files.append(os.path.join(root, f))
    else:
        print(f"路径不存在: {args.path}")
        sys.exit(1)

    if not png_files:
        print(f"未找到 PNG: {args.path}")
        sys.exit(1)

    # 校验
    results = [validate_one(p, args.biome) for p in sorted(png_files)]

    # 输出
    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        print_report(results)

    n_pass = sum(1 for r in results if r["all_pass"])
    sys.exit(0 if n_pass == len(results) else 1)


if __name__ == "__main__":
    main()
