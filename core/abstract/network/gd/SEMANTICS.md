# M3.1 SEMANTICS — GDScript ↔ Python 1:1 镜像对照表

**目的**:保证 M3.1 客户端预测+服务端校正 在 GDScript 端(客户端)与 Python 端(集成测试/回放工具)的语义完全一致。
任何一端逻辑改动 = 破坏协议,必须同步另一端 + 改本文件。

## 文件映射

| 主题       | Python(权威)                                                            | GDScript(镜像)                                                  |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| 常量       | `core/abstract/network/python3/wildwood/constants.py`                   | `core/abstract/network/gd/wildwood_constants.gd`                |
| Predictor  | `core/abstract/network/python3/wildwood/prediction.py`                  | `core/abstract/network/gd/wildwood_predictor.gd`                |
| Interpolator | `core/abstract/network/python3/wildwood/interpolation.py`              | `core/abstract/network/gd/wildwood_interpolator.gd`             |
| 测试       | `core/abstract/network/python3/wildwood/tests/test_m31*.py`             | `core/abstract/network/gd/tests/test_wildwood_m31*.gd`(后续)    |

## 常量对齐

| 常量                   | 值          | 同步状态 |
| ---------------------- | ----------- | -------- |
| RECONCILE_THRESHOLD_PX | 32.0 (px)   | ✓        |
| INTERP_DURATION_MS     | 100 (ms)    | ✓        |
| HIDE_DURATION_MS       | 100 (ms)    | ✓        |
| DEFAULT_SPEED_MPS      | 4.0 (m/s)   | ✓        |
| TILE_SIZE_PX           | 32          | ✓        |
| INPUT_DT_S             | 1/60 (s)    | ✓        |
| SERVER_TICK_HZ         | 20          | ✓        |
| SERVER_TICK_MS         | 50          | ✓        |
| MAX_INPUT_RATE_HZ      | 60          | ✓        |
| MOVE_BURST_MULTIPLIER  | 1.5         | ✓        |
| WORLD_HALF_BOUND_M     | 1024.0 (m)  | ✓        |

服务端 Go 端(`core/abstract/network/go/room/auth_state.go`)也镜像同一组常量:
  - AuthStateTilePx=32 / AuthStateInputDtSec=1/60 / AuthStateMaxInputHz=60 / AuthStateWorldHalfBound=1024
  - **单一权威**:Python constants.py。任何冲突以 Python 为准。

## Predictor 行为对齐

### `predict(dx, dy) → InputRecord`

| 步骤               | Python (prediction.py)               | GDScript (wildwood_predictor.gd)                |
| ------------------ | ------------------------------------- | ----------------------------------------------- |
| 1. 分配 seq        | `seq = self._next_seq; self._next_seq += 1` | `var seq: int = _next_seq; _next_seq += 1`     |
| 2. 归一化          | `_normalize(dx, dy) → (nx, ny)`       | `_normalize(dx, dy) → Vector2(nx, ny)`         |
| 3. 应用步长        | `pos += (nx, ny) * speed * tile * dt` | `pos += (nx, ny) * speed * tile * dt`          |
| 4. 创建 Input      | `Input(seq, nx, ny, time.time()*1000)`| `InputRecord(seq, nx, ny, Time.get_ticks_msec())` |
| 5. 追加到 pending  | `self.pending.append(inp)`            | `pending.append(inp)`                            |

### `_normalize` 归一化

| 输入             | Python                          | GDScript                            |
| ---------------- | ------------------------------- | ----------------------------------- |
| (0, 0)           | (0.0, 0.0)                      | Vector2(0.0, 0.0)                   |
| (0.5, 0)         | (0.5, 0.0)                      | Vector2(0.5, 0.0)                   |
| (0.7, 0.7)       | (0.5/0.99, 0.5/0.99) ≈ (0.707,0.707) | Vector2(0.707, 0.707)            |
| (1, 1)           | (1/√2, 1/√2) ≈ (0.707, 0.707)   | Vector2(0.707, 0.707)               |

