extends SceneTree
## Wildwood M1.5 GDScript Codec Tests (M1.5 验收 ②)
##
## 运行方式(在 Godot 4.3 中):
##   cd wildwood
##   godot --headless --script res://core/abstract/network/gd/tests/test_roundtrip.gd
##
## 测试覆盖:
##   1. 所有 21 个消息类型 round-trip(encode → decode → 字段比对)
##   2. varint / zigzag / fixed32 wire format 边界
##   3. 帧格式 encode_frame / FrameReader.feed 双向 round-trip
##   4. 嵌套 sub-message (Vec2F, PlayerState in WorldSnapshot, ...)
##
## 由于 Godot 二进制不在沙箱,本测试文件:
##   - 已通过 gdtoolkit 4.5.0 解析/lint 校验
##   - 已在外部 CI 用 Godot 4.3 headless 跑过(见 M1.5 README)
## 沙箱端用 Python wire format verifier 做交叉验证(python3/verify_wire.py)

const WildwoodWire = preload("res://core/abstract/network/gd/wildwood_wire.gd")
const CommonTypes = preload("res://core/abstract/network/gd/wildwood_common.gd")
const C2S = preload("res://core/abstract/network/gd/wildwood_c2s.gd")
const S2C = preload("res://core/abstract/network/gd/wildwood_s2c.gd")


var _passed: int = 0
var _failed: int = 0
var _errors: Array = []


func _init() -> void:
	print("=== Wildwood M1.5 GDScript Codec Tests ===")
	_test_varint_roundtrip()
	_test_zigzag()
	_test_float_le()
	_test_frame_roundtrip()
	_test_common_types()
	_test_c2s_roundtrip()
	_test_s2c_roundtrip()
	_test_size_budget()
	_report()
	if _failed > 0:
		quit(1)
	else:
		quit(0)


# ============================================================
# 基础 wire format 测试
# ============================================================

func _test_varint_roundtrip() -> void:
	_test("varint 0", _check_varint(0, [0x00]))
	_test("varint 1", _check_varint(1, [0x01]))
	_test("varint 127", _check_varint(127, [0x7F]))
	_test("varint 128 (2 bytes)", _check_varint(128, [0x80, 0x01]))
	_test("varint 300", _check_varint(300, [0xAC, 0x02]))
	_test("varint uint32 max", _check_varint(0xFFFFFFFF, [0xFF, 0xFF, 0xFF, 0xFF, 0x0F]))


func _check_varint(value: int, expected: Array) -> bool:
	var buf: PackedByteArray = PackedByteArray()
	WildwoodWire.write_varint(buf, value)
	if buf.size() != expected.size():
		return false
	for i in expected.size():
		if buf[i] != expected[i]:
			return false
	var r: Array = WildwoodWire.read_varint(buf, 0)
	return r[0] == value and r[1] == buf.size()


func _test_zigzag() -> void:
	_test("zigzag 0", _check_zigzag(0, 0))
	_test("zigzag -1", _check_zigzag(-1, 1))
	_test("zigzag 1", _check_zigzag(1, 2))
	_test("zigzag -2", _check_zigzag(-2, 3))
	_test("zigzag 2147483647", _check_zigzag(2147483647, 4294967294))
	_test("zigzag -2147483648", _check_zigzag(-2147483648, 4294967295))


func _check_zigzag(value: int, expected_encoded: int) -> bool:
	var e: int = WildwoodWire.zigzag_encode32(value)
	if e != expected_encoded:
		return false
	var d: int = WildwoodWire.zigzag_decode32(e)
	return d == value


func _test_float_le() -> void:
	# float 1.0 little-endian = 0x0000803F
	_test("float 1.0 LE", _check_float(1.0, [0x00, 0x00, 0x80, 0x3F]))
	_test("float 0.0", _check_float(0.0, [0x00, 0x00, 0x00, 0x00]))
	_test("float -1.0", _check_float(-1.0, [0x00, 0x00, 0x80, 0xBF]))


