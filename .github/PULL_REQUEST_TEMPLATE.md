## 描述

<!-- 简述这次 PR 改了什么、为什么 -->

## 改动类型

- [ ] 美术资产 (`assets/art/**`)
- [ ] 代码逻辑 (`src/**` / `tests/**`)
- [ ] 工具脚本 (`tools/**`)
- [ ] 文档 (`docs/**`)
- [ ] CI 配置 (`.github/**`)

## 美术资产（仅在 `assets/art/**` 改动时勾选）

- [ ] **PNG 资产 < 500KB ✅**（必填，CI `asset-budget` 守门）
- [ ] 角色单帧 ≤ 128×128
- [ ] 瓦片 ≤ 32×32
- [ ] UI 图标 ≤ 64×64
- [ ] 建筑 ≤ 256×256
- [ ] 强制索引色（color_type=3）
- [ ] 透明边已 trim
- [ ] 视觉 review 完成（无裁剪错误 / 无色彩丢失）

> 自动化校验：提交后 CI 会跑 `tools/check-asset-budget.py --github --ref ${{ github.sha }}`，
> 任一 PNG > 500KB 会让 `asset-budget` job 失败。请在本地先跑
> `python3 tools/check-asset-budget.py --root assets/art --analyze` 自检。

## 自检

- [ ] `node --check` 跑过改动的 `.js` 文件
- [ ] 相关 smoke test 通过（如 `m5.3-farming-smoke.mjs`）
- [ ] 文档同步更新（README / 路线图 / docs/）

## 关联任务

<!-- 关联 task ID / issue / 看板条目 -->

---

🤖 提交后 CI 会自动跑 `asset-budget` 守门，**PNG > 500KB 直接 fail**。
如需重导配置见 `docs/asset-slimming-plan.md` §2.1。
