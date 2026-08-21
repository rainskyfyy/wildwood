# src/resources/ — 资源系统 (M2.10)

可采集资源实体、物品栏、采集状态机、合成匹配。纯前端,无框架依赖。

## 模块

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `resources.json` | 8 种 | 资源实体定义(名称/采集时间/掉落/群系/碰撞) |
| `items.json` | 11 种 | 物品定义(类别/堆叠上限/食用) |
| `recipes.json` | 5 配方 | 配方表(2x2 手持 / 3x3 科学机器) |
| `catalog.js` | — | 联合查询 + 引用完整性校验 |
| `inventory.js` | — | 6 快捷 + 15 背包 = 21 槽,add/remove/move/swap/serialize |
| `resource-entity.js` | — | 单个资源实体,per-entity Mulberry32 决定掉落 |
| `spawner.js` | — | 按群系 + density 散布(确定性) |
| `gather.js` | — | idle/gathering/just_done 状态机 |
| `crafting.js` | — | matchRecipe(精确匹配)+ craft |

## 数据流

```
                    [地图生成]
                         |
                         v
       spawnResources(world, {seed})
                         |
                         v
    entities: ResourceEntity[]
                         |
   [LMB click]  click(x,y)  findInRange -> start gather
                         |
                         v
   [update dt]  update(player, dt)
                         |
                         v
       on harvest complete -> entity.depleted = true
                         |
                         v
         inventory.add(itemId, count)  [容量 21 / 堆叠 20]
```

## 关键不变量

- **同 seed 同分布** — Perlin + Mulberry32 全链路确定性,可重放。
- **堆叠上限** — `items.json.stackMax`,默认 20,工具类 1(斧/镐/篝火)。
- **采集范围** — `Gather.DEFAULT_RANGE = 1.75` 世界单位(约 1.75 tile)。
- **move 语义** — 同种且 `from.count + to.count <= cap` 时合并;否则交换;**绝不产生 partial residual**(源槽残量会让拖拽 UI 错乱)。
- **合成匹配** — 精确位置(`gridEquals`),不旋转/不镜像。
- **生物群系** — `forest/plains/mines/snow` 与 M4 严格一致,资源按 `biomes[]` 散布。

## 测试

```bash
node tests/m210-node-smoke.mjs
# 57 passed, 0 failed
```

覆盖:catalog 校验、inventory CRUD/合并/交换、spawner 确定性、entity 掉落确定性、
gather 状态机(idle→gathering→just_done→idle)、crafting 匹配与执行。

## 持久化

- `localStorage['wildwood.m210.inventory.v1']` 存背包快照,刷新页面后恢复。
- 启动若快照为空,自动种入 starter pack:木头 ×8、草绳 ×4、石头 ×6、浆果 ×3。

## 与 M2.9 建造系统的边界

- M2.9 占用 crafting.grid —— **不冲突**:M2.9 走 `station=workbench`,
  M2.10 默认 `station=hand` / `station=science`,不同 station 不共享 grid。
- M2.9 放下的 placeable entity(篝火/斧/镐)在本系统中作为可拾取 / 可装备物品。
- 资源实体的 `blockMovement` 字段为 M2.9 留接口,本批次默认 false(穿透),M2.11 接入。