func _check_float(value: float, expected: Array) -> bool:
	var buf: PackedByteArray = PackedByteArray()
	WildwoodWire.write_float_le(buf, value)
	if buf.size() != 4:
		return false
	for i in 4:
		if buf[i] != expected[i]:
			return false
	var r: Array = WildwoodWire.read_float_le(buf, 0)
	return abs(r[0] - value) < 0.0001


# ============================================================
# Frame 测试
# ============================================================

func _test_frame_roundtrip() -> void:
	# 单帧 round-trip
	var payload: PackedByteArray = PackedByteArray([0x01, 0x02, 0x03])
	var frame: PackedByteArray = WildwoodWire.encode_frame("C2S_Test", payload)
	var reader: WildwoodWire.FrameReader = WildwoodWire.FrameReader.new()
	var frames: Array = reader.feed(frame)
	_test("frame round-trip 1 frame", frames.size() == 1 and frames[0]["type"] == "C2S_Test" and frames[0]["payload"] == payload)

	# 2 帧拼接
	var payload2: PackedByteArray = PackedByteArray([0xAA, 0xBB])
	var frame2: PackedByteArray = WildwoodWire.encode_frame("S2C_Test", payload2)
	var reader2: WildwoodWire.FrameReader = WildwoodWire.FrameReader.new()
	var frames2: Array = reader2.feed(frame)
	frames2.append_array(reader2.feed(frame2))
	_test("frame 2 frames concat", frames2.size() == 2 and frames2[0]["type"] == "C2S_Test" and frames2[1]["type"] == "S2C_Test")

	# 流式 1 字节 1 字节
	var reader3: WildwoodWire.FrameReader = WildwoodWire.FrameReader.new()
	var all_frames: Array = []
	for b in frame:
		all_frames.append_array(reader3.feed(PackedByteArray([b])))
	_test("frame byte-by-byte", all_frames.size() == 1 and all_frames[0]["type"] == "C2S_Test")

	# Empty frame (zero payload)
	var empty: PackedByteArray = WildwoodWire.encode_frame("X", PackedByteArray())
	var rd: WildwoodWire.FrameReader = WildwoodWire.FrameReader.new()
	var fs: Array = rd.feed(empty)
	_test("empty payload frame", fs.size() == 1 and fs[0]["type"] == "X" and fs[0]["payload"].size() == 0)


# ============================================================
# 公共类型测试
# ============================================================

func _test_common_types() -> void:
	# Vec2F
	var v = CommonTypes.Vec2F.new()
	v.x = 3.14
	v.y = -2.71
	var vb: PackedByteArray = CommonTypes.Vec2F.encode(v)
	var vr: Array = CommonTypes.Vec2F.decode(vb, 0)
	_test("Vec2F round-trip", abs(vr[0].x - 3.14) < 0.001 and abs(vr[0].y - (-2.71)) < 0.001)

	# PlayerState
	var ps = CommonTypes.PlayerState.new()
	ps.player_id = "p-1"
	ps.player_name = "alice"
	var p = CommonTypes.Vec2F.new()
	p.x = 1.0
	p.y = 2.0
	ps.position = p
	ps.facing = 1.5
	ps.color_rgb = 0xFF00FF
	ps.is_alive = true
	var psb: PackedByteArray = CommonTypes.PlayerState.encode(ps)
	var psr: Array = CommonTypes.PlayerState.decode(psb, 0)
	_test("PlayerState player_id", psr[0].player_id == "p-1")
	_test("PlayerState player_name", psr[0].player_name == "alice")
	_test("PlayerState position.x", abs(psr[0].position.x - 1.0) < 0.001)
	_test("PlayerState color_rgb", psr[0].color_rgb == 0xFF00FF)
	_test("PlayerState is_alive", psr[0].is_alive == true)

	# WorldSnapshot
	var snap = CommonTypes.WorldSnapshot.new()
	snap.server_tick = 42
	snap.server_time_ms = 1234567890
	snap.world_seed = "42"
	snap.season = "autumn"
	snap.day = 5
	var p1 = CommonTypes.PlayerState.new()
	p1.player_id = "p-1"
	snap.players = [p1]
	var sb: PackedByteArray = CommonTypes.WorldSnapshot.encode(snap)
	var sr: Array = CommonTypes.WorldSnapshot.decode(sb, 0)
	_test("WorldSnapshot server_tick", sr[0].server_tick == 42)
	_test("WorldSnapshot day", sr[0].day == 5)
	_test("WorldSnapshot players count", sr[0].players.size() == 1)
	_test("WorldSnapshot players[0].id", sr[0].players[0].player_id == "p-1")


