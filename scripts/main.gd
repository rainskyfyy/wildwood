extends Node
## Main scene root.
##
## M2.1 + M2.2 demo:
##  - 自动连到 ws://127.0.0.1:8080/ws
##  - 握手 → 建/加房 → 加载 WorldSnapshot spawn 资源
##  - WASD 移动 → 客户端预测 + 服务端校正
##  - LMB 智能判别 → 发 GATHER → 1.5s 进度条 → 资源 HP 减少 → sprite 抖动
##  - 联机:全队资源 HP 同步通过 S2C_WorldDelta
##
## 按 ESC 退出。

const PROJECT_VERSION: String = "0.4.0"

const WildwoodSession = preload("res://core/abstract/network/gd/wildwood_session.gd")
const WildwoodNet = preload("res://core/abstract/network/gd/wildwood_net.gd")
const WorldScript = preload("res://scripts/world.gd")
const PlayerScript = preload("res://scripts/player.gd")

const DEFAULT_URL: String = "ws://127.0.0.1:8080/ws"
const ROOM_ID: String = "m2demo"
const PLAYER_NAME: String = "demo-player"

var _session: WildwoodSession = null
var _world: Node = null
var _player: Node = null
var _state: String = "init"


func _ready() -> void:
	print("[Wildwood %s] boot OK (M2.1+M2.2 demo)" % PROJECT_VERSION)

	var url: String = OS.get_environment("WILDSWOOD_SERVER_URL")
	if url == "":
		url = DEFAULT_URL

	_session = WildwoodSession.new(url, PROJECT_VERSION, PLAYER_NAME)
	_session.on_state = _on_session_state
	_session.on_handshake_done = _on_handshake
	_session.on_rtt = _on_rtt
	_session.on_message = _on_message
	_session.on_error = _on_error

	if not _session.connect_to():
		push_warning("[M2.x] connect_to failed, session 自行进入 reconnect 循环")

	# 创建 world + player(UI 层)
	_world = WorldScript.new()
	_world.name = "World"
	add_child(_world)

	_player = PlayerScript.new()
	_player.name = "LocalPlayer"
	_world.add_child(_player)
	_world.setup(_session, _player)

	# 监听 world events
	if _session != null and _session.has_signal("room_joined"):
		_session.connect("room_joined", Callable(self, "_on_room_joined"))
	if _session != null and _session.has_signal("world_delta"):
		_session.connect("world_delta", Callable(self, "_on_world_delta"))


func _process(delta: float) -> void:
	if _session != null:
		_session.poll(delta)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		if _session != null:
			_session.close()
		get_tree().quit()


# ———————————— 业务回调 ————————————

func _on_session_state(state: String, info: Dictionary) -> void:
	_state = state
	print("[M2.x] state=%s info=%s" % [state, info])

func _on_handshake(player_id: String) -> void:
	print("[M2.x] handshake OK player_id=%s" % player_id)
	# 自动建房 + 加入
	if _session != null:
		_session.send_room_create("m2-demo-room", "42", 4)
		# 房主自己也在房间里,无 join

func _on_rtt(rtt_ms: int, ping_seq: int) -> void:
	if rtt_ms > 200:
		print("[M2.x] rtt=%d ms" % rtt_ms)

func _on_message(type_name: String, payload: PackedByteArray) -> void:
	# WildwoodSession 已解 frame;这里只分发业务事件
	# 实际解 PB 在子层;这里简化:用 world.on_world_delta(_parse_dict(payload))
	# 真实场景: lark-cli 走 PB → JSON → dict
	pass

func _on_error(msg: String) -> void:
	push_warning("[M2.x] session error: %s" % msg)

func _on_room_joined(snapshot) -> void:
	if _world != null and _world.has_method("on_room_joined"):
		_world.on_room_joined(snapshot)

func _on_world_delta(delta: Dictionary) -> void:
	if _world != null and _world.has_method("on_world_delta"):
		_world.on_world_delta(delta)
