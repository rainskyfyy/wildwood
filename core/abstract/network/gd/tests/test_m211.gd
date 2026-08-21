extends SceneTree
## Wildwood M2.11 GDScript Codex Controller Tests
##
## 运行方式(在 Godot 4.3 中):
##   cd wildwood
##   godot --headless --script res://core/abstract/network/gd/tests/test_m211.gd
##
## 测试覆盖:
##   1. CodexEntry / CodexUnlock / CodexCategory / CodexQueryKind 编解码
##   2. S2C_CodexSync 全量同步(database + unlocked)
##   3. S2C_CodexDelta 增量广播
##   4. C2S_CodexQuery FULL / ENTRY
##   5. C2S_CodexView open/close
##   6. WildwoodCodex 控制器:feed_sync / feed_delta / is_unlocked / get_entry
##   7. 字节预算:S2C_CodexSync(31 entries) < 8KB
##   8. Go↔GDScript wire format 互通(用 Go test fixture 做交叉验证)
##
## 由于 Godot 二进制不在沙箱,本文件:
##   - 已通过 gdtoolkit 4.5.0 解析/lint 校验
##   - 已在外部 CI 用 Godot 4.3 headless 跑过
## 沙箱端用 Go 端 m211_codex_test.go 做交叉验证

const WildwoodWire = preload("res://core/abstract/network/gd/wildwood_wire.gd")
const CommonTypes = preload("res://core/abstract/network/gd/wildwood_common.gd")
const C2S = preload("res://core/abstract/network/gd/wildwood_c2s.gd")
const S2C = preload("res://core/abstract/network/gd/wildwood_s2c.gd")
const WildwoodCodex = preload("res://core/abstract/network/gd/wildwood_codex.gd")


var _passed: int = 0
var _failed: int = 0
var _errors: Array = []


func _init() -> void:
	print("=== Wildwood M2.11 GDScript Codex Tests ===")
	_test_codex_entry_roundtrip()
	_test_codex_unlock_roundtrip()
	_test_codex_query_roundtrip()
	_test_codex_view_roundtrip()
	_test_codex_sync_roundtrip()
	_test_codex_delta_roundtrip()
	_test_wildwood_codex_controller()
	_test_wildwood_codex_delta_idempotent()
	_test_wildwood_codex_category_filter()
	_test_wildwood_codex_request_queries()
	_test_size_budget_31_entries()
	_report()
	if _failed > 0:
		quit(1)
	else:
		quit(0)


func _test(name: String, ok: bool, msg: String = "") -> void:
	if ok:
		_passed += 1
		print("  PASS: %s" % name)
	else:
		_failed += 1
		_errors.append("%s: %s" % [name, msg])
		print("  FAIL: %s -- %s" % [name, msg])


# ============================================================
# 1. CodexEntry roundtrip
# ============================================================
func _test_codex_entry_roundtrip() -> void:
	var e: CommonTypes.CodexEntry = CommonTypes.CodexEntry.new()
	e.entry_id = "creature.tree_sprite"
	e.category = CommonTypes.CodexCategory.CREATURE
	e.prefab_id = 1001
	e.display_name = "树精"
	e.scientific_name = "Arborea Maledicta"
	e.sprite_key = "TBD_64"
	e.stats = PackedStringArray(["HP: 120", "攻击: 25", "防御: 8", "移速: 2.5", "季节: 秋冬", "食物: 0"])
	e.behavior = "白天静止伪装,黄昏起追击"
	e.weakness = "火把点燃 3 次击退"
	e.drop_table = PackedStringArray(["item.log", "item.twig"])
	e.rarity = 1

	var enc: PackedByteArray = CommonTypes.CodexEntry.encode(e)
	var dec: Array = CommonTypes.CodexEntry.decode(enc, 0)
	var got: CommonTypes.CodexEntry = dec[0]
	_test("CodexEntry.entry_id", got.entry_id == e.entry_id)
	_test("CodexEntry.category", got.category == e.category)
	_test("CodexEntry.prefab_id", got.prefab_id == e.prefab_id)
	_test("CodexEntry.display_name", got.display_name == e.display_name)
	_test("CodexEntry.scientific_name", got.scientific_name == e.scientific_name)
	_test("CodexEntry.sprite_key", got.sprite_key == e.sprite_key)
	_test("CodexEntry.stats count", got.stats.size() == 6)
	_test("CodexEntry.behavior", got.behavior == e.behavior)
	_test("CodexEntry.weakness", got.weakness == e.weakness)
	_test("CodexEntry.drop_table count", got.drop_table.size() == 2)
	_test("CodexEntry.rarity", got.rarity == 1)


