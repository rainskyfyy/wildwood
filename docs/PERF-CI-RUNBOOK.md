# M3.10 perf-ci 真跑 + 4 项指标录入工作台 · Runbook

> **作者**：高级开发工程师
> **协作方**：工作台搭建师（主）/ 工程团队 PR reviewer
> **场景**：D1 perf-ci.yml 已在仓集成分支 commit `be3b274`；本 runbook 讲解从「push 触发 GH runner」到「4 项指标录到工作台 v2 验收指标 tab」的全流程。
> **重要修正**：本轮在沙箱内做了 dry-run，发现 2 个**真 bug** —— 见 §0。

---

## 0. 沙箱内 dry-run 发现 2 个 bug（必须先修再 push）

`/home/gem/.aily/workdir/task_7676068907652533178/artifacts/m3-10-integration/` 是上一轮抽出的副本，已在沙箱内修过并打包成 v2（见本目录 `m3-10-integration-v2/`）。**仓 `main` 分支 commit `be3b274` 上同样有这两个 bug**，push 前必须 amend。

### Bug-1: `perf-ci.yml` line 33 YAML mapping 解析失败

**症状**：用严格 YAML 解析器（如 PyYAML safe_load）报错：
```
yaml.scanner.ScannerError: mapping values are not allowed here
  in ".github/workflows/perf-ci.yml", line 33, column 47
```

**根因**：
```yaml
- name: Build Godot WebGL (export preset: Web)   # ← 冒号在裸标量里被当 mapping separator
```

**修法**：加引号
```yaml
- name: "Build Godot WebGL (export preset: Web)"
```

**严重程度**：中。GitHub Actions 自家 YAML parser 多数情况宽容，但 spec 严格时会偶发失败，且本工作流 line 33 是核心 build step。**建议直接修**。

### Bug-2: `aseprite-32px-check.mjs` ESM 模块用了 `require()`

**症状**：当 aseprite CLI 不在 PATH 时走 PNG 降级路径，崩在 line 36：
```
ReferenceError: require is not defined
  at readPNGSize (file://.../aseprite-32px-check.mjs:36:14)
  exit=2
```

**根因**：
```js
// scripts/aseprite-32px-check.mjs (ESM file!)
function readPNGSize(file) {
  const fs = require('node:fs');   // ← ESM 不能用 require
  ...
}
```

**修法**（已在本目录 v2 中应用）：
```js
import { execSync } from 'node:child_process';
import { readFileSync, readdir, stat } from 'node:fs';
import { readdir as readdirP } from 'node:fs/promises';
import { join, extname } from 'node:path';
...
function readPNGSize(file) {
  const buf = readFileSync(file);   // ← 改用顶层 import
  ...
}
async function walk(dir) {
  for (const ent of await readdirP(dir, { withFileTypes: true })) { ... }   // ← readdirP 避免重名
}
```

**严重程度**：**高**。`dawidd6/action-aseprite@v3` 任何一次安装失败（网络/version 问题）→ 降级 → 崩 → CI 红但不是真违规 → 误导 reviewer。

**沙箱验证（v2 已修）**：
```
==== Negative: 30x30 PNG (should FAIL exit 1) ====
违规：1
  ✗ /tmp/m3-10-badasset/bad30.png (30x30) — size-not-multiple-of-32
✗ 存在非 32px 倍数的资产，PR 阻断
exit=1   ← OK

==== Positive: only 32x32 and 64x64 (should PASS exit 0) ====
违规：0
✓ 全部资产 32px 合规
exit=0   ← OK
```

---

## 1. perf-ci 真实跑分（沙箱外执行）

### 1.1 前置条件

- 仓在 GitHub（`hisense/wildwood` 或自建组织）
- 分支：默认 `main`；perf-ci 触发：`pull_request` / `push` / `workflow_dispatch` 三种
- PR 跑通 workflow 需要 reviewer 通过基础 CI
- 工作流依赖：
  - `actions/checkout@v4`
  - `actions/setup-node@v4` (Node 20)
  - `dawidd6/action-aseprite@v3` (1.3.7)
  - `npm ci`（需要仓根目录有 `package.json` + `package-lock.json`）
  - `npm run build:web`（需要 Godot 4.3 已配置 web export preset）

### 1.2 触发方式

