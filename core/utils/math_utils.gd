extends RefCounted
class_name MathUtils

## 通用数学工具函数集合
##
## 提供游戏代码常用的纯函数,不依赖任何节点或场景,
## 全部为静态方法,便于单元测试覆盖。
##
## 设计原则:
## - 纯函数:无副作用,输入相同则输出相同
## - 零依赖:不引用 Node/SceneTree/资源
## - 数值稳定:边界用 float 精度处理避免 NaN/Inf

const EPSILON := 0.0001


## 带 epsilon 容忍的浮点相等比较
static func approx_eq(a: float, b: float, epsilon: float = EPSILON) -> bool:
	return absf(a - b) <= epsilon


## 数值钳制(等价于 clamp 的 GDScript 内置,但显式封装便于单测)
static func clampi(value: int, min_v: int, max_v: int) -> int:
	if value < min_v:
		return min_v
	if value > max_v:
		return max_v
	return value


## 平滑插值(线性,基础版本;M2.x 可替换为 smoothstep)
static func lerp_f(a: float, b: float, t: float) -> float:
	return a + (b - a) * t


## 二维向量距离平方(避免开方,常用于碰撞检测预筛)
static func distance_squared_2d(a: Vector2, b: Vector2) -> float:
	var dx := a.x - b.x
	var dy := a.y - b.y
	return dx * dx + dy * dy


## 网格对齐(像素艺术基础:把坐标吸附到 32px 网格)
static func snap_to_grid(value: Vector2, grid_size: int) -> Vector2:
	if grid_size <= 0:
		push_error("snap_to_grid: grid_size must be > 0, got %d" % grid_size)
		return value
	return Vector2(
		snappedf(value.x, float(grid_size)),
		snappedf(value.y, float(grid_size))
	)


## 数字是否在区间内(含端点)
static func in_range(value: int, min_v: int, max_v: int) -> bool:
	return value >= min_v and value <= max_v


## 计算四点矩形 AABB 是否相交(常用于碰撞箱)
static func aabb_intersects(a_min: Vector2, a_max: Vector2, b_min: Vector2, b_max: Vector2) -> bool:
	if a_max.x < b_min.x or a_min.x > b_max.x:
		return false
	if a_max.y < b_min.y or a_min.y > b_max.y:
		return false
	return true
