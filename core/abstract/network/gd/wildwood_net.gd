class_name WildwoodNet
extends RefCounted
## Wildwood M1.5 — 高层网络抽象(NetClient/NetServer)
##
## 提供:
##   1. MockPipe  + MockEndpoint: 内存管道(对端为 MockClient/MockServer)
##   2. MockClient/MockServer: 协议层 mock 实现(对标 Go mocks 包)
##   3. NetClient/NetServer: 真实传输层桩位(M1.9 由工作台搭建师补)
##
## A/B 通用:不依赖 WebSocket/UDP/QUIC;只暴露字符串类型 + 二进制帧。
##
## 用法(参考 Go mocks/server_test.go):
##   var pipe = WildwoodNet.MockPipe.new()
##   var srv  = WildwoodNet.MockServer.new(pipe.server_endpoint())
##   var cli  = WildwoodNet.MockClient.new(pipe.client_endpoint())
##   srv.start()
##   cli.handshake("0.1.0", "player-1")
##   var resp = await cli.recv()

const WildwoodWire = preload("res://core/abstract/network/gd/wildwood_wire.gd")
const C2S = preload("res://core/abstract/network/gd/wildwood_c2s.gd")
const S2C = preload("res://core/abstract/network/gd/wildwood_s2c.gd")
const CommonTypes = preload("res://core/abstract/network/gd/wildwood_common.gd")


# ============================================================
# MockPipe + MockEndpoint(协程安全双向字节管道)
# ============================================================
## 内部用 Godot Mutex + Semaphore 实现;read 在没有数据时阻塞,
## write 后唤醒对端 read;close 后所有阻塞 read 返回 EOF 标志。
## ============================================================

class SyncBuffer:
	var _mutex: Mutex = Mutex.new()
	var _sem: Semaphore = Semaphore.new()
	var _buf: PackedByteArray = PackedByteArray()
	var _closed: bool = false

	## 阻塞读;返回 [data, eof]
	func read() -> Array:
		_mutex.lock()
		while _buf.size() == 0:
			if _closed:
				_mutex.unlock()
				return [PackedByteArray(), true]
			_mutex.unlock()
			_sem.wait()
			_mutex.lock()
		var data: PackedByteArray = _buf
		_buf = PackedByteArray()
		var eof: bool = _closed
		_mutex.unlock()
		return [data, eof]

	## 写;若已关闭则返回 false
	func write(data: PackedByteArray) -> bool:
		_mutex.lock()
		if _closed:
			_mutex.unlock()
			return false
		_buf.append_array(data)
		_mutex.unlock()
		_sem.post()
		return true

	func close() -> void:
		_mutex.lock()
		_closed = true
		_mutex.unlock()
		_sem.post()  # 唤醒阻塞的读


## MockPipe = 客户端写 → 服务端读,服务端写 → 客户端读
class MockPipe:
	var _c2s: SyncBuffer = SyncBuffer.new()
	var _s2c: SyncBuffer = SyncBuffer.new()

	func client_endpoint() -> MockEndpoint:
		return MockEndpoint.new(_s2c, _c2s)

	func server_endpoint() -> MockEndpoint:
		return MockEndpoint.new(_c2s, _s2c)


## MockEndpoint = 读端(reader)+ 写端(writer)
class MockEndpoint:
	var _reader: SyncBuffer
	var _writer: SyncBuffer

	func _init(reader: SyncBuffer, writer: SyncBuffer) -> void:
		_reader = reader
		_writer = writer

	## 用 type_name 查表 → encode → 帧;返回是否成功
	func send(type_name: String, value) -> bool:
		var payload: PackedByteArray
		if type_name.begins_with("C2S_"):
			payload = C2S.encode(type_name, value)
		elif type_name.begins_with("S2C_"):
			payload = S2C.encode(type_name, value)
		else:
			push_error("MockEndpoint.send: unknown direction %s" % type_name)
			return false
		if payload.size() == 0 and not _is_zero_value(type_name, value):
			return false
		var frame: PackedByteArray = WildwoodWire.encode_frame(type_name, payload)
		if frame.size() == 0:
			return false
		return _writer.write(frame)

	## 阻塞读一条帧;返回 {type, payload} 或 {type="", eof=true}
	func recv() -> Dictionary:
		var r: Array = _reader.read()
		var data: PackedByteArray = r[0]
		var eof: bool = r[1]
		if data.size() == 0 and eof:
			return {"type": "", "payload": PackedByteArray(), "eof": true}
		var reader: WildwoodWire.FrameReader = WildwoodWire.FrameReader.new()
		var frames: Array = reader.feed(data)
		if frames.size() == 0:
			return {"type": "", "payload": PackedByteArray(), "eof": eof}
		return {
			"type": frames[0]["type"],
			"payload": frames[0]["payload"],
			"eof": eof,
		}

	func close() -> void:
		_writer.close()


# ============================================================
# MockServer:协议层 mock,处理完整房间生命周期
# 对标 go/mocks/server.go
# ============================================================

