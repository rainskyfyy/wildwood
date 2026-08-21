extends Node
class_name WildwoodCameraTransition
## M2.7 GDScript 引擎层 — 群系切换时相机过渡状态机(验收 ③)
##
## 状态机:
##   IDLE (0)
##     → TRANSITION_OUT (1, 250ms, alpha 1→0)
##     → SWAP (2, 0ms,瞬间切换 chunk 内容)
##     → TRANSITION_IN (3, 250ms, alpha 0→1)
##     → IDLE
##
## 总时长 = 250 + 0 + 250 = 500ms(验收 ③)
## 验收:总时长 ∈ [480ms, 520ms](±20ms 容差,留 1 帧误差空间)
##
## 触发:从群系 A 中心移动到群系 B 中心时调用 start_transition()

const _C := preload("res://core/biome_runtime/WildwoodBiomeConstants.gd")

var _state: int = _C.CameraTransitionState.IDLE
var _elapsed_ms: int = 0                  # 当前段已用时
var _total_elapsed_ms: int = 0            # 整个过渡已用时
var _from_biome: StringName = &""
var _to_biome: StringName = &""

# 信号(给相机/UI 订阅)
signal state_changed(new_state: int)
signal transition_started(from_biome: StringName, to_biome: StringName)
signal transition_finished(from_biome: StringName, to_biome: StringName, total_ms: int)
signal alpha_changed(alpha: float)


func _init() -> void:
	_state = _C.CameraTransitionState.IDLE


## 启动群系切换过渡
## 仅当 from != to 时启动;若 from == to,保持 IDLE
func start_transition(from_biome: StringName, to_biome: StringName) -> void:
	if from_biome == to_biome:
		return
	if _state != _C.CameraTransitionState.IDLE:
		push_warning("WildwoodCameraTransition: 已有过渡进行中,忽略新请求")
		return

	_from_biome = from_biome
	_to_biome = to_biome
	_elapsed_ms = 0
	_total_elapsed_ms = 0
	_state = _C.CameraTransitionState.TRANSITION_OUT
	state_changed.emit(_state)
	transition_started.emit(from_biome, to_biome)
	alpha_changed.emit(1.0)


## 每帧推进(delta 单位:秒)
func _process(delta: float) -> void:
	if _state == _C.CameraTransitionState.IDLE:
		return
	advance(delta * 1000.0)


## 推进指定毫秒数(可被测试直接驱动,不依赖帧率)
func advance(delta_ms: float) -> void:
	if _state == _C.CameraTransitionState.IDLE:
		return
	if delta_ms <= 0.0:
		return

	_elapsed_ms += int(delta_ms)
	_total_elapsed_ms += int(delta_ms)

	match _state:
		_C.CameraTransitionState.TRANSITION_OUT:
			# alpha 1 → 0
			var a: float = 1.0 - float(_elapsed_ms) / float(_C.CAMERA_TRANSITION_HALF_MS)
			alpha_changed.emit(clamp(a, 0.0, 1.0))
			if _elapsed_ms >= _C.CAMERA_TRANSITION_HALF_MS:
				_elapsed_ms = 0
				_state = _C.CameraTransitionState.SWAP
				state_changed.emit(_state)

		_C.CameraTransitionState.SWAP:
			# 瞬间切换(0 ms),立即进入 IN
			_elapsed_ms = 0
			_state = _C.CameraTransitionState.TRANSITION_IN
			state_changed.emit(_state)
			alpha_changed.emit(0.0)

		_C.CameraTransitionState.TRANSITION_IN:
			var a: float = float(_elapsed_ms) / float(_C.CAMERA_TRANSITION_HALF_MS)
			alpha_changed.emit(clamp(a, 0.0, 1.0))
			if _elapsed_ms >= _C.CAMERA_TRANSITION_HALF_MS:
				# 过渡完成
				_state = _C.CameraTransitionState.IDLE
				_elapsed_ms = 0
				state_changed.emit(_state)
				alpha_changed.emit(1.0)
				transition_finished.emit(
					_from_biome, _to_biome, _total_elapsed_ms
				)


## 当前状态查询
func get_state() -> int:
	return _state


## 当前 alpha(0.0~1.0,给相机的 ColorRect 透明度用)
func get_alpha() -> float:
	match _state:
		_C.CameraTransitionState.IDLE:
			return 1.0
		_C.CameraTransitionState.TRANSITION_OUT:
			var a: float = 1.0 - float(_elapsed_ms) / float(_C.CAMERA_TRANSITION_HALF_MS)
			return clamp(a, 0.0, 1.0)
		_C.CameraTransitionState.SWAP:
			return 0.0
		_C.CameraTransitionState.TRANSITION_IN:
			var a: float = float(_elapsed_ms) / float(_C.CAMERA_TRANSITION_HALF_MS)
			return clamp(a, 0.0, 1.0)
	return 1.0


## 当前过渡已用总时长(ms)
func total_elapsed_ms() -> int:
	return _total_elapsed_ms


## 当前段已用时长(ms)
func segment_elapsed_ms() -> int:
	return _elapsed_ms


## 强制重置(紧急回退用,例如玩家死亡/读档)
func reset() -> void:
	_state = _C.CameraTransitionState.IDLE
	_elapsed_ms = 0
	_total_elapsed_ms = 0
	_from_biome = &""
	_to_biome = &""
	state_changed.emit(_state)
