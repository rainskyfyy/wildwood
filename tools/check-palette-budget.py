#!/usr/bin/env python3
"""
tools/check-palette-budget.py
v0.8.1a 调色板预算回归 CI 工具

- 扫描 5 群系 (desert/marsh/snow/volcano/forest) 的所有 PNG
- 统计真实调色板用量
- 24 色硬约束：fail if 超 24
- 暖色占比：默认 warn（advisory），可加 --strict 提升为 fail

退出码：
  0  = 全部通过
  1  = 有群系 fail 24 色硬约束
  2  = warn 模式有群系暖色占比不达
"""
import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("FATAL: PIL not available. pip install pillow", file=sys.stderr)
    sys.exit(1)


# 5 群系 → 文件路径模板（v0.5 + v0.6 路径并存）
REPO_TREE = {
    "desert": {
        "warm_target": "≥70%",
        "path_patterns": [
            "assets/art/biomes/desert/tiles/*.png",
            "assets/art/biomes/desert/elements/*.png",
        ],
    },
    "marsh": {
        "warm_target": "≥70%",
        "path_patterns": [
            "assets/art/biomes/marsh/tiles/*.png",
            "assets/art/biomes/marsh/elements/*.png",
        ],
    },
    "volcano": {
        "warm_target": "≥70%",
        "path_patterns": [
            "assets/art/biomes/volcano/tiles/*.png",
            "assets/art/biomes/volcano/elements/*.png",
        ],
    },
    "snow": {
        "warm_target": "≤40%",
        "path_patterns": [
            "assets/biomes/snow/tile_*.png",
            "assets/biomes/snow/elem_*.png",
            # 兼容 v0.5 老路径
            "assets/art/biomes/snow/tiles/*.png",
            "assets/art/biomes/snow/elements/*.png",
        ],
    },
    "forest": {
        "warm_target": "≥70%",
        "path_patterns": [
            "assets/art/biomes/_shared/decorations/forest/*.png",
        ],
    },
}


def classify_warm(rgb):
    r, g, b = rgb[0], rgb[1], rgb[2]
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn < 24:
        return "neutral"
    if mx < 32 or mn > 240:
        return "neutral"
    r_, g_, b_ = r / 255.0, g / 255.0, b / 255.0
    mx_, mn_ = max(r_, g_, b_), min(r_, g_, b_)
    delta = mx_ - mn_
    if delta == 0:
        return "neutral"
    if mx_ == r_:
        h = ((g_ - b_) / delta) % 6
    elif mx_ == g_:
        h = (b_ - r_) / delta + 2
    else:
        h = (r_ - g_) / delta + 4
    h *= 60
    if h < 0:
        h += 360
    sat = delta / mx_ if mx_ > 0 else 0
    if sat < 0.20:
        return "neutral"
    if 0 <= h <= 60 or 300 < h <= 360:
        return "warm"
    return "cool"


def analyze_png(path):
    img = Image.open(path)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    color_map = {}
    for px in img.getdata():
        if len(px) == 4 and px[3] < 16:
            continue
        color_map[px[:4]] = color_map.get(px[:4], 0) + 1
    return color_map


def main():
    parser = argparse.ArgumentParser(description="v0.8.1a 调色板预算回归")
    parser.add_argument("--repo-root", default=".", help="仓库根目录")
    parser.add_argument("--budget", type=int, default=24, help="色数上限（默认 24）")
    parser.add_argument("--strict", action="store_true", help="暖色占比不达也 fail")
    parser.add_argument("--json", action="store_true", help="输出 JSON 报告")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    if not (repo_root / ".git").exists():
        print(f"WARN: {repo_root} not a git repo, run anyway", file=sys.stderr)

    results = {}
    overall_fail = False
    overall_warn = False

    for biome, cfg in REPO_TREE.items():
        # 收集文件
        files = []
        for pat in cfg["path_patterns"]:
            files.extend(sorted((repo_root).glob(pat)))
        # 去重
        files = sorted(set(files))

        all_colors = {}
        for f in files:
            try:
                cm = analyze_png(f)
                for k, v in cm.items():
                    key = k[:3]  # 忽略 alpha
                    all_colors[key] = all_colors.get(key, 0) + v
            except Exception as e:
                print(f"  ERR {f.relative_to(repo_root)}: {e}", file=sys.stderr)

        unique = len(all_colors)
        # 24 色硬约束
        budget_pass = unique <= args.budget
        if not budget_pass:
            overall_fail = True

        # 暖色占比
        cls_counter = Counter()
        for (r, g, b) in all_colors:
            cls_counter[classify_warm((r, g, b))] += 1
        warm_n = cls_counter["warm"]
        cool_n = cls_counter["cool"]
        warm_pct = round(100 * warm_n / (warm_n + cool_n), 1) if (warm_n + cool_n) else 0

        target = cfg["warm_target"]
        if "≥70" in target:
            warm_pass = warm_pct >= 70
        elif "≤40" in target:
            warm_pass = warm_pct <= 40
        else:
            warm_pass = None

        if warm_pass is False:
            if args.strict:
                overall_fail = True
            else:
                overall_warn = True

        results[biome] = {
            "files_n": len(files),
            "unique_colors": unique,
            "budget_pass": budget_pass,
            "warm_n": warm_n,
            "cool_n": cool_n,
            "neutral_n": cls_counter["neutral"],
            "warm_pct": warm_pct,
            "warm_target": target,
            "warm_pass": warm_pass,
        }

    # 输出
    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        # 表格
        print()
        print("=" * 80)
        print(f" v0.8.1a 调色板预算回归  |  budget={args.budget}  |  strict={args.strict}")
        print("=" * 80)
        print(f" {'群系':<10} {'文件':<6} {'色数':<5} {'24色':<6} {'warm%':<8} {'目标':<8} {'warm':<6} {'结论':<6}")
        print("-" * 80)
        for biome, r in results.items():
            budget_mark = "✅" if r["budget_pass"] else "❌"
            warm_mark = "✅" if r["warm_pass"] else ("⚠️" if r["warm_pass"] is False else "N/A")
            verdict = "PASS"
            if not r["budget_pass"]:
                verdict = "FAIL"
            elif r["warm_pass"] is False:
                verdict = "WARN" if not args.strict else "FAIL"
            print(f" {biome:<10} {r['files_n']:<6} {r['unique_colors']:<5} {budget_mark} {r['unique_colors']}/24  "
                  f"{r['warm_pct']:<7}% {r['warm_target']:<8} {warm_mark}      {verdict}")
        print("-" * 80)
        if overall_fail:
            print(f"\n❌ OVERALL: FAIL（24 色硬约束不通过 / --strict 模式下暖色不达）")
        elif overall_warn:
            print(f"\n⚠️  OVERALL: PASS with WARN（24 色通过；暖色占比 advisory）")
        else:
            print(f"\n✅ OVERALL: PASS")

    sys.exit(1 if overall_fail else (2 if overall_warn and not args.strict else 0))


if __name__ == "__main__":
    main()
