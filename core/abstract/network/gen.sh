#!/usr/bin/env bash
# gen.sh — Wildwood M1.5 协议层 protobuf 代码生成
#
# 用法:
#   ./gen.sh                    # 用 protoc 25.1 生成 Go 代码到 go/wildwood/v1/
#   ./gen.sh --check            # 只检查 .proto 是否最新,不实际生成
#   ./gen.sh --install-deps     # 提示/下载 protoc + protoc-gen-go
#
# 依赖(在 .aily/.cli/bin 已就位):
#   protoc              25.1
#   protoc-gen-go       v1.34.2
#
# 跑前确保 PATH 包含 $HOME/.aily/.cli/bin:
#   export PATH="$HOME/.aily/.cli/bin:$PATH"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_DIR="${SCRIPT_DIR}/proto"
OUT_DIR="${SCRIPT_DIR}/go"
PROTOC="${PROTOC:-protoc}"
PROTOC_GEN_GO="${PROTOC_GEN_GO:-protoc-gen-go}"

CHECK_ONLY=0
INSTALL_HINT=0
for arg in "$@"; do
  case "$arg" in
    --check)   CHECK_ONLY=1 ;;
    --install-deps) INSTALL_HINT=1 ;;
  esac
done

# 1) 工具检查
if [ "$INSTALL_HINT" = "1" ]; then
  echo "M1.5 protocol deps install hint:"
  echo "  1. protoc 25.1:    https://github.com/protocolbuffers/protobuf/releases/tag/v25.1"
  echo "  2. protoc-gen-go:  go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.34.2"
  echo "  3. PATH:           export PATH=\"\$HOME/.aily/.cli/bin:\$PATH\""
  exit 0
fi

if ! command -v "$PROTOC" >/dev/null 2>&1; then
  echo "[ERR] protoc not found. Run $0 --install-deps" >&2
  exit 1
fi
if ! command -v "$PROTOC_GEN_GO" >/dev/null 2>&1; then
  echo "[ERR] protoc-gen-go not found. Run: go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.34.2" >&2
  exit 1
fi

# 2) 计算源文件指纹(供 --check 用)
SOURCE_FILES=$(find "$PROTO_DIR" -name '*.proto' | sort)
SOURCE_HASH=$(echo "$SOURCE_FILES" | xargs cat | sha256sum | cut -d' ' -f1)
HASH_FILE="${OUT_DIR}/.proto_hash"

if [ "$CHECK_ONLY" = "1" ]; then
  if [ -f "$HASH_FILE" ] && [ "$(cat "$HASH_FILE")" = "$SOURCE_HASH" ]; then
    echo "proto sources unchanged (hash $SOURCE_HASH)"
    exit 0
  else
    echo "proto sources CHANGED — re-run $0 to regenerate"
    exit 1
  fi
fi

# 3) 生成
echo "==> generating Go protobuf code..."
mkdir -p "$OUT_DIR"
"$PROTOC" \
  --go_out="$OUT_DIR" \
  --go_opt=paths=source_relative \
  -I"$PROTO_DIR" \
  $SOURCE_FILES

# 4) 记录指纹
echo "$SOURCE_HASH" > "$HASH_FILE"

# 5) 跑测试,保证生成后代码可编译
echo "==> running Go tests..."
( cd "$OUT_DIR" && go test ./... -count=1 -timeout 60s )

echo "==> done. Generated files:"
find "$OUT_DIR" -name '*.pb.go' | sort
