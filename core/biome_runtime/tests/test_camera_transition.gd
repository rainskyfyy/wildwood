extends GutTest
## M2.7 GUT 集成测试 — 相机过渡状态机(验收 ③:总时长 0.5s)
##
## 验收:
## 1. IDLE → TRANSITION_OUT(250ms) → SWAP(0ms) → TRANSITION_IN(250ms) → IDLE
## 2. 总时长 = 500ms ± 20ms
## 3. alpha 在 OUT 段 1→0,IN 段 0→1
## 4. 同群系(start_transition from==to)不启动
## 5. 过渡期间再次调用被忽略(避免抖动)

const ConstantsScript := preload("res://core/biome_runtime/WildwoodBiomeConstants.gd")
const CameraScript := preload("res://core/biome_runtime/WildwoodCameraTransition.gd")

var camera: WildwoodCameraTransition


func before_each() -> void:
	camera = CameraScript.new()


# === 1. 状态机基本行为 ===

func test_initial_state_is_idle() -> void:
	assert_eq(camera.get_state(), ConstantsScript.CameraTransitionState.IDLE)

func test_start_transition_changes_to_out() -> void:
	camera.start_transition(&"forest", &"mines")
	assert_eq(camera.get_state(), ConstantsScript.CameraTransitionState.TRANSITION_OUT)

func test_same_biome_does_not_start() -> void:
	camera.start_transition(&"forest", &"forest")
	assert_eq(camera.get_state(), ConstantsScript.CameraTransitionState.IDLE, "同群系不启动")

func test_double_start_is_ignored() -> void:
	camera.start_transition(&"forest", &"mines")
	camera.start_transition(&"mines", &"snow")
	# 第二次被忽略,from/to 仍为 forest→mines
	assert_eq(camera.get_state(), ConstantsScript.CameraTransitionState.TRANSITION_OUT, "第二次启动应被忽略")


# === 2. 总时长 = 500ms (验收 ③) ===

func test_total_transition_time_is_500ms() -> void:
	camera.start_transition(&"forest", &"mines")
	# 模拟 30 步推进,每步 20ms,总 600ms(应足以完成 500ms 过渡)
	for _i in range(30):
		camera.advance(20.0)
	# 完成后应回到 IDLE
	assert_eq(camera.get_state(), ConstantsScript.CameraTransitionState.IDLE)

func test_finished_signal_fires_with_total_ms_in_range() -> void:
	var fired_total: int = -1
	camera.transition_finished.connect(func(f, t, ms): fired_total = ms)
	camera.start_transition(&"forest", &"mines")
	for _i in range(30):
		camera.advance(20.0)
	assert_ne(fired_total, -1, "transition_finished 必须触发")
	# 验收:总时长 ∈ [480, 520]
	assert_gte(fired_total, 480, "总时长 ≥ 480ms")
	assert_lte(fired_total, 520, "总时长 ≤ 520ms")

func test_exact_500ms_total() -> void:
	# 用 50 步 × 10ms = 500ms 精确推进
	camera.start_transition(&"forest", &"mines")
	for _i in range(50):
		camera.advance(10.0)
	# 已 500ms,应恰好完成(留 1 步误差是因为 advance 一次性推进 10ms 可能越界 1 段)
	assert_eq(camera.get_state(), ConstantsScript.CameraTransitionState.IDLE)


# === 3. alpha 变化 ===

func test_alpha_out_segment_decreases() -> void:
	camera.start_transition(&"forest", &"mines")
	assert_almost_eq(camera.get_alpha(), 1.0, 0.01, "起始 alpha=1.0")
	camera.advance(125.0)  # 半段
	var a: float = camera.get_alpha()
	assert_true(a < 1.0 and a > 0.0, "半段 alpha 应在 (0,1)")

func test_alpha_in_segment_increases() -> void:
	camera.start_transition(&"forest", &"mines")
	# 推进到 IN 段中点
	camera.advance(375.0)  # 250 OUT + 125 IN
	assert_eq(camera.get_state(), ConstantsScript.CameraTransitionState.TRANSITION_IN)
	var a: float = camera.get_alpha()
	assert_true(a > 0.0 and a < 1.0, "IN 段半程 alpha 应在 (0,1)")

func test_alpha_changes_signal() -> void:
	var alphas: Array = []
	camera.alpha_changed.connect(func(a): alphas.append(a))
	camera.start_transition(&"forest", &"mines")
	for _i in range(30):
		camera.advance(20.0)
	# OUT(250ms)=13 步 / SWAP(0ms)=0 / IN(250ms)=13 步 ≈ 26 次 alpha 更新
	assert_gt(alphas.size(), 10, "alpha 应多次更新")


# === 4. reset ===

func test_reset_clears_state() -> void:
	camera.start_transition(&"forest", &"mines")
	camera.advance(100.0)
	camera.reset()
	assert_eq(camera.get_state(), ConstantsScript.CameraTransitionState.IDLE)
	assert_eq(camera.total_elapsed_ms(), 0)


# === 5. 信号时序 ===

func test_state_changed_signal_sequence() -> void:
	var states: Array = []
	camera.state_changed.connect(func(s): states.append(s))
	camera.start_transition(&"forest", &"mines")
	camera.advance(300.0)  # 走完 OUT,进入 IN
	# 序列:OUT → IN
	assert_eq(int(states[0]), ConstantsScript.CameraTransitionState.TRANSITION_OUT)
	assert_eq(int(states[states.size() - 1]), ConstantsScript.CameraTransitionState.TRANSITION_IN)

func test_transition_started_signal() -> void:
	var fired: Array = []
	camera.transition_started.connect(func(f, t): fired.append([String(f), String(t)]))
	camera.start_transition(&"forest", &"mines")
	assert_eq(fired.size(), 1)
	assert_eq(fired[0][0], "forest")
	assert_eq(fired[0][1], "mines")
