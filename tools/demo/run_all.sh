#!/bin/bash
# Run all demos in sequence
# 用法: bash tools/demo/run_all.sh (从仓库根目录)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

for demo in "$SCRIPT_DIR"/*.sh; do
    if [ "$(basename "$demo")" = "run_all.sh" ]; then
        continue
    fi
    echo ""
    echo "############################################"
    echo "# $(basename "$demo")"
    echo "############################################"
    bash "$demo"
done
echo ""
echo "All demos passed."
