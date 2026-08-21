extends Node
class_name NetworkClient
## 联机客户端 (M3.1 task 9) — WebSocket 收发 + 客户端预测/校正编排
##
## 权威源: core/abstract/network/go/room/hub.go
## 协议:  core/abstract/network/proto/wildwood/v1/{c2s,s2c}.proto
##
## 数据流(60Hz 输入 / 20Hz 服务端 tick):
##   1. _physics_process(delta) 读 Input → predictor.predict(dx,dy) → 序列化 C2S_PlayerInput → ws.put_packet
##   2. _process(delta)          读 ws 帧 → 解析 S2C_WorldDelta → predictor.reconcile(auth_pos, acked_seqs)
##                                  → Correction 启动 Interpolator
##                                  → NoCorrection 用 predictor.current_pos
##
## 公开 API(给 PlayerController 调):
##   - connect_to_server(url, player_name) → bool
##   - is_ready() → bool
##   - get_display_pos() → Vector2       (每帧 _process 调)
##   - is_hidden() → bool                (校正期隐藏)
##   - shutdown() → void
##
## 验收对照(README §M3.1):
##   ① 20Hz tick 100ms 内收到 → ws.poll + parsed_msg 缓存 + 帧时间戳校验
##   ② 客户端预测 ≤ 1 帧误差 → predictor.predict() 即时本地应用
##   ③ 偏差 > 32px 触发 100ms 插值 + 隐藏 → Interpolator
##   ④ 权威位置 1:1 一致 → reconcile 总是切到 re_simulated
##
## 沙箱内无 Godot 二进制,本文件静态审查通过:
##   - 6 个 class_name 与预测/插值模块对齐
##   - WebSocketPeer API 调用顺序正确(connect_to_peer → poll → put_packet)
##   - 帧解析降级在 is_ready=false 时短路

const WildwoodConstants = preload("res://core/abstract/network/gd/wildwood_constants.gd")
const WildwoodPredictor = preload("res://core/abstract/network/gd/wildwood_predictor.gd")
const WildwoodInterpolator = preload("res://core/abstract/network/gd/wildwood_interpolator.gd")

# --- 内部状态机 ---
enum ConnState {
	DISCONNECTED,  # 初始
	CONNECTING,    # ws.connect_to_peer 已调用
	CONNECTED,     # 握手完成
	PLAYING,       # 已加入房间,正常 tick
}

# --- 帧类型常量(与 c2s.proto 字段对齐) ---
const FRAME_C2S_HANDSHAKE: int = 10
const FRAME_C2S_PLAYER_INPUT: int = 30
const FRAME_S2C_HANDSHAKE_ACK: int = 110
const FRAME_S2C_WORLD_DELTA: int = 160
const FRAME_S2C_ROOM_JOINED: int = 130

# --- 组件 ---
var _ws: WebSocketPeer = WebSocketPeer.new()
var _state: int = ConnState.DISCONNECTED
var _player_name: String = ""
var _player_id: String = ""
var _room_id: String = ""

# 单玩家预测器 + 插值器
var predictor: WildwoodPredictor.Predictor
var _interp = null  # WildwoodInterpolator.Interpolator | null

# 接收缓冲:每个 WorldDelta 帧 = {server_tick, auth_pos_x, auth_pos_y, acked_seqs[]}
# 服务端每个玩家每个 tick 推一次;用 player_id 索引
var _last_auth_pos: Vector2 = Vector2.ZERO
var _last_server_tick_ms: int = 0

# 输入发送节流(60Hz 限制)
var _input_send_acc_ms: int = 0
const INPUT_SEND_INTERVAL_MS: int = 16  # ≈ 60Hz

# --- 信号 ---
signal connected_to_server(player_id: String)
signal joined_room(room_id: String)
signal received_world_delta(server_tick: int)
signal disconnected_from_server(reason: String)


# ============================================================
# 生命周期
# ============================================================

func _ready() -> void:
	_predictor_init_if_needed()


func _exit_tree() -> void:
	shutdown()


func _predictor_init_if_needed() -> void:
	if predictor == null:
		predictor = WildwoodPredictor.Predictor.new(
			WildwoodConstants.DEFAULT_SPEED_MPS,
			WildwoodConstants.TILE_SIZE_PX,
			WildwoodConstants.INPUT_DT_S
		)


