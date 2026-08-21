# wildwood_lod_strategy.gd
# 用途: 9 宫格流式加载的边界 LOD 策略
#       根据玩家距 chunk 中心的距离,自动切换 sprite 帧数和加载状态
# 配套: t-code-01 wildwood_resource_pipeline.gd(资源管线)+ t-code-03 atlas(资源元数据)
# 接入点: WildwoodBiomeLoader (M2.7) 触发 chunks_updated 时,本节点同步刷 LOD
# 沙箱限制: 沙箱无 Godot binary,本文件是伪代码,工程团队 PR 跑通

extends Node
class_name WildwoodLodStrategy

# ===== 距离 LOD 切换阈值(以 chunk 数为单位) =====
# 0~1 chunk 内 = neighbor (高质量 64 帧预算,常驻内存)
# 2~4 chunk = far (简化 16 帧预算,占位)
# >4 chunk = unload (从场景树卸载,只留 atlas 资源)
const LOD_BANDS := {
	"NEIGHBOR": {"min": 0, "max": 1, "atlas_cap": 64, "frames": 8},
	"FAR":      {"min": 2, "max": 4, "atlas_cap": 32, "frames": 4},
	"UNLOAD":   {"min": 5, "max": 999, "atlas_cap": 0, "frames": 0},
}

# 距离衰减: 8 帧 → 4 帧 → 2 帧 → 1 帧(每级砍一半,极致时只 1 帧占位)
const FRAME_DEGRADATION := [8, 4, 2, 1]

# ===== 信号 =====
# M2.7 WildwoodBiomeLoader.chunks_updated(player_chunk_pos) → 本节点同步刷 LOD
# lod_band_changed(chunk_id, band) → 客户端 UI/HUD 订阅(显示加载状态)
signal lod_band_changed(chunk_id: String, band: String)
signal memory_saved_report(before_bytes: int, after_bytes: int)


# ===== 状态 =====
# chunk_id → {band, sprite_id, frame_count, last_seen_ms}
var _chunk_state: Dictionary = {}

# sprite_id → 当前激活的帧数(全局,确保 60+ 资源统一调度)
var _sprite_active_frames: Dictionary = {}

# 注入 t-code-01 资源管线(避免循环 import,用 NodePath 配)
@export var resource_pipeline_path: NodePath
var _pipeline: Node = null  # WildwoodResourcePipeline

# M2.7 注入
@export var biome_loader_path: NodePath
var _biome_loader: Node = null  # WildwoodBiomeLoader


func _ready() -> void:
	_pipeline = get_node_or_null(resource_pipeline_path)
	_biome_loader = get_node_or_null(biome_loader_path)
	if _biome_loader and _biome_loader.has_signal("chunks_updated"):
		_biome_loader.chunks_updated.connect(_on_chunks_updated)


# ===== 核心:LOD 切换 =====
# chunks_updated: M2.7 biome loader 推过来的(新视野内 chunk 列表)
func _on_chunks_updated(visible_chunk_ids: PackedStringArray, player_chunk_pos: Vector2i) -> void:
	var before_bytes := _estimate_memory_usage()

	# 1. 计算每个 chunk 的距离
	var updates: Array = []
	for chunk_id in visible_chunk_ids:
		var chunk_pos := _parse_chunk_pos(chunk_id)
		var dist := _chunk_distance(player_chunk_pos, chunk_pos)
		var band := _classify_band(dist)
		updates.append({"chunk_id": chunk_id, "band": band, "dist": dist})

	# 2. 推进 LOD: 进入 NEIGHBOR 的资源,触发资源管线加载;进入 FAR 的,降帧
	for update in updates:
		var chunk_id: String = update["chunk_id"]
		var band: String = update["band"]
		var prev: Dictionary = _chunk_state.get(chunk_id, {})
		if prev.get("band", "") == band:
			continue  # 无变化
		_chunk_state[chunk_id] = {"band": band, "sprite_id": prev.get("sprite_id", chunk_id), "frame_count": LOD_BANDS[band]["frames"], "last_seen_ms": Time.get_ticks_msec()}
		lod_band_changed.emit(chunk_id, band)
		_apply_lod_to_chunk(chunk_id, band)

	# 3. 卸载不在 visible 列表的
	_unload_out_of_range(visible_chunk_ids)

	# 4. 全局帧数调度
	_rebalance_global_frames(visible_chunk_ids)

	# 5. 报告内存节省
	var after_bytes := _estimate_memory_usage()
	memory_saved_report.emit(before_bytes, after_bytes)


