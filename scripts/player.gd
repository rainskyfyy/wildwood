extends Node2D
## 玩家实体:移动 + LMB 智能判别
##
## 任务 M2.1:
##  - WASD 移动(每次输入发 C2S_PlayerInput MOVE)
##  - LMB 智能判别:屏幕 → 世界坐标,找距离最近的可采资源,发 GATHER
##
## 任务 M2.2 客户端联动:
##  - 收到 S2C_WorldDelta(含 player 位置)→ 更新 self.position
##  - 收到 S2C_WorldDelta(含 resource HP)→ 触发目标 resource 抖动
##  - 收到自己的 gather input_seq ack → 启动 1.5s 进度条

const WildwoodNet = preload("res://core/abstract/network/gd/wildwood_net.gd")

# 移动速度(与服务器保持一致:200 px/s)
const MOVE_SPEED_PX_PER_SEC: float = 200.0
# 触达距离(与服务器 ReachPixels 保持一致)
const REACH_PIXELS: float = 64.0
# 4 朝向(0=down 1=up 2=right 3=left)
const FACING_DOWN: int = 0
const FACING_UP: int = 1
const FACING_RIGHT: int = 2
const FACING_LEFT: int = 3

# 节点引用
var _net: WildwoodNet
var _input_seq: int = 0
var _facing: int = FACING_DOWN

# 本地预测(客户端先动,服务端校正)
var _local_dx: float = 0.0
var _local_dy: float = 0.0

# 抖动(HP 变化时)
var _shake_t: float = 0.0
const SHAKE_DURATION: float = 0.15
const SHAKE_AMPLITUDE: float = 3.0

# 引用
var _sprite: Sprite2D
var _gather_bar: ProgressBar = null
var _gather_target_id: int = 0


func _ready() -> void:
	_sprite = get_node_or_null("Sprite")
	if _sprite == null:
		_sprite = Sprite2D.new()
		add_child(_sprite)
	# 默认颜色
	_sprite.modulate = Color(0.4, 0.8, 0.4)


func setup(net: WildwoodNet) -> void:
	_net = net


func _process(delta: float) -> void:
	# 1) 输入
	var dx: float = 0.0
	var dy: float = 0.0
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		dy -= 1.0
		_facing = FACING_UP
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		dy += 1.0
		_facing = FACING_DOWN
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		dx -= 1.0
		_facing = FACING_LEFT
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		dx += 1.0
		_facing = FACING_RIGHT

	# 2) 客户端预测(立即移动)
	if dx != 0.0 or dy != 0.0:
		# 归一化避免斜向加速
		var mag: float = sqrt(dx*dx + dy*dy)
		if mag > 0.0:
			dx /= mag
			dy /= mag
		position.x += dx * MOVE_SPEED_PX_PER_SEC * delta
		position.y += dy * MOVE_SPEED_PX_PER_SEC * delta
		# 发服务端
		_input_seq += 1
		if _net != null:
			_net.send_player_input_move(_input_seq, dx, dy, _facing)

	# 3) 抖动衰减
	if _shake_t > 0.0:
		_shake_t -= delta
		if _sprite != null:
			var off_x: float = randf_range(-SHAKE_AMPLITUDE, SHAKE_AMPLITUDE)
			var off_y: float = randf_range(-SHAKE_AMPLITUDE, SHAKE_AMPLITUDE)
			_sprite.position = Vector2(off_x, off_y)
	else:
		if _sprite != null:
			_sprite.position = Vector2.ZERO

	# 4) 进度条更新
	if _gather_bar != null and _gather_target_id != 0:
		# 简化:本地计时 1.5s
		# 真实场景:从 ack_input_seq + 服务器 elapsed 算
		pass


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		# LMB 智能判别:找鼠标位置最近的可采资源
		var mouse_world: Vector2 = get_global_mouse_position()
		var target_id: int = _find_nearest_gatherable(mouse_world)
		if target_id != 0 and _net != null:
			_input_seq += 1
			_gather_target_id = target_id
			_net.send_player_input_gather(_input_seq, target_id)
			# 启动本地进度条
			if _gather_bar != null:
				_gather_bar.max_value = 1500
				_gather_bar.value = 0
				_gather_bar.visible = true


# 智能判别:从 world.get_resource_list() 找距离鼠标 < REACH * 2 的最近可采
func _find_nearest_gatherable(mouse_pos: Vector2) -> int:
	var world_node: Node = get_parent()
	if world_node == null:
		return 0
	if not world_node.has_method("find_nearest_gatherable"):
		return 0
	return world_node.find_nearest_gatherable(mouse_pos, REACH_PIXELS * 2.0)


# 收到 server 校正:更新位置
func on_world_delta_player(player_id: String, x: float, y: float, facing: int) -> void:
	if player_id == _net.player_id() if _net != null else "":
		position.x = x
		position.y = y
		_facing = facing


# 收到 server 校正:目标 resource HP 变化 → 抖动
func on_resource_hp_changed(entity_id: int, hp: int, max_hp: int) -> void:
	if entity_id == _gather_target_id and hp < max_hp:
		_shake_t = SHAKE_DURATION


# 收到 GATHER_DONE → 清除进度
func on_gather_done(entity_id: int) -> void:
	if entity_id == _gather_target_id:
		_gather_target_id = 0
		if _gather_bar != null:
			_gather_bar.visible = false
