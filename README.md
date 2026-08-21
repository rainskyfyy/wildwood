# Wildwood

类饥荒生存游戏（M1-M3 联机完整版）— M3.10 perf-ci 集成仓

## 项目状态

- **里程碑**：M1 ✓ done（4 周）→ M2 ✓ done（6 周，提前 1 周收口）→ M3 在跑（6 周，38 人日）
- **本仓定位**：M3.10 性能优化（首屏 < 3s + 包体 < 12MB + Lighthouse ≥ 90）的 CI 集成
- **本仓内容**：4 份 perf-ci 配置 + 5 条代码优化（t-code-01/02/03/04/05 沙箱内 dry-run 验证通过）+ 4 份设计文档

## 仓结构

```
.github/workflows/perf-ci.yml      # GH Actions 9 步流水线
lighthouserc.js                    # LHCI 4 项 assertion (FCP/LCP/TBT/perf)
scripts/aseprite-32px-check.mjs    # 32px 网格校验 (ESM bug 已修)
scripts/bundle-analyze.mjs         # 包体分析 (main.pck 进 isFirst)
scripts/critical-css-extract.mjs   # t-code-05: critical CSS 抽离
scripts/split-pck.mjs              # t-code-02: .pck 拆分
scripts/lod/                       # t-code-04: 9 宫格 LOD 策略
addons/wildwood_perf/              # Godot 4.3 addons (post-export hook + 导出预设)
docs/m3-10/                        # 4 份设计文档
docs/PERF-CI-RUNBOOK.md            # perf-ci 完整 SOP
```

## 沙箱验证（已通过）

- `node --check` 3 份 JS ✓
- `yaml.safe_load` perf-ci.yml 9 步全解析 ✓
- `critical-css-extract.mjs` 2489B → 958B inline + 1301B async (38.5% / 61.5%) ✓
- `lod-memory-estimate.py` 11×11 节省 62.8% / 21×21 节省 89.8% ✓
- `split-pck.mjs` forest+spring main.pck=1078KB < 4MB ✓
- `aseprite-32px-check.mjs` 负例 30×30 → exit 1, 正例 32+64 → exit 0 ✓

## perf-ci 跑通路径

本仓根目录 push 到 GitHub → GH Actions 自动跑 9 步 perf-ci → 拉 3 源数据 → 工作台 v5 录 4 张卡 → mark done。

详见 [docs/PERF-CI-RUNBOOK.md](docs/PERF-CI-RUNBOOK.md) 与 [docs/m3-10/perf-ci-integration.md](docs/m3-10/perf-ci-integration.md)。

## 验收指标

- Lighthouse 性能 ≥ 90
- 首屏 LCP < 3000ms
- FCP < 1800ms
- TBT < 200ms
- 包体 ≤ 12MB
- 首屏懒加载 ≤ 4MB
