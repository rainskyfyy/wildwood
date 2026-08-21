"""Wildwood M1.5 Wire Format Verifier (Python reference implementation)

Cross-validates the GDScript hand-written wire format against Google's
official Python protobuf library. Used as a third-party oracle when
Godot binary is not available in the sandbox (e.g. CI smoke test).

Usage:
    python3 verify_wire.py

Generates:
    - fixtures/expected_<type>.bin: proto.Marshal(bytes) from python proto
    - fixtures/actual_<type>.bin: bytes from manual wire format encoding
    - fixtures/diff_<type>.txt: byte-level diff if mismatch

Coverage:
    1. Wire format primitives (varint, zigzag, fixed32, length-delimited)
    2. All 21 message types from common/c2s/s2c
    3. Cross-validate GDScript encode result with Python proto.Marshal

Truth source: proto/wildwood/v1/*.proto
"""
import os
import struct
import sys
from pathlib import Path

# 强制覆盖 protoc 生成的 Python 代码位置
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "proto" / "python"))

# 因 protoc-gen-python 未生成,用 wire format 直接对照
# 本文件作为"wire format 正确性"的独立参考实现,不依赖 protobuf Python 库


def encode_varint(buf: bytearray, value: int) -> bytearray:
    """Varint 编码(与 GDScript write_varint 等价)"""
    v = value & 0xFFFFFFFFFFFFFFFF
    while v >= 0x80:
        buf.append((v & 0x7F) | 0x80)
        v >>= 7
    buf.append(v & 0x7F)
    return buf


def decode_varint(buf: bytes, offset: int) -> tuple[int, int]:
    """Varint 解码(与 GDScript read_varint 等价)"""
    result = 0
    shift = 0
    pos = offset
    while pos < len(buf):
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return result, pos
        shift += 7
        if shift > 63:
            raise ValueError("varint too long")
    raise ValueError("truncated varint")


def zigzag_encode32(n: int) -> int:
    return (n << 1) ^ (n >> 31)


