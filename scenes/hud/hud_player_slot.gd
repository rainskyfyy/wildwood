extends Control
## HUD 玩家槽位节点 (M2.5 验收 ④)
##
## 验收点 ④ HUD 灰显 50% 透明
##   - ALIVE: 不透明 (alpha=1.0)
##   - GHOST: 50% 透明 + 灰显 (modulate.a=0.5, modulate=Color(0.5,0.5,0.5))
##   - DEAD:  50% 透明 + 灰显(同 GHOST 视觉,显示图标差异)
##
## 协议对齐:slot_visual_state_changed 信号 → 改 self_modulate
##
## 简化:HUD 由 4 个 HudPlayerSlot 组成,本类只负责单个槽位的视觉切换
class_name WildwoodHudPlayerSlot

const C := preload("res://core/survival/death_constants.gd")
const SIG := preload("res://core/survival/survival_signals.gd")

@export var player_id: String = ""

# 内部状态(从外部也可读)
var current_state: int = C.STATE_ALIVE

# 视觉子节点(可被赋值的图标 / 名字)
@onready var _icon: TextureRect = get_node_or_null("Icon")
@onready var _name_label: Label = get_node_or_null("Name")
@onready var _countdown_label: Label = get_node_or_null("Countdown")

func _ready() -> void:
	SIG.slot_visual_state_changed.connect(_on_visual_state_changed)
	_apply_visual()

func setup(p_player_id: String) -> void:
	player_id = p_player_id

func _on_visual_state_changed(payload: Dictionary) -> void:
	if payload.get("player_id") != player_id:
		return
	current_state = int(payload.get("slot_state", C.STATE_ALIVE))
	_apply_visual()

func _apply_visual() -> void:
	# GHOST / DEAD 灰显 50% 透明;ALIVE 正常
	if current_state == C.STATE_GHOST or current_state == C.STATE_DEAD:
		# 灰显:rgb 各降到 50%;透明:alpha 50%
		modulate = Color(0.5, 0.5, 0.5, 0.5)
		if _countdown_label != null and current_state == C.STATE_GHOST:
			# 倒计时由外部 GhostWindow 推;此处只显示占位
			_countdown_label.show()
	else:
		modulate = Color(1, 1, 1, 1)
		if _countdown_label != null:
			_countdown_label.hide()

func set_countdown_text(text: String) -> void:
	if _countdown_label != null:
		_countdown_label.text = text
