extends Node2D
## M2.1 Demo 场景主脚本 — 移动 + LMB 智能判别演示。
##
## 用法:
##   - WASD / 方向键 → 玩家移动(8 方向,60 FPS)
##   - 鼠标左键 → 智能判别(屏幕坐标 → 世界坐标 → 调 LmbDecide → 执行)
##   - ESC → 退出
##   - H → 切换 HUD(默认开)
##
## 验收对照(README §M2.1):
##   ① 移动 200ms 内响应:PlayerController._physics_process 60Hz = 16.67ms << 200ms
##   ② LMB 100% 准确(10 场景):LmbDecide.decide 100% 命中
##   ③ sprite 朝向正确:PlayerController._update_facing 8 方向分支

const PlayerController = preload("res://scripts/player_controller.gd")
const World = preload("res://scripts/world.gd")
const LmbDecide = preload("res://core/abstract/gameplay/lmb_decide.gd")

# 默认参数(米)
const DEFAULT_CTX: Dictionary = {
	"move_range": 4.0,
	"attack_range": 2.0,
	"gather_range": 1.5,
}

var _world: Node = null
var _player: Node = null
var _hud_label: Label = null
var _hud_visible: bool = true
var _last_action: String = "(none)"


func _ready() -> void:
	_world = _find_node_by_name(self, "World")
	_player = _find_node_by_name(self, "Player")
	_hud_label = _find_node_by_name(self, "Hud")
	if _hud_label != null:
		_hud_label.text = "[M2.1 demo]\nWASD/方向键 = 移动\nLMB = 智能判别\nESC = 退出\nH = 切 HUD"
	print("[M2.1] demo ready, world=%s player=%s" % [_world, _player])


func _process(_delta: float) -> void:
	_update_hud()


func _unhandled_input(event: InputEvent) -> void:
	# ESC 退出
	if event.is_action_pressed("ui_cancel"):
		get_tree().quit()
		return

	# H 切 HUD
	if event is InputEventKey and event.pressed and not event.echo:
		if (event as InputEventKey).keycode == KEY_H:
			_hud_visible = not _hud_visible
			if _hud_label != null:
				_hud_label.visible = _hud_visible
			return

	# LMB 智能判别
	if event.is_action_pressed("interact"):
		if _world == null:
			return
		var screen_pos: Vector2 = get_global_mouse_position()
		var action: Dictionary = (_world as World).handle_lmb_click(screen_pos, DEFAULT_CTX)
		(_world as World).execute_action(action)
		_last_action = "[%s] target=%s pos=%s" % [
			action["type"], str(action["target_id"]), str(action["target_pos"])
		]
		print("[M2.1] LMB → %s" % _last_action)


func _update_hud() -> void:
	if _hud_label == null or not _hud_visible:
		return
	var player_pos_m: Vector2 = Vector2.ZERO
	if _player != null and _player is PlayerController:
		player_pos_m = (_player as PlayerController).get_world_pos_meters()
	var facing: int = 0
	if _player != null and _player is PlayerController:
		facing = (_player as PlayerController).get_facing()
	var facing_name: String = ["右", "左", "上", "下"][facing]
	_hud_label.text = "[M2.1 demo]\nplayer(米)=%s\nfacing=%s\nlast action=%s\n\nWASD/方向键=移动\nLMB=智能判别\nESC=退出 H=切HUD" % [
		str(player_pos_m), facing_name, _last_action
	]


# --- 工具 ---

func _find_node_by_name(root: Node, target_name: String) -> Node:
	if root.name == target_name:
		return root
	for c in root.get_children():
		var found: Node = _find_node_by_name(c, target_name)
		if found != null:
			return found
	return null
