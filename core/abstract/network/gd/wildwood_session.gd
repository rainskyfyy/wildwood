class_name WildwoodSession
extends RefCounted
## Wildwood M1.10 — 完整会话: Connect → Handshake → Heartbeat → Reconnect
##
## 组合 WildwoodNet.NetClient + WildwoodHeartbeat + WildwoodReconnect,
## 是 M1.10 demo 的"开箱即用"高层封装。
##
## 一次完整流程:
##   1. connect_to(url) → 拨号 → 握手 → 启动心跳 → state=connected
##   2. 每帧 poll(delta) 推进所有组件
##   3. 收到 S2C_HeartbeatAck → 测 RTT (验证 ① 1s 内回 pong)
##   4. 断网 / 心跳超时 → 触发重连 (验证 ② 30s 自动重连)
##   5. 重连成功 → 重新握手 + 恢复心跳,state=connected
##   6. 30s 内未恢复 → state=failed, 通知用户
##
## 用法:
##   var sess = WildwoodSession.new("ws://127.0.0.1:8080/ws", "0.3.0", "player-1")
##   sess.on_state = func(s, info): print("state=", s, info)
##   sess.on_rtt = func(rtt): print("rtt=", rtt, "ms")
##   sess.connect_to()
##   # ... 每帧 sess.poll(delta) ...

const WildwoodNet = preload("res://core/abstract/network/gd/wildwood_net.gd")
const WildwoodHeartbeat = preload("res://core/abstract/network/gd/wildwood_heartbeat.gd")
const WildwoodReconnect = preload("res://core/abstract/network/gd/wildwood_reconnect.gd")
const C2S = preload("res://core/abstract/network/gd/wildwood_c2s.gd")
const S2C = preload("res://core/abstract/network/gd/wildwood_s2c.gd")

# 状态
const STATE_IDLE: String = "idle"
const STATE_CONNECTING: String = "connecting"
const STATE_HANDSHAKING: String = "handshaking"
const STATE_CONNECTED: String = "connected"
const STATE_RECONNECTING: String = "reconnecting"
const STATE_FAILED: String = "failed"

var _url: String
var _client_version: String
var _player_name: String

# 回调
var on_state: Callable = Callable()         # func(state: String, info: Dictionary)
var on_handshake_done: Callable = Callable() # func(player_id: String)
var on_rtt: Callable = Callable()           # func(rtt_ms: int, ping_seq: int)
var on_message: Callable = Callable()       # func(type_name: String, payload: PackedByteArray) — 业务消息
var on_reconnected: Callable = Callable()   # func(attempts: int)
var on_giveup: Callable = Callable()        # func()
var on_error: Callable = Callable()         # func(msg: String)

# 内部组件
var _client: WildwoodNet.NetClient = null
var _heartbeat: WildwoodHeartbeat = null
var _reconnect: WildwoodReconnect = null
var _state: String = STATE_IDLE
var _player_id: String = ""
var _last_error: String = ""
var _connected_at_ms: int = 0
var _handshake_deadline_ms: int = 0

func _init(url: String, client_version: String, player_name: String) -> void:
	_url = url
	_client_version = client_version
	_player_name = player_name
	_reconnect = WildwoodReconnect.new()
	_reconnect.attempt_callable = _attempt_reconnect
	_reconnect.on_state_change = _on_reconnect_state
	_reconnect.on_reconnected = func(attempts: int):
		if on_reconnected.is_valid():
			on_reconnected.call(attempts)
	_reconnect.on_giveup = func():
		_set_state(STATE_FAILED, {"reason": "reconnect_giveup"})
		if on_giveup.is_valid():
			on_giveup.call()
	_reconnect.on_attempt = func(attempt: int):
		# 每次重试: 创建新 client + 尝试握手
		_create_new_client()

func get_state() -> String:
	return _state

func get_url() -> String:
	return _url

func get_player_id() -> String:
	return _player_id

func get_stats() -> Dictionary:
	return {
		"state": _state,
		"url": _url,
		"player_id": _player_id,
		"last_error": _last_error,
		"connected_at_ms": _connected_at_ms,
		"heartbeat": _heartbeat.get_stats() if _heartbeat != null else {},
		"reconnect": {
			"attempts": _reconnect.get_reconnect_attempts(),
			"total_reconnects": _reconnect.get_total_reconnects(),
			"state": _reconnect.get_state(),
		},
	}

## 主动发起连接
func connect_to() -> bool:
	_set_state(STATE_CONNECTING, {})
	_create_new_client()
	return _try_open_and_handshake()

## 主动关闭
func close() -> void:
	_reconnect.shutdown()
	if _heartbeat != null:
		_heartbeat.stop()
	if _client != null:
		_client.close(1000, "user_close")
	_set_state(STATE_IDLE, {})

