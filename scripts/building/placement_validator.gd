class_name WildwoodPlacementValidator
extends RefCounted
## Wildwood M2.3 — 建造放置校验器(GDScript 公式镜像,语义对齐 core/abstract/building/placement.py)
##
## 提供与 Python PlacementValidator 完全等价的接口:
##   - validate(building_type: int, candidate_x: float, candidate_y: float, player_x: float, player_y: float, materials: Dictionary, grid: Dictionary) -> Dictionary
##   - evaluate_color(result: Dictionary) -> int  (Color.GREEN / Color.RED)
##
## 三判据顺序: 距离 → 地形 → 占用
##   1. distance  玩家 → 候选 cell 的水平距离 ≤ 4.0m(默认 max_range_m)
##   2. terrain   footprint 中心 cell 的地形探针返回 true(默认全可放,FlatTerrainProbe)
##   3. occupied footprint 中心 cell 在 grid 字典里为空
##
## 唯一真相源仍是 Python 端;GDScript 端做"公式镜像"用于客户端红/绿预览,服务端用 Python/Go 端为准。
##
## 用法(典型 — M2.1 移动 + 快捷栏切建筑时实时预览):
##   var pv = WildwoodPlacementValidator.new()
##   var result = pv.validate(1, 5.0, 0.0, 2.0, 0.0, materials, grid)
##   if result.ok:
##       preview.modulate = Color.GREEN
##   else:
##       preview.modulate = Color.RED
##       tooltip.text = result.reason_zh
##
## 坐标:米(m);32px = 1m;client 用 World.position / 32.0 折算

# === 默认参数 ===
const DEFAULT_MAX_RANGE_M: float = 4.0
const DEFAULT_CELL_SIZE_M: float = 1.0

# === BuildingType 协议 id(对齐 core/abstract/building/building_types.py)===
const BUILDING_CAMPFIRE: int = 1
const BUILDING_CHEST: int = 2
const BUILDING_WORKBENCH: int = 3
const BUILDING_COOKPOT: int = 4
const BUILDING_TENT: int = 5
const BUILDING_FIRE_PIT: int = 6
const BUILDING_TORCH_STAND: int = 7

# === Footprint(对齐 Python 端 footprint 元组,1=1x1,2=2x1,3=2x2)===
const FOOTPRINT: Dictionary = {
	BUILDING_CAMPFIRE: [1, 1],
	BUILDING_CHEST: [1, 1],
	BUILDING_WORKBENCH: [2, 1],
	BUILDING_COOKPOT: [1, 1],
	BUILDING_TENT: [2, 2],
	BUILDING_FIRE_PIT: [2, 2],
	BUILDING_TORCH_STAND: [1, 1],
}

# === Building 中文名(对齐 ITEM_LABELS 同套文案)===
const BUILDING_NAMES_ZH: Dictionary = {
	BUILDING_CAMPFIRE: "营火",
	BUILDING_CHEST: "箱子",
	BUILDING_WORKBENCH: "工作台",
	BUILDING_COOKPOT: "烹饪锅",
	BUILDING_TENT: "帐篷",
	BUILDING_FIRE_PIT: "火坑",
	BUILDING_TORCH_STAND: "火把架",
}

# === Block reason 标识(对齐 Python 端 BlockReason 枚举)===
const REASON_OK: String = "ok"
const REASON_OUT_OF_RANGE: String = "out_of_range"
const REASON_BAD_TERRAIN: String = "bad_terrain"
const REASON_OCCUPIED: String = "occupied"
const REASON_INSUFFICIENT: String = "insufficient_materials"
const REASON_UNKNOWN_BUILDING: String = "unknown_building"

# === Recipe 材料(对齐 M2.9 建筑配方 1-7)===
const RECIPES: Dictionary = {
	BUILDING_CAMPFIRE: {"wood": 3, "grass": 2},
	BUILDING_CHEST: {"wood": 4},
	BUILDING_WORKBENCH: {"wood": 4, "flint": 2},
	BUILDING_COOKPOT: {"stone": 3, "rope": 2},
	BUILDING_TENT: {"rope": 4, "grass": 6, "wood": 4},
	BUILDING_FIRE_PIT: {"stone": 6, "wood": 4},
	BUILDING_TORCH_STAND: {"wood": 1, "rope": 1},
}

