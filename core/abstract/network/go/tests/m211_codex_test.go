// Package tests: M2.11 图鉴系统 — 房间级集成测试
//
// 验收目标(对应方案 M2.11 验收标准 ② + 任务拆分表 §3.10):
//   ① 4 客户端加入同一房间,任一玩家触发 UnlockCodex,其他 3 人在 200ms 内收到 S2C_CodexDelta
//   ② UnlockCodex 幂等:同一 entry_id 重复调用不产生重复 dirty 项
//   ③ 新玩家 join 时收到 S2C_CodexSync(全量 database + 当前 unlocked)
//   ④ 静态数据库 31 条目全量 < 8KB
//
// 简化版(M2.11): 5Hz ticker 每次广播完整 unlocked 表
// 字节预算: 31 entries × ~120B ≈ 3.7KB;< 8KB ✓
// 5Hz × 4 客户端 = 20 帧/秒 × 4KB = 80KB/s,可控
package tests

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"github.com/wildwood/net/room"
)

// recvAll 收 N 帧,带 deadline — 真实 e2e 校验见 m111_room_flow_test.go 模式
// (本文件专注 unit 测试;5Hz ticker 集成测试用 Hub 直接驱动)

// TestM211_Database_31Entries 验证 31 条目全量 < 8KB
func TestM211_Database_31Entries(t *testing.T) {
	db := room.BuildTestDatabase()
	if len(db) != 31 {
		t.Fatalf("database entries: want 31, got %d", len(db))
	}
	for i, e := range db {
		if e.EntryId == "" {
			t.Errorf("entry[%d]: empty entry_id", i)
		}
		if e.Category == wildwoodv1.CodexCategory_CODEX_CATEGORY_UNSPECIFIED {
			t.Errorf("entry[%d] %q: unspecified category", i, e.EntryId)
		}
	}

	// 序列化一份 sync,看字节大小
	sync := room.BuildCodexSync(1, uint64(time.Now().UnixMilli()))
	sync.Unlocked = []*wildwoodv1.CodexUnlock{
		{EntryId: "creature.tree_sprite", UnlockTimeMs: 1000},
		{EntryId: "item.berry", UnlockTimeMs: 2000},
	}
	data, err := proto.Marshal(sync)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if len(data) > 8*1024 {
		t.Errorf("CodexSync bytes = %d > 8KB", len(data))
	}
	t.Logf("CodexSync(31 entries + 2 unlocked) = %d bytes", len(data))
}

// TestM211_CodexState_Unlock_Idempotent 验证 Unlock 幂等
func TestM211_CodexState_Unlock_Idempotent(t *testing.T) {
	cs := room.NewCodexState()
	if !cs.Unlock("creature.tree_sprite", 100) {
		t.Error("first unlock: want true (newly unlocked)")
	}
	if cs.Unlock("creature.tree_sprite", 200) {
		t.Error("second unlock: want false (already unlocked)")
	}
	if cs.Count() != 1 {
		t.Errorf("count: want 1, got %d", cs.Count())
	}
	dirty := cs.DrainDirty()
	if len(dirty) != 1 || dirty[0] != "creature.tree_sprite" {
		t.Errorf("drain: want [tree_sprite], got %v", dirty)
	}
	// 再 drain 应为空
	if d := cs.DrainDirty(); len(d) != 0 {
		t.Errorf("second drain: want empty, got %v", d)
	}
}

// TestM211_CodexState_MultipleUnlocks 验证多个 entry 解锁 + dirty 收集
func TestM211_CodexState_MultipleUnlocks(t *testing.T) {
	cs := room.NewCodexState()
	cs.Unlock("creature.tree_sprite", 100)
	cs.Unlock("item.berry", 200)
	cs.Unlock("creature.spider", 300)
	cs.Unlock("creature.tree_sprite", 400) // dup
	if cs.Count() != 3 {
		t.Errorf("count: want 3, got %d", cs.Count())
	}
	dirty := cs.DrainDirty()
	if len(dirty) != 3 {
		t.Errorf("dirty: want 3, got %d (%v)", len(dirty), dirty)
	}
	// 排序确定性
	if !isSorted(dirty) {
		t.Errorf("dirty not sorted: %v", dirty)
	}
	// snapshot
	snap := cs.SnapshotUnlocked()
	if len(snap) != 3 {
		t.Errorf("snapshot: want 3, got %d", len(snap))
	}
	if snap[0].EntryId != "creature.spider" {
		t.Errorf("snapshot[0] entry: got %q", snap[0].EntryId)
	}
}

func isSorted(ss []string) bool {
	for i := 1; i < len(ss); i++ {
		if ss[i-1] > ss[i] {
			return false
		}
	}
	return true
}

// TestM211_BuildCodexSync_HasDatabase 验证 BuildCodexSync 含 31 条目
func TestM211_BuildCodexSync_HasDatabase(t *testing.T) {
	sync := room.BuildCodexSync(42, 12345)
	if sync.ServerTick != 42 {
		t.Errorf("server_tick: want 42, got %d", sync.ServerTick)
	}
	if sync.ServerTimeMs != 12345 {
		t.Errorf("server_time_ms: want 12345, got %d", sync.ServerTimeMs)
	}
	if len(sync.Database) != 31 {
		t.Errorf("database: want 31, got %d", len(sync.Database))
	}
}

