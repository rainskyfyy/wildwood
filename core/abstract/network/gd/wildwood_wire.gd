class_name WildwoodWireFormat
extends RefCounted
## Wildwood M1.5 — Protobuf wire format 低阶编解码(纯 GDScript)
##
## 不依赖 Godot 第三方插件;逐字节对应 protobuf 规范:
##   https://protobuf.dev/programming-guides/encoding/
##
## 协议真相源:proto/wildwood/v1/*.proto
## 配对参考:go/wildwood/v1/*.pb.go (由 protoc-gen-go 生成)
##
## 本类只负责 wire format 与字节缓冲,不做"消息含义"解析;
## 业务 message 见 wildcard_net_c2s.gd / wildcard_net_s2c.gd。
##
## 注意:
##   - int32/int64/uint32/uint64/bool 用 varint(wire_type=0)
##   - sint32/sint64 用 varint + zigzag(wire_type=0)
##   - float  用 fixed32 little-endian(wire_type=5)
##   - string/bytes/message  用 length-delimited(wire_type=2)
##   - enum  底层是 int32,wire_type=0

# === wire type 常量 ===
const WT_VARINT: int = 0       # int32/64/uint32/64/bool/enum
const WT_FIXED64: int = 1      # double(int64)
const WT_LENGTH: int = 2       # string/bytes/embedded message
const WT_FIXED32: int = 5      # float(fixed32)

const MAX_FRAME_SIZE: int = 65536
const MAX_TYPE_LENGTH: int = 64


# ============================================================
# Varint 编解码(用于 wire_type=0)
# ============================================================

## 把 varint 编码到 PackedByteArray,返回追加后的新数组
static func write_varint(buf: PackedByteArray, value: int) -> PackedByteArray:
	# uint64 范围内
	var v: int = value & 0xFFFFFFFFFFFFFFFF
	while v >= 0x80:
		buf.append((v & 0x7F) | 0x80)
		v = v >> 7
	buf.append(v & 0x7F)
	return buf


## 从 PackedByteArray 当前位置读 varint;返回 [value, new_offset]
## 若越界或格式错,返回 [-1, offset]
static func read_varint(buf: PackedByteArray, offset: int) -> Array:
	var result: int = 0
	var shift: int = 0
	var pos: int = offset
	while pos < buf.size():
		var b: int = buf[pos]
		pos += 1
		result = result | ((b & 0x7F) << shift)
		if (b & 0x80) == 0:
			return [result, pos]
		shift += 7
		if shift > 63:
			push_error("WildwoodWireFormat: varint too long")
			return [-1, offset]
	return [-1, offset]  # truncated


# ============================================================
# ZigZag 编码(用于 sint32/sint64)
# ============================================================

## sint32 → varint-friendly uint
static func zigzag_encode32(value: int) -> int:
	return (value << 1) ^ (value >> 31)


## sint64 → varint-friendly uint
static func zigzag_encode64(value: int) -> int:
	return (value << 1) ^ (value >> 63)


## uint → sint32
static func zigzag_decode32(value: int) -> int:
	return (value >> 1) ^ -(value & 1)


## uint → sint64
static func zigzag_decode64(value: int) -> int:
	return (value >> 1) ^ -(value & 1)


# ============================================================
# Field tag 编解码
# ============================================================

## 写 (field_number << 3 | wire_type) 作为一个 varint
static func write_tag(buf: PackedByteArray, field_number: int, wire_type: int) -> PackedByteArray:
	return write_varint(buf, (field_number << 3) | wire_type)


## 读 tag;返回 [field_number, wire_type, new_offset]
static func read_tag(buf: PackedByteArray, offset: int) -> Array:
	var v: Array = read_varint(buf, offset)
	if v[0] == -1:
		return [0, 0, offset]
	var tag: int = v[0]
	return [tag >> 3, tag & 0x07, v[1]]


# ============================================================
# 定长 32/64 bit little-endian 读写(用于 float/double)
# ============================================================

static func write_float_le(buf: PackedByteArray, f: float) -> PackedByteArray:
	var bytes: PackedByteArray = PackedByteArray()
	bytes.resize(4)
	bytes.encode_float(0, f)  # little-endian on all platforms Godot supports
	buf.append_array(bytes)
	return buf


