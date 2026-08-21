extends GutTest
## M2.7 GUT 集成测试 — 9 宫格流式加载器
##
## 覆盖:
## 1. update_player_chunk 计算正确的 9 邻居
## 2. 跨群系移动时正确卸载旧 chunk
## 3. 内存节省 ≥ 60% (验收 ②)
## 4. 状态机:IDLE → LOADING → READY
## 5. 群系 ID 判定(coord_to_biome 顺序敏感规则)

const ConstantsScript := preload("res://core/biome_runtime/WildwoodBiomeConstants.gd")
const LoaderScript := preload("res://core/biome_runtime/WildwoodBiomeLoader.gd")
const RuntimeScript := preload("res://core/biome_runtime/WildwoodBiomeRuntime.gd")

var loader: WildwoodBiomeLoader
var runtime: WildwoodBiomeRuntime


func before_each() -> void:
	loader = LoaderScript.new()
	runtime = RuntimeScript.new()
	# Runtime 内部已 init() 一次,这里不重置以保留初始状态


# === 1. 9 宫格邻居 ===

func test_neighbors_3x3_count_is_9() -> void:
	var neighbors: Array = ConstantsScript.neighbors_3x3(0, 0)
	assert_eq(neighbors.size(), 9, "9 宫格必须返回 9 个 chunk")

func test_neighbors_3x3_center_contains_self() -> void:
	var neighbors: Array = ConstantsScript.neighbors_3x3(2, 3)
	var found_self: bool = false
	for c in neighbors:
		if int(c[0]) == 2 and int(c[1]) == 3:
			found_self = true
			break
	assert_true(found_self, "9 宫格必须包含中心自身")

func test_neighbors_3x3_offset() -> void:
	var neighbors: Array = ConstantsScript.neighbors_3x3(5, -2)
	# 期望范围:cx ∈ [4, 6], cy ∈ [-3, -1]
	for c in neighbors:
		var cx: int = int(c[0])
		var cy: int = int(c[1])
		assert_true(cx >= 4 and cx <= 6, "cx 必须在 [4,6]")
		assert_true(cy >= -3 and cy <= -1, "cy 必须在 [-3,-1]")


# === 2. update_player_chunk 行为 ===

func test_update_player_chunk_loads_9() -> void:
	var res: Dictionary = loader.update_player_chunk([0, 0])
	assert_eq(int(res["loaded"]), 9, "首次应加载 9 个 chunk")
	assert_eq(int(res["evicted"]), 0, "首次无卸载")
	assert_eq(loader.loaded_count(), 9, "已加载 9")

func test_update_player_chunk_same_center_no_op() -> void:
	loader.update_player_chunk([0, 0])
	var res: Dictionary = loader.update_player_chunk([0, 0])
	assert_eq(int(res["loaded"]), 0, "中心未变,无新加载")
	assert_eq(int(res["evicted"]), 0, "中心未变,无卸载")
	assert_eq(loader.loaded_count(), 9, "仍为 9")

func test_update_player_chunk_cross_chunk_partial_unload() -> void:
	loader.update_player_chunk([0, 0])
	# 玩家走到 (1, 0):3 个新 chunk 加载 (1,1)/(2,0)/(1,-1) 不在原 9 内;3 个旧 chunk 卸载
	var res: Dictionary = loader.update_player_chunk([1, 0])
	assert_eq(loader.loaded_count(), 9, "仍维持 9 宫格")
	assert_eq(int(res["loaded"]) + int(res["evicted"]), 6, "移动 1 格:3 加 + 3 卸 = 6")

func test_update_player_chunk_cross_biome_trigger() -> void:
	loader.update_player_chunk([0, 0])  # forest
	# 玩家跨到 (2, 0):mines
	loader.update_player_chunk([2, 0])
	# 9 宫格中应包含 mines 块
	var loaded: Array = loader.loaded_chunks()
	var has_mines_chunk: bool = false
	for c in loaded:
		if int(c[0]) >= 1 and int(c[0]) <= 3:
			has_mines_chunk = true
			break
	assert_true(has_mines_chunk, "应包含 (2,0)/(3,*) 矿区 chunk")


# === 3. 内存节省 ≥ 60% (验收 ②) ===

func test_memory_saving_meets_60_percent_target() -> void:
	loader.update_player_chunk([0, 0])
	var pct: float = loader.memory_saving_pct()
	assert_gte(pct, 60.0, "内存节省必须 ≥ 60%(验收 ②)")

