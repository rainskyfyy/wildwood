# Changelog

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已计划
- M1.2 CI/CD 雏形
- M1.6 资源元数据抽象
- M1.12-1.13 5 张样稿 + Aseprite 工作流

## [0.3.0] - 2026-08-20

### 新增(M1.10 客户端-服务端 WebSocket 连通)

- **Go 端 M1.10 验收测试**(`go/tests/m110_*.go`,4 个测试全过)
  - `TestM110_Heartbeat_RTT_Under1s` — 30 次 heartbeat,断言 max RTT < 1s,avg < 200ms(M1.10 验收 ①)
  - `TestM110_Heartbeat_WorksBeforeHandshake` — 协议层不强制握手→心跳顺序
  - `TestM110_Reconnect_AfterServerRestart` — 30s 窗口内重连到新 hub(M1.10 验收 ②)
  - `TestM110_Reconnect_GiveUpAfterWindow` — 30s 窗口内未恢复 → state=failed
- **Go e2eclient**(`go/cmd/e2eclient/main.go`,新)— 单进程 demo 工具:握手→心跳→模拟断网→重连

## [0.2.0] - 2026-08-20

### 新增(M1.3 自动化测试框架)

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

## [0.1.0] - 2026-08-20

- Godot 4.3 + Git 仓库初始化
- 目录结构 `core/` / `scripts/` / `scenes/` / `assets/{art,audio,fonts}/` / `tests/{unit,integration}/`
- 主场景 `scenes/main.tscn` + `scripts/main.gd` 占位
- README、CHANGELOG、.gitignore、.editorconfig、.gitattributes
