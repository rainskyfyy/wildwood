extends GutTest

## MathUtils 工具函数的 GUT 单元测试
##
## 覆盖:
## - 浮点容差比较
## - 整数钳制
## - 线性插值
## - 二维距离平方
## - 网格吸附
## - 区间判断
## - AABB 相交

func test_approx_eq_true_within_epsilon() -> void:
	assert_true(MathUtils.approx_eq(1.0, 1.00005), "差异小于 epsilon 应相等")

func test_approx_eq_false_outside_epsilon() -> void:
	assert_false(MathUtils.approx_eq(1.0, 1.001), "差异超过 epsilon 应不相等")

func test_approx_eq_default_epsilon() -> void:
	# 默认 epsilon = 0.0001
	assert_true(MathUtils.approx_eq(0.0, 0.00009), "默认 epsilon 应覆盖 9e-5")
	assert_false(MathUtils.approx_eq(0.0, 0.0002), "默认 epsilon 不应覆盖 2e-4")


func test_clampi_below_min() -> void:
	assert_eq(MathUtils.clampi(-5, 0, 10), 0, "负数应被钳到 min")

func test_clampi_above_max() -> void:
	assert_eq(MathUtils.clampi(15, 0, 10), 10, "超出应被钳到 max")

func test_clampi_in_range() -> void:
	assert_eq(MathUtils.clampi(5, 0, 10), 5, "范围内应原样返回")

func test_clampi_at_boundary() -> void:
	assert_eq(MathUtils.clampi(0, 0, 10), 0, "等于 min 不变")
	assert_eq(MathUtils.clampi(10, 0, 10), 10, "等于 max 不变")


func test_lerp_f_start() -> void:
	assert_eq(MathUtils.lerp_f(0.0, 10.0, 0.0), 0.0, "t=0 应等于 a")

func test_lerp_f_end() -> void:
	assert_eq(MathUtils.lerp_f(0.0, 10.0, 1.0), 10.0, "t=1 应等于 b")

func test_lerp_f_midpoint() -> void:
	assert_true(MathUtils.approx_eq(MathUtils.lerp_f(0.0, 10.0, 0.5), 5.0), "t=0.5 应在中点")

func test_lerp_f_extrapolate() -> void:
	# t 超出 [0,1] 区间时不钳制,允许外推
	assert_eq(MathUtils.lerp_f(0.0, 10.0, 2.0), 20.0, "t>1 应外推")


func test_distance_squared_2d_zero() -> void:
	assert_eq(MathUtils.distance_squared_2d(Vector2(1, 2), Vector2(1, 2)), 0.0, "同点距离应为 0")

func test_distance_squared_2d_axis_aligned() -> void:
	assert_eq(MathUtils.distance_squared_2d(Vector2(0, 0), Vector2(3, 4)), 25.0, "3-4-5 直角")

func test_distance_squared_2d_negative_coords() -> void:
	assert_eq(MathUtils.distance_squared_2d(Vector2(-1, -1), Vector2(2, 3)), 25.0, "支持负坐标")


func test_snap_to_grid_aligns_32() -> void:
	# 32px 基础网格
	assert_eq(MathUtils.snap_to_grid(Vector2(33, 65), 32), Vector2(32, 64), "吸附到 32 倍数")
	assert_eq(MathUtils.snap_to_grid(Vector2(0, 0), 32), Vector2(0, 0), "原点不变")

func test_snap_to_grid_aligns_8() -> void:
	# 8px UI 网格(M1.7 规范)
	assert_eq(MathUtils.snap_to_grid(Vector2(7, 15), 8), Vector2(8, 16), "吸附到 8 倍数")

func test_snap_to_grid_invalid_size_returns_input() -> void:
	# 非法 grid_size 应原样返回(已 push_error)
	var input := Vector2(13, 21)
	assert_eq(MathUtils.snap_to_grid(input, 0), input, "grid_size=0 应原样返回")
	assert_eq(MathUtils.snap_to_grid(input, -1), input, "grid_size<0 应原样返回")


func test_in_range_inclusive() -> void:
	assert_true(MathUtils.in_range(5, 0, 10), "范围内")
	assert_true(MathUtils.in_range(0, 0, 10), "下界包含")
	assert_true(MathUtils.in_range(10, 0, 10), "上界包含")
	assert_false(MathUtils.in_range(-1, 0, 10), "下界外")
	assert_false(MathUtils.in_range(11, 0, 10), "上界外")


func test_aabb_intersects_overlap() -> void:
	# 部分重叠
	assert_true(MathUtils.aabb_intersects(
		Vector2(0, 0), Vector2(10, 10),
		Vector2(5, 5), Vector2(15, 15)
	), "部分重叠应相交")

func test_aabb_intersects_contained() -> void:
	# 完全包含
	assert_true(MathUtils.aabb_intersects(
		Vector2(0, 0), Vector2(10, 10),
		Vector2(3, 3), Vector2(7, 7)
	), "包含应相交")

func test_aabb_intersects_disjoint_x() -> void:
	# 水平分开
	assert_false(MathUtils.aabb_intersects(
		Vector2(0, 0), Vector2(10, 10),
		Vector2(20, 0), Vector2(30, 10)
	), "水平分开应不相交")

func test_aabb_intersects_disjoint_y() -> void:
	# 垂直分开
	assert_false(MathUtils.aabb_intersects(
		Vector2(0, 0), Vector2(10, 10),
		Vector2(0, 20), Vector2(10, 30)
	), "垂直分开应不相交")

func test_aabb_intersects_touching_edge() -> void:
	# 边界接触(本实现按"包含端点"判定 → 相交)
	assert_true(MathUtils.aabb_intersects(
		Vector2(0, 0), Vector2(10, 10),
		Vector2(10, 0), Vector2(20, 10)
	), "边界接触按端点包含判定为相交")