```bash
# 方式 1：push 触发（开发流）
git checkout feat/m3.10-perf-opt
git add .
git commit -m "fix(perf-ci): yaml quote + aseprite esm import"
git push origin feat/m3.10-perf-opt
# 然后在 GitHub 上开 PR 到 main

# 方式 2：手动触发（运营流）
# GitHub 网页 → Actions → perf-ci → Run workflow → 选择 main 分支
```

### 1.3 跑通判据

| 步骤 | 期望输出 | 失败动作 |
|---|---|---|
| Setup Node | Node 20.x | 检查 `.nvmrc` |
| Setup Aseprite CLI | 1.3.7 installed | 查 dawidd6/action-aseprite@v3 status |
| Build Godot WebGL | `build/web/index.html` + `.pck` + `.wasm` 存在 | 检查 `npm run build:web` 脚本 |
| Aseprite 32px check | "✓ 全部资产 32px 合规" | 看具体违规 PNG，按 R3/R4 规范修 |
| Bundle analysis | `总包 < 12288 KB ✓` + `首屏 < 4096 KB ✓` | 看 `bundle-report.json` top 50 找大文件 |
| LHCI 3 runs median | assertion 全 pass | 拉 LHCI report 看具体指标 |

### 1.4 拉取跑分数据

PR 跑完（25 分钟内）后，从 3 个源取数据：

**(a) bundle-report.json**（job step `Bundle analysis` 写出）
```bash
# GitHub UI: Actions → perf-ci run → Bundle analysis step → 右上下载 artifact
# 或 CLI:
gh run download <run-id> --name web-build
cat bundle-report.json
```
提取字段：
- `report.totalRawKB` → 工作台 `bundle` 卡 v 值（KB）
- `report.firstChunkKB` → 工作台 `firstChunk` 卡 v 值（KB）

**(b) LHCI 报告**（temporary-public-storage）
- URL 在 `Lighthouse CI` step 的输出日志里
- 提取：
  - `categories.performance.score * 100` → 工作台 `lighthouse` 卡 v 值
  - `audits['largest-contentful-paint'].numericValue`（ms）→ 记到 `lighthouse` 卡 note
  - `audits['first-contentful-paint'].numericValue`（ms）→ 记到 `lighthouse` 卡 note
  - `audits['total-blocking-time'].numericValue`（ms）→ 记到 `lighthouse` 卡 note

**(c) Godot build artifacts**（`web-build`，7 天留存）
- `build/web/index.pck` 大小可作 `bundle` 校核
- 抽样 `build/web/index.js` 验证 critical CSS 抽离后入口文件大小

---

## 2. 录入工作台 v2 验收指标 tab

### 2.1 工作台 4 张卡的字段口径（来自 `app.js` SAMPLE_METRICS）

| 卡 ID | 字段 | 标量 | 目标 | 单位 | 方向 | 取值源 |
|---|---|---|---|---|---|---|
| `lighthouse` | Performance 分数 | 数字 | 90 | /100 | higher-better ≥ 90 | LHCI `categories.performance.score * 100` |
| `firstPaint` | 首屏加载 | 数字 | 3 | s | lower-better ≤ 3 | LHCI LCP(ms) / 1000 推算，或 WebPageTest |
| `bundle` | 包体大小 | 数字 | 12288 | KB | lower-better ≤ 12288 | `bundle-report.json.totalRawKB` |
| `firstChunk` | 首屏懒加载 | 数字 | 4096 | KB | lower-better ≤ 4096 | `bundle-report.json.firstChunkKB` |

**注意**：工作台只有 4 张卡，**没有单独的 LCP/FCP 卡**。LCP/FCP 数值统一记在 `lighthouse` 卡的 `note` 字段里。

### 2.2 history 字段结构（录入弹窗期望）

```js
{
  t: '2026-08-20T19:33:00.000Z',   // ISO 8601 UTC
  v: 88,                            // 数值
  note: 'M3.10 D1：commit be3b274+v2 fix · LCP 2800ms FCP 1500ms TBT 180ms · src: lhci run #34',
  src: 'LHCI 临时公开存储'           // 来源标签（自由文本）
}
```

### 2.3 录入操作流程

工作台搭建师已在 v2 加了"录入新测量值"按钮（每张卡右上角），操作：

1. 浏览器打开工作台 `index.html`（本地或部署）
2. 切到"验收指标" tab
3. 每张卡 → 点"录入新测量值" → 弹窗填：
   - 数值（数字框）
   - 备注（textarea）
   - 来源（select 或 input）
4. 提交 → 自动 push 到 `state.metrics[id].history`
5. 状态自动重算：`metricStatus()` 派生 `ok/warn/fail/gray`

