extends Node2D
class_name World
## 世界容器 (M2.1):持有玩家 + 目标列表,提供 LMB 判别所需的扫描 API。
##
## 设计:
##   - 玩家引用:World 主动找 group "player" 的第一个节点
##   - 目标:WorldTarget 各自 add_to_group("world_target"),World 扫描
##   - 屏幕坐标 → 世界坐标:用 Camera2D.make_input_local 或反推(get_global_mouse_position)
##   - 本期无碰撞体(SceneTree 几何阻挡留 M2.2 资源 HP 时引入)

const PlayerControllerScript = preload("res://scripts/player_controller.gd")
const LmbDecide = preload("res://core/abstract/gameplay/lmb_decide.gd")

var _player: Node2D = null


func _ready() -> void:
	# 玩家延迟绑定
	call_deferred("_bind_player")


func _bind_player() -> void:
	var players := get_tree().get_nodes_in_group("player")
	if players.size() > 0:
		_player = players[0]


## 取所有候选目标(供 LMB 判别)。
func get_candidates() -> Array:
	var out: Array = []
	for n in get_tree().get_nodes_in_group("world_target"):
		if n is WorldTarget:
			out.append((n as WorldTarget).to_candidate())
	return out


## 玩家引用(可能为 null,未 bind 时)。
func get_player() -> Node2D:
	return _player


## 把屏幕坐标(鼠标点击)转世界坐标(米)。
func screen_to_world_meters(screen_pos: Vector2) -> Vector2:
	if _player == null:
		return Vector2.ZERO
	var world_px: Vector2 = _player.get_global_transform().affine_inverse() * screen_pos
	# 简化:用 get_global_mouse_position 替代(更直观)
	world_px = get_global_mouse_position()
	return world_px / 32.0


## 处理一次 LMB 点击:返回 LmbDecide 决策结果。
func handle_lmb_click(screen_pos: Vector2, ctx: Dictionary = {}) -> Dictionary:
	var player_pos_m: Vector2 = Vector2.ZERO
	if _player != null and _player is PlayerControllerScript:
		player_pos_m = (_player as PlayerControllerScript).get_world_pos_meters()
	var click_pos_m: Vector2 = screen_to_world_meters(screen_pos)
	var candidates: Array = get_candidates()
	return LmbDecide.decide(player_pos_m, candidates, click_pos_m, ctx)


## 执行决策(把 Action 落到玩家 / 视觉反馈)。
func execute_action(action: Dictionary) -> void:
	if _player == null:
		return
	match action["type"]:
		"move":
			(_player as PlayerControllerScript).set_target_pos(action["target_pos"] * 32.0)
		"attack":
			# M2.10 接入,本期仅打印 + 朝向
			print("[M2.1] ATTACK target=%s pos=%s" % [action["target_id"], action["target_pos"]])
		"gather":
			# M2.2 接入,本期仅打印 + 朝向
			print("[M2.1] GATHER target=%s pos=%s" % [action["target_id"], action["target_pos"]])
