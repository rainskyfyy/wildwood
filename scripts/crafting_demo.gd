extends Node
## M2.9 合成系统 Demo 场景
##
## 启动后:
##   1. 加载 WildwoodCrafting + 内置 RecipeBook 34 配方
##   2. 动态构建 UI: 配方列表(滚动) / 库存 / 工作站开关 / 状态
##   3. 用户可点按钮 → 调 WildwoodCrafting.craft() → 反馈
##
## 演示所有 4 项验收:
##   ① 30+ 配方可合成        — 34 配方全显示
##   ② 材料全有按钮可点      — can_craft 时按钮 enabled + 高亮
##   ③ 合成 ≤ 400ms 反馈     — craft() 后立即 toast(实测 < 1ms,远小于预算)
##   ④ 无工作台时配方灰显    — can_craft=False + 灰显 + 红字缺料 + blocked_reason
##
## 用法:
##   1. Godot 编辑器打开 scenes/crafting_demo.tscn 作为主场景
##   2. F5 启动,看到 34 配方面板
##   3. 点 "加材料" 按钮(顶部)→ 库存 +1 → 配方按钮自动启用
##   4. 点 "切换工作台" 按钮 → 配方状态变化
##   5. 点配方按钮 → 合成,toast 弹出 + 库存更新
##
## 按 ESC 退出。

const WildwoodCrafting = preload("res://core/abstract/crafting/crafting.gd")
const RecipeBookScript = preload("res://core/abstract/crafting/recipe_book_data.gd")

const PANEL_BG: Color = Color(0.13, 0.13, 0.16, 0.95)
const TEXT_FG: Color = Color(0.95, 0.95, 0.95)
const TEXT_DIM: Color = Color(0.65, 0.65, 0.70)
const ACCENT_OK: Color = Color(0.40, 0.85, 0.45)
const ACCENT_WARN: Color = Color(0.95, 0.55, 0.30)
const ACCENT_BAD: Color = Color(0.90, 0.30, 0.30)
const BUTTON_BG_OK: Color = Color(0.20, 0.40, 0.22)
const BUTTON_BG_DIM: Color = Color(0.30, 0.30, 0.32)
const MISSING_RED: Color = Color(0.95, 0.40, 0.40)
const HEADER_BG: Color = Color(0.20, 0.22, 0.28)

# 状态
var _inventory: Dictionary = {}        # {item_id: count}
var _station_state: Dictionary = {"workbench": false, "cookpot": false}
var _recipes: Array = []                # 34 个 Recipe dict
var _recipe_buttons: Array = []         # 配方 button + state label 引用

# 节点
var _status_label: Label = null
var _toast_label: Label = null
var _inventory_label: Label = null
var _station_label: Label = null
var _perf_label: Label = null


func _ready() -> void:
	print("[M2.9] boot OK, 34-recipe crafting demo")
	_recipes = RecipeBookScript.default_book()
	_build_ui()
	_refresh_all()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		get_tree().quit()


# ============== UI 构建 ==============

