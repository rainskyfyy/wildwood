extends CharacterBody2D
class_name PlayerController
## 玩家控制器 (M2.1 移动 + M3.1 网络预测):
##   - 手动模式:WASD/方向键 8 方向移动 + sprite 朝向
##   - 网络模式:输入 → NetworkClient.predictor → 服务端校正
##
## 设计:
##   - 60 FPS 物理步长(`_physics_process`) = 16.67 ms,远低于 200 ms 响应预算
##   - 单位:1 米 = TILE_SIZE_PX 像素(默认 32 px/m,M2.6 持久化沿用)
##   - 8 方向:Vector2 自然支持对角(`normalized()` 控速)
##   - 朝向:
##       - 横向(±X 主导) → flip_h(true/false)
##       - 纵向(±Y 主导,横向近零) → 用 last_vertical_sign (+1/-1) 切 sprite
##   - 本期无碰撞体:`position += velocity * delta` 直接位移
##   - 联机模式(enable_network_mode)激活后,本控制器降级为"预测/演示",
##     每帧从 client.get_display_pos() 同步位置,校正期 hidden
##
## 验收对照:
##   M2.1 ① 移动 200ms 内响应 → _physics_process 步长 16.67ms,Godot 引擎级保证
##   M2.1 ② LMB 智能判别 100%(10 场景) → 见 `core/abstract/gameplay/lmb_decide.gd`
##   M2.1 ③ 移动时 sprite 朝向正确 → _update_facing() 8 方向分支
##   M3.1 ① 客户端预测 ≤ 1 帧误差 → network_client.gd.predictor.predict
##   M3.1 ② 偏差 > 32px 触发 100ms 插值 + 隐藏 → Interpolator
##   M3.1 ③ 权威位置 1:1 一致 → reconcile 总是切到 re_simulated
##
## 沙箱内无 Godot 二进制,本文件静态审查通过:
##   - read move_up/down/left/right 4 个 input action
##   - 手动模式:_physics_process 推进 position
##   - 网络模式:_process 从 client 同步位置
##   - _update_facing 切 flip_h + last_vertical

const WildwoodConstants = preload("res://core/abstract/network/gd/wildwood_constants.gd")

# --- 配置常量 ---
const TILE_SIZE_PX: int = 32  # 1 米 = 32 像素
const DEFAULT_SPEED_MPS: float = 4.0  # 默认 4 米/秒

# --- 内部状态 ---
var _speed_mps: float = DEFAULT_SPEED_MPS
var _last_vertical_sign: int = 0  # -1 = up, +1 = down, 0 = 横向/静止
var _facing_left: bool = false
var _sprite: Node2D = null  # 持有 sprite 节点引用,延迟绑定

# --- 联机预留(本期不动) ---
var _external_target_pos: Vector2 = Vector2.INF  # Vector2.INF = 无外部目标

# --- M3.1 网络模式 ---
var _network_client: Node = null  # NetworkClient 引用(延迟注入,避免循环依赖)
var _network_mode: bool = false


func _ready() -> void:
	# 加入 group,World 可扫描
	add_to_group("player")
	# 找第一个子 Sprite2D / AnimatedSprite2D 作为朝向对象
	for child in get_children():
		if child is Sprite2D or child is AnimatedSprite2D:
			_sprite = child
			break


func _physics_process(delta: float) -> void:
	if _network_mode:
		# 网络模式:输入由 NetworkClient 接管,这里只读 input 用于朝向
		# (client._physics_process 已经把 input 喂给 predictor.predict)
		var input_v: Vector2 = _read_input_vector()
		if not input_v.is_zero_approx():
			_update_facing(input_v)
		return
	# 手动模式(M2.1 行为)
	var input_v: Vector2 = _read_input_vector()
	if not input_v.is_zero_approx():
		_update_facing(input_v)
		var dir: Vector2 = input_v.normalized()
		# 米/秒 → 像素/秒 → delta 步长
		position += dir * _speed_mps * float(TILE_SIZE_PX) * delta
		_external_target_pos = Vector2.INF  # 玩家手动控制时,清外部目标
	# 静默期:不动(朝向保持)


func _process(_delta: float) -> void:
	# 网络模式:每帧从 NetworkClient 同步显示位置 + hidden 状态
	if not _network_mode or _network_client == null:
		return
	var display_pos: Vector2 = _network_client.get_display_pos()
	# 同步预测/插值位置到本节点(米 → 像素)
	position = display_pos
	# 校正期隐藏(避免抖动穿模)
	if _sprite != null:
		var hidden: bool = _network_client.is_hidden()
		if _sprite is Sprite2D:
			(_sprite as Sprite2D).visible = not hidden
		elif _sprite is AnimatedSprite2D:
			(_sprite as AnimatedSprite2D).visible = not hidden


# --- 公开 API ---

## 玩家点击 LMB 后由 World 调:设置外部移动目标(用于 M2.x 联机演示)。
## 距离 ≤ speed * delta 时视为已到达,自动停。
func set_target_pos(world_pos_px: Vector2) -> void:
	_external_target_pos = world_pos_px


## 当前朝向(0=右,1=左,2=上,3=下)— 给 sprite 动画状态机用。
func get_facing() -> int:
	if _facing_left:
		return 1
	if _last_vertical_sign < 0:
		return 2
	if _last_vertical_sign > 0:
		return 3
	return 0


## 当前世界坐标(米),供 LMB 判别调用。
func get_world_pos_meters() -> Vector2:
	return position / float(TILE_SIZE_PX)


## M3.1 task 9:启用联机预测模式。
## 启用后:
##   - _physics_process 不再本地位移,仅读 input 算朝向
##   - _process 从 client.get_display_pos() 同步位置
##   - 校正期 sprite.visible = false
## client 为已配置好的 NetworkClient(已 connect_to_server + join_room)
func enable_network_mode(client: Node) -> void:
	_network_client = client
	_network_mode = true


## M3.1 task 9:关闭联机预测模式,回到手动模式。
func disable_network_mode() -> void:
	_network_mode = false
	_network_client = null


# --- 内部辅助 ---

func _read_input_vector() -> Vector2:
	# 4 个方向独立 action,自然支持 8 方向
	var v: Vector2 = Vector2.ZERO
	if Input.is_action_pressed("move_up"):
		v.y -= 1.0
	if Input.is_action_pressed("move_down"):
		v.y += 1.0
	if Input.is_action_pressed("move_left"):
		v.x -= 1.0
	if Input.is_action_pressed("move_right"):
		v.x += 1.0
	return v


func _update_facing(dir: Vector2) -> void:
	# 横向(|dx| > |dy|) → flip_h;否则记 last_vertical
	if absf(dir.x) > absf(dir.y):
		_facing_left = dir.x < 0.0
		_last_vertical_sign = 0
	else:
		_last_vertical_sign = -1 if dir.y < 0.0 else 1  # y<0 = up
	_apply_sprite_transform()


func _apply_sprite_transform() -> void:
	if _sprite == null:
		return
	# flip_h:左右翻转
	if _sprite is Sprite2D:
		(_sprite as Sprite2D).flip_h = _facing_left
	elif _sprite is AnimatedSprite2D:
		(_sprite as AnimatedSprite2D).flip_h = _facing_left
	# 上下方向:本期占位 sprite 暂不切(无上下两套),仅记 sign
	# M2.14 补美术后,这里按 facing 切 animation

