class_name WildwoodReconnect
extends RefCounted
## Wildwood M1.10 — 自动重连调度器(30s 窗口 + 指数退避)
##
## 它不直接持有 NetClient,而是驱动一个"连接尝试"循环:
##   1. 检测到断网(start_reconnect)
##   2. 按 1s → 2s → 4s → 8s → 16s → 30s 退避调度 attempt
##   3. 调上层注入的 attempt_callable,成功 → 状态 connected
##   4. 30s 内未成功 → 状态 failed
##
## 上层(通常是 WildwoodSession)负责"创建新 client + 握手",
## 这里只管调度。这样 NetClient 不可重入的问题就不用在 reconnect 模块解决。
##
## 状态机:
##   idle → reconnecting → connected
##                  ↓ (30s 超时)
##                failed
##
## 用法:
##   var rc = WildwoodReconnect.new()
##   rc.attempt_callable = func(): return session.try_connect_once()  # 一次连接尝试,返回 ok
##   rc.on_state_change = func(s): ...
##   rc.on_reconnected = func(attempts): ...
##   rc.on_giveup = func(): ...
##   rc.start_reconnect()  # 触发重连循环
##   rc.poll(delta)        # 每帧推进

# 退避参数
const BACKOFF_MIN_MS: int = 1_000       # 1s
const BACKOFF_MAX_MS: int = 30_000      # 30s 上限
const RECONNECT_WINDOW_MS: int = 30_000  # M1.10 验收 ② 硬约束: 30s 窗口

# 状态
const STATE_IDLE: String = "idle"
const STATE_RECONNECTING: String = "reconnecting"
const STATE_CONNECTED: String = "connected"
const STATE_FAILED: String = "failed"

# 上层注入 — 一次连接尝试(拨号 + 握手 + 启心跳)
# 返回 Dictionary {ok: bool, error: String}
var attempt_callable: Callable = Callable()

# 回调
var on_state_change: Callable = Callable()   # func(state: String)
var on_reconnected: Callable = Callable()    # func(attempts: int)
var on_giveup: Callable = Callable()         # func()
var on_attempt: Callable = Callable()        # func(attempt: int) — 每次重试时

# 内部状态
var _state: String = STATE_IDLE
var _reconnect_attempts: int = 0
var _total_reconnects: int = 0
var _first_disconnect_ms: int = 0
var _next_attempt_at_ms: int = 0
var _current_backoff_ms: int = 0

func _init() -> void:
	pass

func get_state() -> String:
	return _state

func get_reconnect_attempts() -> int:
	return _reconnect_attempts

func get_total_reconnects() -> int:
	return _total_reconnects

## 标记"刚连上",清空重连窗口
func mark_connected() -> void:
	if _state == STATE_RECONNECTING:
		_total_reconnects += 1
		if on_reconnected.is_valid():
			on_reconnected.call(_reconnect_attempts)
	_reconnect_attempts = 0
	_first_disconnect_ms = 0
	_set_state(STATE_CONNECTED)

## 主动关闭
func shutdown() -> void:
	_set_state(STATE_IDLE)

## 触发重连循环
func start_reconnect() -> void:
	if _state == STATE_RECONNECTING:
		return
	_reconnect_attempts = 0
	_first_disconnect_ms = Time.get_ticks_msec()
	_current_backoff_ms = BACKOFF_MIN_MS
	_next_attempt_at_ms = Time.get_ticks_msec() + _current_backoff_ms
	_set_state(STATE_RECONNECTING)
	push_warning("WildwoodReconnect: 进入 30s 重连窗口, 首次尝试在 %d ms 后" % _current_backoff_ms)

## 主循环每帧调用
func poll(_delta: float) -> void:
	if _state != STATE_RECONNECTING:
		return

	var now_ms: int = Time.get_ticks_msec()

	# 1) 窗口耗尽?
	if now_ms - _first_disconnect_ms > RECONNECT_WINDOW_MS:
		push_warning("WildwoodReconnect: 30s 窗口耗尽, attempts=%d, 放弃" % _reconnect_attempts)
		_set_state(STATE_FAILED)
		if on_giveup.is_valid():
			on_giveup.call()
		return

	# 2) 到下一次重试时间?
	if now_ms < _next_attempt_at_ms:
		return

	# 3) 调一次 attempt_callable
	_reconnect_attempts += 1
	if on_attempt.is_valid():
		on_attempt.call(_reconnect_attempts)
	if not attempt_callable.is_valid():
		push_error("WildwoodReconnect: attempt_callable 未注入")
		_increase_backoff()
		return
	var result: Dictionary = attempt_callable.call()
	if result.get("ok", false):
		mark_connected()
		return

	# 4) 失败 → 退避
	var err_msg: String = result.get("error", "unknown")
	push_warning("WildwoodReconnect: attempt #%d 失败 (%s), backoff=%d ms" % [_reconnect_attempts, err_msg, _current_backoff_ms])
	_increase_backoff()


func _increase_backoff() -> void:
	_current_backoff_ms = _current_backoff_ms * 2
	if _current_backoff_ms > BACKOFF_MAX_MS:
		_current_backoff_ms = BACKOFF_MAX_MS
	_next_attempt_at_ms = Time.get_ticks_msec() + _current_backoff_ms


func _set_state(s: String) -> void:
	if _state == s:
		return
	_state = s
	if on_state_change.is_valid():
		on_state_change.call(s)