class MockServer:
	var _ep: MockEndpoint
	var _mu: Mutex = Mutex.new()
	var _rooms: Dictionary = {}  # room_id -> Dictionary
	var _player_seq: int = 0
	var _thread: Thread = null
	var _running: bool = false
	var _on_frame_callback: Callable = Callable()  # for tests/observability

	func _init(ep: MockEndpoint) -> void:
		_ep = ep

	func start() -> void:
		if _running:
			return
		_running = true
		_thread = Thread.new()
		_thread.start(_run_loop)

	func stop() -> void:
		if not _running:
			return
		_running = false
		_ep.close()
		if _thread != null:
			_thread.wait_to_finish()
			_thread = null

	func _run_loop() -> void:
		while _running:
			var f: Dictionary = _ep.recv()
			if f.get("eof", false) and f.get("type", "") == "":
				break
			if f.get("type", "") == "":
				# no full frame yet;continue(可能 close 之后空)
				if f.get("eof", false):
					break
				continue
			_handle(f["type"], f["payload"])
		if _on_frame_callback.is_valid():
			_on_frame_callback.call({})

	func _handle(type_name: String, payload: PackedByteArray) -> void:
		match type_name:
			"C2S_Handshake":
				var arr: Array = C2S.decode("C2S_Handshake", payload, 0)
				var req = arr[0]
				_player_seq += 1
				var ack = S2C.HandshakeAck.new()
				ack.server_version = "0.1.0"
				ack.player_id = "p-%d" % _player_seq
				ack.session_token = "mock-session-token"
				ack.server_tick_rate = 20
				ack.max_room_players = 4
				_ep.send("S2C_HandshakeAck", ack)
			"C2S_Heartbeat":
				var arr2: Array = C2S.decode("C2S_Heartbeat", payload, 0)
				var hb = arr2[0]
				var ack2 = S2C.HeartbeatAck.new()
				ack2.client_time_ms = hb.client_time_ms
				ack2.ping_seq = hb.ping_seq
				ack2.server_time_ms = Time.get_ticks_msec()
				_ep.send("S2C_HeartbeatAck", ack2)
			"C2S_RoomCreate":
				var arr3: Array = C2S.decode("C2S_RoomCreate", payload, 0)
				var rc = arr3[0]
				_player_seq += 1
				var room_id: String = "r-%05d" % _player_seq
				_player_seq += 1
				var join_token: String = "t-%05d" % _player_seq
				_mu.lock()
				_rooms[room_id] = {
					"id": room_id,
					"join_token": join_token,
					"max_players": 4,
					"members": [],
				}
				_mu.unlock()
				var created = S2C.RoomCreated.new()
				created.room_id = room_id
				created.join_token = join_token
				created.max_players = 4
				_ep.send("S2C_RoomCreated", created)
			"C2S_RoomJoin":
				var arr4: Array = C2S.decode("C2S_RoomJoin", payload, 0)
				var rj = arr4[0]
				_player_seq += 1
				var new_pid: String = "p-%d" % _player_seq
				_mu.lock()
				var room = _rooms.get(rj.room_id, null)
				if room == null or room["join_token"] != rj.join_token:
					_mu.unlock()
					var err = S2C.Error.new()
					err.code = CommonTypes.RoomErrorCode.NOT_FOUND
					err.message = "room not found or invalid token"
					err.context = rj.room_id
					_ep.send("S2C_Error", err)
					return
				if room["members"].size() >= int(room["max_players"]):
					_mu.unlock()
					var err2 = S2C.Error.new()
					err2.code = CommonTypes.RoomErrorCode.FULL
					err2.message = "room is full (4/4)"
					err2.context = rj.room_id
					_ep.send("S2C_Error", err2)
					return
				var member = CommonTypes.PlayerState.new()
				member.player_id = new_pid
				member.player_name = "mock-player"
				var pos = CommonTypes.Vec2F.new()
				pos.x = 0.0
				pos.y = 0.0
				member.position = pos
				member.facing = 0.0
				member.color_rgb = 0xc89058
				member.is_alive = true
				room["members"].append(member)
				var members_copy: Array = room["members"].duplicate()
				_mu.unlock()
				var rjd = S2C.RoomJoined.new()
				rjd.room_id = rj.room_id
				rjd.player_id = new_pid
				rjd.members = members_copy
				var snap = CommonTypes.WorldSnapshot.new()
				snap.server_tick = 1
				snap.server_time_ms = Time.get_ticks_msec()
				snap.players = members_copy
				snap.world_seed = "42"
				snap.season = "autumn"
				snap.day = 1
				rjd.initial_state = snap
				rjd.server_tick = 1
				_ep.send("S2C_RoomJoined", rjd)
			"C2S_PlayerInput":
				var arr5: Array = C2S.decode("C2S_PlayerInput", payload, 0)
				var pi = arr5[0]
				var delta = S2C.WorldDelta.new()
				delta.server_tick = 1
				delta.server_time_ms = Time.get_ticks_msec()
				delta.acked_input_seqs = [pi.input_seq]
				_ep.send("S2C_WorldDelta", delta)
			"C2S_ChatMsg":
				var arr6: Array = C2S.decode("C2S_ChatMsg", payload, 0)
				var cm = arr6[0]
				var cb = S2C.ChatBroadcast.new()
				cb.channel = cm.channel
				cb.sender_id = "p-mock"
				cb.sender_name = "mock-player"
				cb.target_player_id = cm.target_player_id
				cb.text = cm.text
				cb.server_time_ms = Time.get_ticks_msec()
				_ep.send("S2C_ChatBroadcast", cb)
			"C2S_Disconnect":
				_ep.close()
			_:
				push_warning("MockServer: unknown C2S type %s" % type_name)

	func send_s2c(type_name: String, value) -> bool:
		# 供测试主动推送用
		return _ep.send(type_name, value)


