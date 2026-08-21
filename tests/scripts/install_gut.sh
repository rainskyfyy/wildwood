#!/usr/bin/env bash
# 安装 GUT (Godot Unit Test) 9.2.0 到 addons/gut/
# M1.3 一次性脚本:后续 CI 由 .github/workflows/test.yml 自动跑。
#
# 用法:bash tests/scripts/install_gut.sh
# 输出:addons/gut/ 目录,带 .gitignore 忽略
#
# 为什么用 git clone 而非 vendor:跟随上游修复;GUT 9.2.0 体积小(~3MB),
# 在沙箱/CI 一次拉取只需 2-3 秒。

set -euo pipefail

GUT_VERSION="${GUT_VERSION:-v9.2.0}"
GUT_DIR="addons/gut"

if [ -d "${GUT_DIR}/gut" ] || [ -f "${GUT_DIR}/plugin.cfg" ]; then
  echo "[install_gut] GUT already present at ${GUT_DIR}, skipping"
  echo "[install_gut] to force reinstall, remove ${GUT_DIR} first"
  exit 0
fi

mkdir -p addons
echo "[install_gut] cloning GUT ${GUT_VERSION} into ${GUT_DIR}"
git clone --depth 1 --branch "${GUT_VERSION}" \
  https://github.com/bitwes/Gut.git "${GUT_DIR}"

# GUT 仓库自带 .git,我们只要源码,清掉以免污染
rm -rf "${GUT_DIR}/.git"

# 标记该目录不进版本控制(脚手架 .gitignore 已加 addons/gut/)
touch "${GUT_DIR}/.gitkeep"

echo "[install_gut] done. GUT version: $(cat ${GUT_DIR}/addons/gut/plugin.cfg 2>/dev/null | grep -E '^version' || echo 'unknown')"