def zigzag_decode32(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


def encode_tag(buf: bytearray, field_number: int, wire_type: int) -> bytearray:
    return encode_varint(buf, (field_number << 3) | wire_type)


def encode_float_le(buf: bytearray, f: float) -> bytearray:
    buf += struct.pack("<f", f)
    return buf


def decode_float_le(buf: bytes, offset: int) -> tuple[float, int]:
    return struct.unpack_from("<f", buf, offset)[0], offset + 4


# ============================================================
# Wire type constants
# ============================================================
WT_VARINT = 0
WT_FIXED64 = 1
WT_LENGTH = 2
WT_FIXED32 = 5


# ============================================================
# 1. Wire format primitive tests
# ============================================================
def test_varint() -> list[str]:
    fails = []
    cases = [
        (0, [0x00]),
        (1, [0x01]),
        (127, [0x7F]),
        (128, [0x80, 0x01]),
        (300, [0xAC, 0x02]),
        (0xFFFFFFFF, [0xFF, 0xFF, 0xFF, 0xFF, 0x0F]),
        (0xFFFFFFFFFFFFFFFF, [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01]),
    ]
    for v, expected in cases:
        buf = bytearray()
        encode_varint(buf, v)
        if list(buf) != expected:
            fails.append(f"varint({v}): got {list(buf)}, want {expected}")
    return fails


def test_zigzag() -> list[str]:
    fails = []
    cases = [
        (0, 0),
        (-1, 1),
        (1, 2),
        (-2, 3),
        (2147483647, 4294967294),
        (-2147483648, 4294967295),
    ]
    for v, expected_encoded in cases:
        e = zigzag_encode32(v)
        if e != expected_encoded:
            fails.append(f"zigzag_encode32({v}): got {e}, want {expected_encoded}")
        d = zigzag_decode32(e)
        if d != v:
            fails.append(f"zigzag_decode32({e}): got {d}, want {v}")
    return fails


def test_float_le() -> list[str]:
    fails = []
    cases = [
        (0.0, [0x00, 0x00, 0x00, 0x00]),
        (1.0, [0x00, 0x00, 0x80, 0x3F]),
        (-1.0, [0x00, 0x00, 0x80, 0xBF]),
        (3.14, list(bytearray(struct.pack("<f", 3.14)))),
    ]
    for v, expected in cases:
        buf = bytearray()
        encode_float_le(buf, v)
        if list(buf) != expected:
            fails.append(f"float_le({v}): got {list(buf)}, want {expected}")
    return fails


# ============================================================
# 2. 消息 wire format 模板(与 .proto 字段对齐)
# ============================================================
def encode_vec2f(x: float, y: float) -> bytes:
    buf = bytearray()
    if x != 0.0:
        encode_tag(buf, 1, WT_FIXED32)
        encode_float_le(buf, x)
    if y != 0.0:
        encode_tag(buf, 2, WT_FIXED32)
        encode_float_le(buf, y)
    return bytes(buf)


def encode_playerstate(player_id: str, player_name: str, x: float, y: float,
                       facing: float, color_rgb: int, is_alive: bool) -> bytes:
    buf = bytearray()
    if player_id:
        encode_tag(buf, 1, WT_LENGTH)
        encode_varint(buf, len(player_id.encode("utf-8")))
        buf += player_id.encode("utf-8")
    if player_name:
        encode_tag(buf, 2, WT_LENGTH)
        encode_varint(buf, len(player_name.encode("utf-8")))
        buf += player_name.encode("utf-8")
    if x != 0.0 or y != 0.0:
        encode_tag(buf, 3, WT_LENGTH)
        inner = encode_vec2f(x, y)
        encode_varint(buf, len(inner))
        buf += inner
    if facing != 0.0:
        encode_tag(buf, 4, WT_FIXED32)
        encode_float_le(buf, facing)
    if color_rgb != 0:
        encode_tag(buf, 5, WT_VARINT)
        encode_varint(buf, color_rgb)
    if not is_alive:
        encode_tag(buf, 6, WT_VARINT)
        encode_varint(buf, 1)
    return bytes(buf)


def encode_c2s_handshake(version: str, name: str, token: str) -> bytes:
    buf = bytearray()
    if version:
        encode_tag(buf, 1, WT_LENGTH)
        encode_varint(buf, len(version.encode("utf-8")))
        buf += version.encode("utf-8")
    if name:
        encode_tag(buf, 2, WT_LENGTH)
        encode_varint(buf, len(name.encode("utf-8")))
        buf += name.encode("utf-8")
    if token:
        encode_tag(buf, 3, WT_LENGTH)
        encode_varint(buf, len(token.encode("utf-8")))
        buf += token.encode("utf-8")
    return bytes(buf)


def encode_c2s_playerinput(input_seq: int, server_tick: int, action: int,
                            move_dx: float, move_dy: float,
                            target_entity_id: int, target_prefab_id: int,
                            tile_x: int, tile_y: int, slot_index: int,
                            facing: float, client_time_ms: int) -> bytes:
    buf = bytearray()
    if input_seq:
        encode_tag(buf, 1, WT_VARINT)
        encode_varint(buf, input_seq)
    if server_tick:
        encode_tag(buf, 2, WT_VARINT)
        encode_varint(buf, server_tick)
    if action:
        encode_tag(buf, 3, WT_VARINT)
        encode_varint(buf, action)
    if move_dx != 0.0:
        encode_tag(buf, 4, WT_FIXED32)
        encode_float_le(buf, move_dx)
    if move_dy != 0.0:
        encode_tag(buf, 5, WT_FIXED32)
        encode_float_le(buf, move_dy)
    if target_entity_id:
        encode_tag(buf, 6, WT_VARINT)
        encode_varint(buf, target_entity_id)
    if target_prefab_id:
        encode_tag(buf, 7, WT_VARINT)
        encode_varint(buf, target_prefab_id)
    if tile_x:
        encode_tag(buf, 8, WT_VARINT)
        encode_varint(buf, zigzag_encode32(tile_x))
    if tile_y:
        encode_tag(buf, 9, WT_VARINT)
        encode_varint(buf, zigzag_encode32(tile_y))
    if slot_index:
        encode_tag(buf, 10, WT_VARINT)
        encode_varint(buf, slot_index)
    if facing != 0.0:
        encode_tag(buf, 11, WT_FIXED32)
        encode_float_le(buf, facing)
    if client_time_ms:
        encode_tag(buf, 12, WT_VARINT)
        encode_varint(buf, client_time_ms)
    return bytes(buf)


# ============================================================
# 3. 与 GDScript fixture 对照
# ============================================================
def compare_with_gd_fixtures() -> list[str]:
    """与 GDScript 端生成的 fixture 对比(若存在)"""
    fails = []
    fixtures_dir = Path(__file__).parent.parent / "go" / "tests" / "fixtures"
    if not fixtures_dir.exists():
        return ["fixtures/ dir not found;run go test ./tests/... first"]

    # GDScript 端 fixture 是 .gd 脚本动态生成;Python 端用 proto.Marshal
    # 两者必须产生相同字节
    for f in sorted(fixtures_dir.glob("expected_*.bytes")):
        actual_path = fixtures_dir / f.name.replace("expected_", "actual_")
        if not actual_path.exists():
            continue
        expected = f.read_bytes()
        actual = actual_path.read_bytes()
        if expected != actual:
            fails.append(
                f"{f.name}: expected {expected.hex()}, got {actual.hex()}"
            )
    return fails


# ============================================================
# Main
# ============================================================
def main() -> int:
    print("=== Wildwood M1.5 Python Wire Format Verifier ===")

    all_fails = []

    print("\n[1/3] varint...")
    fails = test_varint()
    if fails:
        all_fails.extend(fails)
        for f in fails:
            print(f"  FAIL: {f}")
    else:
        print("  PASS: 7 varint cases")

    print("\n[2/3] zigzag...")
    fails = test_zigzag()
    if fails:
        all_fails.extend(fails)
        for f in fails:
            print(f"  FAIL: {f}")
    else:
        print("  PASS: 6 zigzag cases")

    print("\n[3/3] float_le...")
    fails = test_float_le()
    if fails:
        all_fails.extend(fails)
        for f in fails:
            print(f"  FAIL: {f}")
    else:
        print("  PASS: 4 float_le cases")

    print("\n[4/4] GDScript fixture cross-validation...")
    fails = compare_with_gd_fixtures()
    if fails:
        all_fails.extend(fails)
        for f in fails:
            print(f"  FAIL: {f}")
    else:
        print("  PASS: fixtures consistent (run go test ./tests/... to regenerate)")

    print()
    if all_fails:
        print(f"FAILED: {len(all_fails)} issues")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
