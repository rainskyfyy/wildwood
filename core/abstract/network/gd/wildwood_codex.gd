class_name WildwoodCodex
extends RefCounted
## Wildwood M2.11 — 客户端图鉴控制器
##
## 职责:
##   1. 维护本地图鉴数据库(S2C_CodexSync 一次性下发 31 条目)
##   2. 跟踪解锁状态(S2C_CodexSync.unlocked + S2C_CodexDelta.unlocked_full)
##   3. 暴露 UI 需要的查询接口:is_unlocked / get_entry / get_database / get_unlocked_count
##   4. 与 WildwoodSession 配合:on_message 钩子消费 S2C_CodexSync / S2C_CodexDelta
##   5. 客户端打开图鉴面板时,可调用 request_full_query 拉取全量(用于断线重连后)
##
## 用法:
##   var codex = WildwoodCodex.new()
##   codex.on_unlock = func(entry_id, unlock_time_ms): print("UNLOCKED ", entry_id)
##   codex.feed_sync(sync_msg)         # join 后立刻调用
##   codex.feed_delta(delta_msg)       # 5Hz ticker 调用
##   if codex.is_unlocked("creature.spider"): ...
##
## 简化版(M2.11): 5Hz 广播每次发完整 unlocked,客户端用 dict 去重即可
## M3.1 协议统辖后,会改为只发 entry_id 增量
##
## 字节预算:
##   31 entries × ~120B ≈ 3.7KB (< 8KB Sync 预算)
##   unlocked 4-50 项 × 16B ≈ 64-800B (Delta 预算 < 256B 通常远低于)

const S2C = preload("res://core/abstract/network/gd/wildwood_s2c.gd")
const C2S = preload("res://core/abstract/network/gd/wildwood_c2s.gd")
const CommonTypes = preload("res://core/abstract/network/gd/wildwood_common.gd")

# 数据库 entry_id -> CodexEntry
var _database: Dictionary = {}

# 已解锁 entry_id -> CodexUnlock
var _unlocked: Dictionary = {}

# 状态
var _initialized: bool = false   # 是否收到过首次 S2C_CodexSync
var _total_database_size: int = 0
var _last_server_time_ms: int = 0

# 回调(供 UI 订阅)
var on_sync_done: Callable = Callable()           # func(database_size, unlocked_count)
var on_unlock: Callable = Callable()              # func(entry_id, unlock_time_ms)
var on_database_entry: Callable = Callable()      # func(entry: CodexEntry) — sync 时逐条触发,UI 可渐进渲染


## feed_sync 消费 S2C_CodexSync(join 时 / 重连后 / 主动查询)
## 同时更新数据库 + 已解锁列表,触发 on_database_entry / on_unlock
func feed_sync(sync_msg) -> void:
	if sync_msg == null:
		push_warning("WildwoodCodex.feed_sync: null message")
		return
	# 1) 更新 database
	for entry in sync_msg.database:
		if entry == null or entry.entry_id.is_empty():
			continue
		_database[entry.entry_id] = entry
		_total_database_size = _database.size()
		if on_database_entry.is_valid():
			on_database_entry.call(entry)
	# 2) 合并 unlocked
	for u in sync_msg.unlocked:
		if u == null or u.entry_id.is_empty():
			continue
		_unlocked[u.entry_id] = u
	_last_server_time_ms = sync_msg.server_time_ms
	_initialized = true
	if on_sync_done.is_valid():
		on_sync_done.call(_database.size(), _unlocked.size())


## feed_delta 消费 S2C_CodexDelta(5Hz 增量广播)
## 简化版:每次发完整 unlocked 列表,客户端用 dict 覆盖即可
func feed_delta(delta_msg) -> void:
	if delta_msg == null:
		return
	_last_server_time_ms = delta_msg.server_time_ms
	for u in delta_msg.unlocked_full:
		if u == null or u.entry_id.is_empty():
			continue
		# 幂等:已存在则不重复触发 on_unlock
		if _unlocked.has(u.entry_id):
			continue
		_unlocked[u.entry_id] = u
		if on_unlock.is_valid():
			on_unlock.call(u.entry_id, u.unlock_time_ms)


## is_unlocked 查询某 entry_id 是否已解锁
func is_unlocked(entry_id: String) -> bool:
	return _unlocked.has(entry_id)


## get_entry 查询 entry 详情(未找到返回 null,UI 应灰显 ??)
func get_entry(entry_id: String):
	return _database.get(entry_id, null)


## get_database 返回所有 entry 列表(供 Tab 渲染)
func get_database() -> Array:
	return _database.values()


## get_database_by_category 按 category 过滤(CREATURE/ITEM/BIOME)
func get_database_by_category(category: int) -> Array:
	var out: Array = []
	for e in _database.values():
		if e.category == category:
			out.append(e)
	return out


## get_unlocked_count 返回已解锁数
func get_unlocked_count() -> int:
	return _unlocked.size()


## get_total_count 返回数据库条目总数
func get_total_count() -> int:
	return _database.size()


## get_completion_pct 返回完成度百分比(0-100)
func get_completion_pct() -> float:
	if _database.is_empty():
		return 0.0
	return 100.0 * float(_unlocked.size()) / float(_database.size())


## get_unlocked_entry_ids 返回已解锁 entry_id 列表(测试/调试)
func get_unlocked_entry_ids() -> Array:
	return _unlocked.keys()


## is_initialized 是否收到过首次 Sync
func is_initialized() -> bool:
	return _initialized


## get_last_server_time_ms 最近一次 Sync/Delta 的 server_time_ms
func get_last_server_time_ms() -> int:
	return _last_server_time_ms


## request_full_query 构造 C2S_CodexQuery(FULL) 帧(供断线重连后补发)
## 实际发送需主调方通过 WildwoodNet 发出
func request_full_query() -> PackedByteArray:
	var q: C2S.CodexQuery = C2S.CodexQuery.new()
	q.kind = CommonTypes.CodexQueryKind.FULL
	return C2S.encode("C2S_CodexQuery", q)


## request_entry_query 构造 C2S_CodexQuery(ENTRY) 帧
func request_entry_query(entry_id: String) -> PackedByteArray:
	var q: C2S.CodexQuery = C2S.CodexQuery.new()
	q.kind = CommonTypes.CodexQueryKind.ENTRY
	q.entry_id = entry_id
	return C2S.encode("C2S_CodexQuery", q)


## notify_view_open 通知服务端 UI 开/关
func notify_view_open(is_open: bool) -> PackedByteArray:
	var v: C2S.CodexView = C2S.CodexView.new()
	v.is_open = is_open
	return C2S.encode("C2S_CodexView", v)


## reset 清空状态(用于测试 / 切房间)
func reset() -> void:
	_database.clear()
	_unlocked.clear()
	_initialized = false
	_total_database_size = 0
	_last_server_time_ms = 0
