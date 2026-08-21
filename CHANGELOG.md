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

## M1.5 — 网络协议语义层(2026-08-20)

- 新增 Protobuf 协议定义:`core/abstract/network/proto/wildwood/v1/{common,c2s,s2c,wildwood}.proto`
- Go 端 codec + 注册表 + mock 管道:`go/{codec,mocks}/`(34 单测通过)
- GDScript 端手写 wire format codec:`gd/{wildwood_wire,common,c2s,s2c,net}.gd`
- GDScript mock 客户端/服务端(对标 Go mocks):`gd/wildwood_net.gd`
- 字节预算:worst-case WorldDelta(4 人+200 实体) = 2851 bytes < 4KB ✓
- Python 独立验证器:`python3/verify_wire.py`(17 个 wire format 用例)
- 真实传输层(NetClient/NetServer)stub:M1.9 由工作台搭建师补 WebSocket/UDP
- A/B 通用:协议与传输解耦,Godot 4.3 / Unity 6 双端可走同一 .proto
