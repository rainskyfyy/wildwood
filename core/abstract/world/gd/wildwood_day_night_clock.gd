## Wildwood M2.8 — DayNightClock(昼夜时钟)

class_name WildwoodDayNightClock
extends RefCounted

var _time_axis  # WildwoodTimeAxis
var _current: int = 3  # WildwoodDayPhase, 起始 night (0h)

func _init(time_axis) -> void:  # WildwoodTimeAxis
	_time_axis = time_axis
	_current = WildwoodDayPhase.phase_from_hour(_time_axis.hour_in_day)

var current: int:  # WildwoodDayPhase
	get: return _current

func phase() -> int:  # WildwoodDayPhase
	return WildwoodDayPhase.phase_from_hour(_time_axis.hour_in_day)

func update() -> int:  # returns new WildwoodDayPhase or -1
	var new_p := phase()
	if new_p != _current:
		_current = new_p
		return _current
	return -1

func light_intensity() -> float:
	var hour := _time_axis.hour_in_day
	if hour < DAY_HOUR_DAWN_START or hour >= DAY_HOUR_NIGHT_START:
		return 0.0
	if hour < DAY_HOUR_DAY_START:
		var span := float(DAY_HOUR_DAY_START - DAY_HOUR_DAWN_START)
		return float(hour - DAY_HOUR_DAWN_START) / span
	if hour < DAY_HOUR_DUSK_START:
		return 1.0
	var span := float(DAY_HOUR_NIGHT_START - DAY_HOUR_DUSK_START)
	return 1.0 - float(hour - DAY_HOUR_DUSK_START) / span
