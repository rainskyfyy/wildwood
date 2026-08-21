# wildwood_post_export.gd
# 用途: Godot 4.3 PostExportFeature 钩子
#       在 WebGL export 完成后对 index.html 做 critical CSS 抽离
# 安装: 放到项目根 addons/wildwood_perf/ 下
#       在 ProjectSettings → editor → export → post_export_script 设置为本脚本
#
# 真实 Godot 集成由工程团队 PR 跑通(沙箱无 Godot binary)
# 本文件是模板,工程团队按此接线

@tool
class_name WildwoodPostExport
extends EditorExportPlugin

const CRITICAL_CSS_EXTRACTOR := "res://addons/wildwood_perf/critical-css-extract.mjs"
const POSTPROCESS_SCRIPT := "res://addons/wildwood_perf/build-postprocess.mjs"


# Godot 4.3 EditorExportPlugin 回调
# _export_file(path, type, features) - 每导出一个文件都触发
# 我们只关心 HTML,过滤后调用 Node.js 后处理
func _export_file(path: String, type: String, features: PackedStringArray) -> void:
	# 只处理 Web export 的 index.html
	if not path.ends_with("index.html"):
		return
	if not features.has("web"):
		return

	print("[wildwood_perf] post-export: ", path)

	# Godot 不直接调 Node.js,改用 OS.execute 走子进程
	# 真实工程需检查项目 Node 版本 ≥ 18
	var godot_export_dir: String = path.get_base_dir()
	var index_html: String = ProjectSettings.globalize_path(path)
	var out_html: String = index_html.replace(".html", ".optimized.html")

	var args: PackedStringArray = PackedStringArray([
		POSTPROCESS_SCRIPT,
		index_html,
		"--output", out_html,
		"--stats",
	])

	var stdout: Array = []
	var result: int = OS.execute("node", args, stdout, true)
	if result != 0:
		push_error("[wildwood_perf] post-export failed: ", stdout)
		return

	# 用优化后的 HTML 覆盖原 index.html(perf-ci 测量就用这个)
	var optimized: String = FileAccess.get_file_as_string(out_html)
	if optimized.is_empty():
		push_error("[wildwood_perf] failed to read optimized HTML")
		return

	# 注意: Godot export 时写入的是只读虚拟文件系统
	# 真实工程需用 DirAccess + FileAccess 写到物理磁盘
	# 这里仅示意
	print("[wildwood_perf] post-export done: ", out_html)
	for line in (stdout as Array):
		print("  ", line)


# _get_name() - Godot 4.3 要求实现的虚函数
func _get_name() -> String:
	return "WildwoodPostExport"
