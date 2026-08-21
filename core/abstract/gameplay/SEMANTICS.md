# LMB 智能判别 语义对齐表 (Python ↔ GDScript)

> M2.1 验收:Python 端 `tests/unit/test_lmb_decide.py` 19 个测试全过是单一真相源;
> GDScript 端 `lmb_decide.gd` 必须按本表 1:1 实现。沙箱无 Godot 二进制,CI 跑 GUT 时
> 由工作台搭建师(M1.2)执行 GUT 等价测试。

## 规则对照

| # | 规则 | Python 实现 | GDScript 实现 | Python 测试 | GUT 等价 |
|---|------|------------|------------|------------|---------|
| 1 | 无候选 → MOVE 到点击点 | `decide_lmb_action` 末尾 fallback | `decide` 末尾 `return {"type": TYPE_MOVE, ...}` | `test_decide_no_candidate_returns_move` | `test_decide_no_candidate_returns_move` |
| 2 | 攻击射程内最近 attack → ATTACK | `_nearest_in_range(..., ATTACK, ctx.attack_range)` | `_nearest_in_range(..., TTYPE_ATTACK, attack_range)` | `test_decide_close_attack_target_returns_attack` | 同名 |
| 3 | 采集射程内最近 gather → GATHER | `_nearest_in_range(..., GATHER, ctx.gather_range)` | `_nearest_in_range(..., TTYPE_GATHER, gather_range)` | `test_decide_close_gather_target_returns_gather` | 同名 |
| 4 | ATTACK 优先于 GATHER | 规则 1 排在规则 2 之前 | 同上 | `test_decide_mixed_targets_prefers_attack` | 同名 |
| 5 | 0 候选 + 越界点击 → MOVE(纯逻辑不卡碰撞) | fallback 路径 | fallback 路径 | `test_acc05_no_candidate_unreachable_click_returns_move` | 同名 |
| 6 | 距离 > 移动射程 + 目标在攻击射程外 → MOVE | 射程检查:target 在 attack_range 外,无命中 | 同上 | `test_acc06_far_attack_target_in_attack_range_returns_move` | 同名 |
| 7 | 距离 > 移动射程 + 目标在采集射程外 → MOVE | 同 6,换 gather_range | 同上 | `test_acc07_far_gather_target_in_gather_range_returns_move` | 同名 |
| 8 | 多个 gather 选最近 | `_nearest_in_range` 严格 `<= best_d` 单调 | 同上 | `test_acc08_multiple_gather_picks_nearest` | 同名 |
| 9 | 多个 attack 选最近 | 同 8 | 同上 | `test_acc09_multiple_attack_picks_nearest` | 同名 |
| 10 | 攻击目标刚好在 attack_range 边界外 → MOVE | `<= best_d` 严格边界 | 同上 | `test_acc10_attack_just_outside_range_returns_move` | 同名 |
| 边 1 | 距离 0(完全重合) → ATTACK/GATHER | `<= best_d=0` 命中 | 同上 | `test_edge_player_on_target_distance_zero` | 同名 |
| 边 2 | 负坐标区域 | 欧几里得天然支持 | `Vector2.distance_to` 支持 | `test_edge_negative_coordinates` | 同名 |
| 边 3 | 浮点容差 1.4999 vs 1.5 | `<= best_d=1.5` 命中 | `<= best_d=1.5` 命中 | `test_edge_floating_point_just_inside_range` | 同名 |
| 边 4 | 浮点容差 1.5001 vs 1.5 → MOVE | `<= best_d=1.5` 不命中 | 同上 | `test_edge_floating_point_just_outside_range` | 同名 |
| 边 5 | 空 candidates + 负向点击 → MOVE | fallback | fallback | `test_edge_empty_candidates_with_negative_click` | 同名 |
| 性 | 200 候选 × 1000 次 p99 < 1ms | O(n) 线性 | 同上 | `test_decide_perf_under_1ms_p99_with_200_candidates` | GUT 不强制(性能靠 GDScript JIT) |

## 类型映射

| Python | GDScript | 说明 |
|--------|----------|------|
| `TargetType.GATHER/ATTACK/NONE` | `LmbDecide.TTYPE_GATHER/ATTACK/NONE` (String 常量) | GDScript 用字符串代替 Enum,保持 1:1 |
| `ActionType.MOVE/ATTACK/GATHER` | `LmbDecide.TYPE_MOVE/ATTACK/GATHER` | 同上 |
| `Target` dataclass | `Dictionary {id, pos: Vector2, type: String}` | GDScript 无原生 dataclass |
| `Action` dataclass | `Dictionary {type, target_pos: Vector2 \| null, target_id: String \| null}` | 同上 |
| `DecideContext` dataclass | `Dictionary {move_range, attack_range, gather_range}` | 同上 |
| `Tuple[float, float]` | `Vector2` | 引擎内坐标统一 Vector2 |

## 默认参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `move_range` | 4.0 米 | 玩家单次可下达的移动距离(米) |
| `attack_range` | 2.0 米 | 攻击射程 |
| `gather_range` | 1.5 米 | 采集射程 |

## 距离度量

Python 端:`math.sqrt(dx*dx + dy*dy)`,即欧几里得。
GDScript 端:`Vector2.distance_to`,即欧几里得。
两者语义一致,无 < vs ≤ 差异。
