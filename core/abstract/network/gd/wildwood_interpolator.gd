## M3.1 GDScript 1:1 镜像 — Interpolator(100ms 校正插值 + 隐藏窗口)
##
## 权威源: core/abstract/network/python3/wildwood/interpolation.py
## SEMANTICS(必须与 Python 1:1):
##   1. display_pos_at(t_ms): 线性插值 start → target
##      - t_ms < start_ms: 钳位到 start
##      - start_ms ≤ t_ms ≤ start_ms + duration: 线性插值
##      - t_ms > start_ms + duration: 钳位到 target
##   2. is_hidden_at(t_ms): 0..min(duration, hide_duration) 隐藏
##   3. is_complete(t_ms): t ≥ start_ms + duration
##
## 集成: PlayerController 在收到 Correction 后:
##   var interp = WildwoodInterpolator.Interpolator.new(start, target, now_ms)
##   每帧 _process: pos = interp.display_pos_at(now_ms); visible = not interp.is_hidden_at(now_ms)
class_name WildwoodInterpolator
extends RefCounted

const WildwoodConstants = preload("res://core/abstract/network/gd/wildwood_constants.gd")


# ============================================================
# Interpolator
# ============================================================
class Interpolator:
	## 100ms 校正插值器(纯函数,无副作用)

	var start_x: float = 0.0
	var start_y: float = 0.0
	var target_x: float = 0.0
	var target_y: float = 0.0
	var duration_ms: int = 100
	var hide_duration_ms: int = 100
	var start_ms: int = 0

	func _init(p_start: Vector2, p_target: Vector2, p_start_ms: int,
			p_duration_ms: int = 100, p_hide_duration_ms: int = 100) -> void:
		start_x = p_start.x
		start_y = p_start.y
		target_x = p_target.x
		target_y = p_target.y
		duration_ms = p_duration_ms
		hide_duration_ms = p_hide_duration_ms
		start_ms = p_start_ms

	## 返回 t_ms 时刻应显示的位置(像素)
	func display_pos_at(t_ms: int) -> Vector2:
		var end: int = start_ms + duration_ms
		if t_ms <= start_ms:
			return Vector2(start_x, start_y)
		if t_ms >= end:
			return Vector2(target_x, target_y)
		# 进度 0..1
		var progress: float = float(t_ms - start_ms) / float(duration_ms)
		var x: float = start_x + (target_x - start_x) * progress
		var y: float = start_y + (target_y - start_y) * progress
		return Vector2(x, y)

	## t_ms 时刻是否应隐藏被校正实体
	##   - hide_duration ≤ duration: 0..hide_duration 隐藏
	##   - hide_duration > duration: 0..duration 隐藏(不能比完成还晚)
	func is_hidden_at(t_ms: int) -> bool:
		var hide_end: int = start_ms + min(hide_duration_ms, duration_ms)
		return t_ms < hide_end

	## t_ms 时刻校正是否完成
	func is_complete(t_ms: int) -> bool:
		return t_ms >= start_ms + duration_ms

	## 返回插值进度 0..1(钳位)
	func progress_at(t_ms: int) -> float:
		var p: float = float(t_ms - start_ms) / float(duration_ms)
		return clamp(p, 0.0, 1.0)
