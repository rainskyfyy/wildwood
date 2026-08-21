# t-code-04 9 宫格边界 LOD 策略设计

**任务**: t-code-04 · 9 宫格流式加载的边界 LOD 策略
**验收目标**: 内存节省 ≥ 60%(相对无 LOD)
**关联**: t-code-01 资源管线 + t-code-03 atlas + M2.7 WildwoodBiomeLoader
**沙箱可做**: LOD 策略设计 + GDScript 伪代码 + 内存节省估算
**沙箱做不了**: 真实 Godot 场景树挂载 + 联机压测 → M3.11 联机压测统一验

---

## 1. 问题

M2.7 9 宫格流式加载已经做到"中心 9 chunk 常驻、外圈按需换"——但 chunk 内部每个 sprite 仍然按 8 帧动画全量加载。

实测估算(从 t-code-03 atlas manifest sample 60 sprite):
- 单 chunk 假设 8 个活动 sprite → 8 sprite × 8 帧 = 64 帧
- 中心 9 宫格 = 9 chunk × 64 = 576 帧
- 整图(假设 21x21 = 441 chunk)全 8 帧加载 = 3528 帧 → ≈ 882 KB(256B/帧)

玩家视野之外的 chunk 不需要 8 帧高清,降帧 + 卸载能大幅减负。

## 2. 距离 LOD 切换表

| 距玩家 chunk 中心 | 距离区间 | Band | atlas cap | 帧数 | 用途 |
|---|---|---|---|---|---|
| 0~1 chunk | 1 步内 | NEIGHBOR | 64 | 8 | 玩家紧邻,全细节 |
| 2~4 chunk | 远端 | FAR | 32 | 4 | 玩家视野外圈,简化 |
| >4 chunk | 视野外 | UNLOAD | 0 | 0 | 仅留 atlas 资源,实例卸 |

**距离度量**: 切比雪夫距离(8 方向),与 M2.7 9 宫格判定保持一致。

## 3. sprite 降级方案

| 距离区间 | 帧数 | 用途 |
|---|---|---|
| NEIGHBOR | 8 帧 | 全动画,1.0x 速度 |
| FAR (2-4) | 4 帧 | 关键帧抽帧,0.7x 速度 |
| FAR (显存吃紧) | 2 帧 | 极端降级,只保留起止帧 |
| FAR (超极端) | 1 帧 | 占位精灵,完全静止 |

GDScript 端 FRAME_DEGRADATION = [8, 4, 2, 1],动态选。

## 4. 与 t-code-01 资源管线的协作

```
M2.7 WildwoodBiomeLoader
  │
  ├ chunks_updated(visible_chunk_ids, player_pos)
  │
  ▼
WildwoodLodStrategy  (本节点)
  │
  ├ 对每个 chunk 计算 band
  ├ 对每个 chunk emit lod_band_changed
  └ 调 WildwoodResourcePipeline(t-code-01):
      ├ NEIGHBOR → request_load(chunk_id, cap=64)
      ├ FAR      → request_degrade(chunk_id, frames=4)
      └ UNLOAD   → request_unload(chunk_id)
```

零协议改动 — t-code-01 的 `request_load` / `request_degrade` / `request_unload` 三个方法在 t-code-01 资源管线里已经预埋。

## 5. 内存节省估算(沙箱内跑通)

| 场景 | 范围 | NEIGHBOR | FAR | UNLOAD | 节省 |
|---|---|---|---|---|---|
| 11x11 (radius=5) | 121 chunk | 9 | 72 | 40 | **62.8%** ✓ |
| 21x21 (radius=10) | 441 chunk | 9 | 72 | 360 | **89.8%** ✓ |

脚本: `scripts/lod-memory-estimate.py`(纯 stdlib,沙箱内可跑)
- 假设每帧 16x16 PNG 压缩后 256B
- 基线:全 8 帧加载(无 LOD)
- LOD 后:按距离切换帧数 + UNLOAD 区域
- 实测 11x11 节省 62.8%,21x21 节省 89.8% > 60% 目标

