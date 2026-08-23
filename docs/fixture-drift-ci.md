# Fixture 抗漂移 CI Check

> v0.8.0b 起强制。违反者 PR merge 被 block。

本文档说明 `tools/check-fixture-drift.mjs` 的使用方式、检测规则、豁免机制和误报处理。

---

## 1. 背景

`src/resources/spawner.js` 输出的实体**集合**对同一 `(seed, world, catalog)` 稳定,但**顺序**不承诺稳定(catalog 改动会让 `rng()` 序列变化,从而重排 spawn 输出)。

依赖 spawn 顺序的测试(例如 `gent[0]`、`gent.find(e => e.id === 'tree' && e.distTo(0,0) < 30)` 拿"最近的")在 catalog 改动时会**静默失效** — 测试还在过,但断言已经测错东西了。

参考完整规范:`docs/spawner-fixture-guideline.md`。
历史教训:M2.10c 给 catalog 加 5 个资源,spawner 内层 `rng()` 多调用 5 次,既有测试 `gent.find(e => e.id === 'tree' && e.distTo(0,0) < 30)` 拿到的不是"最近的树",而是"spawn 数组里第一个且在范围内的树"。

---

## 2. 工具

### 2.1 安装

无需依赖,纯 Node ESM,要求 Node ≥ 18。

### 2.2 用法

```bash
# 默认:扫 tests/*.mjs
node tools/check-fixture-drift.mjs

# 扫指定文件 / 目录
node tools/check-fixture-drift.mjs tests/foo.mjs
node tools/check-fixture-drift.mjs tests/

# 详细输出:显示每个被跟踪的 spawner 输出变量
node tools/check-fixture-drift.mjs --verbose

# JSON 输出(给机器读,如 CI badge 抓取)
node tools/check-fixture-drift.mjs --json

# 自检:用内置 fixture 验证检测器自身是否正确
node tools/check-fixture-drift.mjs --self-test

# 查看帮助
node tools/check-fixture-drift.mjs --help
```

### 2.3 退出码

| 退出码 | 含义 |
|--------|------|
| `0`    | 通过 — 0 个 ERROR 级反模式 |
| `1`    | 失败 — 至少 1 个 ERROR,需修复后重跑 |
| `2`    | 使用错误(参数解析失败、文件不可读) |

---

## 3. 检测规则

| 规则 | 级别 | 含义 | 例子 |
|------|------|------|------|
| **AP-001** | ERROR | `.find()` 谓词里出现 `distTo` 或 `distance` — 把 spawn 顺序当成了距离 | `ents.find(e => e.id === 'tree' && e.distTo(0,0) < 30)` |
| **AP-002** | ERROR | `.find(...)[N]` — find 返回单元素,`[0]` 取的是属性而非数组下标 | `ents.find(e => e.id === 'tree')[0]` |
| **AP-003** | ERROR | `.filter(...)[N]` — filter 保留 spawn 顺序,`[0]` 无语义保证 | `ents.filter(e => e.id === 'tree')[0]` |
| **AP-004** | ERROR | spawner 输出直接 `[N]` — 顺序不稳定 | `gent[0]` / `trees[2]` |

### 3.1 跟踪范围

检测器**只**跟踪从 `spawnResources(...)` 派生的变量:

- `const X = spawnResources(...)` → X 是 spawner 输出
- `const Y = X.filter(...)` → Y 是派生 spawner 输出
- `Y.sort(...)` 之后的 `Y[N]` 自动豁免(GOOD pattern)
- `gent.find(e => e.id === 'X')`(无 distTo)只用作 existence check,OK

非 spawner 数组(目录、事件 payload、inventory slots 等)上的一切 `[]` `.find()` `.filter()` 都安全,不会被报。

### 3.2 数据流追踪(简化版)

检测器做的是"**轻量级**"变量级数据流分析,不是完整 AST 解析。覆盖:

- `const X = ...spawnResources(...)` ✓
- `const Y = X.filter(...)` ✓
- `Y.sort(...)` 后的 `Y[N]` 豁免 ✓
- 跨行的 `.find(predicate-with-distTo)` ✓
- 模板字符串里的 `${gent[0]}` 插值 ✓

不覆盖(已知限制,留待 v0.8.x 迭代):

