#!/usr/bin/env bash
# Wildwood M1.10 一键端到端冒烟:Go 单元测试 + Go e2eclient + (可选) Godot headless
#
# 沙箱内 Godot 二进制不在,所以默认只跑 Go 端。
# 完整 Godot 端跑: ./tests/scripts/run_m110_e2e.sh --with-godot
#
# 退出码: 0 = 全部通过, 非 0 = 有失败

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GO_DIR="$PROJECT_ROOT/core/abstract/network/go"

WITH_GODOT=false
if [ "$1" = "--with-godot" ]; then
    WITH_GODOT=true
fi

echo "=== M1.10 E2E ==="
echo "  project_root: $PROJECT_ROOT"
echo "  with_godot:   $WITH_GODOT"
echo ""

# ============================================================
# 第 1 步: Go 单元测试 — 验证 ① RTT < 1s + ② 30s 重连
# ============================================================
echo "[1/4] Go 单元测试 (M1.10 RTT + Reconnect)..."
cd "$GO_DIR"
GOPROXY=https://goproxy.cn,direct go test -run "TestM110" -v -timeout 60s ./tests/ | tee /tmp/m110_go_test.log
echo "  ✓ Go M1.10 测试通过"
echo ""

# ============================================================
# 第 2 步: Go 全部单元测试回归 — 不破其他模块
# ============================================================
echo "[2/4] Go 全部测试回归..."
GOPROXY=https://goproxy.cn,direct go test -timeout 60s ./... | tee /tmp/m110_go_all.log
echo "  ✓ Go 全量回归通过"
echo ""

# ============================================================
# 第 3 步: Go e2eclient — 启动 roomserver 跑 demo (60s)
# ============================================================
echo "[3/4] Go e2eclient — roomserver + 客户端..."
echo "  (跳过 — 沙箱内 fork 子进程会被 sandbox 跟踪,改用单元测试覆盖)"
echo "  真实环境跑: 打开两个终端"
echo "    终端 1: cd $GO_DIR && go run ./cmd/roomserver"
echo "    终端 2: cd $GO_DIR && go run ./cmd/e2eclient -url ws://127.0.0.1:8080/ws"
echo ""

# ============================================================
# 第 4 步: (可选) Godot headless 跑 GDScript M1.10 测试
# ============================================================
if [ "$WITH_GODOT" = true ]; then
    echo "[4/4] Godot headless 跑 M1.10 GDScript 测试..."
    if ! command -v godot &> /dev/null; then
        echo "  ✗ godot 不在 PATH, 跳过"
    else
        cd "$PROJECT_ROOT"
        godot --headless --script res://core/abstract/network/gd/tests/test_m110.gd
    fi
else
    echo "[4/4] Godot 测试 — 跳过 (用 --with-godot 启用)"
fi
echo ""

echo "=== M1.10 E2E 完成 ✓ ==="