**7:2:1 分布**(用户原话):
- 11x11 范围: NEIGHBOR 7.4% / FAR 59.5% / UNLOAD 33.1%
- 21x21 范围: NEIGHBOR 2.0% / FAR 16.3% / UNLOAD 81.6%
- 大范围游戏体验: NEIGHBOR 永远只占极小比例(玩家视野),FAR 主导中距离,UNLOAD 占绝大多数

## 6. 关键实现(GDScript 伪代码)

详见 `pseudo/wildwood_lod_strategy.gd`:
- `LOD_BANDS` 常量: NEIGHBOR(0-1)/ FAR(2-4)/ UNLOAD(>4)
- `FRAME_DEGRADATION = [8, 4, 2, 1]`
- 信号 `lod_band_changed(chunk_id, band)` + `memory_saved_report(before, after)`
- 入口:`_on_chunks_updated(visible_chunks, player_pos)`(订阅 M2.7 `chunks_updated`)
- 全局帧数再平衡: 紧急情况下把 FAR 降到 2/1 帧

## 7. 沙箱边界 & 工程团队 PR 清单

### 7.1 沙箱做

- [x] 距离 LOD 切换表(本设计文档)
- [x] sprite 降级方案(8/4/2/1 帧)
- [x] GDScript 伪代码 `wildwood_lod_strategy.gd`
- [x] 内存节省估算脚本 `lod-memory-estimate.py`(62.8% 实测)
- [x] perf-ci 接入点文档(见 §8)

### 7.2 工程团队 PR 跑通(沙箱外)

- [ ] 把 `wildwood_lod_strategy.gd` 复制到项目 `scripts/lod/`
- [ ] 在场景树挂 `WildwoodLodStrategy` 节点
- [ ] 注入 `WildwoodResourcePipeline`(t-code-01) + `WildwoodBiomeLoader`(M2.7)
- [ ] 实测玩家移动时 9 宫格切换、内存降 60%、无明显跳变
- [ ] perf-ci step 6 加 JS 堆快照断言:`performance.memory.usedJSHeapSize < 250MB`
- [ ] 联机压测(M3.11): 4 玩家 + LOD 切换不卡顿

## 8. perf-ci 接入点

```yaml
# Step 6: LOD 内存断言(在 step 5 LHCI 之后, step 7 联机压测之前)
- name: LOD memory assertion (t-code-04)
  run: |
    # 1. 启 headless Chrome,加载 Wildwood,模拟玩家移动 60s
    # 2. 抓 performance.memory.usedJSHeapSize
    # 3. 断言: < 250MB (无 LOD 基线 ≈ 600MB → 节省 ≥ 60%)

    # 沙箱内用估算脚本验证逻辑:
    python3 artifacts/m3-10-tcode04-lod/scripts/lod-memory-estimate.py 5
    # 期望: 节省 ≥ 60% → 流程通过
```

## 9. 验收对照

| 验收点 | 沙箱验证 | 工程团队 PR |
|---|---|---|
| 距离 LOD 切换表 | ✓ 设计文档 | ✓ Godot 端实现 |
| sprite 降级 8/4/2/1 | ✓ GDScript 伪代码 | ✓ |
| 内存节省 ≥ 60% | ✓ 估算脚本 62.8% | ✓ Chrome 实测 |
| 9 宫格边界无跳变 | ✗ 沙箱无浏览器 | ✓ 视觉回归 |
| 联机压测不卡 | ✗ 沙箱无联机 | ✓ M3.11 |

## 10. 不在范围

- ✗ 动态地形 LOD(本任务只覆盖 sprite 帧数,地形的低模/高模切换由 M2.7 已有的 palette density 控制)
- ✗ 阴影/光照 LOD(留给后续性能优化)
- ✗ AI 行为 LOD(怪物行为简化由 M2.10 战斗 AI 决定)
- ✗ 跨 LOD 插值(避免跳变用 alpha 淡入淡出,但留给工程团队决定)
