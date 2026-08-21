// Package tests: Go ↔ GDScript wire format 交叉验证 (M2.11)
//
// 目标:确保 Go protobuf 编码的字节序列与 GDScript 手写 wire format 编码的字节序列
// 在语义上可互相解析(unmarshal 一致). 这是 Godot 客户端跨语言互通的保证.
//
// 策略:不重新实现 protobuf 编码,而是用 Go 的 proto.Marshal 产生的字节作为 oracle,
// GDScript 端用相同的 wire format 编码产生字节,两者应可互换解析.
//
// 本测试用 Go 模拟 GDScript 端的编码路径(write_tag/write_varint/write_string 等),
// 验证与 proto.Marshal 等价. GDScript 端真实代码在 wildwood_c2s.gd / wildwood_s2c.gd
// 由 Godot headless 测试覆盖;沙箱中无法直接跑 Godot.
package tests

import (
	"bytes"
	"encoding/binary"
	"testing"

	"google.golang.org/protobuf/proto"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

// GDScript wire format 常量(与 wildwood_wire.gd 一致)
const (
	GD_WT_VARINT  = 0
	GD_WT_FIXED64 = 1
	GD_WT_LENGTH  = 2
	GD_WT_FIXED32 = 5
)

// writeTagGDScript 模拟 GDScript WildwoodWire.write_tag
func writeTagGDScript(buf *bytes.Buffer, fieldNumber int, wireType int) {
	tag := uint64((fieldNumber << 3) | wireType)
	writeVarintGDScript(buf, tag)
}

// writeVarintGDScript 模拟 GDScript WildwoodWire.write_varint
func writeVarintGDScript(buf *bytes.Buffer, v uint64) {
	for v >= 0x80 {
		buf.WriteByte(byte(v) | 0x80)
		v >>= 7
	}
	buf.WriteByte(byte(v))
}

// writeStringGDScript 模拟 GDScript WildwoodWire.write_string
func writeStringGDScript(buf *bytes.Buffer, s string) {
	writeVarintGDScript(buf, uint64(len(s)))
	buf.WriteString(s)
}

// encodeCodexEntryGDScript 模拟 GDScript CommonTypes.CodexEntry.encode
func encodeCodexEntryGDScript(e *wildwoodv1.CodexEntry) []byte {
	var buf bytes.Buffer
	if e.EntryId != "" {
		writeTagGDScript(&buf, 1, GD_WT_LENGTH)
		writeStringGDScript(&buf, e.EntryId)
	}
	if e.Category != wildwoodv1.CodexCategory_CODEX_CATEGORY_UNSPECIFIED {
		writeTagGDScript(&buf, 2, GD_WT_VARINT)
		writeVarintGDScript(&buf, uint64(e.Category.Number()))
	}
	if e.PrefabId != 0 {
		writeTagGDScript(&buf, 3, GD_WT_VARINT)
		writeVarintGDScript(&buf, uint64(e.PrefabId))
	}
	if e.DisplayName != "" {
		writeTagGDScript(&buf, 4, GD_WT_LENGTH)
		writeStringGDScript(&buf, e.DisplayName)
	}
	if e.ScientificName != "" {
		writeTagGDScript(&buf, 5, GD_WT_LENGTH)
		writeStringGDScript(&buf, e.ScientificName)
	}
	if e.SpriteKey != "" {
		writeTagGDScript(&buf, 6, GD_WT_LENGTH)
		writeStringGDScript(&buf, e.SpriteKey)
	}
	for _, s := range e.Stats {
		writeTagGDScript(&buf, 7, GD_WT_LENGTH)
		writeStringGDScript(&buf, s)
	}
	if e.Behavior != "" {
		writeTagGDScript(&buf, 8, GD_WT_LENGTH)
		writeStringGDScript(&buf, e.Behavior)
	}
	if e.Weakness != "" {
		writeTagGDScript(&buf, 9, GD_WT_LENGTH)
		writeStringGDScript(&buf, e.Weakness)
	}
	for _, d := range e.DropTable {
		writeTagGDScript(&buf, 10, GD_WT_LENGTH)
		writeStringGDScript(&buf, d)
	}
	if e.Rarity != 0 {
		writeTagGDScript(&buf, 11, GD_WT_VARINT)
		writeVarintGDScript(&buf, uint64(e.Rarity))
	}
	return buf.Bytes()
}

// encodeCodexUnlockGDScript 模拟 GDScript CommonTypes.CodexUnlock.encode
func encodeCodexUnlockGDScript(u *wildwoodv1.CodexUnlock) []byte {
	var buf bytes.Buffer
	if u.EntryId != "" {
		writeTagGDScript(&buf, 1, GD_WT_LENGTH)
		writeStringGDScript(&buf, u.EntryId)
	}
	if u.UnlockTimeMs != 0 {
		writeTagGDScript(&buf, 2, GD_WT_VARINT)
		writeVarintGDScript(&buf, u.UnlockTimeMs)
	}
	return buf.Bytes()
}

// TestGD_WireFormat_CodexEntry_RoundTrip 验证 GDScript 编码的 CodexEntry 可被 Go proto.Unmarshal 解析
func TestGD_WireFormat_CodexEntry_RoundTrip(t *testing.T) {
	e := &wildwoodv1.CodexEntry{
		EntryId:        "creature.tree_sprite",
		Category:       wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE,
		PrefabId:       1001,
		DisplayName:    "树精",
		ScientificName: "Arborea Maledicta",
		SpriteKey:      "TBD_64",
		Stats:          []string{"HP: 120", "攻击: 25", "防御: 8", "移速: 2.5", "季节: 秋冬", "食物: 0"},
		Behavior:       "白天静止伪装,黄昏起追击",
		Weakness:       "火把点燃 3 次击退",
		DropTable:      []string{"item.log", "item.twig"},
		Rarity:         1,
	}
	gdBytes := encodeCodexEntryGDScript(e)
	got := &wildwoodv1.CodexEntry{}
	if err := proto.Unmarshal(gdBytes, got); err != nil {
		t.Fatalf("GDScript-encoded bytes fail Go proto.Unmarshal: %v", err)
	}
	if got.EntryId != e.EntryId {
		t.Errorf("entry_id: want %q, got %q", e.EntryId, got.EntryId)
	}
	if got.Category != e.Category {
		t.Errorf("category: want %v, got %v", e.Category, got.Category)
	}
	if got.PrefabId != e.PrefabId {
		t.Errorf("prefab_id: want %d, got %d", e.PrefabId, got.PrefabId)
	}
	if got.DisplayName != e.DisplayName {
		t.Errorf("display_name: want %q, got %q", e.DisplayName, got.DisplayName)
	}
	if len(got.Stats) != 6 {
		t.Errorf("stats len: want 6, got %d", len(got.Stats))
	}
	if got.Rarity != 1 {
		t.Errorf("rarity: want 1, got %d", got.Rarity)
	}

	// 反向:Go 编码也应能被 GDScript 端解码(用 Go 解码再编码验证)
	goBytes, err := proto.Marshal(e)
	if err != nil {
		t.Fatalf("Go proto.Marshal: %v", err)
	}
	got2 := &wildwoodv1.CodexEntry{}
	if err := proto.Unmarshal(goBytes, got2); err != nil {
		t.Fatalf("Go-encoded bytes fail proto.Unmarshal: %v", err)
	}
	if got2.EntryId != e.EntryId || got2.Rarity != 1 {
		t.Errorf("Go round-trip mismatch: %+v", got2)
	}
	t.Logf("GDScript CodexEntry = %d bytes, Go proto.Marshal = %d bytes", len(gdBytes), len(goBytes))
}

// TestGD_WireFormat_CodexUnlock_RoundTrip 验证 CodexUnlock 互通
func TestGD_WireFormat_CodexUnlock_RoundTrip(t *testing.T) {
	u := &wildwoodv1.CodexUnlock{
		EntryId:      "creature.spider",
		UnlockTimeMs: 1700000000000,
	}
	gdBytes := encodeCodexUnlockGDScript(u)
	got := &wildwoodv1.CodexUnlock{}
	if err := proto.Unmarshal(gdBytes, got); err != nil {
		t.Fatalf("GDScript-encoded CodexUnlock: %v", err)
	}
	if got.EntryId != u.EntryId || got.UnlockTimeMs != u.UnlockTimeMs {
		t.Errorf("unlock mismatch: want %+v, got %+v", u, got)
	}
}

// TestGD_WireFormat_CodexSync_RoundTrip 验证 S2C_CodexSync 互通
func TestGD_WireFormat_CodexSync_RoundTrip(t *testing.T) {
	db := []*wildwoodv1.CodexEntry{
		{
			EntryId: "creature.tree_sprite", Category: wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE,
			PrefabId: 1001, DisplayName: "树精", SpriteKey: "TBD_64", Rarity: 1,
			Stats: []string{"HP: 120"}, Behavior: "白天", Weakness: "火把",
		},
		{
			EntryId: "item.berry", Category: wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM,
			PrefabId: 2001, DisplayName: "浆果", SpriteKey: "TBD_64",
			Stats: []string{"再生: 2天"}, Behavior: "采集", Weakness: "无",
		},
	}
	unlocked := []*wildwoodv1.CodexUnlock{
		{EntryId: "creature.tree_sprite", UnlockTimeMs: 1000},
	}

	// GDScript-style 编码
	var buf bytes.Buffer
	writeTagGDScript(&buf, 1, GD_WT_VARINT) // server_tick
	writeVarintGDScript(&buf, 1)
	writeTagGDScript(&buf, 2, GD_WT_VARINT) // server_time_ms
	writeVarintGDScript(&buf, uint64(1700000000000))
	for _, e := range db {
		writeTagGDScript(&buf, 3, GD_WT_LENGTH) // database
		eb := encodeCodexEntryGDScript(e)
		writeVarintGDScript(&buf, uint64(len(eb)))
		buf.Write(eb)
	}
	for _, u := range unlocked {
		writeTagGDScript(&buf, 4, GD_WT_LENGTH) // unlocked
		ub := encodeCodexUnlockGDScript(u)
		writeVarintGDScript(&buf, uint64(len(ub)))
		buf.Write(ub)
	}
	gdBytes := buf.Bytes()

	got := &wildwoodv1.S2C_CodexSync{}
	if err := proto.Unmarshal(gdBytes, got); err != nil {
		t.Fatalf("GDScript S2C_CodexSync: %v (bytes=%d)", err, len(gdBytes))
	}
	if got.ServerTick != 1 {
		t.Errorf("server_tick: got %d", got.ServerTick)
	}
	if len(got.Database) != 2 {
		t.Errorf("database: want 2, got %d", len(got.Database))
	}
	if len(got.Unlocked) != 1 {
		t.Errorf("unlocked: want 1, got %d", len(got.Unlocked))
	}
	if got.Unlocked[0].EntryId != "creature.tree_sprite" {
		t.Errorf("unlocked[0]: got %q", got.Unlocked[0].EntryId)
	}
}

// TestGD_WireFormat_CodexDelta_RoundTrip 验证 S2C_CodexDelta 互通
func TestGD_WireFormat_CodexDelta_RoundTrip(t *testing.T) {
	unlocked := []*wildwoodv1.CodexUnlock{
		{EntryId: "creature.spider", UnlockTimeMs: 100},
		{EntryId: "item.berry", UnlockTimeMs: 200},
	}
	var buf bytes.Buffer
	writeTagGDScript(&buf, 1, GD_WT_VARINT) // server_tick
	writeVarintGDScript(&buf, 5)
	writeTagGDScript(&buf, 2, GD_WT_VARINT) // server_time_ms
	writeVarintGDScript(&buf, uint64(1700000001000))
	for _, u := range unlocked {
		writeTagGDScript(&buf, 3, GD_WT_LENGTH) // unlocked_full
		ub := encodeCodexUnlockGDScript(u)
		writeVarintGDScript(&buf, uint64(len(ub)))
		buf.Write(ub)
	}
	gdBytes := buf.Bytes()

	got := &wildwoodv1.S2C_CodexDelta{}
	if err := proto.Unmarshal(gdBytes, got); err != nil {
		t.Fatalf("GDScript S2C_CodexDelta: %v", err)
	}
	if got.ServerTick != 5 {
		t.Errorf("server_tick: got %d", got.ServerTick)
	}
	if len(got.UnlockedFull) != 2 {
		t.Errorf("unlocked_full: want 2, got %d", len(got.UnlockedFull))
	}
}

// TestGD_WireFormat_CodexQuery_RoundTrip 验证 C2S_CodexQuery 互通
func TestGD_WireFormat_CodexQuery_RoundTrip(t *testing.T) {
	// kind=ENTRY, entry_id="creature.deerclops"
	var buf bytes.Buffer
	writeTagGDScript(&buf, 1, GD_WT_VARINT) // kind
	writeVarintGDScript(&buf, uint64(wildwoodv1.CodexQueryKind_CODEX_QUERY_KIND_ENTRY.Number()))
	writeTagGDScript(&buf, 2, GD_WT_LENGTH) // entry_id
	writeStringGDScript(&buf, "creature.deerclops")
	gdBytes := buf.Bytes()

	got := &wildwoodv1.C2S_CodexQuery{}
	if err := proto.Unmarshal(gdBytes, got); err != nil {
		t.Fatalf("GDScript C2S_CodexQuery: %v", err)
	}
	if got.Kind != wildwoodv1.CodexQueryKind_CODEX_QUERY_KIND_ENTRY {
		t.Errorf("kind: want ENTRY, got %v", got.Kind)
	}
	if got.EntryId != "creature.deerclops" {
		t.Errorf("entry_id: got %q", got.EntryId)
	}
}

// TestGD_WireFormat_CodexView_RoundTrip 验证 C2S_CodexView 互通
func TestGD_WireFormat_CodexView_RoundTrip(t *testing.T) {
	var buf bytes.Buffer
	writeTagGDScript(&buf, 1, GD_WT_VARINT) // is_open=true
	writeVarintGDScript(&buf, 1)
	gdBytes := buf.Bytes()

	got := &wildwoodv1.C2S_CodexView{}
	if err := proto.Unmarshal(gdBytes, got); err != nil {
		t.Fatalf("GDScript C2S_CodexView: %v", err)
	}
	if !got.IsOpen {
		t.Error("is_open: want true")
	}

	// 反向:closed
	var buf2 bytes.Buffer
	// is_open=false → 默认值 → 不写 tag(节省字节)
	_ = buf2
	gdBytes2 := buf2.Bytes()
	got2 := &wildwoodv1.C2S_CodexView{}
	if err := proto.Unmarshal(gdBytes2, got2); err != nil {
		t.Fatalf("empty C2S_CodexView: %v", err)
	}
	if got2.IsOpen {
		t.Error("default is_open: want false")
	}
}

// _ = binary.LittleEndian  // 防止 import 警告
var _ = binary.LittleEndian