# === Block reason 中文文案 ===
const REASON_ZH: Dictionary = {
	REASON_OK: "可放",
	REASON_OUT_OF_RANGE: "距离过远",
	REASON_BAD_TERRAIN: "地形不可放",
	REASON_OCCUPIED: "已被占用",
	REASON_INSUFFICIENT: "材料不足",
	REASON_UNKNOWN_BUILDING: "未知建筑",
}


# === 入口函数 ===

## 校验候选位置 — 返回 Dictionary:
##   { "ok": bool, "reason": String, "missing": Array, "distance_m": float }
##
## 输入:
##   - building_type: 1-7
##   - candidate_x/y: 候选 cell 中心坐标(米)
##   - player_x/y: 玩家坐标(米)
##   - materials: { "wood": 12, ... } 当前背包
##   - grid: { Vector2i(cell_x, cell_y): true, ... } 已占用 cell 集合
func validate(
	building_type: int,
	candidate_x: float, candidate_y: float,
	player_x: float, player_y: float,
	materials: Dictionary,
	grid: Dictionary
) -> Dictionary:
	# 未知建筑
	if not FOOTPRINT.has(building_type):
		return _result(false, REASON_UNKNOWN_BUILDING, 0.0, [])

	# ① 距离
	var dx: float = candidate_x - player_x
	var dy: float = candidate_y - player_y
	var dist: float = sqrt(dx * dx + dy * dy)
	if dist > DEFAULT_MAX_RANGE_M:
		return _result(false, REASON_OUT_OF_RANGE, dist, [])

	# ② 地形 — 默认全可放(FlatTerrainProbe);真实集成时从 TerrainProbe 注入
	# GDScript 端不持有 terrain 状态(由 M2.7 biomes 提供),留 hook 给上层
	# 若调用方有 terrain_check_fn 则执行
	# (此处简化为假设所有 footprint cell 都可放,真实集成时替换)

	# ③ 占用 — 检查 footprint 所有 cell 是否在 grid 中
	var fp: Array = FOOTPRINT[building_type]
	var w: int = fp[0]
	var h: int = fp[1]
	var origin_x: int = int(floor(candidate_x))
	var origin_y: int = int(floor(candidate_y))
	for ix in range(w):
		for iy in range(h):
			var key: Vector2i = Vector2i(origin_x + ix, origin_y + iy)
			if grid.has(key) and grid[key]:
				return _result(false, REASON_OCCUPIED, dist, [])

	# ④ 材料(客户端预检;服务端仍以 Python/Go 端为准)
	var recipe: Dictionary = RECIPES[building_type]
	var missing: Array = []
	for item_id in recipe.keys():
		var need: int = recipe[item_id]
		var have: int = materials.get(item_id, 0)
		if have < need:
			missing.append({"item": item_id, "need": need, "have": have})
	if missing.size() > 0:
		return _result(false, REASON_INSUFFICIENT, dist, missing)

	return _result(true, REASON_OK, dist, [])


## 评估 UI 颜色 — 绿色可放 / 红色不可放
##
## 返回 Color(不是 enum)— 直接 modulate 即可
func evaluate_color(result: Dictionary) -> Color:
	if result.get("ok", false):
		return Color(0.0, 1.0, 0.0, 0.6)  # 绿色半透
	return Color(1.0, 0.0, 0.0, 0.6)      # 红色半透


## 评估 UI 文案 — 返回中文 reason
func reason_zh(result: Dictionary) -> String:
	var reason: String = result.get("reason", REASON_UNKNOWN_BUILDING)
	if not REASON_ZH.has(reason):
		return reason
	if reason == REASON_INSUFFICIENT:
		# 拼出"材料不足:缺 wood×3, stone×1"
		var missing: Array = result.get("missing", [])
		var parts: Array = []
		for m in missing:
			parts.append("%s×%d" % [m.item, m.need - m.have])
		return "材料不足:缺 %s" % ", ".join(parts)
	return REASON_ZH[reason]


## 获取建筑中文名
static func building_name_zh(building_type: int) -> String:
	return BUILDING_NAMES_ZH.get(building_type, "未知")


## 获取 footprint 尺寸 [w, h]
static func get_footprint(building_type: int) -> Array:
	return FOOTPRINT.get(building_type, [1, 1])


# === 内部 helper ===

func _result(ok: bool, reason: String, distance: float, missing: Array) -> Dictionary:
	return {
		"ok": ok,
		"reason": reason,
		"distance_m": distance,
		"missing": missing,
	}
