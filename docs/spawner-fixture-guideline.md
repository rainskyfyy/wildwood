# Wildwood 资源生成代码规范(Spawner Fixture Guideline)

> v0.6.0c 起强制生效。
> 触发原因:M2.10c 给 `resources.json` 新增 5 个资源后,spawner 内层循环多 5 次 `rng()` 调用,导致既有测试 `gent.find(e => e.id === 'tree' && e.distTo(0,0) < 30)` 拿到的不是"最近的树",而是"spawn 数组里第一个且在范围内的树"。测试假阳性 fail,而且完全静默 — 表面看代码没事,只是断言条件变了。

本规范从根上消灭这类问题:**禁止在测试里依赖 spawner 返回数组的下标顺序**。

---

## 1. 核心契约

| 概念 | 承诺 | 不承诺 |
|------|------|--------|
| spawner 返回的实体**集合** | 同一 `seed` + 同一 `world` + 同一 `catalog` → 集合稳定 | — |
| spawner 返回的实体**顺序** | — | 下标 `out[0]`、`out[N]` 的语义跨 catalog 改动**不保证** |

**直觉解释**:spawner 内部按 `(y, x)` 遍历 tile,再按 `catalog` 的内部顺序遍历该 biome 的资源,每条命中后用 `rng()` 决定是否 spawn。catalog 增删资源会让 tile 内的 `rng()` 调用次数变化,从而让所有"在这个 tile 之后才 spawn"的实体换到不同位置。**这不是 bug,是设计** — spawner 不承诺顺序稳定性,因为它不想被测试绑架。

---

## 2. 强制规则(从 v0.6.0c 起,PR review 必检)

### ❌ 反模式:绝对禁止

1. **用 `out[0]` / `out[N]` 拿"第 N 个某 id 的实体"** — 顺序不稳定,删一个资源就崩。
   ```js
   // ❌ 错
   const firstTree = ents[0];
   const thirdRock = rocks[2];
   ```
2. **用 `.find()` + 距离范围,期望拿到"最近的"** — `.find` 拿到的是 spawn 顺序第一个命中,不是距离最近。
   ```js
   // ❌ 错(M2.10c 崩过的就是这个)
   const target = ents.find(e => e.id === 'tree' && e.distTo(0, 0) < 30);
   ```
3. **用 `findIndex` 期望拿"第 N 个某 id"** — 同上。
4. **用 `slice(0, 5)` 期望"前 5 个 tree"** — 顺序依赖 catalog 状态。
5. **测试里写"我手动用 rng() 重放,期望某 tile 出某资源"** — 内层 rng 次数受 catalog 控制,replay 算法本身就是脆弱的。

### ✅ 推荐模式:走 spawner.js 暴露的查询工具

`src/resources/spawner.js` v0.6.0c 起导出三个纯函数:

| 函数 | 用途 | 时间复杂度 |
|------|------|-----------|
| `findNearest(ents, x, y, filter?)` | 找距离某点最近的一个(可按 id 过滤) | O(n) |
| `findInRange(ents, x, y, maxRadius, filter?)` | 拿范围内全部,按距离升序 | O(n log n) |
| `groupById(ents)` | 按 id 分组,返回 `{id: ents[]}` | O(n) |

所有这三个函数**只看坐标和 id**,从不读 `out` 数组的下标。所以无论 catalog 增删、内部遍历顺序怎么变,断言条件都稳定。

**正确写法**:
```js
// ✅ 拿最近的树
const target = findNearest(ents, player.x, player.y, 'tree');

// ✅ 拿半径 3 内所有岩石,按距离升序
const nearby = findInRange(ents, px, py, 3, 'rock');

// ✅ 按 id 分组,断言某 id 至少 N 个
const grouped = groupById(ents);
assert(grouped.rock.length >= 5);
```

---

## 3. 抗漂移原则(写新 spawner 时的 5 条铁律)

1. **catalog 内部顺序不应影响断言** — 别假设"tree 在 catalog 第一个",用 id 过滤。
2. **测试用固定 seed,但代码不依赖 spawn 顺序** — seed 让输出"可重放",但可重放 ≠ 顺序稳定。
3. **加新资源时,自动跑一遍 5/10/20/50 资源场景测试**(见 `tests/v060c-spawner-fixture.mjs`)。
4. **删一个资源,跑全套测试** — 任何红的测试都说明它依赖了顺序。
5. **禁止在测试里"重放" rng() 序列** — 正确做法是断言"集合性质"(最近、范围内、至少 N 个),不是"序列性质"。

---

## 4. 正反例完整对比

### 场景:玩家在 (10, 10),找最近的树

**反例(❌)— 看似正确,实际拿到的不是最近的**:
```js
const tree = ents.find(e => e.id === 'tree' && e.distTo(10, 10) < 5);
assert(tree !== undefined);
```
问题:`.find` 命中的是 spawn 数组里第一个满足条件的 tree,不是距离最近的。catalog 改一个资源,这个 tree 也许还在 5 内,但顺序变了,test 拿到的可能是另一个 tree,断言照样过 — **但断言实际上没在测"最近"**。

**正例(✅)**:
```js
const tree = findNearest(ents, 10, 10, 'tree');
assert(tree !== null);
assert(tree.distTo(10, 10) < 5);
```

### 场景:断言 forest biome 至少 5 棵树

**反例(❌)**:
```js
const trees = ents.filter(e => e.id === 'tree');
assert(trees.length >= 5);   // 这一行本身 OK
const oldest = trees[0];     // ❌ 用下标
```

**正例(✅)**:
```js
const grouped = groupById(ents);
assert((grouped.tree || []).length >= 5);
```

### 场景:删 1 个资源后,既有测试还应该过

如果当前有 `rock` 和 `boulder`,你删了 `boulder`,加了 `tin_ore`:
- 旧测试 `ents.find(e => e.id === 'boulder')` 必然 fail(`boulder` 已不在)。
- 旧测试 `findNearest(ents, x, y, 'rock')` **依然过**(函数只关心 `rock` 实体,其它 catalog 变化无影响)。

这就是"抗漂移"的价值 — 改一个资源,不会引爆半个测试套件。

---

## 5. 测试侧补充约定

- **fixture seed 必须固定**(推荐 `seed: 20260822` 起一个项目级常量)。
- **不要在测试里直接读 catalog** — 用 `allResources()` / `getResource(id)` 等查询 API,这样 catalog 增删时,只要你断言的是"id 在场",而不是"id 排序第 N",就 OK。
- **抗漂移验证**:每次 catalog 改动,在 CI 里跑 `node tests/v060c-spawner-fixture.mjs`;如果挂了,先怀疑你的测试,再怀疑 spawner。

---

## 6. 历史教训

- **M2.10c 踩坑**:catalog 加 5 资源 → spawner 内层 `rng()` 多调用 5 次 → 测试 `ents.find` 拿到错误 tree → 假阳性 fail。
- **修复**:M2.10c 当场用 `findNearest` 重写测试;M2.10d 顺势把所有 `.find` 替换为 sort-by-dist 或 first-match-in-range。
- **预防**:本规范 + `tests/v060c-spawner-fixture.mjs` 5 场景回归,从此 catalog 改一改不会引爆测试。

> **一句话总结**:永远问"我的测试是不是在依赖 spawn 顺序?"如果是,改成 `findNearest` / `findInRange` / `groupById`。三行代码换一份安心。