## 主循环每帧调用
func poll(delta: float) -> void:
	match _state:
		STATE_CONNECTING, STATE_HANDSHAKING:
			# 推进 client,看握手是否完成
			_client.poll(delta)
			_check_handshake()
		STATE_CONNECTED:
			_client.poll(delta)
			_drain_business_messages()
			if _heartbeat != null:
				_heartbeat.poll(delta)
			# 监测底层断网
			if _client.is_closed():
				_handle_disconnect("client_closed")
		STATE_RECONNECTING:
			_reconnect.poll(delta)

## ———————————— 内部 ————————————

func _create_new_client() -> void:
	if _client != null:
		_client.close(1000, "recreate")
	_client = WildwoodNet.NetClient.new()


func _try_open_and_handshake() -> bool:
	if _client == null:
		return false
	var err: int = _client.connect_to(_url)
	if err != OK:
		_last_error = "connect_to err=%d" % err
		return false
	_set_state(STATE_HANDSHAKING, {})
	_handshake_deadline_ms = Time.get_ticks_msec() + 5000  # 5s 握手超时
	return true


func _check_handshake() -> bool:
	if not _client.is_open():
		# TCP 还没连上;看是否超时
		if Time.get_ticks_msec() > _handshake_deadline_ms:
			_last_error = "tcp_handshake_timeout"
			_handle_disconnect(_last_error)
			return false
		return false
	# TCP 通了,发 C2S_Handshake + 等 S2C_HandshakeAck
	# 检查是否已经发过
	if _state == STATE_HANDSHAKING:
		# 发 Handshake
		var h = C2S.Handshake.new()
		h.client_version = _client_version
		h.player_name = _player_name
		_client.send("C2S_Handshake", h)
		# 尝试读 S2C_HandshakeAck
		var f: Dictionary = _client.recv()
		if f.get("eof", false):
			_handle_disconnect("eof_during_handshake")
			return false
		if f.get("type", "") == "S2C_HandshakeAck":
			var arr: Array = S2C.decode("S2C_HandshakeAck", f["payload"], 0)
			if arr.size() > 0 and arr[0] != null:
				_player_id = str(arr[0].player_id)
				_connected_at_ms = Time.get_ticks_msec()
				_start_heartbeat()
				_reconnect.mark_connected()
				_set_state(STATE_CONNECTED, {"player_id": _player_id})
				if on_handshake_done.is_valid():
					on_handshake_done.call(_player_id)
				return true
		# 还没收到 ack,继续等
	return false


func _start_heartbeat() -> void:
	if _heartbeat == null:
		_heartbeat = WildwoodHeartbeat.new(_client, _client_version, _player_name)
		_heartbeat.on_rtt = func(rtt_ms: int, ping_seq: int):
			if on_rtt.is_valid():
				on_rtt.call(rtt_ms, ping_seq)
		_heartbeat.on_timeout = func():
			_handle_disconnect("heartbeat_timeout")
	_heartbeat.start()


func _drain_business_messages() -> void:
	while _client != null and _client.is_open():
		var f: Dictionary = _client.recv()
		if f.get("eof", false):
			_handle_disconnect("eof_during_session")
			return
		var t: String = f.get("type", "")
		if t == "":
			return
		if t == "S2C_HeartbeatAck":
			# heartbeat 模块自己处理
			if _heartbeat != null:
				_heartbeat.poll(0.0)
			continue
		if on_message.is_valid():
			on_message.call(t, f["payload"])


func _handle_disconnect(reason: String) -> void:
	if _state == STATE_RECONNECTING or _state == STATE_FAILED or _state == STATE_IDLE:
		return
	_last_error = reason
	if _heartbeat != null:
		_heartbeat.stop()
	if on_error.is_valid():
		on_error.call(reason)
	_reconnect.start_reconnect()
	_set_state(STATE_RECONNECTING, {"reason": reason})


func _attempt_reconnect() -> Dictionary:
	# 已经被 _reconnect.on_attempt 提前创建了 client
	# 这里执行 open + handshake
	if not _try_open_and_handshake():
		return {"ok": false, "error": _last_error}
	# 等待握手完成 (TCP connect 是非阻塞的,握手也异步)
	# 这里用 busy-poll 直到握手完成或 3s 超时
	var deadline: int = Time.get_ticks_msec() + 3000
	while Time.get_ticks_msec() < deadline:
		_client.poll(0.0)
		if _state == STATE_CONNECTED:
			return {"ok": true, "player_id": _player_id}
		if _state == STATE_FAILED or _state == STATE_IDLE:
			return {"ok": false, "error": "reconnect_aborted"}
	return {"ok": false, "error": "handshake_timeout"}


func _on_reconnect_state(s: String) -> void:
	# reconnect 模块的状态变化已经通过 _set_state(STATE_RECONNECTING/...) 转出去了
	# 这里只做日志
	if s == WildwoodReconnect.STATE_FAILED:
		_set_state(STATE_FAILED, {"reason": "reconnect_giveup"})


func _set_state(s: String, info: Dictionary) -> void:
	if _state == s:
		return
	_state = s
	if on_state.is_valid():
		on_state.call(s, info)