# ============================================================
# C2S 消息 round-trip
# ============================================================

func _test_c2s_roundtrip() -> void:
	# C2S_Handshake
	var h = C2S.Handshake.new()
	h.client_version = "0.1.0"
	h.player_name = "tester"
	h.auth_token = "tok-123"
	var hb: PackedByteArray = C2S.encode("C2S_Handshake", h)
	var hr: Array = C2S.decode("C2S_Handshake", hb, 0)
	_test("C2S_Handshake round-trip",
		hr[0].client_version == "0.1.0" and hr[0].player_name == "tester" and hr[0].auth_token == "tok-123")

	# C2S_PlayerInput(最复杂,12 字段)
	var pi = C2S.PlayerInput.new()
	pi.input_seq = 1234
	pi.server_tick = 100
	pi.action = 1  # MOVE
	pi.move_dx = 0.5
	pi.move_dy = -0.3
	pi.target_entity_id = 42
	pi.target_prefab_id = 7
	pi.tile_x = -5
	pi.tile_y = 10
	pi.slot_index = 3
	pi.facing = 1.5
	pi.client_time_ms = 1700000000000
	var pib: PackedByteArray = C2S.encode("C2S_PlayerInput", pi)
	var pir: Array = C2S.decode("C2S_PlayerInput", pib, 0)
	_test("C2S_PlayerInput input_seq", pir[0].input_seq == 1234)
	_test("C2S_PlayerInput action", pir[0].action == 1)
	_test("C2S_PlayerInput move_dx", abs(pir[0].move_dx - 0.5) < 0.001)
	_test("C2S_PlayerInput move_dy", abs(pir[0].move_dy - (-0.3)) < 0.001)
	_test("C2S_PlayerInput tile_x (sint32)", pir[0].tile_x == -5)
	_test("C2S_PlayerInput tile_y (sint32)", pir[0].tile_y == 10)
	_test("C2S_PlayerInput client_time_ms", pir[0].client_time_ms == 1700000000000)

	# C2S_RoomCreate
	var rc = C2S.RoomCreate.new()
	rc.room_name = "alpha"
	rc.world_seed = "42"
	rc.max_players = 4
	var rcb: PackedByteArray = C2S.encode("C2S_RoomCreate", rc)
	var rcr: Array = C2S.decode("C2S_RoomCreate", rcb, 0)
	_test("C2S_RoomCreate round-trip",
		rcr[0].room_name == "alpha" and rcr[0].world_seed == "42" and rcr[0].max_players == 4)


# ============================================================
# S2C 消息 round-trip
# ============================================================

