class_name WildwoodS2C
extends RefCounted
## Wildwood M1.5 — 服务端→客户端 (S2C) 消息编解码
## 对应 proto/wildwood/v1/s2c.proto
##
## 与 wildwood_c2s.gd 对称。
##
## 协议真相源:proto/wildwood/v1/s2c.proto
## 配对参考:go/wildwood/v1/s2c.pb.go
##
## wire format 编码规则(同 C2S):
##   - int32/uint32/uint64/bool/enum: WT_VARINT(0)
##   - sint32: WT_VARINT(0) + zigzag
##   - float: WT_FIXED32(5) little-endian
##   - string/bytes/embedded message: WT_LENGTH(2)
##   - repeated T field: 多次写 (tag, value),中间无分隔
##
## A/B 通用:只使用 protobuf 标准类型,不依赖任何引擎 API。


# ============================================================
# S2C_HandshakeAck
# ============================================================
class HandshakeAck:
	var server_version: String = ""
	var player_id: String = ""
	var session_token: String = ""
	var server_tick_rate: int = 0
	var max_room_players: int = 0

	static func encode(v: HandshakeAck) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.server_version.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.server_version)
		if not v.player_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.player_id)
		if not v.session_token.is_empty():
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.session_token)
		if v.server_tick_rate != 0:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_tick_rate)
		if v.max_room_players != 0:
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.max_room_players)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: HandshakeAck = HandshakeAck.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.server_version = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.player_id = b2[0].get_string_from_utf8(); pos = b2[1]
				3:
					var b3: Array = WildwoodWire.read_bytes(buf, pos)
					v.session_token = b3[0].get_string_from_utf8(); pos = b3[1]
				4:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.server_tick_rate = vi[0]; pos = vi[1]
				5:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.max_room_players = vi2[0]; pos = vi2[1]
				_:
					push_warning("S2C_HandshakeAck: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_HeartbeatAck
# ============================================================
class HeartbeatAck:
	var client_time_ms: int = 0
	var ping_seq: int = 0
	var server_time_ms: int = 0

	static func encode(v: HeartbeatAck) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.client_time_ms != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.client_time_ms)
		if v.ping_seq != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.ping_seq)
		if v.server_time_ms != 0:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_time_ms)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: HeartbeatAck = HeartbeatAck.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.client_time_ms = vi[0]; pos = vi[1]
				2:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.ping_seq = vi2[0]; pos = vi2[1]
				3:
					var vi3: Array = WildwoodWire.read_varint(buf, pos)
					v.server_time_ms = vi3[0]; pos = vi3[1]
				_:
					push_warning("S2C_HeartbeatAck: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_RoomCreated
# ============================================================
class RoomCreated:
	var room_id: String = ""
	var join_token: String = ""
	var max_players: int = 0

	static func encode(v: RoomCreated) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_id)
		if not v.join_token.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.join_token)
		if v.max_players != 0:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.max_players)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: RoomCreated = RoomCreated.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.room_id = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.join_token = b2[0].get_string_from_utf8(); pos = b2[1]
				3:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.max_players = vi[0]; pos = vi[1]
				_:
					push_warning("S2C_RoomCreated: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_RoomState(repeated in S2C_RoomList;自身 4 字段)
# ============================================================
class RoomState:
	var room_id: String = ""
	var current_players: int = 0
	var max_players: int = 0
	var is_open: bool = true

	static func encode(v: RoomState) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_id)
		if v.current_players != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.current_players)
		if v.max_players != 0:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.max_players)
		if not v.is_open:
			# proto3: default is true;只写 false
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, 0)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: RoomState = RoomState.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.room_id = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.current_players = vi[0]; pos = vi[1]
				3:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.max_players = vi2[0]; pos = vi2[1]
				4:
					var vi3: Array = WildwoodWire.read_varint(buf, pos)
					v.is_open = (vi3[0] != 0); pos = vi3[1]
				_:
					push_warning("S2C_RoomState: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_RoomJoined
# ============================================================
class RoomJoined:
	var room_id: String = ""
	var player_id: String = ""
	var members: Array = []            # Array[PlayerState]
	var initial_state = null           # WorldSnapshot or null
	var server_tick: int = 0

	static func encode(v: RoomJoined) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_id)
		if not v.player_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.player_id)
		for m in v.members:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			var mb: PackedByteArray = CommonTypes.PlayerState.encode(m)
			buf = WildwoodWire.write_varint(buf, mb.size())
			buf.append_array(mb)
		if v.initial_state != null:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_LENGTH)
			var sb: PackedByteArray = CommonTypes.WorldSnapshot.encode(v.initial_state)
			buf = WildwoodWire.write_varint(buf, sb.size())
			buf.append_array(sb)
		if v.server_tick != 0:
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_tick)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: RoomJoined = RoomJoined.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.room_id = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.player_id = b2[0].get_string_from_utf8(); pos = b2[1]
				3:
					var b3: Array = WildwoodWire.read_bytes(buf, pos)
					var sub: Array = CommonTypes.PlayerState.decode(b3[0], 0)
					v.members.append(sub[0]); pos = b3[1]
				4:
					var b4: Array = WildwoodWire.read_bytes(buf, pos)
					var sub2: Array = CommonTypes.WorldSnapshot.decode(b4[0], 0)
					v.initial_state = sub2[0]; pos = b4[1]
				5:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.server_tick = vi[0]; pos = vi[1]
				_:
					push_warning("S2C_RoomJoined: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_RoomLeft
# ============================================================
class RoomLeft:
	var room_id: String = ""
	var reason: String = ""

	static func encode(v: RoomLeft) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_id)
		if not v.reason.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.reason)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: RoomLeft = RoomLeft.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.room_id = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.reason = b2[0].get_string_from_utf8(); pos = b2[1]
				_:
					push_warning("S2C_RoomLeft: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_PlayerJoined
# ============================================================
class PlayerJoined:
	var room_id: String = ""
	var player = null                  # PlayerState or null

	static func encode(v: PlayerJoined) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_id)
		if v.player != null:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			var pb: PackedByteArray = CommonTypes.PlayerState.encode(v.player)
			buf = WildwoodWire.write_varint(buf, pb.size())
			buf.append_array(pb)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: PlayerJoined = PlayerJoined.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.room_id = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					var sub: Array = CommonTypes.PlayerState.decode(b2[0], 0)
					v.player = sub[0]; pos = b2[1]
				_:
					push_warning("S2C_PlayerJoined: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_PlayerLeft
# ============================================================
class PlayerLeft:
	var room_id: String = ""
	var player_id: String = ""
	var reason: String = ""

	static func encode(v: PlayerLeft) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_id)
		if not v.player_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.player_id)
		if not v.reason.is_empty():
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.reason)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: PlayerLeft = PlayerLeft.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.room_id = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.player_id = b2[0].get_string_from_utf8(); pos = b2[1]
				3:
					var b3: Array = WildwoodWire.read_bytes(buf, pos)
					v.reason = b3[0].get_string_from_utf8(); pos = b3[1]
				_:
					push_warning("S2C_PlayerLeft: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_RoomList
# ============================================================
class RoomList:
	var rooms: Array = []              # Array[S2C_RoomState]
	var total: int = 0

	static func encode(v: RoomList) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		for r in v.rooms:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			var rb: PackedByteArray = RoomState.encode(r)
			buf = WildwoodWire.write_varint(buf, rb.size())
			buf.append_array(rb)
		if v.total != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.total)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: RoomList = RoomList.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					var sub: Array = RoomState.decode(b[0], 0)
					v.rooms.append(sub[0]); pos = b[1]
				2:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.total = vi[0]; pos = vi[1]
				_:
					push_warning("S2C_RoomList: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_WorldDelta
# ============================================================
## 20Hz tick 一次;核心节流消息。acked_input_seqs 用于 M3.1 客户端预测校正。
class WorldDelta:
	var server_tick: int = 0
	var server_time_ms: int = 0
	var acked_input_seqs: Array = []   # Array[int]
	var entity_updates: Array = []     # Array[EntityState]
	var removed_entity_ids: Array = [] # Array[int]
	var player_status: Array = []      # Array[PlayerStatus]
	var events: Array = []             # Array[WorldEvent]

	static func encode(v: WorldDelta) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.server_tick != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_tick)
		if v.server_time_ms != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_time_ms)
		for seq in v.acked_input_seqs:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, seq)
		for e in v.entity_updates:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_LENGTH)
			var eb: PackedByteArray = CommonTypes.EntityState.encode(e)
			buf = WildwoodWire.write_varint(buf, eb.size())
			buf.append_array(eb)
		for rid in v.removed_entity_ids:
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, rid)
		for s in v.player_status:
			buf = WildwoodWire.write_tag(buf, 6, WildwoodWire.WT_LENGTH)
			var sb: PackedByteArray = CommonTypes.PlayerStatus.encode(s)
			buf = WildwoodWire.write_varint(buf, sb.size())
			buf.append_array(sb)
		for ev in v.events:
			buf = WildwoodWire.write_tag(buf, 7, WildwoodWire.WT_LENGTH)
			var evb: PackedByteArray = CommonTypes.WorldEvent.encode(ev)
			buf = WildwoodWire.write_varint(buf, evb.size())
			buf.append_array(evb)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: WorldDelta = WorldDelta.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.server_tick = vi[0]; pos = vi[1]
				2:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.server_time_ms = vi2[0]; pos = vi2[1]
				3:
					var vi3: Array = WildwoodWire.read_varint(buf, pos)
					v.acked_input_seqs.append(vi3[0]); pos = vi3[1]
				4:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					var sub: Array = CommonTypes.EntityState.decode(b[0], 0)
					v.entity_updates.append(sub[0]); pos = b[1]
				5:
					var vi4: Array = WildwoodWire.read_varint(buf, pos)
					v.removed_entity_ids.append(vi4[0]); pos = vi4[1]
				6:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					var sub2: Array = CommonTypes.PlayerStatus.decode(b2[0], 0)
					v.player_status.append(sub2[0]); pos = b2[1]
				7:
					var b3: Array = WildwoodWire.read_bytes(buf, pos)
					var sub3: Array = CommonTypes.WorldEvent.decode(b3[0], 0)
					v.events.append(sub3[0]); pos = b3[1]
				_:
					push_warning("S2C_WorldDelta: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_ChatBroadcast
# ============================================================
class ChatBroadcast:
	var channel: int = 0
	var sender_id: String = ""
	var sender_name: String = ""
	var target_player_id: String = ""
	var text: String = ""
	var server_time_ms: int = 0

	static func encode(v: ChatBroadcast) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.channel != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.channel)
		if not v.sender_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.sender_id)
		if not v.sender_name.is_empty():
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.sender_name)
		if not v.target_player_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.target_player_id)
		if not v.text.is_empty():
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.text)
		if v.server_time_ms != 0:
			buf = WildwoodWire.write_tag(buf, 6, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_time_ms)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: ChatBroadcast = ChatBroadcast.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.channel = vi[0]; pos = vi[1]
				2:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.sender_id = b[0].get_string_from_utf8(); pos = b[1]
				3:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.sender_name = b2[0].get_string_from_utf8(); pos = b2[1]
				4:
					var b3: Array = WildwoodWire.read_bytes(buf, pos)
					v.target_player_id = b3[0].get_string_from_utf8(); pos = b3[1]
				5:
					var b4: Array = WildwoodWire.read_bytes(buf, pos)
					v.text = b4[0].get_string_from_utf8(); pos = b4[1]
				6:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.server_time_ms = vi2[0]; pos = vi2[1]
				_:
					push_warning("S2C_ChatBroadcast: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# S2C_Error
# ============================================================
class Error:
	var code: int = 0                  # RoomErrorCode enum
	var message: String = ""
	var context: String = ""

	static func encode(v: Error) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.code != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.code)
		if not v.message.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.message)
		if not v.context.is_empty():
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.context)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: Error = Error.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.code = vi[0]; pos = vi[1]
				2:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.message = b[0].get_string_from_utf8(); pos = b[1]
				3:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.context = b2[0].get_string_from_utf8(); pos = b2[1]
				_:
					push_warning("S2C_Error: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# 模块末尾:外部依赖(const 必须在 func 之前)
# ============================================================
const WildwoodWire = preload("res://core/abstract/network/gd/wildwood_wire.gd")
const CommonTypes = preload("res://core/abstract/network/gd/wildwood_common.gd")


# ============================================================
# Type registry
# ============================================================

const _TYPE_TO_ENCODE: Dictionary = {
	"S2C_HandshakeAck": HandshakeAck.encode,
	"S2C_HeartbeatAck": HeartbeatAck.encode,
	"S2C_RoomCreated": RoomCreated.encode,
	"S2C_RoomJoined": RoomJoined.encode,
	"S2C_RoomLeft": RoomLeft.encode,
	"S2C_PlayerJoined": PlayerJoined.encode,
	"S2C_PlayerLeft": PlayerLeft.encode,
	"S2C_RoomState": RoomState.encode,
	"S2C_RoomList": RoomList.encode,
	"S2C_WorldDelta": WorldDelta.encode,
	"S2C_ChatBroadcast": ChatBroadcast.encode,
	"S2C_Error": Error.encode,
}

const _TYPE_TO_DECODE: Dictionary = {
	"S2C_HandshakeAck": HandshakeAck.decode,
	"S2C_HeartbeatAck": HeartbeatAck.decode,
	"S2C_RoomCreated": RoomCreated.decode,
	"S2C_RoomJoined": RoomJoined.decode,
	"S2C_RoomLeft": RoomLeft.decode,
	"S2C_PlayerJoined": PlayerJoined.decode,
	"S2C_PlayerLeft": PlayerLeft.decode,
	"S2C_RoomState": RoomState.decode,
	"S2C_RoomList": RoomList.decode,
	"S2C_WorldDelta": WorldDelta.decode,
	"S2C_ChatBroadcast": ChatBroadcast.decode,
	"S2C_Error": Error.decode,
}


static func encode(type_name: String, value) -> PackedByteArray:
	if not _TYPE_TO_ENCODE.has(type_name):
		push_error("WildwoodS2C.encode: unknown type %s" % type_name)
		return PackedByteArray()
	return _TYPE_TO_ENCODE[type_name].call(value)


static func decode(type_name: String, buf: PackedByteArray, offset: int) -> Array:
	if not _TYPE_TO_DECODE.has(type_name):
		push_error("WildwoodS2C.decode: unknown type %s" % type_name)
		return [null, offset]
	return _TYPE_TO_DECODE[type_name].call(buf, offset)


static func type_names() -> Array:
	return _TYPE_TO_ENCODE.keys()
