extends Node
## M2.5 整合容器 (死亡与复活 GameWorld)
##
## 把 DeathState × N / ReviveHandler / RemainsManager / HpBridge 串成
## 一个 4 人小队死亡与复活系统。
##
## 用法(简化版 — 真实 M2.x 接入时由 GameWorld 主场景调):
##   var world = WildwoodWorldM25.new()
##   add_child(world)
##   for pid in player_ids:
##       world.add_player(pid, Vector2(...))
##   # 主循环每帧:
##   world.update_alive_position(pid, pos)  # 来自 M2.1 移动
##   world.process(delta)
##
## 协议层(房间服务)与客户端共用这套接口,只是 DeathState 实例化的位置不同
class_name WildwoodWorldM25

const C := preload("res://core/survival/death_constants.gd")
const SIG := preload("res://core/survival/survival_signals.gd")
const HB := preload("res://core/survival/hp_provider.gd")
const DS := preload("res://core/survival/death_state.gd")
const RH := preload("res://core/survival/revive_handler.gd")
const RM := preload("res://core/survival/remains.gd")

var hp_bridge: WildwoodHpBridge = null
var revive_handler: WildwoodReviveHandler = null
var remains_manager: WildwoodRemainsManager = null

var _states: Dictionary = {}  # player_id -> WildwoodDeathState
var _spawn_positions: Dictionary = {}  # player_id -> Vector2 (初始 / 复活点)

func _ready() -> void:
	hp_bridge = WildwoodHpBridge.instance()
	revive_handler = WildwoodReviveHandler.new()
	add_child(revive_handler)
	remains_manager = WildwoodRemainsManager.new()
	add_child(remains_manager)

func add_player(player_id: String, spawn_position: Vector2) -> WildwoodDeathState:
	if _states.has(player_id):
		return _states[player_id]
	var st: WildwoodDeathState = WildwoodDeathState.new(player_id, spawn_position)
	add_child(st)
	st.bind_hp_bridge(hp_bridge)
	hp_bridge.register(player_id, C.MOCK_HP_INITIAL)
	revive_handler.register_state(st)
	_states[player_id] = st
	_spawn_positions[player_id] = spawn_position
	return st

func remove_player(player_id: String) -> void:
	if not _states.has(player_id):
		return
	var st: WildwoodDeathState = _states[player_id]
	st.unbind_hp_bridge()
	revive_handler.unregister_state(player_id)
	st.queue_free()
	_states.erase(player_id)
	_spawn_positions.erase(player_id)

func get_state(player_id: String) -> WildwoodDeathState:
	return _states.get(player_id, null)

func get_all_states() -> Dictionary:
	return _states.duplicate()

func update_alive_position(player_id: String, position: Vector2) -> void:
	revive_handler.update_alive_position(player_id, position)
	var st: WildwoodDeathState = _states.get(player_id, null)
	if st != null and st.is_alive():
		st.current_position = position

func force_hp_zero(player_id: String) -> void:
	var st: WildwoodDeathState = _states.get(player_id, null)
	if st != null:
		st.force_hp_zero()

func damage(player_id: String, amount: int) -> void:
	var st: WildwoodDeathState = _states.get(player_id, null)
	if st != null:
		st.take_damage(amount)

func get_snapshot() -> Array:
	# 供 WorldDelta 序列化使用
	# 返回: [{player_id, state, ghost_remaining_ms, position, remains_id}, ...]
	var snap: Array = []
	for pid in _states.keys():
		var st: WildwoodDeathState = _states[pid]
		snap.append({
			"player_id": pid,
			"state": st.get_state(),
			"is_alive": st.is_alive(),
			"is_ghost": st.is_ghost(),
			"is_dead": st.is_dead(),
			"ghost_remaining_ms": st.get_ghost_remaining_ms(),
			"position": st.current_position,
			"remains_id": st.remains_id,
		})
	return snap