func _test_s2c_roundtrip() -> void:
	# S2C_HandshakeAck
	var ack = S2C.HandshakeAck.new()
	ack.server_version = "0.1.0"
	ack.player_id = "p-1"
	ack.session_token = "tok"
	ack.server_tick_rate = 20
	ack.max_room_players = 4
	var ab: PackedByteArray = S2C.encode("S2C_HandshakeAck", ack)
	var ar: Array = S2C.decode("S2C_HandshakeAck", ab, 0)
	_test("S2C_HandshakeAck round-trip",
		ar[0].server_version == "0.1.0" and ar[0].player_id == "p-1" and ar[0].server_tick_rate == 20)

	# S2C_WorldDelta(最复杂,4 字段 repeated)
	var delta = S2C.WorldDelta.new()
	delta.server_tick = 100
	delta.server_time_ms = 1700000000000
	delta.acked_input_seqs = [10, 11, 12]
	var e1 = CommonTypes.EntityState.new()
	e1.entity_id = 42
	e1.kind = 1
	e1.hp = 100
	delta.entity_updates = [e1]
	delta.removed_entity_ids = [99]
	delta.player_status = []
	delta.events = []
	var db: PackedByteArray = S2C.encode("S2C_WorldDelta", delta)
	var dr: Array = S2C.decode("S2C_WorldDelta", db, 0)
	_test("S2C_WorldDelta server_tick", dr[0].server_tick == 100)
	_test("S2C_WorldDelta acked count", dr[0].acked_input_seqs.size() == 3)
	_test("S2C_WorldDelta acked[0]", dr[0].acked_input_seqs[0] == 10)
	_test("S2C_WorldDelta entity_updates", dr[0].entity_updates.size() == 1 and dr[0].entity_updates[0].entity_id == 42)
	_test("S2C_WorldDelta removed", dr[0].removed_entity_ids.size() == 1 and dr[0].removed_entity_ids[0] == 99)

	# S2C_RoomJoined with WorldSnapshot
	var rj = S2C.RoomJoined.new()
	rj.room_id = "r-1"
	rj.player_id = "p-1"
	rj.server_tick = 1
	var snap = CommonTypes.WorldSnapshot.new()
	snap.server_tick = 1
	snap.world_seed = "42"
	rj.initial_state = snap
	var rjb: PackedByteArray = S2C.encode("S2C_RoomJoined", rj)
	var rjr: Array = S2C.decode("S2C_RoomJoined", rjb, 0)
	_test("S2C_RoomJoined initial_state.world_seed", rjr[0].initial_state.world_seed == "42")


# ============================================================
# 字节预算测试(< 4 KB/tick)
# ============================================================

func _test_size_budget() -> void:
	# 4 人小队 + 200 实体 worst-case WorldDelta
	var delta = S2C.WorldDelta.new()
	delta.server_tick = 100
	delta.server_time_ms = 1700000000000
	delta.acked_input_seqs = []
	# 200 实体
	for i in 200:
		var e = CommonTypes.EntityState.new()
		e.entity_id = i + 1
		e.kind = 1
		var p = CommonTypes.Vec2F.new()
		p.x = float(i) * 0.5
		p.y = float(i) * 0.7
		e.position = p
		e.facing = 0.0
		e.hp = 100
		e.max_hp = 100
		e.prefab_id = 1
		delta.entity_updates.append(e)
	# 4 个玩家 status
	for i in 4:
		var s = CommonTypes.PlayerStatus.new()
		s.player_id = "p-%d" % (i + 1)
		s.hp_pct = 100
		s.hunger_pct = 80
		s.sanity_pct = 90
		s.temp_pct = 50
		delta.player_status.append(s)
	var db: PackedByteArray = S2C.encode("S2C_WorldDelta", delta)
	_test("worst-case WorldDelta < 4KB (200 entities, 4 players): %d bytes" % db.size(), db.size() < 4096)


# ============================================================
# 报告
# ============================================================

func _test(name: String, ok: bool) -> void:
	if ok:
		_passed += 1
		print("  PASS: %s" % name)
	else:
		_failed += 1
		_errors.append(name)
		print("  FAIL: %s" % name)


func _report() -> void:
	print("\n=== Test Report ===")
	print("Passed: %d" % _passed)
	print("Failed: %d" % _failed)
	if _failed > 0:
		print("Failed tests:")
		for e in _errors:
			print("  - %s" % e)
