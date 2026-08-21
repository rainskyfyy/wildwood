class_name WildwoodCommonTypes
extends RefCounted
## Wildwood M1.5 — 公共数据类型 (对应 proto/wildwood/v1/common.proto)
##
## 每个子类型是一对 encode_xxx / decode_xxx:
##   encode_xxx(value) -> PackedByteArray
##   decode_xxx(buf, offset) -> [value, new_offset]
##
## 命名约定与 .proto 完全一致(去掉 C2S_/S2C_ 前缀;只保留 message 名)。


# ============================================================
# 枚举:int32 wire_type=0
# ============================================================

enum RoomErrorCode {
	UNSPECIFIED = 0,
	FULL = 1,
	NOT_FOUND = 2,
	ALREADY_MEMBER = 3,
	VERSION_MISMATCH = 4,
	KICKED = 5,
	ROOM_CLOSED = 6,
	INVALID_INPUT = 7,
	RATE_LIMITED = 8,
}

enum ChatChannel {
	UNSPECIFIED = 0,
	GLOBAL = 1,
	TEAM = 2,
	PRIVATE = 3,
}

enum InputAction {
	UNSPECIFIED = 0,
	MOVE = 1,
	ATTACK = 2,
	GATHER = 3,
	BUILD = 4,
	USE_ITEM = 5,
	RESPAWN = 6,
	INTERACT = 7,
}

enum EntityKind {
	UNSPECIFIED = 0,
	PLAYER = 1,
	MONSTER = 2,
	RESOURCE = 3,
	BUILDING = 4,
	PROJECTILE = 5,
	NPC = 6,
}

enum WorldEventKind {
	UNSPECIFIED = 0,
	GATHER_DONE = 1,
	BUILD_DONE = 2,
	ATTACK_HIT = 3,
	DAMAGE_TAKEN = 4,
	DEATH = 5,
	RESPAWN = 6,
	KNOCKBACK = 7,
}


# ============================================================
# Vec2F (fields 1,2 都是 float / fixed32)
# ============================================================
class Vec2F:
	var x: float = 0.0
	var y: float = 0.0

	static func encode(v: Vec2F) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.x != 0.0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_FIXED32)
			buf = WildwoodWire.write_float_le(buf, v.x)
		if v.y != 0.0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_FIXED32)
			buf = WildwoodWire.write_float_le(buf, v.y)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: Vec2F = Vec2F.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var field_num: int = t[0]
			var wire_type: int = t[1]
			pos = t[2]
			if wire_type == WildwoodWire.WT_FIXED32:
				var f: Array = WildwoodWire.read_float_le(buf, pos)
				match field_num:
					1: v.x = f[0]; pos = f[1]
					2: v.y = f[0]; pos = f[1]
			else:
				push_warning("Vec2F: unexpected wire_type %d field %d" % [wire_type, field_num])
				break
		return [v, pos]


# ============================================================
# PlayerState
# ============================================================
class PlayerState:
	var player_id: String = ""
	var player_name: String = ""
	var position: Vec2F = null
	var facing: float = 0.0
	var color_rgb: int = 0
	var is_alive: bool = true

	static func encode(v: PlayerState) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.player_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.player_id)
		if not v.player_name.is_empty():
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.player_name)
		if v.position != null:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			var pos_bytes: PackedByteArray = Vec2F.encode(v.position)
			buf = WildwoodWire.write_varint(buf, pos_bytes.size())
			buf.append_array(pos_bytes)
		if v.facing != 0.0:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_FIXED32)
			buf = WildwoodWire.write_float_le(buf, v.facing)
		if v.color_rgb != 0:
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.color_rgb)
		if not v.is_alive:
			buf = WildwoodWire.write_tag(buf, 6, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, 1)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: PlayerState = PlayerState.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var field_num: int = t[0]
			var wire_type: int = t[1]
			pos = t[2]
			match field_num:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.player_id = b[0].get_string_from_utf8()
					pos = b[1]
				2:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.player_name = b2[0].get_string_from_utf8()
					pos = b2[1]
				3:
					var b3: Array = WildwoodWire.read_bytes(buf, pos)
					var sub: Array = Vec2F.decode(b3[0], 0)
					v.position = sub[0]
					pos = b3[1]
				4:
					var f: Array = WildwoodWire.read_float_le(buf, pos)
					v.facing = f[0]; pos = f[1]
				5:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.color_rgb = vi[0]; pos = vi[1]
				6:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.is_alive = (vi2[0] != 0); pos = vi2[1]
				_:
					push_warning("PlayerState: unknown field %d" % field_num)
					break
		return [v, pos]