- 跨函数的 spawner 输出(`getEntities()` 返回的实体)
- 对象属性的解构 + filter 链(`const { items } = obj; items.filter(...)`)
- 嵌套作用域的同名变量遮蔽

---

## 4. 豁免机制

### 4.1 行末注释

```js
const t = gent[0]; // fixture-drift-ok: 测 spawn 顺序不变,已挂 #2024 跟进
```

### 4.2 上一行注释

```js
// fixture-drift-ok: 这是抗漂移回归测试本身,故意测 [0]
const t = gent[0];
```

### 4.3 块注释

```js
/* fixture-drift-ok: 整段测顺序无关场景 */
const a = gent[0];
const b = gent[1];
const c = gent[2];
```

**写豁免注释时必须解释** 为什么这是合理的(给未来的 reviewer 留 context)。格式:`// fixture-drift-ok: <具体原因>`。

---

## 5. 修复指南

| 反模式 | 正确写法 | 说明 |
|--------|----------|------|
| `gent.find(e => e.id === 'X' && e.distTo(px, py) < R)` | `findNearest(gent, px, py, 'X')` 或 `findInRange(gent, px, py, R, 'X')` | 用 spawner 暴露的纯函数,不读 spawn 顺序 |
| `gent.find(e => e.id === 'X')[0]` | `gent.filter(e => e.id === 'X').sort(...)[0]` 或 `findNearest(gent, ..., 'X')` | find 返单元素,filter 返数组 |
| `gent.filter(e => e.id === 'X')[0]` | `gent.filter(...).sort((a,b) => a.distTo(px,py) - b.distTo(px,py))[0]` | sort 后 [0] 才有语义 |
| `gent[0]` | 同上,或 `findNearest(gent, ...)` |  |
| `gent.find(e => e.id === 'X')`(裸) | OK,existence check 不需要改 | 谓词无 distTo 时,只做存在性判断,find 是合理的 |

`src/resources/spawner.js` v0.6.0c 起导出的三个纯函数(`findNearest` / `findInRange` / `groupById`)是首选 — 它们只读坐标和 id,从不读 `out` 数组的下标。

---

## 6. CI 集成

### 6.1 Workflow 文件

`.github/workflows/ci.yml` 已包含:

1. **fixture-drift** job:跑 `tools/check-fixture-drift.mjs` + `--self-test`
2. **smoke** job(matrix):对每个 `tests/*.mjs` 单独跑

两个 job 并行,任一失败都 block merge。

### 6.2 本地预检

PR 提交前本地跑:

```bash
node tools/check-fixture-drift.mjs --verbose
```

期望输出 `✓ all clean`。如失败,按 `--- summary ---` 后的 AP 分类逐条修复,或加豁免注释(需解释)。

### 6.3 误报处理

如果检测器在合理代码上报错:

1. **优先**:重构代码用 `findNearest` / `findInRange` / `groupById`,从根本上消除依赖
2. **次选**:在 spawner 输出变量上 `sort(...)` 之后再 `[N]`(显式语义)
3. **最后**:加 `// fixture-drift-ok: <原因>` 注释豁免单行;加块注释豁免多行

**禁止**直接删 `// fixture-drift-ok` 标记来"让 CI 过" — 标记是给 reviewer 看的 evidence。

---

## 7. 维护

### 7.1 添加新反模式

如果发现新的 fixture 漂移反模式但当前未检测:

1. 在 `tools/check-fixture-drift.mjs` 的 `AP_DEFS` 加新条目(severity 必填,title/fix 必填)
2. 在 `scanFile` 加检测逻辑
3. 在 `tools/__demo__/fixture-drift-demo.mjs` 加 BAD + GOOD 对照
4. 在 `runSelfTest` 的 `FIXTURES` 加对应 fixture
5. 跑 `node tools/check-fixture-drift.mjs --self-test` 验证

### 7.2 升级 Node 要求

工具用纯 ESM + 字符串处理,理论上 Node 18+ 都行。若用上新 API,需更新 `package.json` 字段和 CI 的 `node-version`。

### 7.3 历史记录

- **v0.8.0b (2026-08-22)**:首次引入,4 类反模式(AP-001/002/003/004)
