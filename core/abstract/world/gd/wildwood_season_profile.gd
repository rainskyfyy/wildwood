## Wildwood M2.8 — SeasonProfile + SeasonTable
##
## 数据来自方案 §2.7(全季节).

class_name WildwoodSeasonProfile
extends RefCounted

var season: int  # WildwoodSeason
var label: String
var tint_rgb: Array  # [r,g,b] 0..255
var temp_min_c: float
var temp_max_c: float
var features: Array  # String[]
var vegetation_palette: Array  # String[]
var monster_pool: Array  # String[]

func _init(p_season: int, p_label: String, p_tint: Array, p_min: float, p_max: float, p_features: Array, p_veg: Array, p_monsters: Array = []) -> void:
	if p_min > p_max:
		push_error("temp_min_c > temp_max_c for %s" % p_label)
		return
	season = p_season
	label = p_label
	tint_rgb = p_tint.duplicate()
	temp_min_c = p_min
	temp_max_c = p_max
	features = p_features.duplicate()
	vegetation_palette = p_veg.duplicate()
	monster_pool = p_monsters.duplicate()
