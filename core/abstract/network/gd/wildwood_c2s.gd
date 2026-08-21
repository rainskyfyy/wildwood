class_name WildwoodC2S
extends RefCounted
## Wildwood M1.5 — 客户端→服务端 (C2S) 消息编解码
## 对应 proto/wildwood/v1/c2s.proto
##
## 每个类对应一个 C2S_* message,提供静态 encode_xxx / decode_xxx:
##   encode_xxx(value) -> PackedByteArray
##   decode_xxx(buf, offset) -> [value, new_offset]
##
## 协议真相源:proto/wildwood/v1/c2s.proto
## 配对参考:go/wildwood/v1/c2s.pb.go
##
## wire format 编码规则:
##   - int32/uint32/uint64/bool/enum: WT_VARINT(0)
##   - sint32: WT_VARINT(0) + zigzag
##   - float: WT_FIXED32(5) little-endian
##   - string/bytes/embedded message: WT_LENGTH(2)
##
## A/B 通用:只使用 protobuf 标准类型,不依赖任何引擎 API。


# ============================================================
# C2S_Handshake
# ============================================================
class Handshake:
	var client_version: String = ""
	var player_name: String = ""
	var auth_token: String = ""

	static func encode(v: Handshake) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.client_version.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.client_version)
		if not v.player_name.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.player_name)
		if not v.auth_token.is_empty():
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.auth_token)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: Handshake = Handshake.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.client_version = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.player_name = b2[0].get_string_from_utf8(); pos = b2[1]
				3:
					var b3: Array = WildwoodWire.read_bytes(buf, pos)
					v.auth_token = b3[0].get_string_from_utf8(); pos = b3[1]
				_:
					push_warning("C2S_Handshake: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_Heartbeat
# ============================================================
class Heartbeat:
	var client_time_ms: int = 0
	var ping_seq: int = 0

	static func encode(v: Heartbeat) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.client_time_ms != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.client_time_ms)
		if v.ping_seq != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.ping_seq)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: Heartbeat = Heartbeat.new()
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
				_:
					push_warning("C2S_Heartbeat: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_Disconnect
# ============================================================
class Disconnect:
	var reason: String = ""

	static func encode(v: Disconnect) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.reason.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.reason)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: Disconnect = Disconnect.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.reason = b[0].get_string_from_utf8(); pos = b[1]
				_:
					push_warning("C2S_Disconnect: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_RoomCreate
# ============================================================
class RoomCreate:
	var room_name: String = ""
	var world_seed: String = ""
	var max_players: int = 0

	static func encode(v: RoomCreate) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_name.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_name)
		if not v.world_seed.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.world_seed)
		if v.max_players != 0:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.max_players)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: RoomCreate = RoomCreate.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.room_name = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.world_seed = b2[0].get_string_from_utf8(); pos = b2[1]
				3:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.max_players = vi[0]; pos = vi[1]
				_:
					push_warning("C2S_RoomCreate: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_RoomJoin
# ============================================================
class RoomJoin:
	var room_id: String = ""
	var join_token: String = ""

	static func encode(v: RoomJoin) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_id)
		if not v.join_token.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.join_token)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: RoomJoin = RoomJoin.new()
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
				_:
					push_warning("C2S_RoomJoin: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_RoomLeave
# ============================================================
class RoomLeave:
	var room_id: String = ""

	static func encode(v: RoomLeave) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.room_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.room_id)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: RoomLeave = RoomLeave.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.room_id = b[0].get_string_from_utf8(); pos = b[1]
				_:
					push_warning("C2S_RoomLeave: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_RoomList
# ============================================================
class RoomList:
	var page: int = 0
	var page_size: int = 0

	static func encode(v: RoomList) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.page != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.page)
		if v.page_size != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.page_size)
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
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.page = vi[0]; pos = vi[1]
				2:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.page_size = vi2[0]; pos = vi2[1]
				_:
					push_warning("C2S_RoomList: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_PlayerInput
# ============================================================
## 一次输入(MOVE/ATTACK/GATHER/BUILD/USE_ITEM/RESPAWN/INTERACT)
## input_seq 用于 M3.1 客户端预测;server_tick 为客户端参考时刻;
## 按 action 取以下字段(MOVE 走 move_dx/dy,ATTACK 走 target_entity_id,...)
class PlayerInput:
	var input_seq: int = 0
	var server_tick: int = 0
	var action: int = 0
	var move_dx: float = 0.0
	var move_dy: float = 0.0
	var target_entity_id: int = 0
	var target_prefab_id: int = 0
	var tile_x: int = 0
	var tile_y: int = 0
	var slot_index: int = 0
	var facing: float = 0.0
	var client_time_ms: int = 0

	static func encode(v: PlayerInput) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.input_seq != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.input_seq)
		if v.server_tick != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_tick)
		if v.action != 0:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.action)
		if v.move_dx != 0.0:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_FIXED32)
			buf = WildwoodWire.write_float_le(buf, v.move_dx)
		if v.move_dy != 0.0:
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_FIXED32)
			buf = WildwoodWire.write_float_le(buf, v.move_dy)
		if v.target_entity_id != 0:
			buf = WildwoodWire.write_tag(buf, 6, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.target_entity_id)
		if v.target_prefab_id != 0:
			buf = WildwoodWire.write_tag(buf, 7, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.target_prefab_id)
		if v.tile_x != 0:
			buf = WildwoodWire.write_tag(buf, 8, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, WildwoodWire.zigzag_encode32(v.tile_x))
		if v.tile_y != 0:
			buf = WildwoodWire.write_tag(buf, 9, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, WildwoodWire.zigzag_encode32(v.tile_y))
		if v.slot_index != 0:
			buf = WildwoodWire.write_tag(buf, 10, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.slot_index)
		if v.facing != 0.0:
			buf = WildwoodWire.write_tag(buf, 11, WildwoodWire.WT_FIXED32)
			buf = WildwoodWire.write_float_le(buf, v.facing)
		if v.client_time_ms != 0:
			buf = WildwoodWire.write_tag(buf, 12, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.client_time_ms)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: PlayerInput = PlayerInput.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.input_seq = vi[0]; pos = vi[1]
				2:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.server_tick = vi2[0]; pos = vi2[1]
				3:
					var vi3: Array = WildwoodWire.read_varint(buf, pos)
					v.action = vi3[0]; pos = vi3[1]
				4:
					var f: Array = WildwoodWire.read_float_le(buf, pos)
					v.move_dx = f[0]; pos = f[1]
				5:
					var f2: Array = WildwoodWire.read_float_le(buf, pos)
					v.move_dy = f2[0]; pos = f2[1]
				6:
					var vi4: Array = WildwoodWire.read_varint(buf, pos)
					v.target_entity_id = vi4[0]; pos = vi4[1]
				7:
					var vi5: Array = WildwoodWire.read_varint(buf, pos)
					v.target_prefab_id = vi5[0]; pos = vi5[1]
				8:
					var vi6: Array = WildwoodWire.read_varint(buf, pos)
					v.tile_x = WildwoodWire.zigzag_decode32(vi6[0]); pos = vi6[1]
				9:
					var vi7: Array = WildwoodWire.read_varint(buf, pos)
					v.tile_y = WildwoodWire.zigzag_decode32(vi7[0]); pos = vi7[1]
				10:
					var vi8: Array = WildwoodWire.read_varint(buf, pos)
					v.slot_index = vi8[0]; pos = vi8[1]
				11:
					var f3: Array = WildwoodWire.read_float_le(buf, pos)
					v.facing = f3[0]; pos = f3[1]
				12:
					var vi9: Array = WildwoodWire.read_varint(buf, pos)
					v.client_time_ms = vi9[0]; pos = vi9[1]
				_:
					push_warning("C2S_PlayerInput: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_ChatMsg
# ============================================================
class ChatMsg:
	var channel: int = 0
	var target_player_id: String = ""
	var text: String = ""
	var client_time_ms: int = 0

	static func encode(v: ChatMsg) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.channel != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.channel)
		if not v.target_player_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.target_player_id)
		if not v.text.is_empty():
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.text)
		if v.client_time_ms != 0:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.client_time_ms)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: ChatMsg = ChatMsg.new()
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
					v.target_player_id = b[0].get_string_from_utf8(); pos = b[1]
				3:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.text = b2[0].get_string_from_utf8(); pos = b2[1]
				4:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.client_time_ms = vi2[0]; pos = vi2[1]
				_:
					push_warning("C2S_ChatMsg: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_CodexQuery (M2.11)
# 对应 c2s.proto: message C2S_CodexQuery
#   kind=1 (CodexQueryKind enum), entry_id=2
# ============================================================
class CodexQuery:
	var kind: int = 0  # CodexQueryKind: 0=UNSPECIFIED 1=FULL 2=ENTRY
	var entry_id: String = ""

	static func encode(v: CodexQuery) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.kind != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.kind)
		if not v.entry_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.entry_id)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: CodexQuery = CodexQuery.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.kind = vi[0]; pos = vi[1]
				2:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.entry_id = b[0].get_string_from_utf8(); pos = b[1]
				_:
					push_warning("C2S_CodexQuery: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# C2S_CodexView (M2.11) — 客户端开关图鉴面板
# 对应 c2s.proto: message C2S_CodexView
#   is_open=1
# ============================================================
class CodexView:
	var is_open: bool = false

	static func encode(v: CodexView) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.is_open:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, 1)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: CodexView = CodexView.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.is_open = (vi[0] != 0); pos = vi[1]
				_:
					push_warning("C2S_CodexView: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# 模块末尾:外部依赖(const 必须在 func 之前)
# ============================================================
const WildwoodWire = preload("res://core/abstract/network/gd/wildwood_wire.gd")
const CommonTypes = preload("res://core/abstract/network/gd/wildwood_common.gd")


# ============================================================
# Type registry:把字符串名映射到 encode/decode 函数对
# 用法:WildwoodC2S.encode("C2S_Handshake", value) / decode("C2S_Handshake", buf, off)
# ============================================================

const _TYPE_TO_ENCODE: Dictionary = {
	"C2S_Handshake": Handshake.encode,
	"C2S_Heartbeat": Heartbeat.encode,
	"C2S_Disconnect": Disconnect.encode,
	"C2S_RoomCreate": RoomCreate.encode,
	"C2S_RoomJoin": RoomJoin.encode,
	"C2S_RoomLeave": RoomLeave.encode,
	"C2S_RoomList": RoomList.encode,
	"C2S_PlayerInput": PlayerInput.encode,
	"C2S_ChatMsg": ChatMsg.encode,
	"C2S_CodexQuery": CodexQuery.encode,
	"C2S_CodexView": CodexView.encode,
}

const _TYPE_TO_DECODE: Dictionary = {
	"C2S_Handshake": Handshake.decode,
	"C2S_Heartbeat": Heartbeat.decode,
	"C2S_Disconnect": Disconnect.decode,
	"C2S_RoomCreate": RoomCreate.decode,
	"C2S_RoomJoin": RoomJoin.decode,
	"C2S_RoomLeave": RoomLeave.decode,
	"C2S_RoomList": RoomList.decode,
	"C2S_PlayerInput": PlayerInput.decode,
	"C2S_ChatMsg": ChatMsg.decode,
	"C2S_CodexQuery": CodexQuery.decode,
	"C2S_CodexView": CodexView.decode,
}


## 用 type_name 查 encode 函数;返回 PackedByteArray (空数组=unknown)
static func encode(type_name: String, value) -> PackedByteArray:
	if not _TYPE_TO_ENCODE.has(type_name):
		push_error("WildwoodC2S.encode: unknown type %s" % type_name)
		return PackedByteArray()
	return _TYPE_TO_ENCODE[type_name].call(value)


## 用 type_name 查 decode 函数;返回 [value, new_offset]
static func decode(type_name: String, buf: PackedByteArray, offset: int) -> Array:
	if not _TYPE_TO_DECODE.has(type_name):
		push_error("WildwoodC2S.decode: unknown type %s" % type_name)
		return [null, offset]
	return _TYPE_TO_DECODE[type_name].call(buf, offset)


## 返回所有 C2S 类型名(供测试/反射)
static func type_names() -> Array:
	return _TYPE_TO_ENCODE.keys()
