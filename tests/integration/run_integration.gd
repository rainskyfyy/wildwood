extends SceneTree

## Wildwood 集成测试运行器
##
## 用法:
##   godot --headless --path . -s tests/integration/run_integration.gd
##   godot --headless --path . -s tests/integration/run_integration.gd -- --filter test_main_scene
##
## 约定:
## - 集成测试文件以 test_*.gd 命名,放在 tests/integration/ 下
## - 每个测试文件 extend Object,实现静态方法 run(ctx) -> Dictionary
##   返回 { "pass": int, "fail": int, "errors": Array[String] }
## - 退出码:0 全部通过;非 0 至少 1 个失败(便于 CI 判定)
##
## 为什么不用 GUT:集成测试在场景树里跑,需要 SceneTree 的生命周期
## (process_frame 等),与 GUT 的 Test 模式正交;另起独立入口更清晰。

const TEST_DIR := "res://tests/integration"

var _results: Array = []
var _total_pass: int = 0
var _total_fail: int = 0
var _filter: String = ""


func _init() -> void:
	# 解析 --filter
	var args := OS.get_cmdline_user_args()
	for arg in args:
		if arg.begins_with("--filter="):
			_filter = arg.substr("--filter=".length())
	# _init 阶段 SceneTree 还未完全就绪,延后到第一次 idle
	_run_all.call_deferred()


func _run_all() -> void:
	print("[integration] start, filter=%s" % (_filter if _filter != "" else "<none>"))
	var files := _discover_tests()
	if files.is_empty():
		printerr("[integration] no test files found in %s" % TEST_DIR)
		quit(2)
		return

	for path in files:
		var script: GDScript = load(path)
		if script == null:
			_record_fail(path, ["failed to load script"])
			continue
		if not script.has_method("run"):
			_record_fail(path, ["script missing static run(ctx) method"])
			continue
		var ctx := {"tree": self, "path": path}
		var result_raw = script.call("run", ctx)
		if typeof(result_raw) != TYPE_DICTIONARY:
			_record_fail(path, ["run() must return Dictionary, got %s" % typeof(result_raw)])
			continue
		var result: Dictionary = result_raw
		var p: int = int(result.get("pass", 0))
		var f: int = int(result.get("fail", 0))
		var errors: Array = result.get("errors", [])
		_results.append({
			"path": path,
			"pass": p,
			"fail": f,
			"errors": errors,
		})
		_total_pass += p
		_total_fail += f

	_print_summary()
	# 退出码:0 全部通过;1 至少 1 个失败
	quit(0 if _total_fail == 0 else 1)


func _discover_tests() -> Array:
	var out: Array = []
	var dir := DirAccess.open(TEST_DIR)
	if dir == null:
		return out
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if name.begins_with("test_") and name.ends_with(".gd") and name != "run_integration.gd":
			var path := "%s/%s" % [TEST_DIR, name]
			if _filter == "" or name.contains(_filter):
				out.append(path)
		name = dir.get_next()
	dir.list_dir_end()
	out.sort()
	return out


func _record_fail(path: String, errors: Array) -> void:
	_total_fail += 1
	_results.append({
		"path": path,
		"pass": 0,
		"fail": errors.size(),
		"errors": errors,
	})


func _print_summary() -> void:
	print("")
	print("========== Integration Test Summary ==========")
	for r in _results:
		var path: String = r.get("path", "?")
		var p: int = r.get("pass", 0)
		var f: int = r.get("fail", 0)
		var status := "PASS" if f == 0 else "FAIL"
		print("[%s] %s  pass=%d fail=%d" % [status, path, p, f])
		for e in r.get("errors", []):
			print("        ! %s" % e)
	print("----------------------------------------------")
	print("TOTAL: pass=%d fail=%d" % [_total_pass, _total_fail])
	print("==============================================")
