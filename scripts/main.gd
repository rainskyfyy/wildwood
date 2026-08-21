extends Node
## Main scene root script.
##
## M1.10 demo:启动后,自动建立 WebSocket 连到 ws://127.0.0.1:8080/ws
## (或 WILDSWOOD_SERVER_URL 环境变量指定的地址),发心跳,断网自动重连。
##
## 按 ESC 退出。
##
## 真实 gameplay 场景(HUD / world / inventory)在 M2.x 交付。

const PROJECT_VERSION: String = "0.3.0"

const WildwoodSession = preload("res://core/abstract/network/gd/wildwood_session.gd")
const WildwoodNet = preload("res://core/abstract/network/gd/wildwood_net.gd")
const S2C = preload("res://core/abstract/network/gd/wildwood_s2c.gd")

const DEFAULT_URL: String = "ws://127.0.0.1:8080/ws"

var _session: WildwoodSession = null
var _state_label: String = ""


func _ready() -> void:
	print("[Wildwood %s] boot OK (M1.10 demo)" % PROJECT_VERSION)

	var url: String = OS.get_environment("WILDSWOOD_SERVER_URL")
	if url == "":
		url = DEFAULT_URL

	_session = WildwoodSession.new(url, PROJECT_VERSION, "main-demo-player")
	_session.on_state = _on_session_state
	_session.on_handshake_done = _on_handshake
	_session.on_rtt = _on_rtt
	_session.on_message = _on_message
	_session.on_reconnected = _on_reconnected
	_session.on_giveup = _on_giveup
	_session.on_error = _on_error

	if not _session.connect_to():
		print("[M1.10] connect_to failed, session 自行进入 reconnect 循环")


func _process(_delta: float) -> void:
	if _session != null:
		_session.poll(_delta)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		if _session != null:
			_session.close()
		get_tree().quit()


# ———————————— 业务回调 ————————————

func _on_session_state(state: String, info: Dictionary) -> void:
	_state_label = state
	print("[M1.10] state=%s info=%s" % [state, info])

func _on_handshake(player_id: String) -> void:
	print("[M1.10] handshake OK, player_id=%s, heartbeat 已启动 (30s 周期)" % player_id)

func _on_rtt(rtt_ms: int, ping_seq: int) -> void:
	# M1.10 验收 ①: 1s 内回 pong
	# 真实场景: 写到 UI / log
	if rtt_ms > 1000:
		push_warning("[M1.10] RTT 越界: %d ms (ping #%d)" % [rtt_ms, ping_seq])
	else:
		print("[M1.10] rtt=%d ms (ping #%d)" % [rtt_ms, ping_seq])

func _on_message(type_name: String, payload: PackedByteArray) -> void:
	# 非 heartbeat 的业务消息
	print("[M1.10] msg type=%s size=%d" % [type_name, payload.size()])

func _on_reconnected(attempts: int) -> void:
	# M1.10 验收 ②: 30s 内重连成功
	print("[M1.10] ✓ 重连成功, attempts=%d" % attempts)

func _on_giveup() -> void:
	# 30s 内未恢复
	push_warning("[M1.10] ✗ 30s 重连窗口耗尽, 已放弃")

func _on_error(msg: String) -> void:
	push_warning("[M1.10] session error: %s" % msg)
