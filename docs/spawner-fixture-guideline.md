# Wildwood 资源生成代码规范(Spawner Fixture Guideline)

> v0.6.0c 起强制生效。
> 触发原因:M2.10c 给 `resources.json` 新增 5 个资源后,spawner 内层循环多 5 次 `rng()` 调用,导致既有测试 `gent.find(e => e.id === 'tree' && e.distTo(0,0) < 30)` 拿到的不是"最近的树",而是"spawn 数组里第一个且在范围内的树"。测试假阳性 fail,而且完全静默 — 表面看代码没事,只是断言条件变了。

> **v0.7.0c 更新**:本规范升级为自动化 enforce。新增 `eslint-plugin-wildwood/no-find-then-index` 规则 + `eslint.config.js`,违规会在 `npm run lint` 时直接 fail;PR template 加 fixture 检查行作为人工兜底。

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
6. **(v0.7.0c 新增)`.find(pred)[N]` 直接链式下标** — 已被
   `wildwood/no-find-then-index` 规则自动拦截;规则同时覆盖
   `const x = .find(pred); x[N]` 模式。

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
- **(v0.7.0c 新增)CI 跑 `npm run lint`**,会自动拦截
  `wildwood/no-find-then-index` 规则的命中模式;跑
  `npm run lint:rule-test` 验证规则本身仍然工作。

---

## 6. 历史教训

- **M2.10c 踩坑**:catalog 加 5 资源 → spawner 内层 `rng()` 多调用 5 次 → 测试 `ents.find` 拿到错误 tree → 假阳性 fail。
- **修复**:M2.10c 当场用 `findNearest` 重写测试;M2.10d 顺势把所有 `.find` 替换为 sort-by-dist 或 first-match-in-range。
- **预防**:v0.6.0c 的 spec + `tests/v060c-spawner-fixture.mjs` 5 场景回归,从此 catalog 改一改不会引爆测试。
- **v0.7.0c 升级**:spec 不再只是文字,被 `wildwood/no-find-then-index` 规则
  enforce,PR template 第 2 节加了 fixture 检查行,新增
  `tests/v070c-eslint-enforce.mjs` 锁住规则自身不回归。

> **一句话总结**:永远问"我的测试是不是在依赖 spawn 顺序?"如果是,改成 `findNearest` / `findInRange` / `groupById`。三行代码换一份安心。

---

## 7. v0.7.0c 新增案例(从生产踩坑补充)

### 7.1 案例 A:biome 切换 — 比 catalog 扩容更隐蔽的杀手

**场景**:测试覆盖"forest biome 与 desert biome 都至少 10 棵树"。两个 biome 各自走
`src/resources/biomes/forest.js` / `desert.js` 的 `populate()` 函数,代码结构一样,
但 **biome-specific 的 `rng()` 调用次数不同** — forest 调 4 次(desert 会调 6 次,
因为多了 2 个 desert-only 资源 `cactus`、`scorpion` 的 spawn 判定)。

```js
// ❌ 错:在 forest 上 OK,切到 desert 必崩
function countTrees(ents) {
  return ents.find(e => e.id === 'tree') ? 1 : 0;  // 实际可能是
                                                     // `cactus` 命中
}
```

修这个 bug 的过程暴露出 **biome 切换是另一类 catalog 扩容**:biome config 改了,
spawner 走的分支不一样,`rng()` 序列在切换的 tile 位置重新洗牌,导致同一 catalog
的同一资源在 forest 和 desert 的 `out[]` 数组里**下标不对应**。

**正确做法**:
```js
// ✅ 用集合性质断言,跨 biome 稳
function countTrees(ents) {
  return groupById(ents).tree?.length ?? 0;
}

assert(countTrees(forestEnts) >= 10);
assert(countTrees(desertEnts) >= 10);
```

**Lint 覆盖度**:`wildwood/no-find-then-index` 不直接报 biome 切换
(因为 `countTrees` 没下标访问),但 PR template 第 2 节要求 reviewer
**手动**检查"biome 改动 → 跑两套 biome 的 fixture";这是规则覆盖不到的
语义层,reviewer 兜底。

### 7.2 案例 B:catalog 一次性扩容 20 资源 — 把 M2.10c 的坑放大 4 倍

**场景**:v0.6.4 一次性给 `resources.json` 加 20 个新资源(m2.14a
metadata report 里那一批)。M2.10c 当年只加了 5 个,触发一个测试假
阳性;这次同样跑 `tests/v060c-spawner-fixture.mjs`,按理应该全过 ——
但出现一个没在 5 资源场景里浮现的失败:

