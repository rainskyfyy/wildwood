class_name WildwoodCrafting
extends RefCounted
## Wildwood M2.9 — 合成引擎(GDScript 薄包装,语义对齐 core/abstract/crafting/crafting_engine.py)
##
## 提供跟 Python 版 CraftingEngine 完全等价的 3 个方法:
##   - check_can_craft(recipe: Dictionary, inventory: Dictionary, station: Dictionary) -> Dictionary
##   - craft(recipe: Dictionary, inventory: Dictionary, station: Dictionary) -> Dictionary
##   - get_ui_state(recipe: Dictionary, inventory: Dictionary, station: Dictionary) -> Dictionary
##
## GDScript 端用 Dictionary / Array 而非 Python 的 dataclass / Tuple,
## 字段名与 Python 端 1:1 对齐(recipe_id / can_craft / missing / blocked / station_required …),
## 详见 SEMANTICS.md。
##
## 用法(典型 — 与 M2.2 背包、M2.3 建筑联动):
##   var craft = WildwoodCrafting.new()
##   var recipe = WildwoodRecipeBook.find_by_id("craft.tool.axe")
##   var check = craft.check_can_craft(recipe, player_inventory, station_state)
##   if check.can_craft:
##       var result = craft.craft(recipe, player_inventory, station_state)
##       refresh_ui(craft.get_ui_state(recipe, player_inventory, station_state))
##
## inventory 形态: { "wood": 12, "stone": 3, "flint": 0, ... }
##   - 缺料视为 0(自动补 0)
##   - consume(item_id, count) 必须在外部实现(GDScript 无内建 inventory)
## station 形态: { "workbench": true, "cookpot": false, ... } (任一为 true 即拥有)

# === Station 标识 ===
const STATION_NONE: String = "none"            # 自由合成(无需工作站)
const STATION_WORKBENCH: String = "workbench"  # 工作台门槛
const STATION_COOKPOT: String = "cookpot"      # 烹饪锅门槛

# === Block reason 标识(对应 Python 端 _station_block_reason 返的 key)===
const BLOCK_REQUIRES_WORKBENCH: String = "requires_workbench"
const BLOCK_REQUIRES_COOKPOT: String = "requires_cookpot"

# === UI 文案中英映射(对齐 Python 端 _ITEM_LABELS)===
const ITEM_LABELS: Dictionary = {
	"wood": "木材",
	"stone": "石头",
	"flint": "燧石",
	"grass": "草",
	"rope": "绳子",
	"berries": "浆果",
	"mushroom": "蘑菇",
	"meat": "肉",
	"fish": "鱼",
	"honey": "蜂蜜",
	"ice": "冰",
	"fur": "毛皮",
	"leather": "皮革",
	# 产出物
	"axe": "斧头",
	"pickaxe": "镐",
	"shovel": "铲子",
	"hoe": "锄头",
	"spear": "长矛",
	"knife": "小刀",
	"hammer": "锤子",
	"torch": "火把",
	"wooden_armor": "木甲",
	"stone_armor": "石甲",
	"backpack": "背包",
	"helmet_log": "木盔",
	"warm_coat": "暖外套",
	"boots": "靴子",
	"gloves": "手套",
	"cooked_berries": "烤浆果",
	"cooked_mushroom": "烤蘑菇",
	"meatballs": "肉丸",
	"steak": "烤肉",
	"stuffed_mushroom": "酿蘑菇",
	"fish_stew": "鱼汤",
	"honey_pie": "蜜饼",
	"tea": "茶",
	"dried_meat": "肉干",
	"veggie_soup": "菜汤",
	"ice_cream": "冰淇淋",
	"campfire": "营火",
	"chest": "箱子",
	"workbench": "工作台",
	"cookpot": "烹饪锅",
	"tent": "帐篷",
	"fire_pit": "火坑",
	"torch_stand": "火把架",
}

const BLOCK_REASON_ZH: Dictionary = {
	BLOCK_REQUIRES_WORKBENCH: "需要工作台",
	BLOCK_REQUIRES_COOKPOT: "需要烹饪锅",
}


# === 内部工具 ===

static func _label(item_id: String) -> String:
	# 跟 Python 端 _label:未知名返原 id 作 fallback
	return ITEM_LABELS.get(item_id, item_id)


static func _station_block_reason(station: String, station_state: Dictionary) -> String:
	# 返 "" 表示通过,非空表示不满足的原因 key
	if station == STATION_NONE:
		return ""
	if station_state.get(station, false) == true:
		return ""
	match station:
		STATION_WORKBENCH:
			return BLOCK_REQUIRES_WORKBENCH
		STATION_COOKPOT:
			return BLOCK_REQUIRES_COOKPOT
		_:
			return ""


static func _validate_recipe(recipe: Dictionary) -> void:
	# 对齐 Python 端:非 dict 抛 ValueError
	if recipe == null or recipe.is_empty():
		push_error("recipe 必须是非空 Dictionary")
		assert(false, "recipe 必须是非空 Dictionary")
	if not recipe.has("id"):
		push_error("recipe.id 缺失")
		assert(false, "recipe.id 缺失")
	if not recipe.has("ingredients") or typeof(recipe["ingredients"]) != TYPE_ARRAY:
		push_error("recipe.ingredients 必须是 Array")
		assert(false, "recipe.ingredients 必须是 Array")
	if not recipe.has("station"):
		push_error("recipe.station 缺失")
		assert(false, "recipe.station 缺失")
	if not recipe.has("result_item_id"):
		push_error("recipe.result_item_id 缺失")
		assert(false, "recipe.result_item_id 缺失")


