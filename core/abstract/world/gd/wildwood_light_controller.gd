## Wildwood M2.8 — LightController(0.5s LOD 平滑过渡)
##
## 验收 ① ④: 4 季节切换 0.5s LOD 过渡 + 昼夜光照过场平滑.

class_name WildwoodLightController
extends RefCounted

const DEFAULT_SEASON_TRANSITION_SECONDS := 0.5
const DEFAULT_DAYNIGHT_TRANSITION_SECONDS := 0.5

var _current_rgb: Array = [255, 250, 245]  # [r,g,b] 0..255
var _current_intensity: float = 1.0
var _transition_from_rgb: Array = []
var _transition_to_rgb: Array = []
var _transition_from_intensity: float = 0.0
var _transition_to_intensity: float = 0.0
var _transition_duration: float = 0.0
var _transition_elapsed: float = 0.0
var _in_transition: bool = false

func _init(initial_rgb: Array = [255, 250, 245], initial_intensity: float = 1.0) -> void:
	for c in initial_rgb:
		if c < 0 or c > 255:
			push_error("initial_rgb channel out of 0..255: %s" % initial_rgb)
			return
	if initial_intensity < 0.0 or initial_intensity > 1.0:
		push_error("initial_intensity must be in [0,1]")
		return
	_current_rgb = initial_rgb.duplicate()
	_current_intensity = initial_intensity

var current_rgb: Array:
	get: return _current_rgb.duplicate()

var current_intensity: float:
	get: return _current_intensity

var is_in_transition: bool:
	get: return _in_transition

func start_transition(target_rgb: Array, target_intensity: float, duration: float = DEFAULT_SEASON_TRANSITION_SECONDS) -> void:
	for c in target_rgb:
		if c < 0 or c > 255:
			push_error("target_rgb channel out of 0..255")
			return
	if target_intensity < 0.0 or target_intensity > 1.0:
		push_error("target_intensity must be in [0,1]")
		return
	if duration <= 0.0:
		_current_rgb = target_rgb.duplicate()
		_current_intensity = target_intensity
		_in_transition = false
		return
	_transition_from_rgb = _current_rgb.duplicate()
	_transition_to_rgb = target_rgb.duplicate()
	_transition_from_intensity = _current_intensity
	_transition_to_intensity = target_intensity
	_transition_duration = float(duration)
	_transition_elapsed = 0.0
	_in_transition = true

func update(real_dt: float) -> void:
	if real_dt < 0.0:
		push_error("real_dt must be >= 0")
		return
	if not _in_transition:
		return
	_transition_elapsed += real_dt
	if _transition_elapsed >= _transition_duration:
		_current_rgb = _transition_to_rgb.duplicate()
		_current_intensity = _transition_to_intensity
		_in_transition = false
		return
	var p: float = _transition_elapsed / _transition_duration
	p = clampf(p, 0.0, 1.0)
	_current_rgb[0] = _transition_from_rgb[0] + (_transition_to_rgb[0] - _transition_from_rgb[0]) * p
	_current_rgb[1] = _transition_from_rgb[1] + (_transition_to_rgb[1] - _transition_from_rgb[1]) * p
	_current_rgb[2] = _transition_from_rgb[2] + (_transition_to_rgb[2] - _transition_from_rgb[2]) * p
	_current_intensity = _transition_from_intensity + (_transition_to_intensity - _transition_from_intensity) * p

func force_finish() -> void:
	if not _in_transition:
		return
	_current_rgb = _transition_to_rgb.duplicate()
	_current_intensity = _transition_to_intensity
	_in_transition = false