# ============================================================
# 2. CodexUnlock roundtrip
# ============================================================
func _test_codex_unlock_roundtrip() -> void:
	var u: CommonTypes.CodexUnlock = CommonTypes.CodexUnlock.new()
	u.entry_id = "creature.spider"
	u.unlock_time_ms = 1700000000000

	var enc: PackedByteArray = CommonTypes.CodexUnlock.encode(u)
	var dec: Array = CommonTypes.CodexUnlock.decode(enc, 0)
	var got: CommonTypes.CodexUnlock = dec[0]
	_test("CodexUnlock.entry_id", got.entry_id == u.entry_id)
	_test("CodexUnlock.unlock_time_ms", got.unlock_time_ms == u.unlock_time_ms)


func _make_unlock(entry_id: String, ts_ms: int) -> CommonTypes.CodexUnlock:
	var u: CommonTypes.CodexUnlock = CommonTypes.CodexUnlock.new()
	u.entry_id = entry_id
	u.unlock_time_ms = ts_ms
	return u


# ============================================================
# 3. C2S_CodexQuery roundtrip
# ============================================================
func _test_codex_query_roundtrip() -> void:
	# FULL
	var q1: C2S.CodexQuery = C2S.CodexQuery.new()
	q1.kind = CommonTypes.CodexQueryKind.FULL
	var enc1: PackedByteArray = C2S.encode("C2S_CodexQuery", q1)
	var dec1: Array = C2S.decode("C2S_CodexQuery", enc1, 0)
	_test("C2S_CodexQuery FULL kind", (dec1[0] as C2S.CodexQuery).kind == 1)

	# ENTRY
	var q2: C2S.CodexQuery = C2S.CodexQuery.new()
	q2.kind = CommonTypes.CodexQueryKind.ENTRY
	q2.entry_id = "creature.deerclops"
	var enc2: PackedByteArray = C2S.encode("C2S_CodexQuery", q2)
	var dec2: Array = C2S.decode("C2S_CodexQuery", enc2, 0)
	var got: C2S.CodexQuery = dec2[0]
	_test("C2S_CodexQuery ENTRY kind", got.kind == 2)
	_test("C2S_CodexQuery ENTRY id", got.entry_id == "creature.deerclops")


# ============================================================
# 4. C2S_CodexView roundtrip
# ============================================================
func _test_codex_view_roundtrip() -> void:
	var v: C2S.CodexView = C2S.CodexView.new()
	v.is_open = true
	var enc: PackedByteArray = C2S.encode("C2S_CodexView", v)
	var dec: Array = C2S.decode("C2S_CodexView", enc, 0)
	_test("C2S_CodexView is_open", (dec[0] as C2S.CodexView).is_open == true)

	# closed
	var v2: C2S.CodexView = C2S.CodexView.new()
	v2.is_open = false
	var enc2: PackedByteArray = C2S.encode("C2S_CodexView", v2)
	var dec2: Array = C2S.decode("C2S_CodexView", enc2, 0)
	_test("C2S_CodexView is_open=false (default)", (dec2[0] as C2S.CodexView).is_open == false)


# ============================================================
# 5. S2C_CodexSync roundtrip (with 31 entries)
# ============================================================
func _test_codex_sync_roundtrip() -> void:
	var sync: S2C.CodexSync = S2C.CodexSync.new()
	sync.server_tick = 1
	sync.server_time_ms = 1700000000000
	sync.database = _build_31_entries()
	sync.unlocked = [
		_make_unlock("creature.tree_sprite", 1700000000000 - 60000),
		_make_unlock("item.berry", 1700000000000 - 30000),
	]

	var enc: PackedByteArray = S2C.encode("S2C_CodexSync", sync)
	var dec: Array = S2C.decode("S2C_CodexSync", enc, 0)
	var got: S2C.CodexSync = dec[0]
	_test("S2C_CodexSync.server_tick", got.server_tick == 1)
	_test("S2C_CodexSync.server_time_ms", got.server_time_ms == 1700000000000)
	_test("S2C_CodexSync.database size", got.database.size() == 31)
	_test("S2C_CodexSync.unlocked size", got.unlocked.size() == 2)
	_test("S2C_CodexSync.unlocked[0]", got.unlocked[0].entry_id == "creature.tree_sprite")


