class_name SurvivalSystem
extends Node

# Wildwood 生存属性 — Godot 端运行时系统(M2.4 关键路径)
#
# 用法:
#   - 把本节点挂在 Player 节点下
#   - 编辑器设置 stats(默认 4 维全满)
#   - 在外部条件变化时调 update_context(...)
#   - _physics_process 30Hz 调 _tick()
#
# 设计:
#   - 公式见 survival_formulas.gd(纯静态方法)
#   - 本节点负责 30Hz 推进 + 与引擎/物理帧对接
#   - 不依赖 Python 子进程
#
# 与 M2.1 移动控制器的接入点(待 M2.1 集成时实现):
#   speed_modifier = SurvivalFormulas.get_speed_modifier(stats_dict)
#   base_speed *= speed_modifier
#
# 与 M2.5 死亡监听的接入点(待 M2.5 集成时实现):
#   if is_dead: ... emit signal "player_died"

const TICK_HZ := 30
const TICK_DT := 1.0 / 30.0  # ≈ 0.0333 秒

# 衰减/恢复速率(必须与 Python 端 tick.py 同步)
const HUNGER_DRAIN_PER_SEC := 100.0 / 1800.0   # ≈ 0.0556/s
const SANITY_DRAIN_BASE_PER_SEC := 0.1
const SANITY_DRAIN_MONSTER_PER_SEC := 0.3
const SANITY_DRAIN_HUNGRY_PER_SEC := 0.2
const SANITY_DRAIN_NIGHT_PER_SEC := 0.15
const SANITY_REST_RECOVERY_PER_SEC := 0.5
const TEMP_BALANCE_ALPHA := 1.5
const TEMP_FIRE_BONUS_PER_SEC := 2.0
const TEMP_WET_PENALTY_PER_SEC := 1.0
const HP_REGEN_INTERVAL_SEC := 5.0
const HP_REGEN_AMOUNT := 1.0
const HP_DRAIN_STARVING_PER_SEC := 2.0
const HP_DRAIN_TEMP_EXTREME_PER_SEC := 3.0
const HP_DRAIN_INSANE_PER_SEC := 1.0
const TEMP_HP_DRAIN_LOW := -5.0
const TEMP_HP_DRAIN_HIGH := 40.0

# 4 维属性(编辑器可改,默认全满 + 中性温度)
@export var hp: float = 100.0
@export var hunger: float = 100.0
@export var sanity: float = 100.0
@export var temperature: float = 20.0

# 上限/下限
@export var hp_max: float = 100.0
@export var hunger_max: float = 100.0
@export var sanity_max: float = 100.0
@export var temperature_max: float = 100.0
@export var temperature_min: float = -50.0

# 死亡状态
var is_dead: bool = false

# === 外部条件(由调用方在外部状态变化时 update) ===
var ambient_temperature: float = 20.0
var is_near_fire: bool = false
var is_wet: bool = false
var is_in_shelter: bool = false
var time_of_day: float = 0.5  # [0, 1]
var monster_proximity: float = 0.0
var resting: bool = false

# 内部计时
var _hp_regen_timer: float = 0.0
var _tick_accumulator: float = 0.0


func _ready() -> void:
	# 30Hz tick 由 _physics_process 驱动(60Hz,每 2 帧调一次 tick)
	# Godot 物理默认 60Hz,所以 accumulator 控制
	pass


func _physics_process(delta: float) -> void:
	if is_dead:
		return
	# 累积时间到 TICK_DT 触发一次 tick
	_tick_accumulator += delta
	while _tick_accumulator >= TICK_DT:
		_tick_accumulator -= TICK_DT
		_tick_once(TICK_DT)


# 单次 tick 推进
func _tick_once(dt: float) -> void:
	_advance_hunger(dt)
	_advance_sanity(dt)
	_advance_temperature(dt)
	_advance_hp(dt)
	_clamp_stats()
	# 死亡判定
	if hp <= 0.0:
		is_dead = true


# === 4 维推进 ===

func _advance_hunger(dt: float) -> void:
	var drain: float = HUNGER_DRAIN_PER_SEC * dt
	if temperature < 5.0 or temperature > 30.0:
		drain *= 1.5
	hunger = max(0.0, hunger - drain)


