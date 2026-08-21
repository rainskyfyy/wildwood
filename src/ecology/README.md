# src/ecology/ — v0.5.1 生态链模块

## 概要

`src/ecology/` 是 Wildwood v0.5.1 的种群动力学与食物链模块。每个群系独立
维护一组 Population（lotka-volterra 离散时间近似），并由 EcologyManager
统一调度。EcologyMonster 在 M2.14 Monster 基类之上扩展了 FLEE / GRAZE /
HUNT 三个状态，使捕食者–猎物循环在地图上肉眼可见。

## 模块

- `population.js` — `Population` 类。离散 logistic 增长 + 自然死亡 + 捕食
  损失。`tick(predationLoss)` 接受被其它群系捕食者吃掉的个体数，从 N
  中扣减。所有 Population 按 (biome, species) 联合键索引。
- `food-chain.js` — `FoodChain` 类。根据 `ecology.json::foodChain` 和
  `predationEfficiency` 计算每个捕食者在每个群系的预期捕杀量。同群系内
  的捕食者不跨群系捕食（v0.5.1 简化模型）。
- `ecology.js` — `EcologyManager` 总线。`initialize()` 加载 `ecology.json`
  + `ecology-monsters.json`；`update(dt, player)` 推动 Population 2Hz
  tick + 每帧 AI；`_syncEntities()` 每 4 个 tick 同步实体数和种群桶数
  匹配。8-tile chunk grid 加速 `findNearest(species, maxDist, fromEntity)`。

## 数据

- `src/data/ecology.json` — 6 群系 × 6 物种的 (carryingCapacity,
  birthRate, deathRate) 表 + 食物链邻接表 + 捕食效率矩阵。
- `src/data/ecology-monsters.json` — 6 个生态怪物的 M2.14 schema 扩展
  （trophic, diet, threats）。

## AI 扩展（src/monster/ecology-monster.js）

`EcologyMonster` 继承 `Monster`，在 `_think()` 中追加：

1. 威胁检测：若 `findNearest` 命中 `threats` 中任一物种 → FLEE
2. 猎物检测：若命中 `diet` 中任一物种 → HUNT（用 A* 寻路追击）
3. 回退：调用 `super._think()` 的 IDLE / WANDER / CHASE 逻辑

兔/狐/狼各有一套生态参数：

| 物种 | trophic | diet | threats | detectRange | flee/hunt range |
| --- | --- | --- | --- | --- | --- |
| rabbit | grazer | (vegetation) | fox, wolf | 5 | 4 |
| fox | predator | rabbit | wolf | 6 | 5 |
| wolf | apex | fox, rabbit | (none) | 7 | 6 |
| butterfly | passive | (nectar) | (none) | 3 | 0 |
| cow | neutral | (grass) | (none) | 3 | 0 |
| boar | neutral | (roots) | wolf | 4 | 3 |

## 群系参数（节选）

| 群系 | rabbit K | fox K | wolf K | butterfly K |
| --- | --- | --- | --- | --- |
| forest | 12 | 3 | 1 | 8 |
| plains | 18 | 4 | 2 | 4 |
| desert | 2 | 0 | 0 | 1 |
| marsh | 6 | 1 | 0 | 3 |
| snow | 4 | 2 | 2 | 0 |
| volcano | 0 | 0 | 0 | 0 |

## 测试

```
node tests/v051-ecology-smoke.mjs
# 31/31 passed
```

覆盖 6 大类：

1. 6 群系径向布局（forest 中心，plains 环，4 极端群系于四角）
2. Population 模型（clamp、logistic、捕食减员、灭绝桶）
3. 食物链（pred 邻接、捕食效率、cascade）
4. EcologyManager 集成（初始化、实体生成、长时稳定性）
5. EcologyMonster 状态机（FLEE / HUNT / IDLE 回退）

## 已知限制

- v0.5.1 不跨群系捕食（捕食者只吃同群系的猎物）
- 蝴蝶 / 牛 / 野猪暂无完整 AI 状态机（M2.14 base 仅 IDLE / WANDER）
- 玩家从 forest 出生，但出生点周边不一定有兔群（取决于 spawn 布局）
