# 更新日志

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已计划
- M1.2 CI/CD 雏形
- M1.3 GUT + Playwright 测试框架
- M1.4-1.6 三层抽象接口(数据 / 网络 / 资源元数据)
- M1.9-1.11 房间服务 + WebSocket 接入
- M1.12-1.13 5 张样稿 + Aseprite 工作流

## [0.1.0] - 2026-08-20

### 新增
- M1.1 项目初始化:Godot 4.3 工程骨架 + Git 仓库
- 目录结构:`core/` / `scripts/` / `scenes/` / `assets/` / `tests/`
- `project.godot` 主配置(含 4.3 feature tag、WASD 输入映射、像素 snapping、6 层渲染)
- `icon.svg` 占位图标(柴火主题,待 M1.12 AI 画师替换)
- `scenes/main.tscn` + `scripts/main.gd` 主入口占位
- `.gitignore` / `.gitattributes` / `.editorconfig` 工程配置
- `LICENSE` MIT
- 各子目录 `README.md` 文档
- 本 `CHANGELOG.md`

[Unreleased]: https://example.com/wildwood/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/wildwood/releases/tag/v0.1.0