### 2.4 录入模板（D1 PR 跑通后复制粘贴）

```yaml
# lighthouse 卡（新历史）
t: 2026-08-20T<HH>:<MM>:00.000Z
v: <Performance.score * 100 整数>
note: "M3.10 D1 PR #<N> · LCP <LCP ms>ms FCP <FCP ms>ms TBT <TBT ms>ms · 4 assertion 全 pass · commit be3b274 + esm/yaml fix"
src: LHCI 临时公开存储 #<run-id>

# firstPaint 卡
t: 2026-08-20T<HH>:<MM>:00.000Z
v: <LCP ms / 1000，保留 2 位小数>
note: "M3.10 D1：折算自 LHCI LCP <LCP ms>ms"
src: LHCI 临时公开存储

# bundle 卡
t: 2026-08-20T<HH>:<MM>:00.000Z
v: <bundle-report.json.totalRawKB>
note: "M3.10 D1：commit be3b274 baseline · .pck <PCK KB>KB + .wasm <WASM KB>KB + 资源 <OTHERS KB>KB"
src: bundle-analyze.mjs ./build/web

# firstChunk 卡
t: 2026-08-20T<HH>:<MM>:00.000Z
v: <bundle-report.json.firstChunkKB>
note: "M3.10 D1：center chunk + index.html + critical CSS 总和"
src: bundle-analyze.mjs ./build/web
```

---

## 3. 沙箱 vs 真 GH runner 边界

| 任务 | 沙箱能做 | 真 GH runner 才能 | 谁负责 |
|---|---|---|---|
| 4 份文件 syntax 校验 | ✓ | — | 高级开发（已做） |
| YAML 严格 parse | ✓ | — | 高级开发（已做） |
| 负例 PNG 校验 | ✓ | — | 高级开发（已做） |
| 真 Lighthouse 跑分 | ✗（无 web 服务） | ✓ | 工程团队 PR |
| 真 .pck 包体分析 | ✗（无 build/web） | ✓ | 工程团队 PR |
| 真 32px 资产校验 | ✗（沙箱无 .ase/.png 资产） | ✓ | 工程团队 PR |
| 4 项数据录到工作台 | ✗（localStorage 客户端） | ✓ | 团队 leader / 用户浏览器 |

**结论**：D1 跑分数据从 PR GH Actions 来；高级开发负责**配置正确性 + 录入模板**，**不负责**真实跑分与录数据。

---

## 4. 工作台搭建师下一步动作

1. **修仓里 commit be3b274 的 2 个 bug**：
   - `perf-ci.yml` line 33 加引号
   - `aseprite-32px-check.mjs` ESM import 改造（用本目录 v2 副本覆盖）
   - 推荐新 commit `be3b275`（保持 be3b274 干净可审计），不 amend
2. **首次 dry-run**：合到 main 前开一个空 PR（仅含 CI 配置文件改动）跑一次 perf-ci，确认 9 步全过
3. **D1 跑通后**（估计 8/20 EOD 或 8/21 上午）：
   - 拉 `web-build` artifacts + `bundle-report.json` + LHCI 报告
   - 在工作台浏览器里按 §2.4 模板录 4 张卡
   - 录完在 M3.10 任务评论 @高级开发 + 用户确认
4. **可选改进**（非阻塞）：把本 runbook 摘要贴到工作台 `USAGE.md`「指标录入」段，让后续接手的人有 SOP

---

## 5. 验证清单（v2 副本已在沙箱跑通）

- [x] `node --check lighthouserc.js` OK
- [x] `node --check scripts/bundle-analyze.mjs` OK
- [x] `node --check scripts/aseprite-32px-check.mjs` OK
- [x] `yaml.safe_load(.github/workflows/perf-ci.yml)` 9 步全解析（修 `:` bug 后）
- [x] `bundle-analyze.mjs` 空目录 dry-run exit 0，输出 `bundle-report.json`
- [x] `aseprite-32px-check.mjs` 空目录 dry-run exit 0
- [x] `aseprite-32px-check.mjs` 负例（30x30 PNG）exit 1
- [x] `aseprite-32px-check.mjs` 正例（32x32 + 64x64 PNG）exit 0
- [x] 4 份文件与工作台 `app.js` SAMPLE_METRICS 4 项指标字段对齐
- [ ] 真 GH runner 跑通（需工程团队 PR）
- [ ] 4 项数据录到工作台（需用户在浏览器录）
