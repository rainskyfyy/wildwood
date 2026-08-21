# Crafting — Python ↔ GDScript 语义对齐

本文档是 M2.9 合成系统在 A 线(Godot 4.3)上的双语对齐契约。
**两侧必须严格遵守,任何字段名/语义/返回结构变化必须先改本文档再改代码。**

## 1. 模块结构

| 层 | Python | GDScript |
|---|---|---|
| Schema | `core/abstract/crafting/schemas.py` | (无,GDScript 用 Dictionary + `_validate_recipe` 校验) |
| RecipeBook | `core/abstract/crafting/recipe_book.py` | (无,生产时 Godot 端从 JSON/`.tres` 加载;参考 M1.5 的 codec 模式) |
| Inventory 抽象 | `core/abstract/crafting/inventory_view.py` (`InventoryView` Protocol) | Dictionary 直传(`{item_id: count}`) |
| Station 抽象 | `core/abstract/crafting/station_probe.py` (`StationProbe` Protocol) | Dictionary 直传(`{station_name: bool}`) |
| 引擎 | `core/abstract/crafting/crafting_engine.py` (`CraftingEngine`) | `core/abstract/crafting/crafting.gd` (`WildwoodCrafting`) |

**抽象差异说明**:Python 端用 Protocol + runtime_checkable 是为了 M2.2/M2.3 接入时的可替换性;
GDScript 端无 Protocol 概念,直接用 Dictionary 透传 inventory/station — Godot 端代码负责
把 Player 自身的 Inventory / Building 状态序列化为 Dictionary 传入。

## 2. 顶层 API 对齐

| Python | GDScript | 一致性 |
|---|---|---|
| `CraftingEngine().check_can_craft(recipe, inventory, station) -> CheckResult` | `WildwoodCrafting.check_can_craft(recipe, inventory, station_state) -> Dictionary` | ✓ 字段一一对应 |
| `CraftingEngine().craft(recipe, inventory, station) -> CraftingResult` | `WildwoodCrafting.craft(recipe, inventory, station_state) -> Dictionary` (返回 CraftResult dict) | ✓ + `apply_craft_result(inventory, result)` 辅助应用 |
| `CraftingEngine().get_ui_state(recipe, inventory, station) -> dict` | `WildwoodCrafting.get_ui_state(recipe, inventory, station_state) -> Dictionary` | ✓ 完全对齐 |

**GDScript 端额外提供**:
- `apply_craft_result(inventory, craft_result) -> bool`:把 `craft()` 返回的结果原子应用到 inventory Dictionary(扣 + 加)。GDScript 端不直接在 `craft()` 里 mutate inventory,因为 inventory 是 Dictionary 引用传 — 解耦后可让调用方决定何时 commit(类似事务)。Python 端则直接 mutate Protocol 对象(因为 Python 端有完整对象模型)。

## 3. Station 标识

| Python | GDScript const | 值 |
|---|---|---|
| `StationType.NONE` | `STATION_NONE` | `"none"` |
| `StationType.WORKBENCH` | `STATION_WORKBENCH` | `"workbench"` |
| `StationType.COOKPOT` | `STATION_COOKPOT` | `"cookpot"` |

`recipe.station` 在 Python 端是 `StationType` 枚举;在 GDScript 端是 `String`,值与上表严格一致。

## 4. Block reason 标识(无工作站时 check 返的原因)

| Python key | GDScript const | UI 中文物文(`get_ui_state` 返) |
|---|---|---|
| `"requires_workbench"` | `BLOCK_REQUIRES_WORKBENCH` | `"需要工作台"` |
| `"requires_cookpot"` | `BLOCK_REQUIRES_COOKPOT` | `"需要烹饪锅"` |
| `None` / 通过 | `""` (空字符串) | `""` (空字符串) |

## 5. CheckResult / craft / UI state 字段对齐

### 5.1 `check_can_craft` 返回

| Python (CheckResult) | GDScript (Dictionary) | 类型 |
|---|---|---|
| `can_craft: bool` | `can_craft: bool` | 同步 |
| `missing: Tuple[Ingredient, ...]` | `missing: Array[Dictionary]` | 同步(内层 dict 字段见下) |
| `blocked: Optional[str]` (None/keys) | `blocked: String` (`""`/keys) | 同步(None → "") |
| `station_required: StationType` | `station_required: String` | 同步(枚举 → 字符串) |

