# tools/check-fixture-drift.mjs — fixture 抗漂移 CI check 输出 demo

本文件是 v0.8.0b 引入的 fixture-drift CI check 在 demo fixture 上的运行结果,用于证明检测器在已知反模式上正确触发、在已知正确写法上无误报。

## Demo 命令

```bash
node tools/check-fixture-drift.mjs tools/__demo__/fixture-drift-demo.mjs
```

## Demo Fixture

文件:`tools/__demo__/fixture-drift-demo.mjs`

内容覆盖:
- **4 类反模式** 各 1 例(AP-001 / AP-002 / AP-003 / AP-004)
- **5 类正确写法**(findNearest / findInRange / groupById / sort+index / existence check)

## 期望输出

```
fixture-drift check: 1 files scanned, 4 findings

tools/__demo__/fixture-drift-demo.mjs
  L21: AP-001  [error]
    const target = gent.find(e => e.id === 'tree' && e.distTo(0, 0) < 30);
    fix: 改用 findNearest(ents, x, y, id) 或 findInRange(ents, x, y, r, id) + sort
  L26: AP-002  [error]
    const near = gent.find(e => e.id === 'tree')[0];
    fix: 改成 .filter(...)[0] 后接 sort,或直接用 findNearest
  L30: AP-003  [error]
    const firstTree = gent.filter(e => e.id === 'tree')[0];
    fix: 先 .sort((a,b) => a.distTo(x,y) - b.distTo(x,y)) 再 [0],或用 findNearest
  L34: AP-004  [error]
    const alsoFirst = gent[0];
    fix: 用 findNearest / findInRange / groupById 替换(见 docs/spawner-fixture-guideline.md)

--- summary ---
  AP-001: 1
  AP-002: 1
  AP-003: 1
  AP-004: 1

详情见 docs/spawner-fixture-guideline.md
```

## 实际输出(本地复跑 2026-08-22)

```
fixture-drift check: 1 files scanned, 4 findings

tools/__demo__/fixture-drift-demo.mjs
  L21: AP-001  [error]
    const target = gent.find(e => e.id === 'tree' && e.distTo(0, 0) < 30);
    fix: 改用 findNearest(ents, x, y, id) 或 findInRange(ents, x, y, r, id) + sort
  L26: AP-002  [error]
    const near = gent.find(e => e.id === 'tree')[0];
    fix: 改成 .filter(...)[0] 后接 sort,或直接用 findNearest
  L30: AP-003  [error]
    const firstTree = gent.filter(e => e.id === 'tree')[0];
    fix: 先 .sort((a,b) => a.distTo(x,y) - b.distTo(x,y)) 再 [0],或用 findNearest
  L34: AP-004  [error]
    const alsoFirst = gent[0];
    fix: 用 findNearest / findInRange / groupById 替换(见 docs/spawner-fixture-guideline.md)

--- summary ---
  AP-001: 1
  AP-002: 1
  AP-003: 1
  AP-004: 1
```

✓ 4 个反模式全部检出,5 个正确写法无 false positive。

## Self-test 输出

```
$ node tools/check-fixture-drift.mjs --self-test
  ✓ bad-ap001.mjs: ["AP-001"]
  ✓ bad-ap002.mjs: ["AP-002"]
  ✓ bad-ap003.mjs: ["AP-003"]
  ✓ bad-ap004.mjs: ["AP-004"]
  ✓ good-001.mjs: []
  ✓ good-002.mjs: []
  ✓ good-003.mjs: []
  ✓ good-004.mjs: []
  ✓ good-005.mjs: []

self-test: 9 pass, 0 fail
✓ detector covers AP-001/002/003/004, exemption works, non-spawner scope safe
```

9 个内置 fixture 全部通过,覆盖:
- 4 类反模式各 1 例(必报)
- `findNearest` / `findInRange` 正确写法(不报)
- 裸 `find` 做 existence check(不报)
- 单行 `// fixture-drift-ok` 豁免(不报)
- 块 `/* fixture-drift-ok */` 豁免(不报)
- 非 spawner 数组(目录 / event / slot 等)上的任意 `[]` / `.find`(不报)

## 在真实 `tests/*.mjs` 上的输出

```
$ node tools/check-fixture-drift.mjs

fixture-drift check: 22 files scanned, 0 findings

✓ all clean — fixture-drift CI check passed
```

22 个 smoke test 全部通过 fixture-drift check(包括 `m210b-regrow-durability.mjs` 中 `trees.sort(...)[0]` 的 GOOD pattern,正确豁免)。
