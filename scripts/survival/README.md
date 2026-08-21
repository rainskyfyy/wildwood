# scripts/survival — Godot 端 M2.4 生存属性镜像

## 文件

- `survival_formulas.gd` — 静态公式类,镜像 Python 端 `core/abstract/survival/modifiers.py`
- `survival_system.gd` — 运行时节点,30Hz `_physics_process` 推进,镜像 Python 端 `core/abstract/survival/tick.py`

## 与 Python 实现的关系

**唯一真相源是 Python 端** (`core/abstract/survival/`)。GDScript 端做"公式镜像",两份实现必须保持同步:

- 常量值(`CRITICAL_THRESHOLD` / `TEMP_FREEZING` / 衰减速率 等)
- 公式结构(多因子叠加 / 牛顿冷却 / HP 再生条件)

**修改公式前**:
1. 先在 Python 端改 + 跑 pytest 通过
2. 然后同步到 GDScript 端
3. 最后跑 GUT 测试(等 M2.1 集成时建)

## 接入点

### M2.1 移动控制器

```gdscript
# 在玩家节点 update 中:
var modifier: float = survival_node.get_speed_modifier()
position += input_dir * base_speed * modifier * delta
```

### M2.5 死亡监听

```gdscript
if survival_node.is_dead:
    emit_signal("player_died", survival_node)
```

### UI 警示动效

```gdscript
# 任务验收 ②:任意维度 < 30% 触发警示
if survival_node.is_critical():
    show_warning_anim()
```

### 幻象 shader

```gdscript
# 任务验收 ④:精神 < 30% 启用
if survival_node.should_show_illusion():
    enable_illusion_shader()
```

## 测试

- Python 端 94 个单测通过(无需 Godot)
- GUT 端测试:等 M2.1 移动控制器集成时建(setup Godot + GUT CI 较重,本任务不重复)
