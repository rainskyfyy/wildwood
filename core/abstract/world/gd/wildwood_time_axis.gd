## Wildwood M2.8 — TimeAxis(全局时间轴, 唯一 owner)
##
## GDScript 4.3 包装, 与 core/abstract/world/time_axis.py 语义一致.
##
## 单一 owner 约束(验收 ③): 同一游戏世界只允许一个 TimeAxis, 由 TickDriver
## 持有, 外部通过 TickDriver.tick(dt) 推进, 不可直接调用本类的 tick().

class_name WildwoodTimeAxis
extends RefCounted

const DEFAULT_REAL_SECONDS_PER_DAY := 24.0 * 60.0  ## 1440s = 24min
const HOURS_PER_DAY := 24
const MINUTES_PER_HOUR := 60
const SECONDS_PER_MINUTE := 60
const DAYS_PER_SEASON := 30
const SEASONS_PER_YEAR := 4
const SEASON_ORDER := ["spring", "summer", "autumn", "winter"]

var _elapsed: float = 0.0
var _real_seconds_per_day: float = DEFAULT_REAL_SECONDS_PER_DAY
var _real_seconds_per_hour: float = DEFAULT_REAL_SECONDS_PER_DAY / HOURS_PER_DAY
var _real_seconds_per_minute: float = _real_seconds_per_hour / MINUTES_PER_HOUR

func _init(real_seconds_per_day: float = DEFAULT_REAL_SECONDS_PER_DAY) -> void:
	if real_seconds_per_day <= 0.0:
		push_error("real_seconds_per_day must be > 0, got %s" % real_seconds_per_day)
		return
	_real_seconds_per_day = float(real_seconds_per_day)
	_real_seconds_per_hour = _real_seconds_per_day / HOURS_PER_DAY
	_real_seconds_per_minute = _real_seconds_per_hour / MINUTES_PER_HOUR

# ---- owner API --------------------------------------------------------

func tick(real_dt: float) -> void:
	if real_dt < 0.0:
		push_error("real_dt must be >= 0, got %s" % real_dt)
		return
	_elapsed += real_dt

func reset() -> void:
	_elapsed = 0.0

# ---- 读访问 ----------------------------------------------------------

var elapsed_real_seconds: float:
	get: return _elapsed

var real_seconds_per_day: float:
	get: return _real_seconds_per_day

var day_in_season: int:
	get:
		var total_days := int(_elapsed / _real_seconds_per_day)
		return total_days % DAYS_PER_SEASON

var season_index: int:
	get:
		var total_days := int(_elapsed / _real_seconds_per_day)
		return (total_days / DAYS_PER_SEASON) % SEASONS_PER_YEAR

var hour_in_day: int:
	get:
		if _real_seconds_per_hour <= 0.0:
			return 0
		var total_hours := int(_elapsed / _real_seconds_per_hour)
		return total_hours % HOURS_PER_DAY

var minute_in_hour: int:
	get:
		if _real_seconds_per_minute <= 0.0:
			return 0
		var total_minutes := int(_elapsed / _real_seconds_per_minute)
		return total_minutes % MINUTES_PER_HOUR

var day_progress: float:
	get:
		if _real_seconds_per_day <= 0.0:
			return 0.0
		return fmod(_elapsed, _real_seconds_per_day) / _real_seconds_per_day

var season_progress: float:
	get:
		if _real_seconds_per_day <= 0.0:
			return 0.0
		var season_real_seconds := _real_seconds_per_day * DAYS_PER_SEASON
		return fmod(_elapsed, season_real_seconds) / season_real_seconds

func _to_string() -> String:
	return "TimeAxis(elapsed=%.2f, day=%d, season=%d, hour=%d, min=%d)" % [
		_elapsed, day_in_season, season_index, hour_in_day, minute_in_hour,
	]
