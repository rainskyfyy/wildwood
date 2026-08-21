extends RefCounted
class_name LmbDecide
## LMB 智能判别 (M2.1) — GDScript 薄包装,与 Python `core/abstract/gameplay/lmb_decide.py` 1:1 语义对齐。
##
## 用法:
##   var decide := LmbDecide.new()
##   var action: Dictionary = decide.decide(player_pos, candidates, click_pos, ctx)
##   # action: {type: "move"/"attack"/"gather", target_pos: Vector2, target_id: String}
##
## 设计:
##   - 零外部依赖,纯函数语义
##   - 距离度量:欧几里得,32 像素 = 1 米
##   - 优先级: ATTACK > GATHER > MOVE
##   - 射程内最近目标胜出;超出射程返 MOVE(让角色靠近)
##   - 详细规则 / 10 验收用例见 `tests/unit/test_lmb_decide.py` 与 `SEMANTICS.md`
##
## 与 Python 端 1:1 对齐的测试通过 SEMANTICS.md 列出,逐条验收。GUT 等价测试
## 在 CI 跑(沙箱无 Godot 二进制时跳过 GUT,只跑 Python 端)。

# 动作 / 目标 类型常量
const TYPE_MOVE: String = "move"
const TYPE_ATTACK: String = "attack"
const TYPE_GATHER: String = "gather"

const TTYPE_GATHER: String = "gather"
const TTYPE_ATTACK: String = "attack"
const TTYPE_NONE: String = "none"

# 默认上下文(米)
const DEFAULT_MOVE_RANGE: float = 4.0
const DEFAULT_ATTACK_RANGE: float = 2.0
const DEFAULT_GATHER_RANGE: float = 1.5


## LMB 智能判别主入口。
##
## Args:
##   player_pos: Vector2(米)
##   candidates: Array[Dictionary],每个元素: {id: String, pos: Vector2, type: String}
##   click_pos: Vector2(米)
##   ctx: Dictionary,可选 — {move_range, attack_range, gather_range}。None 时用默认。
##
## Returns:
##   Dictionary:{type: String, target_pos: Vector2 | null, target_id: String | null}
static func decide(
	player_pos: Vector2,
	candidates: Array,
	click_pos: Vector2,
	ctx: Dictionary = {}
) -> Dictionary:
	var move_range: float = ctx.get("move_range", DEFAULT_MOVE_RANGE)
	var attack_range: float = ctx.get("attack_range", DEFAULT_ATTACK_RANGE)
	var gather_range: float = ctx.get("gather_range", DEFAULT_GATHER_RANGE)

	# 1. 攻击优先级最高(射程内最近)
	var atk: Dictionary = _nearest_in_range(player_pos, candidates, TTYPE_ATTACK, attack_range)
	if not atk.is_empty():
		return {"type": TYPE_ATTACK, "target_pos": atk["pos"], "target_id": atk["id"]}

	# 2. 其次采集(射程内最近)
	var gat: Dictionary = _nearest_in_range(player_pos, candidates, TTYPE_GATHER, gather_range)
	if not gat.is_empty():
		return {"type": TYPE_GATHER, "target_pos": gat["pos"], "target_id": gat["id"]}

	# 3-5. 默认 MOVE 到点击点
	return {"type": TYPE_MOVE, "target_pos": click_pos, "target_id": null}


## 在 candidates 中取指定 type 且距离 ≤ max_range 的最近目标。
## 返回 {} 表示无候选。
static func _nearest_in_range(
	player_pos: Vector2,
	candidates: Array,
	target_type: String,
	max_range: float
) -> Dictionary:
	var best: Dictionary = {}
	var best_d: float = max_range
	for c in candidates:
		if c.get("type", TTYPE_NONE) != target_type:
			continue
		var d: float = player_pos.distance_to(c["pos"])
		if d <= best_d:
			best_d = d
			best = c
	return best
