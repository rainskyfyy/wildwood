## Wildwood M2.8 — SeasonClock(基于 TimeAxis 推算当前季节)

class_name WildwoodSeasonClock
extends RefCounted

var _time_axis  # WildwoodTimeAxis
var _current: int = 0  # WildwoodSeason

func _init(time_axis) -> void:  # WildwoodTimeAxis
	_time_axis = time_axis
	_current = _time_axis.season_index

var current: int:  # WildwoodSeason
	get: return _current

var day_in_season: int:
	get: return _time_axis.day_in_season

func update() -> int:  # returns WildwoodSeason or -1 if no change
	var new_index := _time_axis.season_index
	if new_index != _current:
		_current = new_index
		return _current
	return -1
