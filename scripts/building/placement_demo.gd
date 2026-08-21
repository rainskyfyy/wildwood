extends Node2D
## Wildwood M2.3 — 建造放置 demo scene
##
## 演示:
##   1. 7 建筑可造 — 快捷栏切建筑 → 实时预览
##   2. 三判据 — 距离/地形/占用 + 客户端预检材料
##   3. 全队可见 — 服务端 broadcast → 其它客户端同步(此处演示协议 payload)
##
## 用法(在 Godot 4.3 编辑器中):
##   - 打开 scripts/building/placement_demo.tscn
##   - F6 运行(需先在 Project Settings 注册 WildwoodPlacementValidator)
##
## CLI 测试(无需 Godot 运行时):
##   - 见 scripts/building/test_placement_validator.gd 头部

const PROTOCOL_KIND_BUILD_DONE: int = 2  # WorldEventKind.BUILD_DONE, 已在 M1.5 预埋

var validator: WildwoodPlacementValidator = null
var current_building_type: int = WildwoodPlacementValidator.BUILDING_CAMPFIRE
var current_building_id: int = 1000  # 服务端分配,这里从 1000 起模拟
var grid: Dictionary = {}           # 已占用 cell: { Vector2i: true }
var materials: Dictionary = {
	"wood": 12, "stone": 8, "flint": 5, "rope": 6, "grass": 10
}
var player_pos: Vector2 = Vector2(2.0, 0.0)


func _ready() -> void:
	validator = WildwoodPlacementValidator.new()
	_run_demo()


## 5 步端到端 demo — 与 Python 端 m23_demo.py 对齐
func _run_demo() -> void:
	print("============================================================")
	print("M2.3 建造系统 GDScript Demo")
	print("============================================================")

	# 步骤 1:7 建筑可造
	print("\n[1] 7 建筑可造:")
	for bt in range(1, 8):
		var name_zh: String = WildwoodPlacementValidator.building_name_zh(bt)
		var fp: Array = WildwoodPlacementValidator.get_footprint(bt)
		print("  building %d (%s) — footprint %dx%d" % [bt, name_zh, fp[0], fp[1]])

	# 步骤 2:三判据(距离/占用/材料)
	print("\n[2] 三判据(距离/占用/材料):")
	var test_cases: Array = [
		{"name": "玩家附近空地", "bx": 3.0, "by": 0.0, "expect_ok": true},
		{"name": "超出 4m 距离", "bx": 8.0, "by": 0.0, "expect_ok": false},
		{"name": "已占用 cell", "bx": 5.0, "by": 0.0, "expect_ok": false},
		{"name": "材料不足(耗光)", "bx": 4.0, "by": 1.0, "expect_ok": false},
	]
	# 预占 cell (5, 0) — 模拟之前放过 chest
	grid[Vector2i(5, 0)] = true
	# 预扣材料 — 模拟之前放过几次
	materials["wood"] = 1
	materials["stone"] = 0

	for tc in test_cases:
		var res: Dictionary = validator.validate(
			current_building_type, tc.bx, tc.by, player_pos.x, player_pos.y, materials, grid
		)
		var color: Color = validator.evaluate_color(res)
		var reason: String = validator.reason_zh(res)
		var mark: String = "✓" if res.ok == tc.expect_ok else "✗"
		print("  %s [%s] %s @ (%.1f, %.1f) — %s" % [
			mark, _color_label(color), tc.name, tc.bx, tc.by, reason
		])

	# 步骤 3:放置成功 + 协议 payload(对齐 Go 端 broadcastBuildDone)
	print("\n[3] 放置 + 协议 payload(BUILD_DONE=2):")
	var place_res: Dictionary = validator.validate(
		current_building_type, 3.0, 0.0, player_pos.x, player_pos.y, materials, grid
	)
	if place_res.ok:
		current_building_id += 1
		grid[Vector2i(3, 0)] = true
		var evt: Dictionary = {
			"event_kind": PROTOCOL_KIND_BUILD_DONE,
			"source_entity_id": _player_hash("p1"),
			"target_entity_id": current_building_id,
			"amount": current_building_type,  # zigzag 自动处理
			"position": Vector2(3.0, 0.0),
		}
		print("  ✓ 放置成功 → 协议事件:")
		print("    event_kind = %d (BUILD_DONE)" % evt.event_kind)
		print("    source_entity_id = 0x%08x (player hash)" % evt.source_entity_id)
		print("    target_entity_id = %d (new building)" % evt.target_entity_id)
		print("    amount = %d (building type id, zigzag)" % evt.amount)
		print("    position = (%g, %g)" % [evt.position.x, evt.position.y])
	else:
		print("  ✗ 放置失败: %s" % place_res.reason)

	# 步骤 4:跨客户端一致 — 4 个玩家放 4 个不同建筑
	print("\n[4] 4 玩家各自放 1 个建筑(协议一致):")
	var pids: Array = ["p1", "p2", "p3", "p4"]
	var positions: Array = [
		Vector2(0.5, 0.5), Vector2(2.5, 0.5), Vector2(4.5, 0.5), Vector2(6.5, 0.5)
	]
	var building_types: Array = [1, 2, 3, 4]
	for i in range(4):
		var pid: String = pids[i]
		var pos: Vector2 = positions[i]
		var bt: int = building_types[i]
		var res: Dictionary = validator.validate(bt, pos.x, pos.y, pos.x - 1.0, pos.y, materials, grid)
		if res.ok:
			current_building_id += 1
			grid[Vector2i(int(pos.x), int(pos.y))] = true
			print("  ✓ %s 放 %s @ (%.1f, %.1f) → entity_id=%d  event=BUILD_DONE" % [
				pid, WildwoodPlacementValidator.building_name_zh(bt), pos.x, pos.y, current_building_id
			])

	print("\n============================================================")
	print("M2.3 建造系统 GDScript Demo 全过 ✓")
	print("============================================================")


func _color_label(c: Color) -> String:
	if c.g > 0.5 and c.r < 0.5:
		return "GREEN"
	if c.r > 0.5 and c.g < 0.5:
		return "RED"
	return "?"


# FNV-1a 32-bit hash — 与 Python / Go 端 player_id → entity_id 对齐
func _player_hash(player_id: String) -> int:
	if player_id.is_empty():
		return 0
	# GDScript 端用 String → PackedByteArray → 哈希
	var bytes: PackedByteArray = player_id.to_utf8_buffer()
	var h: int = 0x811c9dc5  # FNV offset basis (32-bit)
	for b in bytes:
		h = h ^ b
		h = (h * 0x01000193) & 0xFFFFFFFF  # FNV prime, mask 32-bit
	return h