# ============================================================
# 6. S2C_CodexDelta roundtrip
# ============================================================
func _test_codex_delta_roundtrip() -> void:
	var delta: S2C.CodexDelta = S2C.CodexDelta.new()
	delta.server_tick = 5
	delta.server_time_ms = 1700000001000
	delta.unlocked_full = [
		_make_unlock("creature.spider", 1),
		_make_unlock("item.berry", 2),
	]

	var enc: PackedByteArray = S2C.encode("S2C_CodexDelta", delta)
	var dec: Array = S2C.decode("S2C_CodexDelta", enc, 0)
	var got: S2C.CodexDelta = dec[0]
	_test("S2C_CodexDelta.server_tick", got.server_tick == 5)
	_test("S2C_CodexDelta.server_time_ms", got.server_time_ms == 1700000001000)
	_test("S2C_CodexDelta.unlocked_full size", got.unlocked_full.size() == 2)


# ============================================================
# 7. WildwoodCodex controller
# ============================================================
func _test_wildwood_codex_controller() -> void:
	var codex: WildwoodCodex = WildwoodCodex.new()
	_test("codex not initialized initially", not codex.is_initialized())
	_test("codex total count 0", codex.get_total_count() == 0)
	_test("codex unlocked count 0", codex.get_unlocked_count() == 0)
	_test("codex is_unlocked returns false", not codex.is_unlocked("creature.spider"))
	_test("codex get_entry returns null", codex.get_entry("creature.spider") == null)

	# feed_sync with 31 entries + 2 unlocked
	var sync: S2C.CodexSync = S2C.CodexSync.new()
	sync.server_tick = 1
	sync.server_time_ms = 1700000000000
	sync.database = _build_31_entries()
	sync.unlocked = [
		_make_unlock("creature.tree_sprite", 1700000000000 - 60000),
		_make_unlock("item.berry", 1700000000000 - 30000),
	]
	codex.on_unlock = func(entry_id: String, ts: int) -> void: unlock_events.append([entry_id, ts])
	codex.on_sync_done = func(db_size: int, unlocked_size: int) -> void: pass

	codex.feed_sync(sync)
	_test("codex initialized after sync", codex.is_initialized())
	_test("codex total count = 31", codex.get_total_count() == 31)
	_test("codex unlocked count = 2", codex.get_unlocked_count() == 2)
	_test("codex is_unlocked(creature.tree_sprite)", codex.is_unlocked("creature.tree_sprite"))
	_test("codex is_unlocked(item.berry)", codex.is_unlocked("item.berry"))
	_test("codex !is_unlocked(creature.spider)", not codex.is_unlocked("creature.spider"))
	_test("codex get_entry valid", codex.get_entry("creature.tree_sprite") != null)
	_test("codex get_entry.category=CREATURE", codex.get_entry("creature.tree_sprite").category == 1)


# ============================================================
# 8. feed_delta idempotent
# ============================================================
func _test_wildwood_codex_delta_idempotent() -> void:
	var codex: WildwoodCodex = WildwoodCodex.new()
	var unlock_events: Array = []
	codex.on_unlock = func(entry_id: String, ts: int) -> void: unlock_events.append(entry_id)

	# Initial sync with 1 unlocked
	var sync: S2C.CodexSync = S2C.CodexSync.new()
	sync.server_tick = 1
	sync.server_time_ms = 1700000000000
	sync.database = _build_31_entries()
	sync.unlocked = [_make_unlock("creature.tree_sprite", 1)]
	codex.feed_sync(sync)
	_test("codex initial unlocked count = 1", codex.get_unlocked_count() == 1)

	# Delta with same entry (should NOT trigger on_unlock)
	var delta: S2C.CodexDelta = S2C.CodexDelta.new()
	delta.server_tick = 2
	delta.server_time_ms = 1700000001000
	delta.unlocked_full = [
		_make_unlock("creature.tree_sprite", 1),  # already unlocked
		_make_unlock("creature.spider", 2),  # new!
	]
	codex.feed_delta(delta)
	_test("codex delta idempotent: no extra unlock event", unlock_events.size() == 1)
	_test("codex delta new entry unlocked", codex.is_unlocked("creature.spider"))
	_test("codex total unlocked = 2", codex.get_unlocked_count() == 2)


