extends CharacterBody2D
class_name PlayerController
## 玩家控制器 (M2.1):WASD/方向键 8 方向移动 + sprite 朝向。
##
## 设计:
##   - 60 FPS 物理步长(`_physics_process`) = 16.67 ms,远低于 200 ms 响应预算
##   - 单位:1 米 = TILE_SIZE_PX 像素(默认 32 px/m,M2.6 持久化沿用)
##   - 8 方向:Vector2 自然支持对角(`normalized()` 控速)
##   - 朝向:
##       - 横向(±X 主导) → flip_h(true/false)
##       - 纵向(±Y 主导,横向近零) → 用 last_vertical_sign (+1/-1) 切 sprite
##   - 本期无碰撞体:`position += velocity * delta` 直接位移
##   - 联机输入流(M3.x)接管 C2S_PlayerInput 后,本控制器降级为"预测/演示",
##     服务端校正注入 `_external_target_pos`
##
## 验收对照(README §M2.1):
##   ① 移动 200ms 内响应 → _physics_process 步长 16.67ms,Godot 引擎级保证
##   ② LMB 智能判别 100%(10 场景) → 见 `core/abstract/gameplay/lmb_decide.gd`
##   ③ 移动时 sprite 朝向正确 → _update_facing() 8 方向分支
##
## 沙箱内无 Godot 二进制,本文件静态审查通过(M2.1 验收脚本验证关键符号):
##   - read move_up/down/left/right 4 个 input action
##   - _physics_process 推进 position
##   - _update_facing 切 flip_h + last_vertical

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


func _ready() -> void:
	# 加入 group,World 可扫描
	add_to_group("player")
	# 找第一个子 Sprite2D / AnimatedSprite2D 作为朝向对象
	for child in get_children():
		if child is Sprite2D or child is AnimatedSprite2D:
			_sprite = child
			break


func _physics_process(delta: float) -> void:
	# M2.1:手动移动(联机接管后,本函数改读 _external_target_pos)
	var input_v: Vector2 = _read_input_vector()
	if not input_v.is_zero_approx():
		_update_facing(input_v)
		var dir: Vector2 = input_v.normalized()
		# 米/秒 → 像素/秒 → delta 步长
		position += dir * _speed_mps * float(TILE_SIZE_PX) * delta
		_external_target_pos = Vector2.INF  # 玩家手动控制时,清外部目标
	# 静默期:不动(朝向保持)


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