static func read_float_le(buf: PackedByteArray, offset: int) -> Array:
	if offset + 4 > buf.size():
		return [0.0, offset]
	var bytes: PackedByteArray = buf.slice(offset, offset + 4)
	return [bytes.decode_float(0), offset + 4]


# ============================================================
# 字符串/字节数组(length-delimited)
# ============================================================

static func write_bytes(buf: PackedByteArray, data: PackedByteArray) -> PackedByteArray:
	buf = write_varint(buf, data.size())
	buf.append_array(data)
	return buf


static func write_string(buf: PackedByteArray, s: String) -> PackedByteArray:
	var bytes: PackedByteArray = s.to_utf8_buffer()
	return write_bytes(buf, bytes)


## 读 length-delimited 段;返回 [PackedByteArray, new_offset]
static func read_bytes(buf: PackedByteArray, offset: int) -> Array:
	var v: Array = read_varint(buf, offset)
	if v[0] == -1:
		return [PackedByteArray(), offset]
	var length: int = v[0]
	var new_offset: int = v[1]
	if new_offset + length > buf.size():
		return [PackedByteArray(), offset]
	var data: PackedByteArray = buf.slice(new_offset, new_offset + length)
	return [data, new_offset + length]


# ============================================================
# Frame 帧格式(传输层入口)
# ============================================================
## 帧格式:
##   [varint LEN] [varint TYPE_LEN] [TYPE bytes UTF-8] [PAYLOAD bytes]
##   LEN = TYPE_LEN(varint 字节) + TYPE 字节数 + PAYLOAD 字节数
## ============================================================


## 编码单条帧为可写入 socket 的字节
static func encode_frame(type_name: String, payload: PackedByteArray) -> PackedByteArray:
	if type_name.is_empty():
		push_error("WildwoodWireFormat: empty type_name")
		return PackedByteArray()
	var type_bytes: PackedByteArray = type_name.to_utf8_buffer()
	if type_bytes.size() > MAX_TYPE_LENGTH:
		push_error("WildwoodWireFormat: type too long")
		return PackedByteArray()
	var body: PackedByteArray = PackedByteArray()
	body = write_varint(body, type_bytes.size())
	body.append_array(type_bytes)
	body.append_array(payload)
	var out: PackedByteArray = PackedByteArray()
	out = write_varint(out, body.size())
	out.append_array(body)
	if out.size() > MAX_FRAME_SIZE:
		push_error("WildwoodWireFormat: frame exceeds MAX_FRAME_SIZE")
		return PackedByteArray()
	return out


## 流式帧解析器:累积数据,返回已解析的所有完整帧
## 返回:Array of Dictionary { "type": String, "payload": PackedByteArray }
## 失败(超长/格式错)返回空数组
class FrameReader extends RefCounted:
	var _buf: PackedByteArray = PackedByteArray()

	func feed(data: PackedByteArray) -> Array:
		_buf.append_array(data)
		var out: Array = []
		while _buf.size() > 0:
			var v: Array = WildwoodWireFormat.read_varint(_buf, 0)
			if v[0] == -1:
				break
			var length: int = v[0]
			if length > WildwoodWireFormat.MAX_FRAME_SIZE:
				push_error("FrameReader: frame too large")
				_buf = PackedByteArray()
				return []
			if _buf.size() < v[1] + length:
				break  # 等待更多数据
			var body: PackedByteArray = _buf.slice(v[1], v[1] + length)
			_buf = _buf.slice(v[1] + length)
			# body: [TYPE_LEN varint] [TYPE] [PAYLOAD]
			var t: Array = WildwoodWireFormat.read_varint(body, 0)
			if t[0] == -1:
				continue
			var type_len: int = t[0]
			var type_offset: int = t[1]
			if type_offset + type_len > body.size():
				continue
			var type_name: String = body.slice(type_offset, type_offset + type_len).get_string_from_utf8()
			var payload: PackedByteArray = body.slice(type_offset + type_len)
			out.append({"type": type_name, "payload": payload})
		return out