**注意**:Python 用 `math.hypot` 算 length,GDScript 用 `sqrt(dx*dx + dy*dy)`。两者数学等价(无 overflow 风险时,值差 < 1e-9)。

### `reconcile(auth_pos, acked_seqs) → Correction | NoCorrection`

| 步骤                    | Python                                       | GDScript                                                |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------- |
| 1. 转 acked 为 set      | `acked: Set[int] = set(acked_seqs)`         | `acked: Dictionary = {}; for s in acked_seqs: acked[s] = true` |
| 2. 记录校正起点         | `self._current_pos_before_reconcile = self._current_pos` | `_current_pos_before_reconcile_x/y = _current_pos_x/y` |
| 3. 过滤并排序 remaining | `sorted([pi for pi in pending if pi.seq not in acked], key=seq)` | `remaining.sort_custom(compare seq)`                |
| 4. 重新应用             | `for pi in remaining: re_sim_pos += normalize(pi) * step` | 同 GDScript 镜像                                          |
| 5. 计算偏差             | `delta = re_sim_pos - self._current_pos_before_reconcile; delta.length()` | `delta_px = sqrt(dx² + dy²)`                         |
| 6. 切 current 到 re_sim | `self._current_pos = re_sim_pos`            | `_current_pos_x/y = re_sim_x/y`                          |
| 7. 决策                 | `if delta_px > 32: return Correction(...) else: return NoCorrection()` | 同左                                                    |

## Interpolator 行为对齐

### `Interpolator(start, target, start_ms, duration_ms=100, hide_duration_ms=100)`

| 字段                | Python                                | GDScript                            |
| ------------------- | ------------------------------------- | ----------------------------------- |
| start               | `tuple (x, y)`                        | `Vector2 start_x/y`                  |
| target              | `tuple (x, y)`                        | `Vector2 target_x/y`                 |
| duration_ms         | 100                                   | 100                                 |
| hide_duration_ms    | 100                                   | 100                                 |
| start_ms            | 0                                     | 0                                   |

### `display_pos_at(t_ms) → Vector2`

| t_ms 与 start_ms 关系 | Python                       | GDScript                       |
| --------------------- | ---------------------------- | ------------------------------ |
| t < start             | (start.x, start.y)           | Vector2(start_x, start_y)     |
| start ≤ t ≤ end       | start + (target-start) * (t-start)/duration | start + (target-start) * progress |
| t > end               | (target.x, target.y)         | Vector2(target_x, target_y)   |

### `is_hidden_at(t_ms) → bool`

`hide_end = start_ms + min(hide_duration_ms, duration_ms)`
`return t_ms < hide_end`

### `is_complete(t_ms) → bool`

`return t_ms >= start_ms + duration_ms`

### `progress_at(t_ms) → float`

`return clamp((t_ms - start_ms) / duration_ms, 0.0, 1.0)`

## 同步规则

1. **任何数值改动 = 双端同步**:Python 改 → GDScript 改 → Go 改(若影响 server)
2. **不变量**:re_sim_pos - current_pos_before_reconcile 的距离永远 = delta_px
3. **回归保护**:Python pytest 41/41 + Go 81/81 必须全过;GDScript 镜像加 GUT 测试时也必须全过
4. **版本号**:本协议版本 v0.6.0(随 M3.1 引入);后续任何不兼容改动必须 bump 协议

## 已知差异

- **时间源**:Python 用 `time.time() * 1000`(wall clock),GDScript 用 `Time.get_ticks_msec()`(自启动单调时钟)。
  - 集成测试不依赖绝对时间(只用 seq),差异无影响
  - 真实集成时由上层传入 `now_ms`(统一时钟)
- **字典 vs Set**:Python set / GDScript Dictionary 实现都是 O(1) 查找,语义对齐
- **浮点**:Python double / GDScript double 都是 IEEE 754 64-bit,差值 < 1e-12
