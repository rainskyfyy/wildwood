class_name SurvivalFormulas
extends RefCounted

# Wildwood 生存属性 — 公式镜像(M2.4 关键路径)
#
# 本文件镜像 core/abstract/survival/modifiers.py 的 Python 实现,
# Godot 端调这些静态方法做判定。**不要**调 Python 子进程,
# 简单公式直接 GDScript 跑更高效、可调试。
#
# 任务验收(项目总方案 §2.1):
#   ② 警示动效 < 30% 触发     → is_critical()
#   ③ 温度 < 0°C 减速 50%    → get_speed_modifier()
#   ④ 精神 < 30% 幻象 shader  → should_show_illusion()
#
# 与 Python 实现的差异:Godot 端用 Dictionary 传 stats,而不是 dataclass。

# === 常量(必须与 Python 端 modifiers.py 同步) ===

const CRITICAL_THRESHOLD := 0.30  # 任务验收 ②
const ILLUSION_THRESHOLD := 0.30  # 任务验收 ④

const TEMP_FREEZING := 0.0        # 任务验收 ③
const TEMP_HOT_EXTREME := 35.0
const HP_LOW_THRESHOLD := 0.30

const TEMP_COLD_WARNING := 5.0    # 温度警示下界
const TEMP_HOT_WARNING := 35.0    # 温度警示上界

const SPEED_NORMAL := 1.0
const SPEED_FREEZING := 0.5
const SPEED_HOT := 0.7
const SPEED_LOW_HP := 0.8


# === 内部工具 ===

# 计算 value / max 的 0~1 比例,max <= 0 时返回 0。
static func _ratio(value: float, max_value: float) -> float:
	if max_value <= 0.0:
		return 0.0
	return clampf(value / max_value, 0.0, 1.0)


# === 公开 API ===

# 任务验收 ②:任意维度进入警示。
# stats 字段:hp / hunger / sanity / temperature / hp_max / hunger_max / sanity_max / temperature_max / temperature_min
static func is_critical(stats: Dictionary) -> bool:
	if _ratio(stats.hp, stats.hp_max) < CRITICAL_THRESHOLD:
		return true
	if _ratio(stats.hunger, stats.hunger_max) < CRITICAL_THRESHOLD:
		return true
	if _ratio(stats.sanity, stats.sanity_max) < CRITICAL_THRESHOLD:
		return true
	var t: float = stats.temperature
	if t < TEMP_COLD_WARNING or t > TEMP_HOT_WARNING:
		return true
	return false


# 任务验收 ③:温度 < 0°C 减速 50%。
# 复合 modifier 取最严格的(即最小值)。
static func get_speed_modifier(stats: Dictionary) -> float:
	var modifier: float = SPEED_NORMAL
	if stats.temperature < TEMP_FREEZING:
		modifier = min(modifier, SPEED_FREEZING)
	if stats.temperature > TEMP_HOT_EXTREME:
		modifier = min(modifier, SPEED_HOT)
	if _ratio(stats.hp, stats.hp_max) < HP_LOW_THRESHOLD:
		modifier = min(modifier, SPEED_LOW_HP)
	return modifier


# 任务验收 ④:精神 < 30% 启用幻象 shader。
static func should_show_illusion(stats: Dictionary) -> bool:
	return _ratio(stats.sanity, stats.sanity_max) < ILLUSION_THRESHOLD
