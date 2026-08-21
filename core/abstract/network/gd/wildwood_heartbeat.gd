class_name WildwoodHeartbeat
extends RefCounted
## Wildwood M1.10 — 应用层心跳(C2S_Heartbeat → S2C_HeartbeatAck)
##
## M1.9 transport 只做 WebSocket 字节流,不发应用层心跳。
## M1.10 在 NetClient 之上加一个 30s 周期的 ping/pong:
##   - 每 30s 发 C2S_Heartbeat(client_time_ms, ping_seq)
##   - 服务端 1s 内回 S2C_HeartbeatAck(server_time_ms)
##   - 客户端测量 RTT,超时 5s 视为断网 → 触发 reconnect
##
## 这是 M1.10 验收 ① (1s 内回 pong) 的客户端实现。
##
## 用法:
##   var hb = WildwoodHeartbeat.new(client, "0.3.0", "player-1")
##   hb.on_rtt = func(rtt_ms, ping_seq): print("rtt=", rtt_ms, "ms")
##   hb.on_timeout = func(): print("heartbeat timeout, reconnect")
##   hb.start()
##   # ... 每帧调 hb.poll(delta) 推进 ...
##   # ... 离开房间时 hb.stop()

const C2S = preload("res://core/abstract/network/gd/wildwood_c2s.gd")
const S2C = preload("res://core/abstract/network/gd/wildwood_s2c.gd")

const INTERVAL_MS_DEFAULT: int = 30_000   # 30s 发一次心跳
const TIMEOUT_MS_DEFAULT: int = 5_000     # 5s 内没回 pong → 断网
const MAX_PINGS_DEFAULT: int = 3          # 允许连续丢 3 次再告警

var _client                  # WildwoodNet.NetClient (避免循环依赖,运行时校验)
var _client_version: String
var _player_name: String

var interval_ms: int = INTERVAL_MS_DEFAULT
var timeout_ms: int = TIMEOUT_MS_DEFAULT

# 回调(可选)
var on_rtt: Callable = Callable()       # func(rtt_ms: int, ping_seq: int)
var on_timeout: Callable = Callable()    # func()  — 连续 max_pings 次超时后调用
var on_pong: Callable = Callable()       # func(ack) — 每收到 pong 调一次

# 内部状态
var _running: bool = false
var _ping_seq: int = 0
var _last_ping_sent_ms: int = 0
var _awaiting_pong: bool = false
var _consecutive_timeouts: int = 0
var _last_rtt_ms: int = 0
var _total_pings: int = 0
var _total_pongs: int = 0

func _init(client, client_version: String, player_name: String) -> void:
	_client = client
	_client_version = client_version
	_player_name = player_name

func start() -> void:
	_running = true
	_ping_seq = 0
	_awaiting_pong = false
	_consecutive_timeouts = 0
	_total_pings = 0
	_total_pongs = 0

func stop() -> void:
	_running = false
	_awaiting_pong = false

func is_running() -> bool:
	return _running

func get_last_rtt_ms() -> int:
	return _last_rtt_ms

func get_stats() -> Dictionary:
	return {
		"total_pings": _total_pings,
		"total_pongs": _total_pongs,
		"consecutive_timeouts": _consecutive_timeouts,
		"last_rtt_ms": _last_rtt_ms,
		"running": _running,
	}

## 主循环每帧调用:发 ping / 收 pong / 检查超时
func poll(_delta: float) -> void:
	if not _running:
		return
	if _client == null:
		return
	if not _client.is_open():
		return

	# 1) 收 pong (可能一次到多个)
	while true:
		var f: Dictionary = _client.recv()
		if f.get("eof", false):
			# 底层连接已关 — 停心跳
			_running = false
			return
		var t: String = f.get("type", "")
		if t == "":
			break
		if t == "S2C_HeartbeatAck":
			_handle_pong(f["payload"])

	# 2) 检查超时
	if _awaiting_pong:
		var now_ms: int = Time.get_ticks_msec()
		if now_ms - _last_ping_sent_ms > timeout_ms:
			_consecutive_timeouts += 1
			_awaiting_pong = false
			if _consecutive_timeouts >= MAX_PINGS_DEFAULT:
				push_warning("WildwoodHeartbeat: 连续 %d 次超时, 触发 on_timeout" % _consecutive_timeouts)
				if on_timeout.is_valid():
					on_timeout.call()
			else:
				push_warning("WildwoodHeartbeat: ping #%d 超时 (%d ms)" % [_ping_seq, now_ms - _last_ping_sent_ms])

	# 3) 周期性发新 ping
	if not _awaiting_pong:
		var since_last: int = Time.get_ticks_msec() - _last_ping_sent_ms
		if since_last >= interval_ms or _last_ping_sent_ms == 0:
			_send_ping()


func _send_ping() -> void:
	var hb = C2S.Heartbeat.new()
	hb.client_time_ms = Time.get_ticks_msec()
	hb.ping_seq = _ping_seq
	if not _client.send("C2S_Heartbeat", hb):
		return
	_last_ping_sent_ms = Time.get_ticks_msec()
	_awaiting_pong = true
	_total_pings += 1
	_ping_seq += 1


func _handle_pong(payload: PackedByteArray) -> void:
	var arr: Array = S2C.decode("S2C_HeartbeatAck", payload, 0)
	if arr.size() == 0:
		return
	var ack = arr[0]
	if ack == null:
		return
	var now_ms: int = Time.get_ticks_msec()
	_last_rtt_ms = now_ms - int(ack.client_time_ms)
	_awaiting_pong = false
	_consecutive_timeouts = 0
	_total_pongs += 1
	if on_pong.is_valid():
		on_pong.call(ack)
	if on_rtt.is_valid() and _last_rtt_ms >= 0:
		on_rtt.call(_last_rtt_ms, int(ack.ping_seq))
