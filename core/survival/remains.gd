extends Node
## 遗物管理器 (M2.5 验收 ③)
##
## 验收点 ③ 超时生成遗物坐标
##   - player_died 信号触发 → 生成遗物(remains_id, position, lifetime)
##   - remains_spawned 信号广播(供 HUD 坐标提示 + 队友拾取)
##   - remains_picked 信号(濒死玩家回城)
##   - remains_expired 信号(5 分钟后未拾取消失)
##
## 协议对齐:遗物坐标走 WorldDelta.player_status 或独立 WorldEvent
##   当前选:独立事件(更清晰,后续 M3.6 联机扩展更顺)
##
## 用法:
##   add_child(WildwoodRemainsManager.new())
##   SIG.player_died.connect(...) — 自动 spawn
class_name WildwoodRemainsManager

const C := preload("res://core/survival/death_constants.gd")
const SIG := preload("res://core/survival/survival_signals.gd")

var _next_id: int = 1
var _remains: Dictionary = {}  # remains_id -> { owner_id, position, expire_at_ms, picked }

func _ready() -> void:
	SIG.player_died.connect(_on_player_died)

func _process(_delta: float) -> void:
	if _remains.is_empty():
		return
	var now: int = Time.get_ticks_msec()
	var expired_ids: Array = []
	for rid in _remains.keys():
		var r: Dictionary = _remains[rid]
		if r["picked"]:
			continue
		if r["expire_at_ms"] <= now:
			expired_ids.append(rid)
	for rid in expired_ids:
		_remains.erase(rid)
		SIG.remains_expired.emit({"remains_id": rid})

func spawn_for_player(owner_id: String, position: Vector2) -> int:
	var rid: int = _next_id
	_next_id += 1
	var now: int = Time.get_ticks_msec()
	_remains[rid] = {
		"owner_id": owner_id,
		"position": position,
		"spawned_at_ms": now,
		"expire_at_ms": now + C.REMAINS_LIFETIME_MS,
		"picked": false,
	}
	SIG.remains_spawned.emit({
		"remains_id": rid,
		"owner_player_id": owner_id,
		"position": position,
		"world_pos": position,
		"lifetime_ms": C.REMAINS_LIFETIME_MS,
	})
	return rid

func pickup(remains_id: int, picker_id: String) -> bool:
	if not _remains.has(remains_id):
		return false
	var r: Dictionary = _remains[remains_id]
	if r["picked"]:
		return false
	r["picked"] = true
	var owner_id: String = r["owner_id"]
	_remains.erase(remains_id)
	SIG.remains_picked.emit({
		"remains_id": remains_id,
		"picker_id": picker_id,
		"owner_player_id": owner_id,
	})
	return true

func get_remains_count() -> int:
	return _remains.size()

func has_remains(remains_id: int) -> bool:
	return _remains.has(remains_id)

func get_remains_position(remains_id: int) -> Vector2:
	if not _remains.has(remains_id):
		return Vector2.ZERO
	return _remains[remains_id]["position"]

func _on_player_died(payload: Dictionary) -> void:
	# payload: { player_id, position, remains_id }
	# 分配实际 remains_id,补发 remains_spawned
	var owner_id: String = payload["player_id"]
	var pos: Vector2 = payload["position"]
	var rid: int = spawn_for_player(owner_id, pos)
	# 通知 DeathState 更新 remains_id(回填)
	# 真实链路:由 GameWorld 在 spawn 后把 rid 灌回 DeathState
	# 这里直接调:查 owner 的 DeathState,更新 remains_id
	# (省略 — 测试覆盖端到端)
	payload["remains_id"] = rid
