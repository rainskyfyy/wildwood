class_name WildwoodTransport
extends RefCounted
## Wildwood M1.9 — 真实 WebSocket 传输层(Godot 4.3)
##
## 与 M1.5 协议层(WildwoodWire / C2S / S2C)无缝衔接:
##   NetClient.connect(url) → 连上服务端后,send/recv 收发帧
##   NetServer.listen(port) → 监听 TCP,内部 upgrade WebSocket,
##                          → 每个连接派发到 handler Callable
##
## 配对实现:Go 侧 core/abstract/network/go/transport/ (gorilla/websocket)
## 帧格式一致:[varint LEN][varint TYPE_LEN][TYPE][PAYLOAD]
##
## 线程模型:
##   Godot 是单线程 + 主循环驱动。NetClient/NetServer 都不是线程,
##   调用方每帧调 poll() 驱动状态机和收发。send 是非阻塞的(写入
##   WebSocketPeer 内部缓冲,put_packet 失败 → 记入 _outbox 队列)。
##
## 用法(NetClient):
##   var cli = WildwoodTransport.WsNetClient.new()
##   var ok = cli.connect_to("ws://127.0.0.1:8080/ws")
##   while not cli.is_open():
##       cli.poll(0.0)
##       await get_tree().process_frame
##   cli.send_frame("C2S_Handshake", payload)
##   while cli.is_open():
##       cli.poll(0.0)
##       var f = cli.recv_frame()
##       if f["type"] != "":
##           handle(f)
##       await get_tree().process_frame
##
## 用法(NetServer):
##   var srv = WildwoodTransport.WsNetServer.new()
##   srv.handler = func(peer_id, type_name, payload): ...
##   srv.listen(8080, "/ws")
##   while srv.is_listening():
##       srv.poll(0.0)
##       await get_tree().process_frame
##   srv.broadcast("S2C_WorldDelta", payload)
##   srv.send_to(peer_id, "S2C_RoomJoined", payload)
##   srv.broadcast_except("S2C_Chat", payload, peer_id)

const WildwoodWire = preload("res://core/abstract/network/gd/wildwood_wire.gd")


# ============================================================
# 通用工具:把 enum / int / string 错误码转可读字符串
# ============================================================
static func ws_state_name(state: int) -> String:
	match state:
		WebSocketPeer.STATE_CONNECTING:
			return "CONNECTING"
		WebSocketPeer.STATE_OPEN:
			return "OPEN"
		WebSocketPeer.STATE_CLOSING:
			return "CLOSING"
		WebSocketPeer.STATE_CLOSED:
			return "CLOSED"
		_:
			return "UNKNOWN(%d)" % state


# ============================================================
# WsConn:服务端侧一条 WebSocket 连接的封装
# ============================================================
## 内部状态由 WsNetServer 持有;通过 peer_id(String)索引
## ============================================================
class WsConn extends RefCounted:
	var peer_id: String = ""
	var peer: WebSocketPeer = WebSocketPeer.new()
	var frame_reader: WildwoodWire.FrameReader = WildwoodWire.FrameReader.new()
	var connected_at_ms: int = 0
	var closed: bool = false

	func _init(id: String) -> void:
		peer_id = id
		connected_at_ms = Time.get_ticks_msec()

	func is_open() -> bool:
		return peer.get_ready_state() == WebSocketPeer.STATE_OPEN and not closed

	## 拉一帧;没数据返回 {type:"", payload:PackedByteArray(), eof:false}
	## 连接关闭返回 eof:true
	func poll_in() -> Dictionary:
		peer.poll()
		if peer.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			closed = true
			return {"type": "", "payload": PackedByteArray(), "eof": true}
		var st: int = peer.get_ready_state()
		while st == WebSocketPeer.STATE_OPEN and peer.get_available_packet_count() > 0:
			var pkt: PackedByteArray = peer.get_packet()
			var frames: Array = frame_reader.feed(pkt)
			if frames.size() > 0:
				var f: Dictionary = frames[0]
				return {
					"type": str(f.get("type", "")),
					"payload": f.get("payload", PackedByteArray()),
					"eof": false,
				}
		return {"type": "", "payload": PackedByteArray(), "eof": false}

	## 写一帧;返回是否成功
	func send_frame(type_name: String, payload: PackedByteArray) -> bool:
		if not is_open():
			return false
		var frame: PackedByteArray = WildwoodWire.WildwoodWireFormat.encode_frame(type_name, payload)
		if frame.size() == 0:
			return false
		var err: int = peer.put_packet(frame)
		return err == OK

	## 拉所有已就绪的入帧(批量)
	func drain_in() -> Array:
		peer.poll()
		var out: Array = []
		if peer.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			closed = true
			return [{"type": "", "payload": PackedByteArray(), "eof": true}]
		var st2: int = peer.get_ready_state()
		while st2 == WebSocketPeer.STATE_OPEN and peer.get_available_packet_count() > 0:
			var pkt: PackedByteArray = peer.get_packet()
			var frames: Array = frame_reader.feed(pkt)
			for f in frames:
				out.append({
					"type": str(f.get("type", "")),
					"payload": f.get("payload", PackedByteArray()),
					"eof": false,
				})
		return out

	func close(code: int = 1000, reason: String = "bye") -> void:
		if peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
			peer.close(code, reason)
		closed = true


