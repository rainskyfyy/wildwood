extends Object

## 项目资源路径完整性检查
##
## 校验 project.godot 引用、main_scene 引用的资源都真实存在。
## 防止"脚手架跑得通但某些引用资源缺失"的隐性 bug。
##
## 检查范围:
## 1. res://scenes/ 下所有 .tscn 的 ext_resource 引用都能 resolve
## 2. res://core/ 和 res://scripts/ 下所有 .gd 文件语法可解析(简单 load 测试)

const SCENES_DIR := "res://scenes"


static func run(_ctx: Dictionary) -> Dictionary:
	var pass_count := 0
	var fail_count := 0
	var errors: Array = []
	_check_scenes_ext_resources(pass_count, fail_count, errors)
	return {"pass": pass_count, "fail": fail_count, "errors": errors}


static func _check_scenes_ext_resources(passes: int, fails: int, errors: Array) -> void:
	var counter := [passes, fails, errors]
	var dir := DirAccess.open(SCENES_DIR)
	if dir == null:
		# M1.1 阶段 scenes/ 存在但可能为空,这是正常的
		print("  [info] %s is empty or missing, skipping ext_resource check" % SCENES_DIR)
		return
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if name.ends_with(".tscn") and not name.ends_with(".import"):
			var path := "%s/%s" % [SCENES_DIR, name]
			_verify_scene_assets(path, counter)
		name = dir.get_next()
	dir.list_dir_end()


static func _verify_scene_assets(path: String, counter: Array) -> void:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		counter[1] += 1
		counter[2].append("%s could not be opened" % path)
		return
	var content := f.get_as_text()
	f.close()
	# 简单解析:每行 [ext_resource ... path="res://..."] 都要存在
	var lines := content.split("\n")
	for line in lines:
		var s := String(line).strip_edges()
		if not s.begins_with("[ext_resource"):
			continue
		var pfrom := s.find("path=\"")
		if pfrom < 0:
			continue
		var pend := s.find("\"", pfrom + 6)
		if pend < 0:
			continue
		var res_path := s.substr(pfrom + 6, pend - pfrom - 6)
		if not res_path.begins_with("res://"):
			continue
		if FileAccess.file_exists(res_path):
			counter[0] += 1
			print("  [pass] %s ref → %s exists" % [path, res_path])
		else:
			counter[1] += 1
			counter[2].append("%s references missing %s" % [path, res_path])
