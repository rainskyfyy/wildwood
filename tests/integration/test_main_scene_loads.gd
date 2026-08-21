extends Object

## 主场景加载测试
##
## 验证 project.godot 中配置的 main_scene 能被 Godot 正常加载,
## 这是 M1.1 之后所有场景相关工作的基石 — 如果主场景本身都加载不了,
## 后续 M1.7-1.8 UI / M2.x 一切场景都是空谈。

const MAIN_SCENE_PATH := "res://scenes/main.tscn"


static func run(_ctx: Dictionary) -> Dictionary:
	var pass_count := 0
	var fail_count := 0
	var errors: Array = []
	_expect_file_exists(MAIN_SCENE_PATH, pass_count, fail_count, errors)
	_expect_loadable(MAIN_SCENE_PATH, pass_count, fail_count, errors)
	_expect_has_root_node(MAIN_SCENE_PATH, pass_count, fail_count, errors)
	return {"pass": pass_count, "fail": fail_count, "errors": errors}


static func _expect_file_exists(path: String, passes: int, fails: int, errors: Array) -> void:
	# GDScript 没有引用传参,这里用 Array 模拟
	var counter := [passes, fails, errors]
	if FileAccess.file_exists(path):
		counter[0] += 1
		print("  [pass] %s exists" % path)
	else:
		counter[1] += 1
		counter[2].append("%s does not exist" % path)


static func _expect_loadable(path: String, passes: int, fails: int, errors: Array) -> void:
	var counter := [passes, fails, errors]
	if not FileAccess.file_exists(path):
		return
	var packed: PackedScene = load(path)
	if packed == null:
		counter[1] += 1
		counter[2].append("%s failed to load as PackedScene" % path)
		return
	if not packed is PackedScene:
		counter[1] += 1
		counter[2].append("%s loaded but is not a PackedScene (got type %d)" % [path, typeof(packed)])
		return
	counter[0] += 1
	print("  [pass] %s loaded as PackedScene" % path)


static func _expect_has_root_node(path: String, passes: int, fails: int, errors: Array) -> void:
	var counter := [passes, fails, errors]
	if not FileAccess.file_exists(path):
		return
	var packed: PackedScene = load(path)
	if packed == null:
		return
	var inst: Node = packed.instantiate()
	if inst == null:
		counter[1] += 1
		counter[2].append("%s instantiate() returned null" % path)
		return
	if not inst is Node:
		counter[1] += 1
		counter[2].append("%s root is not a Node" % path)
	else:
		counter[0] += 1
		print("  [pass] %s root node instantiated (name=%s)" % [path, inst.name])
	inst.queue_free()