# ============================================================
# EntityState
# ============================================================
class EntityState:
	var entity_id: int = 0
	var kind: int = 0
	var position: Vec2F = null
	var facing: float = 0.0
	var hp: int = 0
	var max_hp: int = 0
	var prefab_id: int = 0
	var player_id: String = ""

	static func encode(v: EntityState) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.entity_id != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.entity_id)
		if v.kind != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.kind)
		if v.position != null:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			var pos_bytes: PackedByteArray = Vec2F.encode(v.position)
			buf = WildwoodWire.write_varint(buf, pos_bytes.size())
			buf.append_array(pos_bytes)
		if v.facing != 0.0:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_FIXED32)
			buf = WildwoodWire.write_float_le(buf, v.facing)
		if v.hp != 0:
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.hp)
		if v.max_hp != 0:
			buf = WildwoodWire.write_tag(buf, 6, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.max_hp)
		if v.prefab_id != 0:
			buf = WildwoodWire.write_tag(buf, 7, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.prefab_id)
		if not v.player_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 8, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.player_id)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: EntityState = EntityState.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var field_num: int = t[0]
			pos = t[2]
			match field_num:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.entity_id = vi[0]; pos = vi[1]
				2:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.kind = vi2[0]; pos = vi2[1]
				3:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					var sub: Array = Vec2F.decode(b[0], 0)
					v.position = sub[0]; pos = b[1]
				4:
					var f: Array = WildwoodWire.read_float_le(buf, pos)
					v.facing = f[0]; pos = f[1]
				5:
					var vi3: Array = WildwoodWire.read_varint(buf, pos)
					v.hp = vi3[0]; pos = vi3[1]
				6:
					var vi4: Array = WildwoodWire.read_varint(buf, pos)
					v.max_hp = vi4[0]; pos = vi4[1]
				7:
					var vi5: Array = WildwoodWire.read_varint(buf, pos)
					v.prefab_id = vi5[0]; pos = vi5[1]
				8:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					v.player_id = b2[0].get_string_from_utf8(); pos = b2[1]
				_:
					push_warning("EntityState: unknown field %d" % field_num)
					break
		return [v, pos]


