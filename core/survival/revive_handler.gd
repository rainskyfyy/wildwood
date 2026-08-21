extends Node
## 复活处理器 (M2.5 验收 ②)
##
## 验收点 ② 队友 10s 内接触复活
##   - 每帧检测所有 GHOST 玩家与所有 ALIVE 队友的距离
##   - 距离 < REVIVE_TOUCH_PX (48px = 1.5 网格) 即视为接触
##   - 接触立刻复活(不需按键,简化;后续可加 "按住 E" 1.5s 深度玩法)
##
## 接管者(reviver)规则:
##   1. reviver 不能是 ghost 自己
##   2. reviver 必须是 ALIVE 状态
##   3. 距离 ≤ 48px
##
## 用法:
##   add_child(WildwoodReviveHandler.new())
##   handler.register_state(ghost_player_death_state)
##   handler.register_state(alive_player_death_state)
##   handler.update_alive_position(player_id, position)  # 主循环每帧
class_name WildwoodReviveHandler

const C := preload("res://core/survival/death_constants.gd")

var _states: Dictionary = {}        # player_id -> WildwoodDeathState
var _alive_positions: Dictionary = {} # player_id -> Vector2
var _revivals_this_window: Array = []  # [(from_pid, to_pid, time_ms), ...] — 调试用

func register_state(state: WildwoodDeathState) -> void:
	_states[state.player_id] = state

func unregister_state(player_id: String) -> void:
	_states.erase(player_id)
	_alive_positions.erase(player_id)

func update_alive_position(player_id: String, position: Vector2) -> void:
	_alive_positions[player_id] = position

## 主循环每帧调用:检查所有 GHOST 玩家,看有没有 ALIVE 队友贴脸
func _process(_delta: float) -> void:
	if _states.is_empty():
		return
	var ghost_pids: Array = []
	for pid in _states.keys():
		var st: WildwoodDeathState = _states[pid]
		if st.is_ghost():
			ghost_pids.append(pid)
	for ghost_pid in ghost_pids:
		var ghost_st: WildwoodDeathState = _states[ghost_pid]
		for reviver_pid in _alive_positions.keys():
			if reviver_pid == ghost_pid:
				continue
			var reviver_pos: Vector2 = _alive_positions[reviver_pid]
			if ghost_st.try_revive(reviver_pid, reviver_pos):
				_revivals_this_window.append({
					"from": reviver_pid,
					"to": ghost_pid,
					"time_ms": Time.get_ticks_msec(),
				})
				# 一个 ghost 一次只能被一个人救,break 出去
				break

func get_revival_count() -> int:
	return _revivals_this_window.size()

func clear_revival_log() -> void:
	_revivals_this_window.clear()