**missing 内层 dict 字段**:
| Python (Ingredient) | GDScript (Dictionary) |
|---|---|
| `item_id: str` | `item_id: String` |
| `count: int` (缺的**数量**) | `count: int` (缺的**数量**) |

### 5.2 `craft` 返回

| Python (CraftingResult) | GDScript (Dictionary) |
|---|---|
| `recipe_id: str` | `recipe_id: String` |
| `produced: Tuple[Ingredient, ...]` (长度 1) | `produced: Array[Dictionary]` (长度 1) |
| `consumed: Tuple[Ingredient, ...]` | `consumed: Array[Dictionary]` (与 recipe.ingredients 一致) |

**produced / consumed 内层 dict 字段**:
| Python (Ingredient) | GDScript (Dictionary) |
|---|---|
| `item_id: str` | `item_id: String` |
| `count: int` | `count: int` |

### 5.3 `get_ui_state` 返回

| Python (dict) | GDScript (Dictionary) |
|---|---|
| `recipe_id: str` | `recipe_id: String` |
| `can_craft_now: bool` | `can_craft_now: bool` |
| `craftable_button_enabled: bool` | `craftable_button_enabled: bool` |
| `missing_materials: List[dict]` | `missing_materials: Array[Dictionary]` |
| `blocked_reason: Optional[str]` (中文物文) | `blocked_reason: String` (中文物文,空表示通过) |
| `station_required: str` (StationType.value) | `station_required: String` |

**missing_materials 内层 dict 字段**:
| Python | GDScript |
|---|---|
| `item_id: str` | `item_id: String` |
| `label: str` (中文) | `label: String` (中文) |
| `needed: int` | `needed: int` |
| `have: int` | `have: int` |
| `missing: int` (冗余 = needed - have) | `missing: int` |

## 6. 错误处理对齐

| 失败场景 | Python | GDScript |
|---|---|---|
| recipe 不是合法结构 | `ValueError` | `push_error` + `assert(false)` |
| 检查不通过时 craft | `raise CraftingError(...)` | `push_error(...)` + `return null` |
| 中途扣材料失败 | `raise CraftingError(...)` (已回滚) | (GDScript 端不在 craft 内 mutate,无回滚场景 — 由 `apply_craft_result` 的原子性保证) |
| 加产出失败(背包满) | `raise CraftingError(...)` (已回滚) | (同上,`apply_craft_result` 假定能容纳;否则上层应预先检查) |

**GDScript 端不抛异常的策略**:GDScript 调试期可看 `push_error`,生产期上层用 `if result == null` 判失败。Python 端用异常是为了契约化失败 — `CraftingError` 携带 reason,M2.2/M2.3 集成时上层 catch 即可。

## 7. 性能契约

| 操作 | Python 实测(p99) | GDScript 预算 | 验收 ③ 目标 |
|---|---|---|---|
| 单次 `craft()` | 0.014 ms | < 50 ms | < 400 ms |
| 34 配方全表 `check_can_craft` | 0.093 ms | < 50 ms | < 400 ms |
| 大库存(50 item)`craft()` | 0.010 ms | < 50 ms | < 400 ms |

GDScript 端不实际跑(沙箱无 Godot binary),但内部循环结构与 Python 端 1:1 翻译,性能应不低于 Python 8x。如未来 Godot 集成后发现 GDScript 端 p99 > 50 ms,优先排查 inventory Dictionary 访问(可换 `Object` 持有数组优化)。

## 8. 集成示例(参考,M2.2/M2.3/M2.13 接入用)

```gdscript
# 在 HUD 节点上
const Crafting = preload("res://core/abstract/crafting/crafting.gd")

@onready var recipe_book = preload("res://content/recipe_book.gd").new()

func _on_craft_button_pressed(recipe_id: String) -> void:
    var recipe: Dictionary = recipe_book.find_by_id(recipe_id)
    var inventory: Dictionary = player.get_inventory_dict()  # {wood: 12, ...}
    var station_state: Dictionary = world.get_nearby_stations(player.global_position)  # {workbench: true, cookpot: false}
    var result = Crafting.craft(recipe, inventory, station_state)
    if result == null:
        return  # 失败:push_error 已打
    if not Crafting.apply_craft_result(inventory, result):
        push_error("inventory full, rollback")
        return
    refresh_inventory_ui()
    refresh_crafting_panel()
    show_toast("合成成功: " + recipe["name"])
```

## 9. 变更记录

- 2026-08-20:初版(M2.9),与 Python 端 commit `da82673` 严格对齐
