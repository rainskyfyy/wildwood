extends Node
## 鬼魂态 10s 倒计时管理器 (M2.5 验收 ①)
##
## 验收点 ① 鬼魂态 10s 倒计时
##   - start(ms) 启动
##   - stop()    取消(队友接触复活走此路径)
##   - tick(remaining_ms)  每秒/每 100ms 触发,供 UI
##   - expired()           超时(走 player_died 路径)
##
## tick 信号频率 = 100ms(让 UI 倒计时数字逐 100ms 滚动)
class_name WildwoodGhostWindow

signal tick(remaining_ms: int)
signal expired()

const TICK_INTERVAL_MS: int = 100   # 倒计时刷新频率

var _remaining_ms: int = 0
var _running: bool = false
var _last_tick_at_ms: int = 0

func start(duration_ms: int) -> void:
	_remaining_ms = duration_ms
	_running = true
	_last_tick_at_ms = Time.get_ticks_msec()
	tick.emit(_remaining_ms)

func stop() -> void:
	_running = false
	_remaining_ms = 0

func is_running() -> bool:
	return _running

func remaining_ms() -> int:
	return max(0, _remaining_ms)

func _process(_delta: float) -> void:
	if not _running:
		return
	var now: int = Time.get_ticks_msec()
	var dt: int = now - _last_tick_at_ms
	if dt < TICK_INTERVAL_MS:
		return
	_last_tick_at_ms = now
	_remaining_ms = max(0, _remaining_ms - dt)
	if _remaining_ms <= 0:
		_running = false
		expired.emit()
	else:
		tick.emit(_remaining_ms)
