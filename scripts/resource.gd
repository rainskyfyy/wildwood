extends Node2D
## 资源实体:服务端同步 HP 显示 + 客户端 sprite 抖动
##
## 任务 M2.2 验收 ③ 采集时 sprite 抖动
## 任务 M2.2 验收 ④ 联机下资源 HP 同步

const SHAKE_DURATION: float = 0.15
const SHAKE_AMPLITUDE: float = 4.0

var entity_id: int = 0
var prefab_id: int = 0
var hp: int = 1
var max_hp: int = 1

var _shake_t: float = 0.0
var _sprite: Sprite2D
var _hp_label: Label = null
var _base_pos: Vector2 = Vector2.ZERO


func _ready() -> void:
	_sprite = get_node_or_null("Sprite")
	if _sprite == null:
		_sprite = Sprite2D.new()
		_sprite.name = "Sprite"
		add_child(_sprite)
	_hp_label = get_node_or_null("HPLabel")
	_base_pos = position
	_refresh_color()
	_refresh_hp_label()


func setup(eid: int, pid: int, hp_val: int, max_hp_val: int) -> void:
	entity_id = eid
	prefab_id = pid
	hp = hp_val
	max_hp = max_hp_val
	_refresh_color()
	_refresh_hp_label()


# 收到服务端 HP 变化 → 抖动 + 颜色变暗
func on_hp_changed(new_hp: int, new_max: int) -> void:
	if new_hp < hp:
		# 减少 → 抖动
		_shake_t = SHAKE_DURATION
	hp = new_hp
	max_hp = new_max
	_refresh_color()
	_refresh_hp_label()


func _process(delta: float) -> void:
	if _shake_t > 0.0:
		_shake_t -= delta
		if _sprite != null:
			var off_x: float = randf_range(-SHAKE_AMPLITUDE, SHAKE_AMPLITUDE)
			var off_y: float = randf_range(-SHAKE_AMPLITUDE, SHAKE_AMPLITUDE)
			_sprite.position = Vector2(off_x, off_y)
	else:
		if _sprite != null:
			_sprite.position = Vector2.ZERO


func _refresh_color() -> void:
	if _sprite == null:
		return
	# 用 prefab_id 区分颜色
	var colors: Dictionary = {
		1: Color(0.4, 0.3, 0.2),    # tree 棕
		2: Color(0.5, 0.5, 0.55),   # rock_ore 灰
		3: Color(0.3, 0.8, 0.3),    # grass 绿
		4: Color(0.7, 0.6, 0.4),    # rabbit_house 浅棕
		5: Color(0.8, 0.2, 0.3),    # berry 红
		6: Color(0.6, 0.4, 0.7),    # mushroom 紫
		7: Color(0.7, 0.7, 0.3),    # reed 黄
		8: Color(0.3, 0.3, 0.3),    # flint 黑
		9: Color(0.9, 0.9, 0.8),    # bone 白
		10: Color(0.5, 0.3, 0.1),   # twig 深棕
		11: Color(0.4, 0.6, 0.3),   # bush 暗绿
		12: Color(0.7, 0.2, 0.4),   # berry_bush 粉
	}
	var c: Color = colors.get(prefab_id, Color.GRAY)
	# HP 越少越暗
	var factor: float = float(hp) / float(max_hp) if max_hp > 0 else 1.0
	c = c * (0.4 + 0.6 * factor)
	_sprite.modulate = c


func _refresh_hp_label() -> void:
	if _hp_label == null:
		return
	if hp <= 0:
		_hp_label.text = ""
	else:
		_hp_label.text = "%d/%d" % [hp, max_hp]
