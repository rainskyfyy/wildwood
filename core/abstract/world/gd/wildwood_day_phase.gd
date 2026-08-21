## Wildwood M2.8 — DayPhase(昼夜时段)

enum WildwoodDayPhase {
	DAWN = 0,  ## 05:00 - 07:59
	DAY = 1,   ## 08:00 - 16:59
	DUSK = 2,  ## 17:00 - 19:59
	NIGHT = 3, ## 20:00 - 04:59
}

const DAY_HOUR_DAWN_START := 5
const DAY_HOUR_DAY_START := 8
const DAY_HOUR_DUSK_START := 17
const DAY_HOUR_NIGHT_START := 20

static func phase_from_hour(hour: int) -> int:  # WildwoodDayPhase
	if hour < DAY_HOUR_DAWN_START or hour >= DAY_HOUR_NIGHT_START:
		return WildwoodDayPhase.NIGHT
	if hour < DAY_HOUR_DAY_START:
		return WildwoodDayPhase.DAWN
	if hour < DAY_HOUR_DUSK_START:
		return WildwoodDayPhase.DAY
	return WildwoodDayPhase.DUSK