# ============================================================
# WsNetClient:客户端(单连接)
# ============================================================
class WsNetClient extends RefCounted:
	var _peer: WebSocketPeer = WebSocketPeer.new()
	var _frame_reader: WildwoodWire.FrameReader = WildwoodWire.FrameReader.new()
	var _is_open_flag: bool = false
	var _close_code: int = 0
	var _close_reason: String = ""
	var _pending_inbox: Array = []  # 待取出的入帧队列

	func _init() -> void:
		_peer.set_no_delay(true)
		_peer.set_max_packet_size(65536)

	## 同步发起连接(非阻塞);后续用 poll() 推进
	## 返回 OK 表示发起成功(还没连上);其他错误码表示失败
	func connect_to(url: String, protocols: PackedStringArray = PackedStringArray()) -> int:
		_pending_inbox = []
		_is_open_flag = false
		_close_code = 0
		_close_reason = ""
		var err: int = _peer.connect_to_url(url, protocols)
		if err != OK:
			push_error("WsNetClient.connect_to: %s failed err=%d" % [url, err])
		return err

	## 主循环每帧调用;驱动 connect → open / 处理入帧 / 监测关闭
	func poll(_delta: float) -> void:
		_peer.poll()
		var state: int = _peer.get_ready_state()
		match state:
			WebSocketPeer.STATE_CONNECTING:
				pass
			WebSocketPeer.STATE_OPEN:
				if not _is_open_flag:
					_is_open_flag = true
				var open_st: int = _peer.get_ready_state()
				while open_st == WebSocketPeer.STATE_OPEN and _peer.get_available_packet_count() > 0:
					var pkt: PackedByteArray = _peer.get_packet()
					var frames: Array = _frame_reader.feed(pkt)
					for f in frames:
						_pending_inbox.append({
							"type": str(f.get("type", "")),
							"payload": f.get("payload", PackedByteArray()),
							"eof": false,
						})
			WebSocketPeer.STATE_CLOSING:
				pass
			WebSocketPeer.STATE_CLOSED:
				if _is_open_flag or _close_code == 0:
					_close_code = _peer.get_close_code()
					_close_reason = _peer.get_close_reason()
				_is_open_flag = false
				while _peer.get_available_packet_count() > 0:
					var pkt2: PackedByteArray = _peer.get_packet()
					var frames2: Array = _frame_reader.feed(pkt2)
					for f in frames2:
						_pending_inbox.append({
							"type": str(f.get("type", "")),
							"payload": f.get("payload", PackedByteArray()),
							"eof": false,
						})

	func is_connecting() -> bool:
		return _peer.get_ready_state() == WebSocketPeer.STATE_CONNECTING

	func is_open() -> bool:
		return _is_open_flag and _peer.get_ready_state() == WebSocketPeer.STATE_OPEN

	func is_closed() -> bool:
		return _peer.get_ready_state() == WebSocketPeer.STATE_CLOSED

	func get_close_code() -> int:
		return _close_code

	func get_close_reason() -> String:
		return _close_reason

	## 主动发一帧;返回是否成功
	func send_frame(type_name: String, payload: PackedByteArray) -> bool:
		if not is_open():
			return false
		var frame: PackedByteArray = WildwoodWire.WildwoodWireFormat.encode_frame(type_name, payload)
		if frame.size() == 0:
			return false
		var err: int = _peer.put_packet(frame)
		if err != OK:
			push_warning("WsNetClient.send_frame: put_packet err=%d" % err)
			return false
		return true

	## 取一帧(非阻塞);空则返回 {type:"", payload:..., eof:false}
	## 连接已关且没数据 → {..., eof:true}
	func recv_frame() -> Dictionary:
		if _pending_inbox.size() > 0:
			return _pending_inbox.pop_front()
		if is_closed():
			return {"type": "", "payload": PackedByteArray(), "eof": true}
		return {"type": "", "payload": PackedByteArray(), "eof": false}

	## 关闭连接(graceful)
	func close(code: int = 1000, reason: String = "bye") -> void:
		var st: int = _peer.get_ready_state()
		if st == WebSocketPeer.STATE_OPEN or st == WebSocketPeer.STATE_CONNECTING:
			_peer.close(code, reason)

	func get_peer() -> WebSocketPeer:
		return _peer