# ============================================================
# MockClient:协议层 mock 客户端
# 对标 go/mocks/server.go::MockClient
# ============================================================

class MockClient:
	var _ep: MockEndpoint

	func _init(ep: MockEndpoint) -> void:
		_ep = ep

	func handshake(version: String, name: String) -> bool:
		var h = C2S.Handshake.new()
		h.client_version = version
		h.player_name = name
		return _ep.send("C2S_Handshake", h)

	func heartbeat() -> bool:
		var h = C2S.Heartbeat.new()
		h.client_time_ms = Time.get_ticks_msec()
		h.ping_seq = 1
		return _ep.send("C2S_Heartbeat", h)

	func create_room(room_name: String, world_seed: String) -> bool:
		var r = C2S.RoomCreate.new()
		r.room_name = room_name
		r.world_seed = world_seed
		r.max_players = 4
		return _ep.send("C2S_RoomCreate", r)

	func join_room(room_id: String, join_token: String) -> bool:
		var j = C2S.RoomJoin.new()
		j.room_id = room_id
		j.join_token = join_token
		return _ep.send("C2S_RoomJoin", j)

	func player_input(seq: int, action: int) -> bool:
		var p = C2S.PlayerInput.new()
		p.input_seq = seq
		p.action = action
		p.client_time_ms = Time.get_ticks_msec()
		return _ep.send("C2S_PlayerInput", p)

	func chat(channel: int, text: String) -> bool:
		var c = C2S.ChatMsg.new()
		c.channel = channel
		c.text = text
		c.client_time_ms = Time.get_ticks_msec()
		return _ep.send("C2S_ChatMsg", c)

	func disconnect() -> bool:
		var d = C2S.Disconnect.new()
		d.reason = "user_quit"
		return _ep.send("C2S_Disconnect", d)

	func recv() -> Dictionary:
		return _ep.recv()

	## 阻塞接收并按 type_name 自动 decode;返回 decode 后的对象或 null(EOF/不匹配)
	func recv_typed(type_name: String) -> Variant:
		var f: Dictionary = _ep.recv()
		if f.get("eof", false):
			return null
		if f.get("type", "") != type_name:
			return null
		if type_name.begins_with("C2S_"):
			return C2S.decode(type_name, f["payload"], 0)[0]
		if type_name.begins_with("S2C_"):
			return S2C.decode(type_name, f["payload"], 0)[0]
		return null

	func close() -> void:
		_ep.close()


# ============================================================
# NetClient/NetServer(真实传输层桩位;M1.9 由工作台搭建师实现)
# ============================================================

class NetClient extends RefCounted:
	## 客户端:连上服务端后,把 proto message 编码为帧,写到 transport。
	## M1.5 阶段仅做字段占位;M1.9 由工作台搭建师补 WebSocket/UDP 实现。
	var _transport = null  # WebSocket/QUIC(待 M1.9+ 接入)
	var _frame_reader: WildwoodWire.FrameReader = WildwoodWire.FrameReader.new()
	var _is_open: bool = false

	func connect(_url: String) -> bool:
		push_warning("NetClient.connect: stub, M1.9+ 接入")
		return false

	func send(_type_name: String, _value) -> bool:
		push_warning("NetClient.send: stub")
		return false

	func recv() -> Dictionary:
		return {"type": "", "payload": PackedByteArray(), "eof": true}

	func close() -> void:
		_is_open = false


class NetServer extends RefCounted:
	## 服务端:接收连接,逐帧解析,调用 handler。
	## M1.5 阶段仅做字段占位;M1.9 由工作台搭建师补 WebSocket/UDP 实现。
	var _port: int = 0
	var _handler: Callable = Callable()

	func listen(_port: int, _handler: Callable) -> bool:
		push_warning("NetServer.listen: stub, M1.9+ 接入")
		return false

	func stop() -> void:
		pass


# ============================================================
# 辅助:判断"全零值"消息是否应该被允许发送空 payload
# ============================================================
func _is_zero_value(_type_name: String, _value) -> bool:
	# 当消息所有字段都为零时,encode 也会返回空 PackedByteArray
	# 但这是合法空消息;MockEndpoint.send 仍要发送(空帧,接收端会跳过)
	# 这里假设 encode 永远成功,只对 unknown type 返回 false
	return true