# ============================================================
# PlayerStatus
# ============================================================
class PlayerStatus:
	var player_id: String = ""
	var hp_pct: int = 0
	var hunger_pct: int = 0
	var sanity_pct: int = 0
	var temp_pct: int = 0
	var is_alive: bool = true
	var is_ghost: bool = false
	var ghost_remaining_ms: int = 0

	static func encode(v: PlayerStatus) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if not v.player_id.is_empty():
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.player_id)
		for pair in [[2, "hp_pct"], [3, "hunger_pct"], [4, "sanity_pct"], [5, "temp_pct"]]:
			var fn: int = pair[0]
			var val: int = v.get(pair[1])
			if val != 0:
				buf = WildwoodWire.write_tag(buf, fn, WildwoodWire.WT_VARINT)
				buf = WildwoodWire.write_varint(buf, val)
		if not v.is_alive:
			buf = WildwoodWire.write_tag(buf, 6, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, 1)
		if v.is_ghost:
			buf = WildwoodWire.write_tag(buf, 7, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, 1)
		if v.ghost_remaining_ms != 0:
			buf = WildwoodWire.write_tag(buf, 8, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.ghost_remaining_ms)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: PlayerStatus = PlayerStatus.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					v.player_id = b[0].get_string_from_utf8(); pos = b[1]
				2:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.hp_pct = vi[0]; pos = vi[1]
				3:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.hunger_pct = vi2[0]; pos = vi2[1]
				4:
					var vi3: Array = WildwoodWire.read_varint(buf, pos)
					v.sanity_pct = vi3[0]; pos = vi3[1]
				5:
					var vi4: Array = WildwoodWire.read_varint(buf, pos)
					v.temp_pct = vi4[0]; pos = vi4[1]
				6:
					var vi5: Array = WildwoodWire.read_varint(buf, pos)
					v.is_alive = (vi5[0] != 0); pos = vi5[1]
				7:
					var vi6: Array = WildwoodWire.read_varint(buf, pos)
					v.is_ghost = (vi6[0] != 0); pos = vi6[1]
				8:
					var vi7: Array = WildwoodWire.read_varint(buf, pos)
					v.ghost_remaining_ms = vi7[0]; pos = vi7[1]
				_:
					push_warning("PlayerStatus: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# WorldEvent
# ============================================================
class WorldEvent:
	var event_id: int = 0
	var event_kind: int = 0
	var source_entity_id: int = 0
	var target_entity_id: int = 0
	var amount: int = 0
	var position: Vec2F = null

	static func encode(v: WorldEvent) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.event_id != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.event_id)
		if v.event_kind != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.event_kind)
		if v.source_entity_id != 0:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.source_entity_id)
		if v.target_entity_id != 0:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.target_entity_id)
		if v.amount != 0:
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, WildwoodWire.zigzag_encode32(v.amount))
		if v.position != null:
			buf = WildwoodWire.write_tag(buf, 6, WildwoodWire.WT_LENGTH)
			var pos_bytes: PackedByteArray = Vec2F.encode(v.position)
			buf = WildwoodWire.write_varint(buf, pos_bytes.size())
			buf.append_array(pos_bytes)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: WorldEvent = WorldEvent.new()
		var end: int = buf.size()
		var pos: int = offset
		while pos < end:
			var t: Array = WildwoodWire.read_tag(buf, pos)
			var fn: int = t[0]; pos = t[2]
			match fn:
				1:
					var vi: Array = WildwoodWire.read_varint(buf, pos)
					v.event_id = vi[0]; pos = vi[1]
				2:
					var vi2: Array = WildwoodWire.read_varint(buf, pos)
					v.event_kind = vi2[0]; pos = vi2[1]
				3:
					var vi3: Array = WildwoodWire.read_varint(buf, pos)
					v.source_entity_id = vi3[0]; pos = vi3[1]
				4:
					var vi4: Array = WildwoodWire.read_varint(buf, pos)
					v.target_entity_id = vi4[0]; pos = vi4[1]
				5:
					var vi5: Array = WildwoodWire.read_varint(buf, pos)
					v.amount = WildwoodWire.zigzag_decode32(vi5[0]); pos = vi5[1]
				6:
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					var sub: Array = Vec2F.decode(b[0], 0)
					v.position = sub[0]; pos = b[1]
				_:
					push_warning("WorldEvent: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# WorldSnapshot
# ============================================================
class WorldSnapshot:
	var server_tick: int = 0
	var server_time_ms: int = 0
	var entities: Array = []      # Array[EntityState]
	var players: Array = []       # Array[PlayerState]
	var status: Array = []        # Array[PlayerStatus]
	var world_seed: String = ""
	var season: String = ""
	var day: int = 0

	static func encode(v: WorldSnapshot) -> PackedByteArray:
		var buf: PackedByteArray = PackedByteArray()
		if v.server_tick != 0:
			buf = WildwoodWire.write_tag(buf, 1, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_tick)
		if v.server_time_ms != 0:
			buf = WildwoodWire.write_tag(buf, 2, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.server_time_ms)
		for e in v.entities:
			buf = WildwoodWire.write_tag(buf, 3, WildwoodWire.WT_LENGTH)
			var eb: PackedByteArray = EntityState.encode(e)
			buf = WildwoodWire.write_varint(buf, eb.size())
			buf.append_array(eb)
		for p in v.players:
			buf = WildwoodWire.write_tag(buf, 4, WildwoodWire.WT_LENGTH)
			var pb: PackedByteArray = PlayerState.encode(p)
			buf = WildwoodWire.write_varint(buf, pb.size())
			buf.append_array(pb)
		for s in v.status:
			buf = WildwoodWire.write_tag(buf, 5, WildwoodWire.WT_LENGTH)
			var sb: PackedByteArray = PlayerStatus.encode(s)
			buf = WildwoodWire.write_varint(buf, sb.size())
			buf.append_array(sb)
		if not v.world_seed.is_empty():
			buf = WildwoodWire.write_tag(buf, 6, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.world_seed)
		if not v.season.is_empty():
			buf = WildwoodWire.write_tag(buf, 7, WildwoodWire.WT_LENGTH)
			buf = WildwoodWire.write_string(buf, v.season)
		if v.day != 0:
			buf = WildwoodWire.write_tag(buf, 8, WildwoodWire.WT_VARINT)
			buf = WildwoodWire.write_varint(buf, v.day)
		return buf

	static func decode(buf: PackedByteArray, offset: int) -> Array:
		var v: WorldSnapshot = WorldSnapshot.new()
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
					var b: Array = WildwoodWire.read_bytes(buf, pos)
					var sub: Array = EntityState.decode(b[0], 0)
					v.entities.append(sub[0]); pos = b[1]
				4:
					var b2: Array = WildwoodWire.read_bytes(buf, pos)
					var sub2: Array = PlayerState.decode(b2[0], 0)
					v.players.append(sub2[0]); pos = b2[1]
				5:
					var b3: Array = WildwoodWire.read_bytes(buf, pos)
					var sub3: Array = PlayerStatus.decode(b3[0], 0)
					v.status.append(sub3[0]); pos = b3[1]
				6:
					var b4: Array = WildwoodWire.read_bytes(buf, pos)
					v.world_seed = b4[0].get_string_from_utf8(); pos = b4[1]
				7:
					var b5: Array = WildwoodWire.read_bytes(buf, pos)
					v.season = b5[0].get_string_from_utf8(); pos = b5[1]
				8:
					var vi3: Array = WildwoodWire.read_varint(buf, pos)
					v.day = vi3[0]; pos = vi3[1]
				_:
					push_warning("WorldSnapshot: unknown field %d" % fn)
					break
		return [v, pos]


# ============================================================
# 模块末尾:外部依赖(放到最后避免 class-definitions-order 警告)
# ============================================================
const WildwoodWire = preload("res://core/abstract/network/gd/wildwood_wire.gd")