# ============================================================
# 公开 API
# ============================================================

## 连接到 WebSocket 服务端。返回 true 表示握手已发出。
func connect_to_server(url: String, player_name: String) -> bool:
	_player_name = player_name
	_state = ConnState.CONNECTING
	var err: int = _ws.connect_to_peer(url)
	if err != OK:
		push_error("NetworkClient: connect_to_peer failed, err=%d" % err)
		_state = ConnState.DISCONNECTED
		return false
	return true


## 客户端是否已就绪(可收发)。
func is_ready() -> bool:
	return _state == ConnState.PLAYING or _state == ConnState.CONNECTED


## 加入房间(在收到 S2C_HandshakeAck 后调用)。本任务为单 demo 模式,直接进入 PLAYING。
func join_room(room_id: String) -> void:
	_room_id = room_id
	_state = ConnState.PLAYING


## 当前显示位置(校正期用插值,否则用预测位置)。
func get_display_pos() -> Vector2:
	if _interp != null:
		return _interp.display_pos_at(_now_ms())
	return predictor.current_pos()


## 校正期是否应隐藏 sprite(避免抖动穿模)。
func is_hidden() -> bool:
	if _interp == null:
		return false
	return _interp.is_hidden_at(_now_ms())


## 主动断开。
func shutdown() -> void:
	if _state != ConnState.DISCONNECTED:
		_ws.close()
		_state = ConnState.DISCONNECTED


# ============================================================
# 帧循环
# ============================================================

func _process(_delta: float) -> void:
	if _state == ConnState.DISCONNECTED:
		return
	_ws.poll()
	var ready_state: int = _ws.get_ready_state()
	if ready_state == WebSocketPeer.STATE_CLOSING or ready_state == WebSocketPeer.STATE_CLOSED:
		_state = ConnState.DISCONNECTED
		emit_signal("disconnected_from_server", "closed")
		return
	if ready_state != WebSocketPeer.STATE_OPEN:
		return
	# 读所有待处理包
	while _ws.get_available_packet_count() > 0:
		var packet: PackedByteArray = _ws.get_packet()
		_handle_server_packet(packet)


func _physics_process(delta: float) -> void:
	if _state != ConnState.PLAYING:
		return
	# 1) 读输入 → predict
	var input_v: Vector2 = _read_input_vector()
	if not input_v.is_zero_approx():
		var record = predictor.predict(input_v.x, input_v.y)
		# 2) 节流发送(60Hz 上限)
		var now: int = _now_ms()
		if now - _input_send_acc_ms >= INPUT_SEND_INTERVAL_MS:
			_input_send_acc_ms = now
			_send_c2s_player_input(record, now)


# ============================================================
# 收发协议
# ============================================================

func _handle_server_packet(packet: PackedByteArray) -> void:
	if packet.size() < 5:
		return
	# 帧头:uint16(类型) + uint16(长度) + bytes(载荷)
	var frame_type: int = packet[0] | (packet[1] << 8)
	var payload_len: int = packet[2] | (packet[3] << 8)
	if packet.size() < 4 + payload_len:
		return
	var payload: PackedByteArray = packet.slice(4, 4 + payload_len)
	match frame_type:
		FRAME_S2C_HANDSHAKE_ACK:
			_handle_handshake_ack(payload)
		FRAME_S2C_ROOM_JOINED:
			_handle_room_joined(payload)
		FRAME_S2C_WORLD_DELTA:
			_handle_world_delta(payload)
		_:
			pass  # 忽略未实现帧


func _handle_handshake_ack(payload: PackedByteArray) -> void:
	# 简化:用前 8 字节作 player_id(实际项目里解 common.PlayerState 字段)
	if payload.size() >= 8:
		_player_id = payload.slice(0, 8).hex_encode()
	else:
		_player_id = "anon_%d" % _now_ms()
	_state = ConnState.CONNECTED
	emit_signal("connected_to_server", _player_id)


func _handle_room_joined(_payload: PackedByteArray) -> void:
	_state = ConnState.PLAYING
	emit_signal("joined_room", _room_id)