func _build_ui() -> void:
	# 根布局
	var root_vbox := VBoxContainer.new()
	root_vbox.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root_vbox.add_theme_constant_override("separation", 8)
	add_child(root_vbox)

	# 顶部 header
	var header := _make_panel(HEADER_BG)
	header.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	root_vbox.add_child(header)
	var header_hbox := HBoxContainer.new()
	header_hbox.add_theme_constant_override("separation", 12)
	header.add_child(header_hbox)
	var title := Label.new()
	title.text = "M2.9 合成系统 Demo · 34 配方"
	title.add_theme_color_override("font_color", TEXT_FG)
	title.add_theme_font_size_override("font_size", 22)
	header_hbox.add_child(title)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header_hbox.add_child(spacer)
	var toggle_station_btn := Button.new()
	toggle_station_btn.text = "切换工作台(workbench)"
	toggle_station_btn.pressed.connect(_on_toggle_workbench)
	header_hbox.add_child(toggle_station_btn)
	var toggle_cookpot_btn := Button.new()
	toggle_cookpot_btn.text = "切换烹饪锅(cookpot)"
	toggle_cookpot_btn.pressed.connect(_on_toggle_cookpot)
	header_hbox.add_child(toggle_cookpot_btn)
	var add_mats_btn := Button.new()
	add_mats_btn.text = "+ 5 随机材料(全 +5)"
	add_mats_btn.pressed.connect(_on_add_materials)
	header_hbox.add_child(add_mats_btn)
	var reset_btn := Button.new()
	reset_btn.text = "清空库存"
	reset_btn.pressed.connect(_on_reset_inventory)
	header_hbox.add_child(reset_btn)

	# 主体两栏:左 Inventory + Station / 右 Recipes
	var main_hbox := HBoxContainer.new()
	main_hbox.size_flags_vertical = Control.SIZE_EXPAND_FILL
	main_hbox.add_theme_constant_override("separation", 12)
	root_vbox.add_child(main_hbox)

	# 左栏
	var left_panel := _make_panel(PANEL_BG)
	left_panel.custom_minimum_size = Vector2(280, 0)
	main_hbox.add_child(left_panel)
	var left_vbox := VBoxContainer.new()
	left_vbox.add_theme_constant_override("separation", 6)
	left_panel.add_child(left_vbox)
	var inv_title := Label.new()
	inv_title.text = "库存(Inventory)"
	inv_title.add_theme_color_override("font_color", TEXT_FG)
	inv_title.add_theme_font_size_override("font_size", 16)
	left_vbox.add_child(inv_title)
	_inventory_label = Label.new()
	_inventory_label.add_theme_color_override("font_color", TEXT_FG)
	_inventory_label.add_theme_font_size_override("font_size", 14)
	_inventory_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	left_vbox.add_child(_inventory_label)
	var sep1 := HSeparator.new()
	left_vbox.add_child(sep1)
	var sta_title := Label.new()
	sta_title.text = "工作站(Station)"
	sta_title.add_theme_color_override("font_color", TEXT_FG)
	sta_title.add_theme_font_size_override("font_size", 16)
	left_vbox.add_child(sta_title)
	_station_label = Label.new()
	_station_label.add_theme_color_override("font_color", TEXT_FG)
	_station_label.add_theme_font_size_override("font_size", 14)
	left_vbox.add_child(_station_label)
	var sep2 := HSeparator.new()
	left_vbox.add_child(sep2)
	var perf_title := Label.new()
	perf_title.text = "性能(Perf)"
	perf_title.add_theme_color_override("font_color", TEXT_FG)
	perf_title.add_theme_font_size_override("font_size", 16)
	left_vbox.add_child(perf_title)
	_perf_label = Label.new()
	_perf_label.add_theme_color_override("font_color", TEXT_DIM)
	_perf_label.add_theme_font_size_override("font_size", 12)
	_perf_label.text = "— 等待操作 —"
	left_vbox.add_child(_perf_label)

	# 右栏(配方列表)
	var right_panel := _make_panel(PANEL_BG)
	right_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main_hbox.add_child(right_panel)
	var right_vbox := VBoxContainer.new()
	right_vbox.add_theme_constant_override("separation", 4)
	right_panel.add_child(right_vbox)
	var rec_title := Label.new()
	rec_title.text = "配方(Recipes) — 34 项"
	rec_title.add_theme_color_override("font_color", TEXT_FG)
	rec_title.add_theme_font_size_override("font_size", 16)
	right_vbox.add_child(rec_title)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	right_vbox.add_child(scroll)
	var list_vbox := VBoxContainer.new()
	list_vbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list_vbox.add_theme_constant_override("separation", 3)
	scroll.add_child(list_vbox)
	_recipe_buttons.clear()
	for recipe in _recipes:
		var row := _build_recipe_row(recipe)
		list_vbox.add_child(row)
		_recipe_buttons.append(row)

	# 底部状态栏 + toast
	var footer := _make_panel(HEADER_BG)
	footer.size_flags_vertical = Control.SIZE_SHRINK_END
	root_vbox.add_child(footer)
	_status_label = Label.new()
	_status_label.add_theme_color_override("font_color", TEXT_FG)
	_status_label.add_theme_font_size_override("font_size", 14)
	footer.add_child(_status_label)
	_toast_label = Label.new()
	_toast_label.add_theme_color_override("font_color", ACCENT_OK)
	_toast_label.add_theme_font_size_override("font_size", 16)
	_toast_label.modulate.a = 0.0
	footer.add_child(_toast_label)


func _build_recipe_row(recipe: Dictionary) -> Control:
	var row := PanelContainer.new()
	row.set_meta("recipe", recipe)
	# 视觉默认:灰
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.18, 0.18, 0.22)
	style.content_margin_left = 8
	style.content_margin_right = 8
	style.content_margin_top = 4
	style.content_margin_bottom = 4
	row.add_theme_stylebox_override("panel", style)

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 8)
	row.add_child(hbox)

	# 按钮
	var btn := Button.new()
	btn.text = recipe.get("name", recipe.get("id", "?")) + "  →  " + str(recipe.get("result_count", 1)) + "×" + str(recipe.get("result_item_id", "?"))
	btn.custom_minimum_size = Vector2(220, 0)
	btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn.pressed.connect(_on_craft_pressed.bind(recipe))
	row.set_meta("button", btn)
	hbox.add_child(btn)

	# 状态标签
	var state := Label.new()
	state.custom_minimum_size = Vector2(220, 0)
	state.add_theme_color_override("font_color", TEXT_DIM)
	state.add_theme_font_size_override("font_size", 12)
	state.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	row.set_meta("state", state)
	hbox.add_child(state)

	return row


# ============== 状态更新 ==============

func _refresh_all() -> void:
	_refresh_inventory_label()
	_refresh_station_label()
	_refresh_recipe_states()
	_status_label.text = "就绪 · 共 %d 配方 · 库存 %d item · 工作台=%s 烹饪锅=%s" % [
		_recipes.size(),
		_inventory.size(),
		"✓" if _station_state.get("workbench", false) else "✗",
		"✓" if _station_state.get("cookpot", false) else "✗",
	]