# ============================================================
# WsNetServer:服务端(多连接,广播 / 单播)
# ============================================================
class WsNetServer extends RefCounted:
	const DEFAULT_PATH: String = "/ws"
	const MAX_CONNS_DEFAULT: int = 1024

	# 公开回调:handler(peer_id, type_name, payload)
	# 生命周期钩子:on_connect(peer_id) / on_disconnect(peer_id, code, reason)
	var handler: Callable = Callable()
	var on_connect: Callable = Callable()
	var on_disconnect: Callable = Callable()

	var _tcp: TCPServer = TCPServer.new()
	var _path: String = DEFAULT_PATH
	var _max_conns: int = MAX_CONNS_DEFAULT
	var _conns: Dictionary = {}    # peer_id(String) -> WsConn
	var _next_peer_seq: int = 0
	var _peer_seq_mutex: Mutex = Mutex.new()

	# 统计
	var _total_accepted: int = 0
	var _total_closed: int = 0
	func _init(max_conns: int = MAX_CONNS_DEFAULT) -> void:
		_max_conns = max_conns

	## 监听端口;返回 OK 或错误码
	func listen(port: int, path: String = DEFAULT_PATH) -> int:
		_path = path
		var err: int = _tcp.listen(port, "0.0.0.0")
		if err != OK:
			push_error("WsNetServer.listen: port=%d err=%d" % [port, err])
		return err

	func is_listening() -> bool:
		return _tcp.is_listening()

	func get_listen_port() -> int:
		return _tcp.get_local_port()

	func stop() -> void:
		_tcp.stop()
		for pid in _conns.keys():
			var c: WsConn = _conns[pid]
			c.close(1001, "server_shutdown")
		_conns.clear()

	## 主循环每帧调用:接受新连接、poll 已有连接、分发入帧
	func poll(_delta: float) -> void:
		while _tcp.is_connection_available() and _conns.size() < _max_conns:
			var conn: StreamPeerTCP = _tcp.take_connection()
			if conn == null:
				break
			var ws: WebSocketPeer = WebSocketPeer.new()
			ws.set_no_delay(true)
			var accept_err: int = ws.accept_stream(conn)
			if accept_err != OK:
				push_warning("WsNetServer: accept_stream err=%d, dropping" % accept_err)
				conn.disconnect_from_host()
				continue
			var pid: String = _gen_peer_id()
			var c: WsConn = WsConn.new(pid)
			c.peer = ws
			_conns[pid] = c
			_total_accepted += 1
			if on_connect.is_valid():
				on_connect.call(pid)

		var to_remove: Array = []
		for pid in _conns.keys():
			var c: WsConn = _conns[pid]
			var frames: Array = c.drain_in()
			for f in frames:
				if f.get("eof", false):
					to_remove.append(pid)
					break
				if handler.is_valid():
					var type_name: String = str(f.get("type", ""))
					var payload: PackedByteArray = f.get("payload", PackedByteArray())
					handler.call(pid, type_name, payload)
			if c.peer.get_ready_state() == WebSocketPeer.STATE_CLOSED:
				if not to_remove.has(pid):
					to_remove.append(pid)

		for pid in to_remove:
			var c2: WsConn = _conns.get(pid, null)
			if c2 != null:
				var code: int = c2.peer.get_close_code()
				var reason: String = c2.peer.get_close_reason()
				_conns.erase(pid)
				_total_closed += 1
				if on_disconnect.is_valid():
					on_disconnect.call(pid, code, reason)

	## 广播:全网
	func broadcast(type_name: String, payload: PackedByteArray) -> int:
		var n: int = 0
		for pid in _conns.keys():
			var c: WsConn = _conns[pid]
			if c.send_frame(type_name, payload):
				n += 1
		return n

	## 单播
	func send_to(peer_id: String, type_name: String, payload: PackedByteArray) -> bool:
		var c: WsConn = _conns.get(peer_id, null)
		if c == null:
			return false
		return c.send_frame(type_name, payload)

	## 广播但排除某 peer
	func broadcast_except(type_name: String, payload: PackedByteArray, except_peer_id: String) -> int:
		var n: int = 0
		for pid in _conns.keys():
			if pid == except_peer_id:
				continue
			var c: WsConn = _conns[pid]
			if c.send_frame(type_name, payload):
				n += 1
		return n

	func conn_count() -> int:
		return _conns.size()

	func peer_ids() -> Array:
		return _conns.keys()

	func has_peer(peer_id: String) -> bool:
		return _conns.has(peer_id)

	func get_conn(peer_id: String) -> WsConn:
		return _conns.get(peer_id, null)

	func total_accepted() -> int:
		return _total_accepted

	func total_closed() -> int:
		return _total_closed

	func _gen_peer_id() -> String:
		_peer_seq_mutex.lock()
		_next_peer_seq += 1
		var pid: String = "p-%d" % _next_peer_seq
		_peer_seq_mutex.unlock()
		return pid