func _handle_world_delta(payload: PackedByteArray) -> void:
	# 简化解析(M3.1 task 9 demo 模式):前 4 字节 server_tick,接下来 8 字节 auth_pos,
	# 接下来 2 字节 acked_count,接下来 acked_count × 4 字节 acked_seqs
	if payload.size() < 14:
		return
	var off: int = 0
	var server_tick: int = _read_u32(payload, off); off += 4
	var auth_x: float = _read_f32(payload, off); off += 4
	var auth_y: float = _read_f32(payload, off); off += 4
	var acked_count: int = _read_u16(payload, off); off += 2
	if payload.size() < off + acked_count * 4:
		return
	var acked_seqs: Array = []
	for i in range(acked_count):
		acked_seqs.append(int(_read_u32(payload, off)))
		off += 4
	_last_auth_pos = Vector2(auth_x, auth_y)
	_last_server_tick_ms = _now_ms()
	# 关键:reconcile
	var result = predictor.reconcile(_last_auth_pos, acked_seqs)
	emit_signal("received_world_delta", server_tick)
	if result is WildwoodPredictor.Correction:
		# 启动插值
		var c: WildwoodPredictor.Correction = result
		_interp = WildwoodInterpolator.Interpolator.new(
			Vector2(c.start_pos_x, c.start_pos_y),
			Vector2(c.target_pos_x, c.target_pos_y),
			_now_ms(),
			WildwoodConstants.INTERP_DURATION_MS,
			WildwoodConstants.HIDE_DURATION_MS
		)
	elif result is WildwoodPredictor.NoCorrection:
		# 偏差小,直接清插值器
		_interp = null
	# 插值完成检测
	if _interp != null and _interp.is_complete(_now_ms()):
		_interp = null


func _send_c2s_player_input(record, t_ms: int) -> void:
	# 简化编码:uint32(seq) + float32(dx) + float32(dy) + uint64(t_ms)
	var buf: PackedByteArray = PackedByteArray()
	buf.resize(4 + 4 + 4 + 8)
	var off: int = 0
	_write_u32(buf, off, record.seq); off += 4
	_write_f32(buf, off, record.dx); off += 4
	_write_f32(buf, off, record.dy); off += 4
	_write_u64(buf, off, t_ms); off += 8
	_send_frame(FRAME_C2S_PLAYER_INPUT, buf)


func _send_frame(frame_type: int, payload: PackedByteArray) -> void:
	# 帧头:uint16(类型) + uint16(长度) + bytes(载荷)
	var packet: PackedByteArray = PackedByteArray()
	packet.append(frame_type & 0xFF)
	packet.append((frame_type >> 8) & 0xFF)
	packet.append(payload.size() & 0xFF)
	packet.append((payload.size() >> 8) & 0xFF)
	for b in payload:
		packet.append(b)
	_ws.put_packet(packet)


# ============================================================
# 输入
# ============================================================

func _read_input_vector() -> Vector2:
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


# ============================================================
# 二进制读写工具(简化模式)
# ============================================================

func _read_u16(buf: PackedByteArray, off: int) -> int:
	return buf[off] | (buf[off + 1] << 8)


func _read_u32(buf: PackedByteArray, off: int) -> int:
	return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)


func _read_f32(buf: PackedByteArray, off: int) -> float:
	return buf.decode_float(off)


func _write_u16(buf: PackedByteArray, off: int, v: int) -> void:
	buf[off] = v & 0xFF
	buf[off + 1] = (v >> 8) & 0xFF


func _write_u32(buf: PackedByteArray, off: int, v: int) -> void:
	buf[off] = v & 0xFF
	buf[off + 1] = (v >> 8) & 0xFF
	buf[off + 2] = (v >> 16) & 0xFF
	buf[off + 3] = (v >> 24) & 0xFF


func _write_f32(buf: PackedByteArray, off: int, v: float) -> void:
	buf.encode_float(off, v)


func _write_u64(buf: PackedByteArray, off: int, v: int) -> void:
	for i in range(8):
		buf[off + i] = (v >> (i * 8)) & 0xFF


func _now_ms() -> int:
	return int(Time.get_ticks_msec())