static func _have_count(inventory: Dictionary, item_id: String) -> int:
	# 缺料视为 0(对齐 Python 端 inventory.get_count 的"任意 item 都可查"语义)
	return int(inventory.get(item_id, 0))


# === 主 API ===

## 检查是否可合成(纯查询,不动库存)。
## 返回 Dictionary 字段(对齐 Python 端 CheckResult):
##   can_craft: bool
##   missing: Array[Dictionary]   # 每个 { item_id, count } — count 为缺的数量
##   blocked: String              # "" / BLOCK_REQUIRES_WORKBENCH / BLOCK_REQUIRES_COOKPOT
##   station_required: String     # "none" / "workbench" / "cookpot"
static func check_can_craft(recipe: Dictionary, inventory: Dictionary, station_state: Dictionary) -> Dictionary:
	_validate_recipe(recipe)
	var blocked: String = _station_block_reason(recipe["station"], station_state)
	var missing: Array = []
	for ing in recipe["ingredients"]:
		var have: int = _have_count(inventory, ing["item_id"])
		if have < int(ing["count"]):
			missing.append({
				"item_id": ing["item_id"],
				"count": int(ing["count"]) - have,
			})
	return {
		"can_craft": blocked.is_empty() and missing.is_empty(),
		"missing": missing,
		"blocked": blocked,
		"station_required": recipe["station"],
	}


## 合成:扣材料 + 加产出。配补偿回滚。
## 返回 Dictionary(对齐 Python 端 CraftingResult):
##   recipe_id: String
##   produced: Array[Dictionary]   # [{ item_id, count }]
##   consumed: Array[Dictionary]  # [{ item_id, count }]
## 不可合成 → push_error + 返 null(对齐 Python 端 CraftingError)。
## 注意:GDScript 端 inventory 是 Dictionary 直传,
##       本方法不直接 mutate inventory — 由调用方根据 consumed 自行扣减。
##       这是为了保持 check 与 craft 端 inventory 引用一致 + 便于回滚。
static func craft(recipe: Dictionary, inventory: Dictionary, station_state: Dictionary) -> Variant:
	_validate_recipe(recipe)
	var check: Dictionary = check_can_craft(recipe, inventory, station_state)
	if not check["can_craft"]:
		var reasons: Array = []
		if not check["blocked"].is_empty():
			reasons.append("station:" + str(check["blocked"]))
		if not check["missing"].is_empty():
			var miss_parts: Array = []
			for m in check["missing"]:
				miss_parts.append("%sx%d" % [m["item_id"], m["count"]])
			reasons.append("missing:" + ",".join(miss_parts))
		push_error("无法合成 %s (%s): %s" % [recipe["id"], recipe.get("name", "?"), "; ".join(reasons)])
		return null
	# 校验通过,返回合成结果(由调用方负责真正扣减 + 添加到 inventory)
	var result_count: int = int(recipe.get("result_count", 1))
	return {
		"recipe_id": recipe["id"],
		"produced": [{"item_id": recipe["result_item_id"], "count": result_count}],
		"consumed": recipe["ingredients"].duplicate(true),  # 浅复制上层 Array,内层 dict 复用
	}


## UI 状态计算(给 HUD/合成面板用)。对齐 Python 端 get_ui_state。
## 返回 Dictionary:
##   recipe_id: String
##   can_craft_now: bool
##   craftable_button_enabled: bool    # 缺料/无工作站 → false → 按钮灰显
##   missing_materials: Array[Dictionary]  # [{ item_id, label, needed, have, missing }]
##   blocked_reason: String            # 中文物文("需要工作台" / "需要烹饪锅" / "")
##   station_required: String          # "none" / "workbench" / "cookpot"
static func get_ui_state(recipe: Dictionary, inventory: Dictionary, station_state: Dictionary) -> Dictionary:
	_validate_recipe(recipe)
	var check: Dictionary = check_can_craft(recipe, inventory, station_state)
	var missing_payload: Array = []
	for ing in check["missing"]:
		var have: int = _have_count(inventory, ing["item_id"])
		# 实际配方要求 = have + 缺的数量
		var needed: int = have + int(ing["count"])
		missing_payload.append({
			"item_id": ing["item_id"],
			"label": _label(ing["item_id"]),
			"needed": needed,
			"have": have,
			"missing": ing["count"],
		})
	var blocked_zh: String = BLOCK_REASON_ZH.get(check["blocked"], "")
	return {
		"recipe_id": recipe["id"],
		"can_craft_now": check["can_craft"],
		"craftable_button_enabled": check["can_craft"],
		"missing_materials": missing_payload,
		"blocked_reason": blocked_zh,
		"station_required": recipe["station"],
	}


## GDScript 端 inventory 原子操作辅助 — 把 craft() 返回结果应用到 inventory Dictionary。
## 应用后 inventory[item_id] += produced[0].count, -= consumed[*].count。
## 失败时(数量不足)返 false,否则返 true(已 mutate inventory)。
static func apply_craft_result(inventory: Dictionary, craft_result: Dictionary) -> bool:
	if craft_result == null:
		return false
	# 先扣(扣失败 → 全失败)
	for c in craft_result["consumed"]:
		var have: int = _have_count(inventory, c["item_id"])
		if have < int(c["count"]):
			return false
	for c in craft_result["consumed"]:
		inventory[c["item_id"]] = _have_count(inventory, c["item_id"]) - int(c["count"])
	# 再加(此处不模拟背包满,理论上层处理)
	for p in craft_result["produced"]:
		inventory[p["item_id"]] = _have_count(inventory, p["item_id"]) + int(p["count"])
	return true