```js
// ❌ 错(测试文件实际写法,review 时发现)
test('player gathers from nearest tree', () => {
  const ents = spawn({ seed: 20260822, biome: 'forest' });
  // 拿"spawn 顺序里第一个 tree"
  const target = ents.find(e => e.id === 'tree');
  expect(target.distTo(player.x, player.y)).toBeLessThan(8);
});
```

**为什么 5 资源场景没爆,20 资源才爆**:5 资源时 `target` 恰好是距
player < 8 的那棵树;20 资源后,spawner 在玩家附近多 spawn 了一棵
`birch`,而 birch 比 `tree` 在 catalog 顺序里靠前,`find` 命中的
是那棵更远的 birch,断言看似还过(因为 distTo 也 < 8),但玩家
实际"想拿"的那棵树不再是 `target`。**断言虚晃一招,逻辑已
错**。

**正确做法**:
```js
// ✅ 显式找最近,断言"最近"语义
test('player gathers from nearest tree', () => {
  const ents = spawn({ seed: 20260822, biome: 'forest' });
  const target = findNearest(ents, player.x, player.y, 'tree');
  expect(target).not.toBeNull();
  expect(target.distTo(player.x, player.y)).toBeLessThan(8);
});
```

**Lint 覆盖度**:本例 `target = ents.find(...);` 本身**不触发**本规则
(规则拦截的是 `find()` 后跟数字下标,这里没下标)。这正是 PR template
第 2 节"规则覆盖不到的语义边界"的典型 — reviewer 必须看到这种"find
后立刻读 property"的模式时警觉:它**看起来不依赖顺序**,但 spawn
顺序变化会让"任意第一个 find 命中"和"语义目标"在 catalog 改动
时悄悄错位。

### 7.3 案例 C:catalog 缩容(删 2 个 + 加 1 个) — 看上去 OK 但又崩了

**场景**:data team 把 `gold_ore` 和 `silver_ore` 合并成 `precious_ore`。
测试套件绝大多数稳,但有一个测试:

```js
// ❌ 错:依赖 spawn 顺序中 `gold_ore` 出现在 `rock` 之前
test('mining order: gold before rock', () => {
  const ents = spawn({ seed: 20260822, biome: 'mountain' });
  const gold = ents.findIndex(e => e.id === 'gold_ore');
  const rock = ents.findIndex(e => e.id === 'rock');
  expect(gold).toBeLessThan(rock);
});
```

删 `gold_ore` → `findIndex` 返回 -1 → `expect(-1).toBeLessThan(rock)` 实际还能过(因为 rock 肯定 > 0),
**断言虚过**。但同时加 `precious_ore` 让 catalog 顺序重排,rock 的下标变化,断言完全失去意义。

**正确做法**:
```js
// ✅ 断言"集合性质":有 gold,rock 总数符合预期
test('mining order: gold before rock', () => {
  const ents = spawn({ seed: 20260822, biome: 'mountain' });
  const grouped = groupById(ents);
  expect((grouped.precious_ore || []).length).toBeGreaterThan(0);
  expect((grouped.rock || []).length).toBeGreaterThan(0);
});
```

**Lint 覆盖度**:`findIndex` 在本规则**未被直接覆盖**(它返回下标,不是
值,且没下标访问)。本规则 v0.7.0c 的覆盖范围聚焦"`.find()` 后的
数字下标访问"这一最常见反模式;`findIndex` 的反模式由
`v060c-spawner-fixture.mjs` 5 场景回归测试间接覆盖(catalog 改动后
跑全套,任何依赖下标的 `findIndex` 用法都会暴露)。未来 v0.7.x 计划
扩规则覆盖 `findIndex` + `indexOf` + 链式 `find().<numeric-prop>`。

### 7.4 三个案例共性回顾

| 触发源 | catalog 内部变化 | biome 切换 | 缩容 + 重命名 |
|--------|------------------|------------|----------------|
| spawner `rng()` 序列漂移 | ✓(主因) | ✓(biome 分支不同) | ✓(catalog 顺序重排) |
| `.find()` 命中语义错位 | 必然 | 必然 | 必然 |
| `out[N]` 断言崩 | 必然 | 必然 | 必然(下标基线变了) |
| `wildwood/no-find-then-index` 自动拦截 | ✓(`[N]` 部分) | △(review 兜底) | △(review 兜底 + fixture 回归) |
| PR template 第 2 节 review 兜底 | ✓ | ✓ | ✓ |

**核心提醒**:自动化规则**只能挡住硬语法反模式**;语义层的"`.find`
拿到的不是语义目标"**永远需要 reviewer 警觉**。所以 PR template
那一项 fixture 检查**不可省**,它是规则的语义兜底,不是冗余。

