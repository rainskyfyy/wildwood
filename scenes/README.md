# scenes/ — Godot 场景文件

放置 `.tscn`(场景)、`.tres`(资源)、`.gd` 附加脚本以外的纯数据文件。

## 当前内容

| 文件        | 用途                                        |
|-------------|---------------------------------------------|
| `main.tscn` | 主入口场景,M1.1 占位,挂载 `scripts/main.gd` |

## 计划中的场景

- `menu/main_menu.tscn` — M2.x 主菜单
- `world/forest.tscn` — M2.7 森林群系场景
- `world/desert.tscn` — M2.7 沙漠群系场景
- `world/swamp.tscn` — M2.7 沼泽群系场景
- `world/snow.tscn` — M2.7 雪山群系场景
- `ui/hud.tscn` — M1.7-1.8 HUD
- `ui/inventory.tscn` — M2.x 背包 + 合成
- `ui/codex.tscn` — M2.x 生物 / 物品图鉴

## 命名约定

- 场景根节点命名:PascalCase(`Main`, `Player`, `Hud`)
- 文件名:与根节点名一致 + `.tscn`(`main.tscn` / `hud.tscn`)
- 子场景复用:复杂 UI / 怪物 / 建筑应拆为可嵌套的子场景,降低单文件复杂度
