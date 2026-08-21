extends RefCounted
class_name WildwoodBiomeConstants
## M2.7 引擎层常量集中 — 美术风格指南 §网格规范 + 任务书硬约束
##
## 设计原则:
## - 32 px 基础网格(美术风格指南 §网格规范)
## - 1 chunk = 32 grid × 32 grid = 1024×1024 px
## - 9 宫格 = 1 中心 + 8 邻居,加载半径 1 chunk
## - 相机过渡总时长 500ms(0.5s) — 验收 ③
## - 内存节省目标 ≥ 60%(9 chunks / 25 chunks = 36%)
##
## 本文件只放常量,不放逻辑。所有值与 core/abstract/biome/*.py 同步。

# === 网格 ===
const GRID_SIZE_PX: int = 32              ## 基础网格 32 px(美术风格指南)
const CHUNK_GRID: int = 32                ## 单 chunk 网格数
const CHUNK_PX: int = 1024                ## 单 chunk 像素 = 32 × 32

# === 加载 ===
const MAP_RADIUS_CHUNKS: int = 1          ## 9 宫格半径
const LOADED_CHUNKS: int = 9              ## 9 宫格块数
const MIN_FULL_MAP_CHUNKS: int = 25       ## 全图基线 5×5
const MEMORY_SAVING_TARGET_PCT: float = 60.0  ## 验收 ②:内存节省 ≥ 60%
const CHUNK_SIZE_BYTES: int = 1048576     ## 1 MB(1024² bytes)

# === 相机过渡(验收 ③) ===
const CAMERA_TRANSITION_TOTAL_MS: int = 500  ## 总过渡 0.5s
const CAMERA_TRANSITION_HALF_MS: int = 250   ## 出/入 各 0.25s
const CAMERA_TRANSITION_TOLERANCE_MS: int = 20  ## ±20ms 容差(单步)
const CAMERA_TRANSITION_TOTAL_TOLERANCE_MS: int = 20  ## 总时长容差

# === 状态机 ===
enum LoaderState { IDLE, LOADING, READY }
enum CameraTransitionState { IDLE, TRANSITION_OUT, SWAP, TRANSITION_IN }

# === 群系 ID(与抽象层 biomes.py BIOMES.keys 同步) ===
const BIOME_FOREST: StringName = &"forest"
const BIOME_PLAINS: StringName = &"plains"
const BIOME_MINES:  StringName = &"mines"
const BIOME_SNOW:   StringName = &"snow"

# === 4 大群系 ID 列表(给 UI 遍历用) ===
const ALL_BIOMES: Array[StringName] = [
	BIOME_FOREST,
	BIOME_PLAINS,
	BIOME_MINES,
	BIOME_SNOW,
]


## 计算 9 宫格邻居(中心 + 8 邻居)坐标
## 与 Python 版 core.abstract.biome.biome_map.get_neighbors_3x3 行为一致
static func neighbors_3x3(cx: int, cy: int) -> Array:
	var out: Array = []
	for dx in range(-1, 2):
		for dy in range(-1, 2):
			out.append([cx + dx, cy + dy])
	return out


## 默认 9 宫格中心(0, 0) + 8 邻居(共 9 个,全部为 (x, y) Array)
static func default_loaded_chunks() -> Array:
	return neighbors_3x3(0, 0)


## 内存节省百分比 = (1 - loaded/full_map) × 100
static func memory_saving_pct(loaded: int, full_map: int) -> float:
	if full_map <= 0:
		push_error("WildwoodBiomeConstants: full_map must be > 0")
		return 0.0
	if loaded > full_map:
		push_error("WildwoodBiomeConstants: loaded > full_map")
		return 0.0
	return (1.0 - float(loaded) / float(full_map)) * 100.0
