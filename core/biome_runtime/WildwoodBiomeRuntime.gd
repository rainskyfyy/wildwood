extends Node
class_name WildwoodBiomeRuntime
## M2.7 GDScript 引擎层 — 9 宫格运行时 + 内存统计
##
## 职责:
## - 持有 WildwoodBiomeLoader 状态
## - 把抽象层 coord_to_biome 规则用 GDScript 重写(供引擎层无依赖调用)
## - 维护当前群系 ID + 群系切换时通知相机过渡
## - 暴露内存统计给 UI 调试面板
##
## 注:群系判定规则与 core/abstract/biome/biome_map.py 严格一致;
##   当 Python 通用层规则更新时,本方法 coord_to_biome 需同步修改。

const _C := preload("res://core/biome_runtime/WildwoodBiomeConstants.gd")
const _Loader := preload("res://core/biome_runtime/WildwoodBiomeLoader.gd")

# 4 群系定义(主色 + 密度)
# 共享元素永远 4 个:grass / rock / tree / mushroom
const BIOME_DEFS: Dictionary = {
	"forest": {
		"display_name": "森林",
		"primary_color_hex": "#7d8b4d",
		"density": {"grass": 0.60, "tree": 0.30, "rock": 0.05, "mushroom": 0.05},
		"signature_resources": ["m2.14.resource.berry_bush", "m2.14.resource.sapling"],
		"signature_monsters":  ["m2.14.monster.rabbit",        "m2.14.monster.spider"],
	},
	"plains": {
		"display_name": "平原",
		"primary_color_hex": "#5a6b3a",
		"density": {"grass": 0.80, "tree": 0.08, "rock": 0.07, "mushroom": 0.05},
		"signature_resources": ["m2.14.resource.grass_tuft", "m2.14.resource.reed"],
		"signature_monsters":  ["m2.14.monster.cow",          "m2.14.monster.plant_tentacle"],
	},
	"mines": {
		"display_name": "矿区",
		"primary_color_hex": "#5a7080",
		"density": {"grass": 0.30, "rock": 0.45, "tree": 0.10, "mushroom": 0.15},
		"signature_resources": ["m2.14.resource.ore_iron", "m2.14.resource.flint"],
		"signature_monsters":  ["m2.14.monster.hound",     "m2.14.monster.deerclops"],
	},
	"snow": {
		"display_name": "雪原",
		"primary_color_hex": "#8fb4c0",
		"density": {"grass": 0.20, "rock": 0.30, "tree": 0.20, "mushroom": 0.30},
		"signature_resources": ["m2.14.resource.ore_iron", "m2.14.resource.ice"],
		"signature_monsters":  ["m2.14.monster.pengull",    "m2.14.monster.plant_tentacle"],
	},
}

var loader: WildwoodBiomeLoader = WildwoodBiomeLoader.new()
var _current_biome_id: StringName = _C.BIOME_FOREST
var _previous_biome_id: StringName = _C.BIOME_FOREST

# 群系切换信号 — 给相机过渡、UI、音频订阅
signal biome_changed(from_id: StringName, to_id: StringName, chunk: Array)
signal memory_stats_updated(loaded_bytes: int, full_bytes: int, saving_pct: float)


func _ready() -> void:
	# 初始:中心森林
	var init := loader.update_player_chunk([0, 0])
	_current_biome_id = coord_to_biome(0, 0)
	_previous_biome_id = _current_biome_id


## 玩家中心 chunk 变更 → 触发 9 宫格重算 + 群系切换检测
func on_player_moved(new_center: Array) -> Dictionary:
	var prev_chunk: Array = loader.current_center()
	var prev_biome: StringName = _current_biome_id
	var res: Dictionary = loader.update_player_chunk(new_center)
	var new_biome: StringName = coord_to_biome(int(new_center[0]), int(new_center[1]))
	_previous_biome_id = prev_biome
	_current_biome_id = new_biome

	# 群系切换才广播(避免相机每帧抖动)
	if prev_biome != new_biome:
		biome_changed.emit(prev_biome, new_biome, new_center)

	# 内存统计广播
	memory_stats_updated.emit(
		loader.loaded_bytes(),
		_C.MIN_FULL_MAP_CHUNKS * _C.CHUNK_SIZE_BYTES,
		loader.memory_saving_pct(),
	)
	return res


## chunk 坐标 → 群系 ID(与 core/abstract/biome/biome_map.py 行为一致)
##
## 规则(顺序敏感):
## 1) 距离 ≤ 1:forest
## 2) cx == 2 → mines(整列,在 cy>0 之前判定)
## 3) cx == -2 → snow
## 4) cx == 0 and |cy| == 2 → plains
## 5) 角落 |cx|==2 and |cy|==2 → mines/snow
## 6) 距离 ≥ 3 按象限回退
func coord_to_biome(cx: int, cy: int) -> StringName:
	# 1) 中心森林圈
	if abs(cx) <= 1 and abs(cy) <= 1:
		return _C.BIOME_FOREST
	# 2/3) 主轴(必在 cy>0 之前)
	if cx == 2:
		return _C.BIOME_MINES
	if cx == -2:
		return _C.BIOME_SNOW
	# 4) 北南主轴
	if cx == 0 and abs(cy) == 2:
		return _C.BIOME_PLAINS
	# 5) 角落
	if abs(cx) == 2 and abs(cy) == 2:
		return _C.BIOME_MINES if cx > 0 else _C.BIOME_SNOW
	# 6) 距离 ≥ 3 象限回退
	if cy > 0:
		return _C.BIOME_PLAINS
	if cx > 0:
		return _C.BIOME_MINES
	if cx < 0:
		return _C.BIOME_SNOW
	return _C.BIOME_PLAINS


## 当前群系
func current_biome() -> StringName:
	return _current_biome_id


## 上一群系
func previous_biome() -> StringName:
	return _previous_biome_id


## 群系主色
func primary_color(biome_id: StringName) -> String:
	return String(BIOME_DEFS[biome_id]["primary_color_hex"])


## 群系定义查询
func get_biome_def(biome_id: StringName) -> Dictionary:
	return BIOME_DEFS[biome_id]


## 内存统计(给 UI 调试面板)
func memory_stats() -> Dictionary:
	var full: int = _C.MIN_FULL_MAP_CHUNKS * _C.CHUNK_SIZE_BYTES
	return {
		"loaded_chunks": loader.loaded_count(),
		"full_chunks": _C.MIN_FULL_MAP_CHUNKS,
		"loaded_bytes": loader.loaded_bytes(),
		"full_bytes": full,
		"saving_pct": loader.memory_saving_pct(),
		"target_pct": _C.MEMORY_SAVING_TARGET_PCT,
	}
