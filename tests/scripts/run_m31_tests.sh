#!/usr/bin/env bash
# M3.1 验收脚本 — 一键跑 Go 回归 + Python 预测/插值 + 关键文件存在 + 符号检查。
#
# 沙箱内可跑;CI 跑通时,所有 Go 单元测试 + Python 预测/插值测试全过,
# GDScript 端静态对齐(SEMANTICS.md)。GUT 等价测试由工作台搭建师(M1.2)在 CI 补。
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

echo "[M3.1] === 1) 跑 Go 全量回归(81 个,8 个包)==="
cd "$ROOT/core/abstract/network/go"
go test ./... 2>&1 | tail -5

echo ""
echo "[M3.1] === 2) 跑 Python 端预测 + 插值 + 集成测试 ==="
cd "$ROOT"
python3 -m pytest \
    core/abstract/network/python3/tests/test_prediction.py \
    core/abstract/network/python3/tests/test_interpolation.py \
    core/abstract/network/python3/tests/test_m31_integration.py \
    -v 2>&1 | tail -10

echo ""
echo "[M3.1] === 3) 跑 1000-tick 压力测试(p99 < 16ms)==="
go test -run 'TestM31_HubTick_TimingStress' -v ./room/ 2>&1 | tail -10

echo ""
echo "[M3.1] === 4) 检查关键文件存在 ==="
cd "$ROOT"
for f in \
    core/abstract/network/proto/wildwood/v1/c2s.proto \
    core/abstract/network/proto/wildwood/v1/s2c.proto \
    core/abstract/network/python3/wildwood/prediction.py \
    core/abstract/network/python3/wildwood/interpolation.py \
    core/abstract/network/python3/wildwood/constants.py \
    core/abstract/network/gd/wildwood_constants.gd \
    core/abstract/network/gd/wildwood_predictor.gd \
    core/abstract/network/gd/wildwood_interpolator.gd \
    core/abstract/network/gd/SEMANTICS.md \
    core/abstract/network/go/room/hub.go \
    core/abstract/network/go/room/auth_state.go \
    core/abstract/network/go/room/m31_auth_test.go \
    core/abstract/network/go/room/m31_hub_tick_test.go \
    core/abstract/network/go/room/m31_tick_timing_test.go \
    scripts/network_client.gd \
    scripts/player_controller.gd \
    docs/plans/2026-08-20-m3.1-prediction.md
do
    if [ ! -f "$ROOT/$f" ]; then
        echo "  ✗ MISSING: $f" >&2
        exit 1
    fi
    echo "  ✓ $f"
done

echo ""
echo "[M3.1] === 5) 静态检查 Python ↔ GDScript 关键符号(grep)==="
declare -a SYMBOL_CHECKS=(
    # Python 端
    "class Predictor|core/abstract/network/python3/wildwood/prediction.py"
    "class Interpolator|core/abstract/network/python3/wildwood/interpolation.py"
    "RECONCILE_THRESHOLD_PX|core/abstract/network/python3/wildwood/constants.py"
    "INTERP_DURATION_MS|core/abstract/network/python3/wildwood/constants.py"
    "HIDE_DURATION_MS|core/abstract/network/python3/wildwood/constants.py"
    # GDScript 端
    "class_name WildwoodPredictor|core/abstract/network/gd/wildwood_predictor.gd"
    "class_name WildwoodInterpolator|core/abstract/network/gd/wildwood_interpolator.gd"
    "RECONCILE_THRESHOLD_PX|core/abstract/network/gd/wildwood_constants.gd"
    "INTERP_DURATION_MS|core/abstract/network/gd/wildwood_constants.gd"
    "HIDE_DURATION_MS|core/abstract/network/gd/wildwood_constants.gd"
    # 客户端集成
    "class_name NetworkClient|scripts/network_client.gd"
    "enable_network_mode|scripts/player_controller.gd"
    # Go 端
    "func.*ApplyInput|core/abstract/network/go/room/auth_state.go"
    "func.*TickCount|core/abstract/network/go/room/hub.go"
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
echo "[M3.1] === 6) 性能断言:Go 1000-tick p99 < 16ms ==="
RESULT=$(go -C "$ROOT/core/abstract/network/go" test -run 'TestM31_HubTick_TimingStress' -v ./room/ 2>&1 | grep -oE 'p99=[0-9.]+ms' | head -1 || true)
if [ -z "$RESULT" ]; then
    echo "  ✗ 压力测试未输出 p99" >&2
    exit 1
fi
P99=$(echo "$RESULT" | grep -oE '[0-9.]+' | head -1)
echo "  p99 = ${P99} ms (预算 16 ms / tick @ 60Hz)"
python3 -c "import sys; sys.exit(0 if $P99 < 16.0 else 1)" || {
    echo "  ✗ p99 ${P99}ms exceeds 16ms budget" >&2
    exit 1
}
echo "  ✓ 性能达标"

echo ""
echo "[M3.1] ✓✓✓ ALL GREEN"
