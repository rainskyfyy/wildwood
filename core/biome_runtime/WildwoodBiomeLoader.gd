extends RefCounted
class_name WildwoodBiomeLoader
## M2.7 GDScript 引擎层 — 9 宫格流式加载触发器
##
## 行为契约(与 core.abstract.biome.loader.BiomeLoader 一致):
## - update_player_chunk(c) 计算新 9 宫格,返回 LoadResult(loaded, evicted, state)
## - 跨群系移动时自动卸载远端 chunk
## - 状态机 IDLE → LOADING → READY
##
## 注:实际资源 IO 在外层(WildwoodBiomeRuntime)做,本类只算坐标集合。
## GDScript 版本为 A 线(Godot 4.3),B 线 Unity 由独立脚本实现。

const _C := preload("res://core/biome_runtime/WildwoodBiomeConstants.gd")

var _loaded: Dictionary = {}        # key = "cx,cy" → true
var _current_center: Array = [0, 0]  # [cx, cy]
var _state: int = _C.LoaderState.IDLE

# 状态变化信号(给 WildwoodBiomeRuntime / UI 订阅)
signal state_changed(new_state: int)
signal chunks_updated(loaded: Array, evicted: Array)


func _init() -> void:
	_state = _C.LoaderState.IDLE
	_loaded.clear()


## 玩家中心 chunk 变更 → 重算 9 宫格
##  - center: [cx, cy] 数组
##  - 返回: { loaded: int, evicted: int, new_state: int }
func update_player_chunk(center: Array) -> Dictionary:
	if center.size() != 2:
		push_error("WildwoodBiomeLoader: center must be [cx, cy]")
		return {"loaded": 0, "evicted": 0, "new_state": _state}

	_state = _C.LoaderState.LOADING
	state_changed.emit(_state)

	var old_loaded: Dictionary = _loaded.duplicate()
	var new_keys: Dictionary = {}
	var new_chunks: Array = []
	for c in _C.neighbors_3x3(int(center[0]), int(center[1])):
		var key: String = "%d,%d" % [int(c[0]), int(c[1])]
		new_keys[key] = true
		new_chunks.append(c)

	# 计算 added / removed
	var added: Array = []
	for k in new_keys.keys():
		if not old_loaded.has(k):
			added.append(k)
	var removed: Array = []
	for k in old_loaded.keys():
		if not new_keys.has(k):
			removed.append(k)

	_loaded = new_keys
	_current_center = [int(center[0]), int(center[1])]
	_state = _C.LoaderState.READY
	state_changed.emit(_state)
	chunks_updated.emit(new_chunks, removed)

	return {
		"loaded": added.size(),
		"evicted": removed.size(),
		"new_state": _state,
	}


## 当前已加载 chunk 数
func loaded_count() -> int:
	return _loaded.size()


## 当前中心
func current_center() -> Array:
	return _current_center.duplicate()


## 当前已加载的 chunk 列表
func loaded_chunks() -> Array:
	var out: Array = []
	for k in _loaded.keys():
		var parts: PackedStringArray = k.split(",")
		out.append([int(parts[0]), int(parts[1])])
	out.sort_custom(func(a, b): return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	return out


## 已加载字节数(模拟:每 chunk 1MB)
func loaded_bytes() -> int:
	return _loaded.size() * _C.CHUNK_SIZE_BYTES


## 内存节省百分比
func memory_saving_pct(full_map: int = _C.MIN_FULL_MAP_CHUNKS) -> float:
	if full_map < _C.MIN_FULL_MAP_CHUNKS:
		full_map = _C.MIN_FULL_MAP_CHUNKS
	return _C.memory_saving_pct(_loaded.size(), full_map)


## 状态机查询
func get_state() -> int:
	return _state


## 重置
func reset() -> void:
	_loaded.clear()
	_current_center = [0, 0]
	_state = _C.LoaderState.IDLE
	state_changed.emit(_state)
