## Wildwood M2.8 — TickDriver(统一 tick 入口, 验收 ③ 核心)
##
## 单一 TimeAxis owner. 外部不能直接调 time_axis.tick(), 必须经本类 tick().

class_name WildwoodTickDriver
extends RefCounted

const SEASON_TRANSITION_SECONDS := 0.5
const DAYNIGHT_TRANSITION_SECONDS := 0.5

const DAWN_TINT := [255, 220, 200]
const DAY_TINT := [255, 250, 245]
const DUSK_TINT := [255, 165, 90]
const NIGHT_TINT := [40, 50, 90]

var _time_axis  # WildwoodTimeAxis
var _season_clock  # WildwoodSeasonClock
var _day_night  # WildwoodDayNightClock
var _light  # WildwoodLightController
var _tick_count: int = 0

func _init(real_seconds_per_day: float = WildwoodTimeAxis.DEFAULT_REAL_SECONDS_PER_DAY) -> void:
	_time_axis = WildwoodTimeAxis.new(real_seconds_per_day)
	_season_clock = WildwoodSeasonClock.new(_time_axis)
	_day_night = WildwoodDayNightClock.new(_time_axis)
	var initial_season := _season_clock.current
	var initial_rgb: Array = SEASON_PROFILES[initial_season]["tint_rgb"]
	var initial_intensity := _day_night.light_intensity()
	_light = WildwoodLightController.new(initial_rgb, initial_intensity)

var time_axis: WildwoodTimeAxis:
	get: return _time_axis

var season_clock: WildwoodSeasonClock:
	get: return _season_clock

var day_night: WildwoodDayNightClock:
	get: return _day_night

var light: WildwoodLightController:
	get: return _light

var tick_count: int:
	get: return _tick_count

# 返回 Dictionary {season_change, phase_change, in_season_transition, in_daynight_transition}
func tick(real_dt: float) -> Dictionary:
	if real_dt < 0.0:
		push_error("real_dt must be >= 0")
		return {}
	_time_axis.tick(real_dt)
	var season_change := _season_clock.update()
	var in_season := false
	if season_change != -1:
		var target_rgb: Array = SEASON_PROFILES[season_change]["tint_rgb"]
		_light.start_transition(target_rgb, _day_night.light_intensity(), SEASON_TRANSITION_SECONDS)
		in_season = true
	var phase_change := _day_night.update()
	var in_dn := false
	if phase_change != -1:
		var target_rgb: Array = _phase_tint(phase_change)
		_light.start_transition(target_rgb, _day_night.light_intensity(), DAYNIGHT_TRANSITION_SECONDS)
		in_dn = true
	_light.update(real_dt)
	_tick_count += 1
	return {
		"season_change": season_change,
		"phase_change": phase_change,
		"in_season_transition": in_season,
		"in_daynight_transition": in_dn,
	}

static func _phase_tint(phase: int) -> Array:
	match phase:
		WildwoodDayPhase.DAWN: return DAWN_TINT
		WildwoodDayPhase.DAY: return DAY_TINT
		WildwoodDayPhase.DUSK: return DUSK_TINT
		WildwoodDayPhase.NIGHT: return NIGHT_TINT
		_: return DAY_TINT
