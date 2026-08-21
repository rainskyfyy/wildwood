# scripts/ — GDScript 业务脚本

放置**非 autoload 的纯逻辑脚本**。这些脚本通常以 `extends` 一个 Godot 内置类型(Node / Node2D / Resource 等)或自定义类,被场景节点引用。

## 当前内容

| 文件        | 用途                                       |
|-------------|--------------------------------------------|
| `main.gd`   | 主场景 `scenes/main.tscn` 根节点脚本,M1.1 占位 |

## 命名约定

- 文件名 `snake_case.gd`(Godot 4 推荐风格)
- 类名 `PascalCase`(`class_name PlayerController`)
- 私有成员 `_leading_underscore`
- 信号 `past_tense_verb`(`health_changed`、`inventory_updated`)

## 计划中的脚本

- `player/player_controller.gd` — M2.1 WASD 移动
- `player/player_stats.gd` — M2.4 HP/饱腹/精神/温度
- `systems/gatherable.gd` — M2.2 采集系统
- `systems/placeable.gd` — M2.3 建造系统
- `ai/behavior_tree.gd` — M2.10 怪物 AI 行为树
- `ui/hud.gd` — M1.7-1.8 HUD 主控脚本

> 完整目录树待 M2.x 启动时建立。
