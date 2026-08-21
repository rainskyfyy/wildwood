## Wildwood M2.8 — Season(季节枚举 + 状态机)

enum WildwoodSeason {
	SPRING = 0,  ## 春 / 暖粉 / 15-25°C / 雨季+蘑菇
	SUMMER = 1,  ## 夏 / 明黄 / 25-40°C / 高温+仙人掌
	AUTUMN = 2,  ## 秋 / 橙金 / 10-20°C / 落叶+收获
	WINTER = 3,  ## 冬 / 冷蓝 / -10-5°C / 结冰+篝火+雪盲
}

const SEASON_NAMES := ["spring", "summer", "autumn", "winter"]

static func from_index(idx: int) -> WildwoodSeason:
	if idx < 0 or idx >= SEASONS_PER_YEAR:
		push_error("season_index out of range: %d" % idx)
		return WildwoodSeason.SPRING
	return idx as WildwoodSeason

static func name_of(season: WildwoodSeason) -> String:
	return SEASON_NAMES[season]

const SEASONS_PER_YEAR := 4
