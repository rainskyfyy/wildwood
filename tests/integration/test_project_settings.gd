extends Object

## 项目配置健康检查
##
## 校验 project.godot 里的关键设置:
## - 渲染器(GL Compatibility 是 M1 的目标平台,Web 导出必备)
## - 主场景存在
## - 资源元数据(版本号)
## - 关键输入动作(方案 §2.2 4 人小队 → 至少 4 方向 + interact)
## - 像素吸附(方案 §4.5 美术硬约束)

const EXPECTED_RENDERER := "gl_compatibility"
const REQUIRED_INPUT_ACTIONS := ["move_up", "move_down", "move_left", "move_right", "interact"]


static func run(_ctx: Dictionary) -> Dictionary:
	var pass_count := 0
	var fail_count := 0
	var errors: Array = []
	var counter := [pass_count, fail_count, errors]
	_expect_project_version(counter)
	_expect_main_scene(counter)
	_expect_renderer(counter)
	_expect_input_actions(counter)
	_expect_pixel_snap(counter)
	return {"pass": counter[0], "fail": counter[1], "errors": counter[2]}


static func _expect_project_version(counter: Array) -> void:
	var v := ProjectSettings.get_setting("application/config/version", "")
	if String(v).is_empty():
		counter[1] += 1
		counter[2].append("application/config/version is empty")
	else:
		counter[0] += 1
		print("  [pass] application/config.version = %s" % v)


static func _expect_main_scene(counter: Array) -> void:
	var s := ProjectSettings.get_setting("application/run/main_scene", "")
	if String(s).is_empty():
		counter[1] += 1
		counter[2].append("application/run/main_scene is empty")
	else:
		counter[0] += 1
		print("  [pass] application.run.main_scene = %s" % s)


static func _expect_renderer(counter: Array) -> void:
	# Godot 4.3:rendering/rendering_method
	var r := String(ProjectSettings.get_setting("rendering/rendering_method", ""))
	if r == EXPECTED_RENDERER:
		counter[0] += 1
		print("  [pass] rendering_method = %s" % r)
	else:
		counter[1] += 1
		counter[2].append("rendering_method=%s, expected %s" % [r, EXPECTED_RENDERER])


static func _expect_input_actions(counter: Array) -> void:
	var actions := InputMap.get_actions()
	for required in REQUIRED_INPUT_ACTIONS:
		if required in actions:
			counter[0] += 1
			print("  [pass] InputMap has action '%s'" % required)
		else:
			counter[1] += 1
			counter[2].append("InputMap missing required action '%s'" % required)


static func _expect_pixel_snap(counter: Array) -> void:
	# 方案 §4.5 美术硬约束要求像素吸附
	var snap_x := ProjectSettings.get_setting("rendering/2d/snap/snap_2d_transforms_to_pixel", false)
	var snap_v := ProjectSettings.get_setting("rendering/2d/snap/snap_2d_vertices_to_pixel", false)
	if snap_x and snap_v:
		counter[0] += 1
		print("  [pass] 2d snap enabled (transforms=%s, vertices=%s)" % [snap_x, snap_v])
	else:
		counter[1] += 1
		counter[2].append("2d snap not fully enabled (transforms=%s, vertices=%s)" % [snap_x, snap_v])
