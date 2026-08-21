# Changelog

## [0.2.0] - M1.3 自动化测试框架

### 新增

- **三层测试体系**(验收 ①②③ 全部覆盖):
  - `tests/unit/` GUT 9.2.0 单测:`test_math_utils.gd`、`test_save_metadata.gd`
  - `tests/integration/` Godot 集成测试:场景加载、资源引用、项目配置
  - `tests/e2e/` Playwright 1.62 + Chromium,含沙箱可用的 mock Godot web export
- 测试可执行目标(给单测当 subject):
  - `core/utils/math_utils.gd` — 纯函数工具(浮点容差 / 钳制 / 网格吸附 / AABB)
  - `core/abstract/data/save_metadata.gd` — 数据层 v1 schema(M1.4 占位)
- 运行脚本 `tests/scripts/`:`install_gut.sh`、`run_unit.sh`、`run_integration.sh`、`run_e2e.sh`、`run_all.sh`
- CI 集成 `.github/workflows/test.yml`:GUT + Godot 集成 + Playwright 三个 job
- 文档:更新 `tests/README.md`,新增 `core/utils/README.md` 与 `core/abstract/data/README.md`

### 改动

- `tests/README.md` 重写为三层测试的运行手册
- `.gitignore` 屏蔽 `addons/` 与 `tests/e2e/{node_modules,screenshots,playwright-report,test-results,dist}`

### 验收对照

| 验收 | 实现 |
|---|---|
| ① `godot --headless --test` 可执行 GUT | GUT 9.2.0 + 22 个 unit test case + run_unit.sh 包装 |
| ② 集成测试通过场景脚本 | run_integration.gd + 3 个 test_*.gd(场景加载/资源引用/项目配置) |
| ③ Playwright 能打开 Web 导出页面并截屏 | web-bootstrap.spec.ts + mock-godot-export + screenshots/ |

### 沙箱验证范围

| 测试层 | 沙箱可跑 | 备注 |
|---|---|---|
| E2E | ✓ | mock web export 零依赖,screenshots/web-bootstrap-chromium.png 已生成 |
| Unit | ✗ | 沙箱无 Godot 引擎;本地/CI(Godot 4.3)回归 |
| Integration | ✗ | 同上 |

### 下游约束

- GUT 9.2.0 不入版本控制(`.gitignore` 的 `addons/`),由 `install_gut.sh` 拉取
- Playwright 版本与 `package.json` 锁定一致(1.62.1),CI 用 `npm ci`
- 真实 Godot web build 就绪后(M1.2 + M3.10),通过 `WILDEWOOD_E2E_BASE_URL` 切换 E2E 目标

## [0.1.0] - M1.1 项目脚手架

- Godot 4.3 + Git 仓库初始化
- 目录结构 `core/` / `scripts/` / `scenes/` / `assets/{art,audio,fonts}/` / `tests/{unit,integration}/`
- 主场景 `scenes/main.tscn` + `scripts/main.gd` 占位
- README、CHANGELOG、.gitignore、.editorconfig、.gitattributes