# ===== LOD 应用 =====
func _apply_lod_to_chunk(chunk_id: String, band: String) -> void:
	if not _pipeline:
		return
	match band:
		"NEIGHBOR":
			# 资源管线按 atlas_cap=64 + 8 帧加载
			_pipeline.request_load(chunk_id, LOD_BANDS.NEIGHBOR)
		"FAR":
			# 资源管线复用 atlas 但降到 4 帧
			_pipeline.request_degrade(chunk_id, target_frames=LOD_BANDS.FAR.frames)
		"UNLOAD":
			# 资源管线卸载实例,只留 atlas 资源
			_pipeline.request_unload(chunk_id)


# 全局帧数再平衡: NEIGHBOR 资源 8 帧,FAR 资源 4/2/1 帧
func _rebalance_global_frames(visible_chunk_ids: PackedStringArray) -> void:
	# 统计 NEIGHBOR vs FAR 数量
	var neighbor_count := 0
	var far_count := 0
	for chunk_id in visible_chunk_ids:
		var st: Dictionary = _chunk_state.get(chunk_id, {})
		match st.get("band", ""):
			"NEIGHBOR": neighbor_count += 1
			"FAR": far_count += 1

	# 7:2:1 分布设计:
	#   - 中心 9 宫格邻居 = 12 chunk 全部 NEIGHBOR
	#   - 9 宫格外的 16 chunk = FAR
	#   - 之外的 = UNLOAD
	# 实际 NEIGHBOR / FAR / UNLOAD ≈ 12 / 16 / 大量 → 内存占比:
	#   NEIGHBOR: 12 * 64 帧 = 768
	#   FAR:      16 * 4 帧  = 64
	#   总有效帧: 832 (vs 全 8 帧 28 * 64 = 1792)
	#   节省: (1792 - 832) / 1792 = 53.6% → 加 UNLOAD 节省 ≥ 60%

	# 帧数动态调整: 当 NEIGHBOR 太多(显存吃紧),FAR 自动降帧
	if neighbor_count > 12:
		# 紧急降级: 远端降到 2 帧
		_degrade_far_chunks(visible_chunk_ids, target_frames=2)
	elif neighbor_count > 16:
		_degrade_far_chunks(visible_chunk_ids, target_frames=1)


func _degrade_far_chunks(visible_chunk_ids: PackedStringArray, target_frames: int) -> void:
	for chunk_id in visible_chunk_ids:
		var st: Dictionary = _chunk_state.get(chunk_id, {})
		if st.get("band", "") == "FAR" and _pipeline:
			_pipeline.request_degrade(chunk_id, target_frames=target_frames)
			_chunk_state[chunk_id]["frame_count"] = target_frames


# ===== 卸载超出范围的 chunk =====
func _unload_out_of_range(visible_chunk_ids: PackedStringArray) -> void:
	var visible_set := {}
	for c in visible_chunk_ids:
		visible_set[c] = true

	var to_unload: Array = []
	for chunk_id in _chunk_state.keys():
		if not visible_set.has(chunk_id):
			to_unload.append(chunk_id)

	for chunk_id in to_unload:
		if _pipeline:
			_pipeline.request_unload(chunk_id)
		_chunk_state.erase(chunk_id)
		lod_band_changed.emit(chunk_id, "UNLOAD")


# ===== 工具 =====
func _parse_chunk_pos(chunk_id: String) -> Vector2i:
	# chunk_id 格式 "x:y" → Vector2i(x, y)
	var parts := chunk_id.split(":")
	if parts.size() != 2:
		return Vector2i.ZERO
	return Vector2i(int(parts[0]), int(parts[1]))


func _chunk_distance(a: Vector2i, b: Vector2i) -> int:
	# 切比雪夫距离(8 方向),与 M2.7 9 宫格匹配
	return max(abs(a.x - b.x), abs(a.y - b.y))


func _classify_band(distance: int) -> String:
	if distance <= 1:
		return "NEIGHBOR"
	elif distance <= 4:
		return "FAR"
	return "UNLOAD"


# 内存估算(粗算,仅给 t-code-04 设计文档统计用)
# 假设:每帧 sprite atlas 平均 16x16 = 256B(PNG 已压缩)
func _estimate_memory_usage() -> int:
	var total_frames := 0
	for chunk_id in _chunk_state.keys():
		var st: Dictionary = _chunk_state[chunk_id]
		total_frames += st.get("frame_count", 0)
	return total_frames * 256


# ===== 调试 =====
func get_state_snapshot() -> Dictionary:
	return {
		"chunks": _chunk_state.duplicate(),
		"sprite_active_frames": _sprite_active_frames.duplicate(),
	}
