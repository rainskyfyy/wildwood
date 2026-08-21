# Wildwood 美术资产 (assets/art)

存放游戏所有美术资产（M2.14a + M2.14b 批次），按用途分类。

## 目录结构

| 目录 | 用途 | 状态 |
|---|---|---|
| `hero/` | 主角动画 | 占位 — 28 帧 hero zip 待补 |
| `monsters/` | 怪物动画（bat / treant / spider / merm / hound） | 占位 — 5 个 20 帧 zip 待补 |
| `spider_repaint/` | 蜘蛛 32×32 repaint v0 | ✅ 已入库 (M2.14a) |
| `resources/` | 10 项基础采集资源 PNG | ✅ 28 项已入库 (M2.14b) |
| `tools/` | 5 项基础工具 PNG | ✅ 已入库 (M2.14b) |
| `buildings/` | 5 项基础建筑 PNG | ✅ 已入库 (M2.14b) |
| `ui_monsters/` | 8 张怪物图鉴 PNG | ✅ 已入库 (M2.14b) |
| `metadata/` | metadata.json + 报告 | ✅ M2.14a + M2.14b 已入库 |

## 来源

- 飞书云盘文件夹 `HQgHfhFhVlr73VdqTeuc05kYnJb`（M2.14a 8 个 zip）
- 飞书云文档 `J7SOd67S3o9gLixzRIocA6APn0f`（M2.14b 28 张 PNG）

## 已知限制

- 6 个 > 100MB 的帧动画 zip（hero + 5 monsters）受 lark-cli 100MB 响应体硬限制，**本批无法自动下完**。需后续通过 Range 分片或人工取回后补齐。
- M2.14b 的 28 张 PNG 是 Seedream V4.5 生成的概念稿（含 AI 笔触），**不直接满足 24 色板 + 像素硬边**，需 M1.13 Aseprite 工作流重建为 .ase 源文件。

## backfill 时间

2026-08-21
