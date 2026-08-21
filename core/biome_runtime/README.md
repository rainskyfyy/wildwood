# M2.7 GDScript 引擎层 — 群系运行时 + 相机过渡

A 线(Godot 4.3)引擎层。在 `core/abstract/biome/`(Python 通用层)之上,
把群系定义、9 宫格加载、相机过渡接入 Godot 场景树。

## 文件结构

```
core/biome_runtime/
├── WildwoodBiomeConstants.gd       # 常量集中(32px 网格 / 0.5s 过渡 / -60% 内存)
├── WildwoodBiomeLoader.gd          # 9 宫格流式加载触发
├── WildwoodBiomeRuntime.gd         # 群系运行时(内存统计 + 群系切换广播)
├── WildwoodCameraTransition.gd     # 相机过渡状态机(验收 ③ 0.5s)
└── tests/
    ├── test_biome_loader.gd        # GUT 测试:加载 + 群系判定
    └── test_camera_transition.gd   # GUT 测试:状态机 + 0.5s 验收
```

## 核心常量(`WildwoodBiomeConstants.gd`)

| 常量 | 值 | 说明 |
|------|------|------|
| `GRID_SIZE_PX` | 32 | 基础网格 32 px(美术风格指南) |
| `CHUNK_PX` | 1024 | 1 chunk = 32×32 grid = 1024×1024 px |
| `MAP_RADIUS_CHUNKS` | 1 | 9 宫格半径 |
| `LOADED_CHUNKS` | 9 | 9 宫格块数 |
| `MIN_FULL_MAP_CHUNKS` | 25 | 全图基线 5×5 |
| `MEMORY_SAVING_TARGET_PCT` | 60.0 | 验收 ②:内存节省 ≥ 60% |
| `CAMERA_TRANSITION_TOTAL_MS` | 500 | 验收 ③:相机过渡 0.5s |
| `CAMERA_TRANSITION_HALF_MS` | 250 | OUT/IN 各 0.25s |

## 使用示例

### 1. 启动运行时

```gdscript
@onready var biome_runtime: WildwoodBiomeRuntime = $BiomeRuntime

func _ready() -> void:
    biome_runtime.biome_changed.connect(_on_biome_changed)
    biome_runtime.memory_stats_updated.connect(_on_memory_stats)

func _on_biome_changed(from_id, to_id, chunk) -> void:
    print("群系切换:", from_id, "→", to_id, "at", chunk)
    $CameraTransition.start_transition(from_id, to_id)
```

### 2. 玩家移动时更新

```gdscript
func _on_player_moved(new_chunk: Vector2i) -> void:
    biome_runtime.on_player_moved([new_chunk.x, new_chunk.y])
```

### 3. 相机过渡(0.5s)

```gdscript
$CameraTransition.alpha_changed.connect(_on_fade_alpha)
$CameraTransition.transition_finished.connect(_on_transition_done)

func _on_fade_alpha(alpha: float) -> void:
    $FadeRect.modulate.a = alpha

func _on_transition_done(from_id, to_id, total_ms) -> void:
    print("过渡完成:", total_ms, "ms")  # 应为 500
```

## 状态机

### Loader 状态机

```
IDLE → LOADING → READY
                    ↓ (玩家移动)
                  LOADING → READY
```

### Camera 状态机(验收 ③)

```
IDLE
  → TRANSITION_OUT (0.25s, alpha 1→0)
  → SWAP (0ms,瞬间切换内容)
  → TRANSITION_IN (0.25s, alpha 0→1)
  → IDLE
```

总时长 = 250 + 0 + 250 = 500ms(±20ms 容差)。

## 群系判定规则(`coord_to_biome`)

与 `core/abstract/biome/biome_map.py` 严格一致。规则(顺序敏感):

1. `|cx| ≤ 1 and |cy| ≤ 1` → forest
2. `cx == 2` → mines(必在 cy > 0 之前)
3. `cx == -2` → snow
4. `cx == 0 and |cy| == 2` → plains
5. `|cx| == 2 and |cy| == 2` → mines(>0) / snow(<0)
6. 距离 ≥ 3 按象限回退:cy>0→plains, cx>0→mines, cx<0→snow

## GUT 测试

```bash
# Godot 4.3 + GUT 9.x
cd <project-root>
godot --headless --quit -s addons/gut/gut_cmdln.gd \
    -gdir=res://core/biome_runtime/tests \
    -gprefix=test_ \
    -gexit
```

测试覆盖(2 文件):
- `test_biome_loader.gd`:19 个测试
  - 9 宫格邻居 / 跨 chunk / 跨群系 / 内存 -60% / 状态机 / coord_to_biome 规则
- `test_camera_transition.gd`:12 个测试
  - 状态机 / 总时长 0.5s / alpha 曲线 / 信号时序 / reset

## 与 M2.7 抽象层对应

| 抽象层 | 引擎层 |
|--------|--------|
| `palette.py` | `WildwoodBiomeConstants`(色板硬编码为常量引用) |
| `elements.py` | `BIOME_DEFS.density`(4 群系各自的密度) |
| `biomes.py` | `BIOME_DEFS`(4 群系 dict) |
| `biome_map.py::coord_to_biome` | `WildwoodBiomeRuntime.coord_to_biome` |
| `loader.py::BiomeLoader` | `WildwoodBiomeLoader` |
| — | `WildwoodCameraTransition`(GDScript 独有,Godot 视觉表现) |

## B 线对接

B 线(Unity 6 + .NET 8)按相同 API 在 `core/biome_runtime/Assets/Scripts/` 实现。
`BiomeMap.coord_to_biome` 规则与 `BiomeLoader` 行为必须严格一致(共享测试用例)。
