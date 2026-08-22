# PoC-5: 客户端 patch 原子切换

**目标**:验证 patch 加载过程中切换,不会出现半棵树半灌木的渲染态。

**对应 RFC 章节**:§5.1-§5.3 资源元数据层(整章)+ §6 PoC-5

## 跑法

```bash
cd docs/rfc-v0.2/pocs/poc-5-atomic-swap
node index.mjs                # 跑 100 次刷新
node index.mjs --trials=10    # 跑 10 次
```

不依赖外部包,纯 Node.js 18+。

## 通过判据

- 100 次刷新,无混合态
- 每次刷新要么走老资源(老 manifest),要么走新资源(新 manifest),不存在"老+新"混搭
- atomicSwap 是原子的(回调观测不到中间态)

## 回滚方案

增加「切换临界区」,patch 完成前禁止重渲染。

## 关键设计

- mock 一个 `ResourceMap`,30 个 tile 资源,分 3 批 patch
- 模拟客户端在 30% / 70% / 99% patch 完成时强制 `atomicSwap()` 或强制 abort
- 关键观测点:`atomicSwap` 调用期间,任何 RenderTile 读到的 manifest 引用要么完全老、要么完全新

## 与 RFC v0.2 接口对应

- `diffManifest`(`local` + `remote`)→ `PatchPlan`
- `atomicSwap`(`current` + `next` + ctx)→ `AtomicSwapResult`
- `fetchPatch`(`plan` + ctx)→ Promise
- §5.3 临界区:`isInCriticalSection/enterCritical/exitCritical` 三件套