func test_memory_saving_loaded_bytes_correct() -> void:
	loader.update_player_chunk([0, 0])
	# 9 chunks × 1 MB = 9 MB
	assert_eq(loader.loaded_bytes(), 9 * 1048576, "9 chunks × 1MB = 9MB")


# === 4. 状态机 ===

func test_state_idle_to_loading_to_ready() -> void:
	assert_eq(loader.get_state(), ConstantsScript.LoaderState.IDLE)
	loader.update_player_chunk([0, 0])
	# 同步调用在 update 完成后应回到 READY
	assert_eq(loader.get_state(), ConstantsScript.LoaderState.READY)

func test_state_changed_signal_emitted() -> void:
	var states: Array = []
	loader.state_changed.connect(func(s): states.append(s))
	loader.update_player_chunk([0, 0])
	# 至少应该经过 LOADING 和 READY
	assert_true(states.size() >= 2, "状态变化信号至少 2 次")
	assert_eq(int(states[0]), ConstantsScript.LoaderState.LOADING)
	assert_eq(int(states[states.size() - 1]), ConstantsScript.LoaderState.READY)


# === 5. coord_to_biome 规则 ===

func test_coord_to_biome_center_is_forest() -> void:
	assert_eq(runtime.coord_to_biome(0, 0), ConstantsScript.BIOME_FOREST)
	assert_eq(runtime.coord_to_biome(1, 1), ConstantsScript.BIOME_FOREST)
	assert_eq(runtime.coord_to_biome(-1, -1), ConstantsScript.BIOME_FOREST)

func test_coord_to_biome_east_axis_is_mines() -> void:
	# cx == 2 整列 → mines(顺序敏感)
	assert_eq(runtime.coord_to_biome(2, 0), ConstantsScript.BIOME_MINES)
	assert_eq(runtime.coord_to_biome(2, 1), ConstantsScript.BIOME_MINES)
	assert_eq(runtime.coord_to_biome(2, -1), ConstantsScript.BIOME_MINES)
	assert_eq(runtime.coord_to_biome(2, 2), ConstantsScript.BIOME_MINES)

func test_coord_to_biome_west_axis_is_snow() -> void:
	assert_eq(runtime.coord_to_biome(-2, 0), ConstantsScript.BIOME_SNOW)
	assert_eq(runtime.coord_to_biome(-2, 1), ConstantsScript.BIOME_SNOW)
	assert_eq(runtime.coord_to_biome(-2, -1), ConstantsScript.BIOME_SNOW)
	assert_eq(runtime.coord_to_biome(-2, 2), ConstantsScript.BIOME_SNOW)

func test_coord_to_biome_north_south_is_plains() -> void:
	# cx == 0, |cy| == 2 → plains
	assert_eq(runtime.coord_to_biome(0, 2), ConstantsScript.BIOME_PLAINS)
	assert_eq(runtime.coord_to_biome(0, -2), ConstantsScript.BIOME_PLAINS)

func test_coord_to_biome_corner_falls_back() -> void:
	# (2, 2) → mines;(−2, −2) → snow(规则回退)
	assert_eq(runtime.coord_to_biome(2, 2), ConstantsScript.BIOME_MINES)
	assert_eq(runtime.coord_to_biome(-2, -2), ConstantsScript.BIOME_SNOW)


# === 6. Runtime 集成 ===

func test_runtime_on_player_moved_emits_biome_changed() -> void:
	var fired: Array = []
	runtime.biome_changed.connect(func(f, t, c): fired.append([f, t, c]))
	# 初始 (0, 0) = forest;移动到 (2, 0) = mines
	runtime.on_player_moved([2, 0])
	assert_eq(fired.size(), 1, "跨群系移动应触发 biome_changed")
	assert_eq(String(fired[0][0]), "forest")
	assert_eq(String(fired[0][1]), "mines")

func test_runtime_on_player_moved_no_signal_for_same_biome() -> void:
	var fired: Array = []
	runtime.biome_changed.connect(func(f, t, c): fired.append(f))
	# (0, 0) → (1, 0) 都是 forest
	runtime.on_player_moved([1, 0])
	assert_eq(fired.size(), 0, "同群系不广播")

func test_runtime_memory_stats() -> void:
	var stats: Dictionary = runtime.memory_stats()
	assert_eq(int(stats["loaded_chunks"]), 9)
	assert_eq(int(stats["full_chunks"]), 25)
	assert_gte(float(stats["saving_pct"]), 60.0)
