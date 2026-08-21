## M3.1 GDScript 1:1 镜像 — Predictor(客户端预测器)
##
## 权威源: core/abstract/network/python3/wildwood/prediction.py
## 数据流:
##   Predictor ─predict→ Input(seq, dx, dy, t_ms)
##             ←reconcile(auth_pos, acked_seqs)─ ReconciliationResult
##
## SEMANTICS(必须与 Python 1:1):
##   1. predict(): 立即本地应用输入,返回 Input(seq, dx, dy, t_ms)
##   2. reconcile(auth_pos, acked_seqs):
##      a. 记录 _current_pos_before_reconcile
##      b. 丢弃已 ack 输入,按 seq 升序排
##      c. 从 auth_pos 重新应用 remaining(re-simulate)
##      d. 比较 re-simulated 与 _current_pos_before_reconcile
##      e. 偏差 > 32px → Correction(触发插值);否则 NoCorrection
##      f. 总是把 _current_pos 切到 re_simulated(下次 predict 基础正确)
##
## 集成: scripts/player_controller.gd 在 M3.1 task 9 接入。
class_name WildwoodPredictor
extends RefCounted

const WildwoodConstants = preload("res://core/abstract/network/gd/wildwood_constants.gd")


# ============================================================
# 值对象 / 结果类型
# ============================================================
class InputRecord:
	## 一次客户端输入记录(本地缓存,等服务器 ack)
	var seq: int = 0
	var dx: float = 0.0
	var dy: float = 0.0
	var t_ms: int = 0

	func _init(p_seq: int, p_dx: float, p_dy: float, p_t_ms: int) -> void:
		seq = p_seq
		dx = p_dx
		dy = p_dy
		t_ms = p_t_ms


class Correction:
	## 触发校正(偏差 > 32px)
	var start_pos_x: float = 0.0
	var start_pos_y: float = 0.0
	var target_pos_x: float = 0.0
	var target_pos_y: float = 0.0
	var delta_px: float = 0.0

	func _init(p_sx: float, p_sy: float, p_tx: float, p_ty: float, p_d: float) -> void:
		start_pos_x = p_sx
		start_pos_y = p_sy
		target_pos_x = p_tx
		target_pos_y = p_ty
		delta_px = p_d


class NoCorrection:
	## 无校正(偏差 ≤ 32px 或服务端与本地一致)
	pass


# ============================================================
# Predictor
# ============================================================
class Predictor:
	## 单玩家预测器。维护本地预测位置 + 未 ack 输入队列。

	var _speed: float
	var _tile_px: int
	var _dt: float
	var _current_pos_x: float = 0.0
	var _current_pos_y: float = 0.0
	var _next_seq: int = 1
	var pending: Array = []  # Array[InputRecord]
	var _current_pos_before_reconcile_x: float = 0.0
	var _current_pos_before_reconcile_y: float = 0.0

	func _init(speed_mps: float = 4.0, tile_px: int = 32, dt_s: float = 1.0 / 60.0) -> void:
		_speed = speed_mps
		_tile_px = tile_px
		_dt = dt_s

	# ----- 公共属性 -----

	func current_pos() -> Vector2:
		return Vector2(_current_pos_x, _current_pos_y)

	func current_pos_before_reconcile() -> Vector2:
		## 上一次 reconcile 调用前的 current_pos(Correction.start_pos 用)
		return Vector2(_current_pos_before_reconcile_x, _current_pos_before_reconcile_y)

	func get_next_seq() -> int:
		return _next_seq

	# ----- 公共方法 -----

	func predict(dx: float, dy: float) -> InputRecord:
		## 本地立即应用输入,返回待发送的 InputRecord(seq, dx, dy, t_ms)
		## 调用方负责把 InputRecord 序列化后通过 C2S_PlayerInput 发到服务端
		var seq: int = _next_seq
		_next_seq += 1
		# 归一化(8 方向,对角线不超速)
		var normalized: Vector2 = _normalize(dx, dy)
		# 应用步长
		var step: float = _speed * _tile_px * _dt
		_current_pos_x += normalized.x * step
		_current_pos_y += normalized.y * step
		var inp := InputRecord.new(seq, normalized.x, normalized.y, _now_ms())
		pending.append(inp)
		return inp

	## 收到 S2C_WorldDelta(权威位置 + 已 ack seq 列表)后调用
	## 返回 Object(Correction 或 NoCorrection),前端根据结果决定:
	##   - NoCorrection → 不动
	##   - Correction → 启动 100ms 插值 + 隐藏
	func reconcile(auth_pos: Vector2, acked_seqs) -> Object:
		# acked_seqs: Array[int] 或 PackedInt32Array
		var acked: Dictionary = {}
		if acked_seqs is Array:
			for s in acked_seqs:
				acked[int(s)] = true
		elif acked_seqs is PackedInt32Array:
			for i in range(acked_seqs.size()):
				acked[int(acked_seqs[i])] = true
		# 1. 记录校正起点
		_current_pos_before_reconcile_x = _current_pos_x
		_current_pos_before_reconcile_y = _current_pos_y
		# 2. 丢弃已 ack,按 seq 升序排
		var remaining: Array = []
		for pi in pending:
			if not acked.has(pi.seq):
				remaining.append(pi)
		remaining.sort_custom(func(a, b): return a.seq < b.seq)
		# 3. 从 auth_pos 重新应用
		var re_sim_x: float = auth_pos.x
		var re_sim_y: float = auth_pos.y
		var step: float = _speed * _tile_px * _dt
		for pi in remaining:
			var n: Vector2 = _normalize(pi.dx, pi.dy)
			re_sim_x += n.x * step
			re_sim_y += n.y * step
		# 4. 计算偏差(re-sim 与 reconcile 前的 current)
		var dx_diff: float = re_sim_x - _current_pos_before_reconcile_x
		var dy_diff: float = re_sim_y - _current_pos_before_reconcile_y
		var delta_px: float = sqrt(dx_diff * dx_diff + dy_diff * dy_diff)
		# 5. 切到 re_simulated(下次 predict 基础正确)
		_current_pos_x = re_sim_x
		_current_pos_y = re_sim_y
		pending = remaining
		# 6. 决策
		if delta_px > WildwoodConstants.RECONCILE_THRESHOLD_PX:
			return Correction.new(
				_current_pos_before_reconcile_x,
				_current_pos_before_reconcile_y,
				re_sim_x,
				re_sim_y,
				delta_px
			)
		return NoCorrection.new()

	# ----- 内部 -----

	## 8 方向归一化(2D 向量长度钳制到 1)
	##   - (0, 0) 保留 (0, 0): 静止
	##   - 长度 > 1 自动除以自身长度
	static func _normalize(dx: float, dy: float) -> Vector2:
		var length: float = sqrt(dx * dx + dy * dy)
		if length == 0.0:
			return Vector2(0.0, 0.0)
		if length > 1.0:
			return Vector2(dx / length, dy / length)
		return Vector2(dx, dy)

	static func _now_ms() -> int:
		return int(Time.get_ticks_msec())