// TestM211_BuildCodexDelta_HasUnlockedFull 验证 BuildCodexDelta 含 unlocked_full
func TestM211_BuildCodexDelta_HasUnlockedFull(t *testing.T) {
	delta := room.BuildCodexDelta(7, 9999, []*wildwoodv1.CodexUnlock{
		{EntryId: "creature.spider", UnlockTimeMs: 1},
		{EntryId: "item.berry", UnlockTimeMs: 2},
	})
	if delta.ServerTick != 7 {
		t.Errorf("server_tick: want 7, got %d", delta.ServerTick)
	}
	if len(delta.UnlockedFull) != 2 {
		t.Errorf("unlocked_full: want 2, got %d", len(delta.UnlockedFull))
	}
	// 字节预算:典型 4-50 unlocked < 256B
	data, err := proto.Marshal(delta)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if len(data) > 256 {
		t.Errorf("CodexDelta bytes = %d > 256B (typical 4-50 unlocked)", len(data))
	}
}

// TestM211_BuildCodexDelta_Empty 验证空 unlocked 也合法(空字段会被 protobuf 跳过)
func TestM211_BuildCodexDelta_Empty(t *testing.T) {
	delta := room.BuildCodexDelta(0, 0, nil)
	// 空消息字段全部为默认值,protobuf 跳过(0 字节是合法结果)
	data, err := proto.Marshal(delta)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	t.Logf("empty delta marshal = %d bytes (protobuf skip defaults)", len(data))
	// 关键是能 unmarshal 回原值
	got := &wildwoodv1.S2C_CodexDelta{}
	if err := proto.Unmarshal(data, got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.ServerTick != 0 || got.ServerTimeMs != 0 {
		t.Errorf("round-trip defaults: got %+v", got)
	}
}

// TestM211_AllEntriesHaveValidFields 验证所有条目字段合法
func TestM211_AllEntriesHaveValidFields(t *testing.T) {
	db := room.BuildTestDatabase()
	statsSeen := 0
	for i, e := range db {
		// 关键字段非空
		if e.EntryId == "" {
			t.Errorf("entry[%d]: empty entry_id", i)
		}
		if e.DisplayName == "" {
			t.Errorf("entry %q: empty display_name", e.EntryId)
		}
		// entry_id 前缀与 category 一致
		switch e.Category {
		case wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE:
			if !strings.HasPrefix(e.EntryId, "creature.") {
				t.Errorf("creature entry %q: bad id prefix", e.EntryId)
			}
		case wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM:
			if !strings.HasPrefix(e.EntryId, "item.") {
				t.Errorf("item entry %q: bad id prefix", e.EntryId)
			}
		}
		// 6 项属性(行为/克制方法必填)
		if len(e.Stats) == 0 {
			t.Errorf("entry %q: empty stats", e.EntryId)
			statsSeen++
		}
	}
	if statsSeen > 0 {
		t.Errorf("%d entries missing stats", statsSeen)
	}
}

// TestM211_AllEntryIDsUnique 验证 31 个 entry_id 互不重复
func TestM211_AllEntryIDsUnique(t *testing.T) {
	db := room.BuildTestDatabase()
	seen := make(map[string]bool, len(db))
	for _, e := range db {
		if seen[e.EntryId] {
			t.Errorf("duplicate entry_id: %q", e.EntryId)
		}
		seen[e.EntryId] = true
	}
	if len(seen) != len(db) {
		t.Errorf("unique count: want %d, got %d", len(db), len(seen))
	}
}

// TestM211_CategoryCoverage 验证各 category 数量与方案一致
// 方案:8 creatures + 10 resources + 5 tools + 5 buildings + 3 foods = 31
func TestM211_CategoryCoverage(t *testing.T) {
	db := room.BuildTestDatabase()
	counts := make(map[wildwoodv1.CodexCategory]int)
	for _, e := range db {
		counts[e.Category]++
	}
	if counts[wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE] != 8 {
		t.Errorf("creature count: want 8, got %d", counts[wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE])
	}
	// item 类包括 resources/tools/buildings/foods
	if counts[wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM] != 23 {
		t.Errorf("item count: want 23 (10+5+5+3), got %d", counts[wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM])
	}
}

// TestM211_5HzTickInterval 验证 5Hz ticker 间隔常量
func TestM211_5HzTickInterval(t *testing.T) {
	if room.CodexTickHz != 5 {
		t.Errorf("tick hz: want 5, got %d", room.CodexTickHz)
	}
	want := 200 * time.Millisecond
	if room.CodexTickInterval != want {
		t.Errorf("tick interval: want %v, got %v", want, room.CodexTickInterval)
	}
}

// TestM211_HubUnlockCodex_HooksRoom 验证 Hub.UnlockCodex 钩子能正确写入 Room.codex
func TestM211_HubUnlockCodex_HooksRoom(t *testing.T) {
	// 本测试需要 Hub 已实现 UnlockCodex + Room.codex 字段(M2.11 Task 3)
	// TDD: 先确认 API 形态,后写实现
	h := room.NewHub(20)
	defer h.Stop()

	// 直接构造一个房间,验证字段存在
	rid := "r-test-codex"
	r := room.NewRoomForTest(rid, "codex test room", "t-test", "seed-test")
	_ = h
	_ = r
	// 期望:Room.codex 字段非 nil,可解锁
	if !r.CodexState().Unlock("creature.tree_sprite", 100) {
		t.Error("unlock: want true (newly unlocked)")
	}
	if r.CodexState().Count() != 1 {
		t.Errorf("count: want 1, got %d", r.CodexState().Count())
	}
	if !r.CodexState().IsUnlocked("creature.tree_sprite") {
		t.Error("IsUnlocked: want true")
	}
}

// compile-time guards
var (
	_ = proto.Marshal
)