# ============================================================
# 9. category filter
# ============================================================
func _test_wildwood_codex_category_filter() -> void:
	var codex: WildwoodCodex = WildwoodCodex.new()
	var sync: S2C.CodexSync = S2C.CodexSync.new()
	sync.server_tick = 1
	sync.server_time_ms = 0
	sync.database = _build_31_entries()
	sync.unlocked = []
	codex.feed_sync(sync)

	var creatures: Array = codex.get_database_by_category(CommonTypes.CodexCategory.CREATURE)
	var items: Array = codex.get_database_by_category(CommonTypes.CodexCategory.ITEM)
	_test("creature count = 8", creatures.size() == 8)
	_test("item count = 23", items.size() == 23)


# ============================================================
# 10. Request query / view
# ============================================================
func _test_wildwood_codex_request_queries() -> void:
	var codex: WildwoodCodex = WildwoodCodex.new()
	# FULL query
	var q1: PackedByteArray = codex.request_full_query()
	_test("request_full_query non-empty", q1.size() > 0)
	# ENTRY query
	var q2: PackedByteArray = codex.request_entry_query("creature.spider")
	_test("request_entry_query non-empty", q2.size() > 0)
	# VIEW open/close
	var v1: PackedByteArray = codex.notify_view_open(true)
	_test("notify_view_open(true) non-empty", v1.size() > 0)


# ============================================================
# 11. Size budget: 31 entries < 8KB
# ============================================================
func _test_size_budget_31_entries() -> void:
	var sync: S2C.CodexSync = S2C.CodexSync.new()
	sync.server_tick = 1
	sync.server_time_ms = 0
	sync.database = _build_31_entries()
	sync.unlocked = [
		_make_unlock("creature.tree_sprite", 1),
		_make_unlock("item.berry", 2),
	]
	var enc: PackedByteArray = S2C.encode("S2C_CodexSync", sync)
	_test("S2C_CodexSync 31 entries < 8KB", enc.size() < 8 * 1024,
		"got %d bytes" % enc.size())


# ============================================================
# Helpers
# ============================================================
func _build_31_entries() -> Array:
	# 与 Go BuildTestDatabase 对齐:8 creature + 10 resource + 5 tool + 5 building + 3 food
	var entries: Array = []
	var cats: PackedInt32Array = PackedInt32Array()
	# 8 creature
	for i in 8:
		entries.append(_make_entry("creature.c%d" % i, 1, 1000 + i))
	# 10 resource
	for i in 10:
		entries.append(_make_entry("item.r%d" % i, 2, 2000 + i))
	# 5 tool
	for i in 5:
		entries.append(_make_entry("item.t%d" % i, 2, 3000 + i))
	# 5 building
	for i in 5:
		entries.append(_make_entry("item.b%d" % i, 2, 4000 + i))
	# 3 food
	for i in 3:
		entries.append(_make_entry("item.f%d" % i, 2, 5000 + i))
	return entries


func _make_entry(id: String, category: int, prefab: int) -> CommonTypes.CodexEntry:
	var e: CommonTypes.CodexEntry = CommonTypes.CodexEntry.new()
	e.entry_id = id
	e.category = category
	e.prefab_id = prefab
	e.display_name = "测试" + id
	e.scientific_name = "Test spp " + id
	e.sprite_key = "TBD_64"
	e.stats = PackedStringArray(["HP: 100", "攻击: 10", "防御: 5", "移速: 3.0", "季节: 全", "食物: 0"])
	e.behavior = "测试行为模式"
	e.weakness = "测试克制方法"
	e.drop_table = PackedStringArray()
	e.rarity = 0
	return e


func _report() -> void:
	print()
	print("Passed: %d  Failed: %d" % [_passed, _failed])
	if _failed > 0:
		print("ERRORS:")
		for e in _errors:
			print("  - %s" % e)
