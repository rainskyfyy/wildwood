#!/usr/bin/env bash
# M2.1 验收脚本 — 一键跑核心判别测试 + headless smoke + 关键文件存在。
#
# 沙箱内可跑;CI 跑通时,所有 Python 端 LMB 判别 100% 命中,
# GDScript 端静态对齐(SEMANTICS.md)。GUT 等价测试由工作台搭建师(M1.2)在 CI 补。
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

echo "[M2.1] === 1) 跑 Python 单元测试(19 个,LMB 判别核心)==="
python3 -m pytest tests/unit/test_lmb_decide.py -v

echo ""
echo "[M2.1] === 2) 跑 headless smoke(15 场景:10 ACC + 5 edge)==="
python3 tests/scripts/headless_smoke.py

echo ""
echo "[M2.1] === 3) 检查关键文件存在(静态)==="
for f in \
    core/abstract/gameplay/lmb_decide.py \
    core/abstract/gameplay/lmb_decide.gd \
    core/abstract/gameplay/SEMANTICS.md \
    scripts/player_controller.gd \
    scripts/world.gd \
    scripts/world_target.gd \
    scripts/m21_demo.gd \
    scenes/m21_demo.tscn \
    tests/unit/test_lmb_decide.py \
    tests/scripts/headless_smoke.py \
    docs/plans/2026-08-20-m2.1-movement-and-lmb-decide.md
do
    if [ ! -f "$ROOT/$f" ]; then
        echo "  ✗ MISSING: $f" >&2
        exit 1
    fi
    echo "  ✓ $f"
done

echo ""
echo "[M2.1] === 4) 检查 project.godot main_scene 已切到 m21_demo ==="
if ! grep -q 'run/main_scene="res://scenes/m21_demo.tscn"' "$ROOT/project.godot"; then
    echo "  ✗ main_scene 未切到 m21_demo.tscn" >&2
    exit 1
fi
echo "  ✓ main_scene = res://scenes/m21_demo.tscn"

echo ""
echo "[M2.1] === 5) 静态检查 GDScript 关键符号(grep)==="
# Python 端 decide_lmb_action ↔ GDScript 端 LmbDecide.decide(语义 1:1)
# 其它符号在两边同名 / 同义。
declare -a SYMBOL_CHECKS=(
    "LmbDecide|core/abstract/gameplay/lmb_decide.gd"
    "PlayerController|scripts/player_controller.gd"
    "WorldTarget|scripts/world_target.gd"
    "_physics_process|scripts/player_controller.gd"
    "_update_facing|scripts/player_controller.gd"
    "static func decide|core/abstract/gameplay/lmb_decide.gd"
    "decide_lmb_action|core/abstract/gameplay/lmb_decide.py"
)
for entry in "${SYMBOL_CHECKS[@]}"; do
    sym="${entry%%|*}"
    f="${entry##*|}"
    if ! grep -q "$sym" "$ROOT/$f"; then
        echo "  ✗ 符号缺失: $sym (in $f)" >&2
        exit 1
    fi
    echo "  ✓ $sym (in $f)"
done

echo ""
echo "[M2.1] === 6) 性能断言:200 候选 x 1000 次 p99 < 1ms ==="
python3 -c "
import time, random
import sys
sys.path.insert(0, '$ROOT')
from core.abstract.gameplay.lmb_decide import decide_lmb_action, Target, TargetType
random.seed(42)
cand = [Target(f'a_{i}', (random.uniform(-8,8), random.uniform(-8,8)), TargetType.ATTACK) for i in range(100)] + \
       [Target(f'g_{i}', (random.uniform(-8,8), random.uniform(-8,8)), TargetType.GATHER) for i in range(100)]
samples = []
for _ in range(1000):
    px, py = random.uniform(-8,8), random.uniform(-8,8)
    cx, cy = random.uniform(-8,8), random.uniform(-8,8)
    t0 = time.perf_counter()
    decide_lmb_action((px,py), cand, (cx,cy))
    samples.append((time.perf_counter()-t0)*1000.0)
samples.sort()
p99 = samples[int(0.99*len(samples))]
print(f'  p99 = {p99:.4f} ms (预算 1.0 ms / 实际预算 200 ms 的 0.5%)')
assert p99 < 1.0, f'p99 {p99:.4f}ms exceeds 1ms budget'
print('  ✓ 性能达标')
"

echo ""
echo "[M2.1] ✓✓✓ ALL GREEN"
