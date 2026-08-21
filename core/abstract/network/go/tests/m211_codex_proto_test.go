// Package tests: M2.11 图鉴系统 Protobuf 消息往返测试
//
// 验收目标:
//   1) 公共类型 CodexEntry / CodexUnlock / CodexCategory 可序列化 + 反序列化
//   2) S2C_CodexSync 含 database 数组 + unlocked 数组,bytes 还原一致
//   3) S2C_CodexDelta 增量广播,5Hz 频次(序列化层不验,留给 room 层)
//   4) C2S_CodexQuery / C2S_CodexView 注册到 registry
package tests

import (
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"github.com/wildwood/net/codec"
	"github.com/wildwood/net/room"
)

// TestCodexEntry_RoundTrip 验证公共类型可序列化还原
func TestCodexEntry_RoundTrip(t *testing.T) {
	entry := &wildwoodv1.CodexEntry{
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

	data, err := proto.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("empty marshal output")
	}

	got := &wildwoodv1.CodexEntry{}
	if err := proto.Unmarshal(data, got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.EntryId != entry.EntryId {
		t.Errorf("entry_id: want %q, got %q", entry.EntryId, got.EntryId)
	}
	if got.Category != entry.Category {
		t.Errorf("category: want %v, got %v", entry.Category, got.Category)
	}
	if got.DisplayName != entry.DisplayName {
		t.Errorf("display_name: want %q, got %q", entry.DisplayName, got.DisplayName)
	}
	if len(got.Stats) != 6 {
		t.Errorf("stats len: want 6, got %d", len(got.Stats))
	}
	if got.Rarity != 1 {
		t.Errorf("rarity: want 1, got %d", got.Rarity)
	}
}

// TestS2C_CodexSync_RoundTrip 验证 Sync 消息含 database + unlocked
func TestS2C_CodexSync_RoundTrip(t *testing.T) {
	now := time.Now().UnixMilli()
	sync := &wildwoodv1.S2C_CodexSync{
		ServerTick:    100,
		ServerTimeMs:  uint64(now),
		Database:      room.BuildTestDatabase(), // 31 entries 由 codex.go 提供
		Unlocked: []*wildwoodv1.CodexUnlock{
			{EntryId: "creature.tree_sprite", UnlockTimeMs: uint64(now - 60000)},
			{EntryId: "item.berry", UnlockTimeMs: uint64(now - 30000)},
		},
	}

	data, err := proto.Marshal(sync)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	// 字节预算: 31 entries × ~120B + 2 unlocks × 30B ≈ 4 KB
	// 5Hz 频率下每秒 4 个客户端 × 1 帧 ≈ 16 KB/s,可控
	if len(data) > 8*1024 {
		t.Logf("warning: CodexSync bytes = %d > 8 KB", len(data))
	}

	got := &wildwoodv1.S2C_CodexSync{}
	if err := proto.Unmarshal(data, got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.ServerTick != 100 {
		t.Errorf("server_tick: want 100, got %d", got.ServerTick)
	}
	if len(got.Database) != 31 {
		t.Errorf("database size: want 31, got %d", len(got.Database))
	}
	if len(got.Unlocked) != 2 {
		t.Errorf("unlocked size: want 2, got %d", len(got.Unlocked))
	}
	if got.Unlocked[0].EntryId != "creature.tree_sprite" {
		t.Errorf("unlocked[0] entry_id: got %q", got.Unlocked[0].EntryId)
	}
}

// TestS2C_CodexDelta_RoundTrip 验证 Delta 增量广播
func TestS2C_CodexDelta_RoundTrip(t *testing.T) {
	delta := &wildwoodv1.S2C_CodexDelta{
		ServerTick:   200,
		ServerTimeMs: 12345,
		UnlockedFull: []*wildwoodv1.CodexUnlock{
			{EntryId: "creature.spider", UnlockTimeMs: 100},
			{EntryId: "item.berry", UnlockTimeMs: 50},
		},
	}
	data, err := proto.Marshal(delta)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := &wildwoodv1.S2C_CodexDelta{}
	if err := proto.Unmarshal(data, got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.ServerTick != 200 {
		t.Errorf("server_tick: want 200, got %d", got.ServerTick)
	}
	if len(got.UnlockedFull) != 2 {
		t.Errorf("unlocked_full size: want 2, got %d", len(got.UnlockedFull))
	}
}

// TestC2S_CodexQuery_CodecRegistered 验证客户端消息注册到 codec registry
func TestC2S_CodexQuery_CodecRegistered(t *testing.T) {
	q := &wildwoodv1.C2S_CodexQuery{
		Kind:    wildwoodv1.CodexQueryKind_CODEX_QUERY_KIND_ENTRY,
		EntryId: "creature.deerclops",
	}
	data, err := proto.Marshal(q)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	// 经 codec frame 往返
	fr, err := codec.EncodeFrame(codec.Frame{Type: "C2S_CodexQuery", Payload: data})
	if err != nil {
		t.Fatalf("encode frame: %v", err)
	}
	rdr := codec.NewReader()
	frames, err := rdr.Feed(fr)
	if err != nil {
		t.Fatalf("feed: %v", err)
	}
	if len(frames) != 1 {
		t.Fatalf("want 1 frame, got %d", len(frames))
	}
	if frames[0].Type != "C2S_CodexQuery" {
		t.Errorf("type: want C2S_CodexQuery, got %q", frames[0].Type)
	}

	msg, err := codec.UnmarshalFrame(frames[0])
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got, ok := msg.(*wildwoodv1.C2S_CodexQuery)
	if !ok {
		t.Fatalf("type assertion failed: got %T", msg)
	}
	if got.EntryId != "creature.deerclops" {
		t.Errorf("entry_id: got %q", got.EntryId)
	}
}

// TestC2S_CodexView_CodecRegistered 验证 View 开关注册
func TestC2S_CodexView_CodecRegistered(t *testing.T) {
	v := &wildwoodv1.C2S_CodexView{IsOpen: true}
	data, err := proto.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	fr, err := codec.EncodeFrame(codec.Frame{Type: "C2S_CodexView", Payload: data})
	if err != nil {
		t.Fatalf("encode frame: %v", err)
	}
	rdr := codec.NewReader()
	frames, err := rdr.Feed(fr)
	if err != nil {
		t.Fatalf("feed: %v", err)
	}
	if frames[0].Type != "C2S_CodexView" {
		t.Errorf("type: got %q", frames[0].Type)
	}
}

// TestS2C_CodexSync_RegisteredInRegistry 验证 S2C 消息在 registry 中
func TestS2C_CodexSync_RegisteredInRegistry(t *testing.T) {
	for _, want := range []string{
		"S2C_CodexSync",
		"S2C_CodexDelta",
		"C2S_CodexQuery",
		"C2S_CodexView",
	} {
		if !codec.IsKnownType(want) {
			t.Errorf("registry missing type %q", want)
		}
	}
}