func _advance_sanity(dt: float) -> void:
	if resting:
		if sanity < 50.0:
			sanity = min(sanity_max, sanity + SANITY_REST_RECOVERY_PER_SEC * dt)
		return
	# 非休息:多因子叠加衰减
	var drain: float = SANITY_DRAIN_BASE_PER_SEC * dt
	if monster_proximity > 0.5:
		drain += SANITY_DRAIN_MONSTER_PER_SEC * dt
	if hunger < hunger_max * 0.30:
		drain += SANITY_DRAIN_HUNGRY_PER_SEC * dt
	if _is_night(time_of_day):
		drain += SANITY_DRAIN_NIGHT_PER_SEC * dt
	sanity = max(0.0, sanity - drain)


func _advance_temperature(dt: float) -> void:
	var target: float = ambient_temperature
	if is_near_fire:
		target = max(target, 20.0)
	if is_in_shelter:
		target = target * 0.5 + 15.0 * 0.5
	var alpha: float = min(1.0, TEMP_BALANCE_ALPHA * dt)
	temperature = temperature + (target - temperature) * alpha
	if is_near_fire:
		temperature += TEMP_FIRE_BONUS_PER_SEC * dt
	if is_wet:
		temperature -= TEMP_WET_PENALTY_PER_SEC * dt


func _advance_hp(dt: float) -> void:
	var can_regen: bool = (
		hunger > hunger_max * 0.50
		and sanity > sanity_max * 0.50
		and TEMP_HP_DRAIN_LOW <= temperature and temperature <= TEMP_HP_DRAIN_HIGH
		and hp < hp_max
	)
	if can_regen:
		_hp_regen_timer += dt
		if _hp_regen_timer >= HP_REGEN_INTERVAL_SEC:
			hp = min(hp_max, hp + HP_REGEN_AMOUNT)
			_hp_regen_timer -= HP_REGEN_INTERVAL_SEC
	else:
		_hp_regen_timer = 0.0

	# 衰减
	var drain: float = 0.0
	if hunger <= 0.0:
		drain += HP_DRAIN_STARVING_PER_SEC * dt
	if temperature < TEMP_HP_DRAIN_LOW or temperature > TEMP_HP_DRAIN_HIGH:
		drain += HP_DRAIN_TEMP_EXTREME_PER_SEC * dt
	if sanity <= 0.0:
		drain += HP_DRAIN_INSANE_PER_SEC * dt
	if drain > 0.0:
		hp = max(0.0, hp - drain)


func _clamp_stats() -> void:
	hp = clamp(hp, 0.0, hp_max)
	hunger = clamp(hunger, 0.0, hunger_max)
	sanity = clamp(sanity, 0.0, sanity_max)
	temperature = clamp(temperature, temperature_min, temperature_max)


# === 公开 modifier 接口(供 M2.1 移动 / M2.5 死亡监听 / UI 警示动效调用) ===

func get_stats_dict() -> Dictionary:
	return {
		"hp": hp,
		"hunger": hunger,
		"sanity": sanity,
		"temperature": temperature,
		"hp_max": hp_max,
		"hunger_max": hunger_max,
		"sanity_max": sanity_max,
		"temperature_max": temperature_max,
		"temperature_min": temperature_min,
	}


func is_critical() -> bool:
	return SurvivalFormulas.is_critical(get_stats_dict())


func get_speed_modifier() -> float:
	return SurvivalFormulas.get_speed_modifier(get_stats_dict())


func should_show_illusion() -> bool:
	return SurvivalFormulas.should_show_illusion(get_stats_dict())


# === 外部 API:更新上下文 ===
func update_context(
	ambient: float = 20.0,
	near_fire: bool = false,
	wet: bool = false,
	in_shelter: bool = false,
	tod: float = 0.5,
	monster_prox: float = 0.0,
	rest: bool = false
) -> void:
	ambient_temperature = ambient
	is_near_fire = near_fire
	is_wet = wet
	is_in_shelter = in_shelter
	time_of_day = tod
	monster_proximity = monster_prox
	resting = rest


# === 内部工具 ===
static func _is_night(tod: float) -> bool:
	return tod < 0.25 or tod > 0.75
