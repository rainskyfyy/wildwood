## Wildwood M2.8 — SeasonTable(方案 §2.7 数据)
##
## 温度范围硬约束:
##   春 15-25 / 夏 25-40 / 秋 10-20 / 冬 -10-5(°C)

extends RefCounted

const SEASON_PROFILES := {
	0: {  # SPRING
		"label": "春",
		"tint_rgb": [255, 200, 215],
		"temp_min_c": 15.0,
		"temp_max_c": 25.0,
		"features": ["rain", "mushroom_growth"],
		"vegetation_palette": ["veg_spring_grass", "veg_spring_bush"],
		"monster_pool": [],
	},
	1: {  # SUMMER
		"label": "夏",
		"tint_rgb": [255, 230, 130],
		"temp_min_c": 25.0,
		"temp_max_c": 40.0,
		"features": ["heatstroke", "cactus_fruit"],
		"vegetation_palette": ["veg_summer_grass", "veg_summer_cactus"],
		"monster_pool": [],
	},
	2: {  # AUTUMN
		"label": "秋",
		"tint_rgb": [240, 175, 80],
		"temp_min_c": 10.0,
		"temp_max_c": 20.0,
		"features": ["leaf_fall", "harvest"],
		"vegetation_palette": ["veg_autumn_grass", "veg_autumn_leaves"],
		"monster_pool": [],
	},
	3: {  # WINTER
		"label": "冬",
		"tint_rgb": [180, 215, 245],
		"temp_min_c": -10.0,
		"temp_max_c": 5.0,
		"features": ["freeze", "campfire_required", "snow_blind"],
		"vegetation_palette": ["veg_winter_grass", "veg_winter_snow"],
		"monster_pool": [],
	},
}

static func lookup(season: int) -> Dictionary:  # WildwoodSeason → profile dict
	return SEASON_PROFILES[season]