func _refresh_inventory_label() -> void:
	if _inventory.is_empty():
		_inventory_label.text = "(空)"
		return
	var parts: Array = []
	for item_id in _inventory.keys():
		parts.append("%s: %d" % [_label_for(item_id), _inventory[item_id]])
	_inventory_label.text = "\n".join(parts)


func _refresh_station_label() -> void:
	_station_label.text = "工作台: %s\n烹饪锅: %s" % [
		"✓ 有" if _station_state.get("workbench", false) else "✗ 无",
		"✓ 有" if _station_state.get("cookpot", false) else "✗ 无",
	]


func _refresh_recipe_states() -> void:
	for row in _recipe_buttons:
		var recipe: Dictionary = row.get_meta("recipe")
		var state: Dictionary = WildwoodCrafting.get_ui_state(recipe, _inventory, _station_state)
		var btn: Button = row.get_meta("button")
		var state_lbl: Label = row.get_meta("state")
		var style: StyleBoxFlat = row.get_theme_stylebox("panel").duplicate() as StyleBoxFlat

		if state["can_craft_now"]:
			# 可合成:亮 + enabled
			style.bg_color = Color(0.20, 0.42, 0.24)
			btn.disabled = false
			btn.modulate = Color(1, 1, 1, 1)
			state_lbl.add_theme_color_override("font_color", ACCENT_OK)
			state_lbl.text = "✓ 可合成"
		else:
			btn.disabled = true
			btn.modulate = Color(0.7, 0.7, 0.7, 0.6)  # 灰显
			var parts: Array = []
			if state["blocked_reason"] != "":
				style.bg_color = Color(0.30, 0.20, 0.18)  # 工作站缺失
				parts.append("⚠ " + str(state["blocked_reason"]))
			else:
				style.bg_color = Color(0.22, 0.20, 0.20)  # 仅缺料
			for m in state["missing_materials"]:
				parts.append("缺 " + str(m["label"]) + " " + str(m["have"]) + "/" + str(m["needed"]))
			state_lbl.add_theme_color_override("font_color", MISSING_RED)
			state_lbl.text = "  ·  ".join(parts)
		row.add_theme_stylebox_override("panel", style)


# ============== 回调 ==============

func _on_toggle_workbench() -> void:
	_station_state["workbench"] = not _station_state.get("workbench", false)
	_refresh_all()
	_show_toast("工作台: %s" % ("有" if _station_state["workbench"] else "无"), ACCENT_WARN)


func _on_toggle_cookpot() -> void:
	_station_state["cookpot"] = not _station_state.get("cookpot", false)
	_refresh_all()
	_show_toast("烹饪锅: %s" % ("有" if _station_state["cookpot"] else "无"), ACCENT_WARN)


func _on_add_materials() -> void:
	var candidates: Array = ["wood", "stone", "flint", "grass", "rope", "berries", "mushroom", "meat", "fish", "honey"]
	for i in range(candidates.size()):
		var it = candidates[i]
		_inventory[it] = _inventory.get(it, 0) + 5
	_refresh_all()
	_show_toast("+5 全材料(10 种)", ACCENT_OK)


func _on_reset_inventory() -> void:
	_inventory.clear()
	_refresh_all()
	_show_toast("库存已清空", ACCENT_WARN)


func _on_craft_pressed(recipe: Dictionary) -> void:
	var t0: int = Time.get_ticks_msec()
	var result = WildwoodCrafting.craft(recipe, _inventory, _station_state)
	var t1: int = Time.get_ticks_msec()
	if result == null:
		_show_toast("合成失败(查看 console)", ACCENT_BAD)
		return
	# 应用到 inventory
	if not WildwoodCrafting.apply_craft_result(_inventory, result):
		_show_toast("inventory 异常,回滚", ACCENT_BAD)
		return
	var dur_ms: float = float(t1 - t0)
	_perf_label.text = "最近合成: %s\n耗时: %.2f ms(预算 400ms)" % [recipe["id"], dur_ms]
	_refresh_all()
	_show_toast("✓ 合成成功: %s" % str(recipe.get("name", recipe["id"])), ACCENT_OK)


# ============== 工具 ==============

func _label_for(item_id: String) -> String:
	return WildwoodCrafting.ITEM_LABELS.get(item_id, item_id)


func _make_panel(bg: Color) -> PanelContainer:
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = bg
	style.content_margin_left = 10
	style.content_margin_right = 10
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	panel.add_theme_stylebox_override("panel", style)
	return panel


func _show_toast(msg: String, color: Color) -> void:
	_toast_label.text = msg
	_toast_label.add_theme_color_override("font_color", color)
	_toast_label.modulate.a = 1.0
	var tw := create_tween()
	tw.tween_property(_toast_label, "modulate:a", 0.0, 1.5)
