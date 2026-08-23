# Wildwood UI 测试 Fixture 抗漂移规范(UI Fixture Guideline)

> v0.8.2a 起强制生效。配套工具:`tools/check-fixture-drift.mjs`
> 触发原因:v0.8.0a 装配层 pass-through 字段冻结后,UI 改 tickState / inventory /
> eventMgr 状态必须走 svc,但旧 fixture 里 `tickState.svc = newSvc` / `window.__tickState.setRate(100)`
> 这类"绕过 svc 直接写"的代码会变成"假阳性绿测" — fixture 看起来过了,实际没在测正确路径。

本规范配合 `docs/spawner-fixture-guideline.md`(资源生成抗漂移)一起使用,
覆盖「读 / 写 UI 全局状态」这一类 fixture 的所有反模式。

---

## 1. 核心契约

| 概念 | 承诺 | 不承诺 |
|------|------|--------|
| 装配层 `game` 对象的 pass-through 字段 | 引用稳定(`game.tickStateSvc === svc` 永远成立) | — |
| 装配层字段值(实例本身) | 内部状态可写(方法调用正常) | 实例引用被换会抛 `TypeError` |
| UI 改 tickState / inventory / eventMgr 状态 | 走 svc(单 mutation 入口) | 直接 mutate 私有字段 / 换引用会抛错 |
| UI 读全局状态 | 走 view(只读 pass-through)/ game 字段直读 | — |

**直觉解释**:v0.8.0a 用 `Object.defineProperty` 锁字段描述符(不是字段值),
任何 `game.X = newX` / `delete game.X` 抛 `TypeError`。`game.X.method()` 仍工作
(实例本身没被 freeze)。所以 fixture 必须走"方法调用"模式,不能"换引用"或
"mutate 私有字段"。

---

## 2. 强制规则(从 v0.8.2a 起,PR review 必检)

### ❌ 反模式 1:UI 直接 import TickStateService

```js
// ❌ 错(src/ui/* 不应拿 svc)
import { TickStateService } from '../../services/TickStateService.js';
const svc = new TickStateService();
svc.setRate(100);
```

**为什么错**:UI 不该知道 svc 的存在;UI 走 `game.tickStateView` 读状态,管理面板 / 调试
面板才走 `game.tickStateSvc`。这层职责分离一旦被打破,UI 测试和装配层真实代码就脱节了。

```js
// ✅ 对(UI 改频率 — 走 game.tickStateSvc,只允许在管理面板 / 调试面板)
import { game } from './game.js'; // 假设有 game 单例
game.tickStateSvc.setRate(100);

// ✅ 对(普通 UI 组件只读 — 拿 view)
const view = game.tickStateView;
view.subscribe((d) => { /* ... */ });
```

---

### ❌ 反模式 2:mutate svc / view 私有字段

```js
// ❌ 错(直接改私有字段,绕过公开方法)
tickStateSvc._tickMs = 50;
tickStateView._subscribers.push(myHandler);
```

**为什么错**:svc / view 私有字段是实现细节,字段名 / 数据结构改了就崩。
走公开方法(setRate / subscribe)才能保证契约稳定。

```js
// ✅ 对(走公开方法)
tickStateSvc.setRate(50);
const unsub = tickStateSvc.subscribe(myHandler);
// 或:const unsub = tickStateView.subscribe(myHandler);  // view.subscribe 委托 svc
```

---

### ❌ 反模式 3:在 view 上调写方法

```js
// ❌ 错(view 是只读,setRate 抛 ReadOnlyViewError)
tickStateView.setRate(100);
tickStateView.pause();
```

**为什么错**:view 是 pass-through 只读入口,写必须走 svc。view 显式抛
`ReadOnlyViewError` 是双保险 — 编译期 + 运行期拦截。fixture 想改状态
直接调 svc 即可,不要在 view 上"碰运气"。

```js
// ✅ 对(改写 — 走 svc)
tickStateSvc.setRate(100);
tickStateSvc.pause();
```

---

### ❌ 反模式 4:fixture 拿 window.__tickState.getRate() / getTickCount() 断言具体值

```js
// ❌ 错(旧 API,实现细节不稳)
const r = window.__tickState.getRate();
assert(r === 200); // 哪天 tickState 改成 rate 字段,这就崩
```

**为什么错**:`getRate()` / `getTickCount()` 是 v0.6.4a 旧 API,实现细节。
v0.8.2a 起统一走 `getState()` 拿快照,断言 `s.rate` / `s.paused` / `s.tickCount` 字段。

```js
// ✅ 对(走 getState() 拿快照,断言字段)
const s = tickStateView.getState();
assert(s.rate === 200);
assert(s.paused === false);
assert(s.running === true);
```

---

### ❌ 反模式 5:换 svc 引用(装配层 freeze 会抛)

```js
// ❌ 错(装配层已 freeze,这种代码会抛 TypeError)
game.tickStateSvc = new TickStateService();
game.tickStateView = new TickStateView(svc);
```

**为什么错**:v0.8.0a 字段级 freeze 锁引用。任何 `game.X = newX` 抛 `TypeError`。
fixture 想"重置" svc,应该 `tickStateSvc.stop()` + `tickStateSvc.start()`,
而不是换引用。

```js
// ✅ 对(走公开方法)
tickStateSvc.stop();
tickStateSvc.start();
// 或:setRate / pause / resume / fireOnce — 都是合法 mutation
```

---

### ❌ 反模式 6:UI 端调 __tickState.__service() 拿 svc

```js
// ❌ 错(UI 不应拿内部钩子)
const svc = window.__tickState.__service();
svc.setRate(100);
```

**为什么错**:`__service()` 是内部 / 测试钩子,UI 不应拿。
UI 拿 svc 应该通过 `game.tickStateSvc`(装配层挂的合法入口)。

```js
// ✅ 对
const svc = game.tickStateSvc;  // 装配层挂的
svc.setRate(100);
```

---

## 3. 抗漂移原则(写新 UI fixture 时的 5 条铁律)

1. **fixture seed 必须固定** — 推荐项目级常量 `seed: 20260822`,配合
   `getState()` 快照断言,不要重新创建 svc。
2. **不依赖私有字段名** — 字段加 `_` 前缀是约定,但**不要**写
   `assert(svc._tickMs === 200)`,断言公开快照字段 `s.rate`。
3. **不绕过 view / svc 直接拿 window.__tickState 调写方法** — 旧 IIFE
   入口是过渡桥,装配后所有 mutation 走 svc,所有读走 view。
4. **不换 svc 引用** — `game.tickStateSvc = ...` 会抛错,改用 `stop() / start() / setRate()`
   等公开方法。
5. **不假设内部数据结构** — svc 内部可能用 `_subscribers` 也可能用
   `_listenerSet`,改实现时只动 svc 自身,fixture 不受影响。

---

## 4. 写新 UI 组件 / Fixture 时的模板

### UI 组件模板(只读 + 订阅)

```js
// src/ui/components/MyComponent.js
'use strict';
import { game } from '../game.js'; // 假设装配层挂的 game 单例

export class MyComponent {
  constructor(rootEl) {
    this.root = rootEl;
    this._render = this._render.bind(this);
    // ✅ 走 view 订阅(view.subscribe 委托 svc)
    this._unsub = game.tickStateView.subscribe(this._render);
  }
  destroy() {
    this._unsub();
  }
  _render(detail) {
    // ✅ 走 view 读快照
    const s = game.tickStateView.getState();
    this.root.textContent = `tick=${s.tickCount} rate=${s.rate}ms`;
  }
}
```

### Fixture / 测试模板(合法 mutation)

```js
// tests/m_my_component.mjs
import { assembleGame } from '../src/assembly.js';
import { createTickStateService } from '../src/services/TickStateService.js';

it('component reflects svc setRate via view', () => {
  // ✅ 装一个真实 game(或者 mock 一个最小 game)
  const game = { tickStateSvc: svc, tickStateView: view };
  // 走 svc 改
  game.tickStateSvc.setRate(100);
  // 走 view 读
  const s = game.tickStateView.getState();
  assert(s.rate === 100);
});
```

### 调试 / 管理面板(合法 mutation,UI 端)

```js
// src/ui/admin/DebugPanel.js — 允许走 svc,因为是管理工具
'use strict';
import { game } from '../game.js';

export class DebugPanel {
  setRate100() {
    // ✅ 管理面板可以走 svc(这是 mutation 入口存在的目的)
    game.tickStateSvc.setRate(100);
  }
  pause() {
    game.tickStateSvc.pause();
  }
}
```

> 调试面板也走 svc,不是"我拿到 svc 就可以乱搞" — 仍然必须走公开方法,
> 不 mutate 私有字段、不换引用。

---

## 5. 检测工具 `tools/check-fixture-drift.mjs`

跑一次就能扫出所有违规:

```bash
$ node tools/check-fixture-drift.mjs

── check-fixture-drift ──

Scanned 39 file(s) in [src/ui, tests]
Rules: 6  |  Errors: 0  |  Warnings: 0

  ✓ No drift detected — fixtures are aligned with v0.8.2a bridge boundary.
```

6 条规则覆盖:

| ID | 等级 | 检测内容 |
|----|------|----------|
| `svc-leak-in-ui` | error | `src/ui/*` import `TickStateService` |
| `private-field-mutation` | error | mutate svc / view 私有字段(`_tickMs` 等) |
| `view-write-attempt` | error | 在 view 上调写方法(应抛 `ReadOnlyViewError`) |
| `legacy-tickstate-api` | warn | 用 `window.__tickState.getRate()` / `getTickCount()` |
| `svc-reassign-attempt` | error | `game.tickStateSvc = newSvc` 换引用 |
| `service-leak-via-window` | warn | UI 端用 `window.__tickState.__service()` |

CI 集成:
```yaml
# .github/workflows/ci.yml(参考片段)
- name: check-fixture-drift
  run: node tools/check-fixture-drift.mjs
```

---

## 6. 与 spawner-fixture-guideline 的关系

| 维度 | spawner(资源) | tickState / 装配层字段 |
|------|----------------|----------------------|
| 不稳定点 | spawn 顺序(下标) | 私有字段 / 换引用 / 旧 API |
| 稳定承诺 | 集合稳定(同 seed+world+catalog) | 引用稳定 + 实例方法可用 |
| 推荐工具 | `findNearest` / `findInRange` / `groupById` | `svc.setRate` / `view.getState` / `view.subscribe` |
| 漂移检测 | 测试断言用 `findNearest` 等 | fixture 用 `getState()` 快照 + svc 公开方法 |

两者并列存在,各自管一片:
- **spawner-fixture-guideline** 管"读资源"那一类 fixture
- **ui-fixture-guideline**(本文件)管"读 / 写 UI 全局状态"那一类 fixture

新写的 fixture 触发漂移时,先怀疑 fixture,再怀疑实现。

---

## 7. 历史教训

- **v0.8.0a 装配合约**:pass-through 字段 freeze,UI 必须走 svc。
  没规范的话,`game.tickStateSvc = newSvc()` 这种代码编译过、跑起来抛
  `TypeError`,调试半天发现是字段被锁了。
- **v0.8.2a 本规范**:把"必须走 svc"具象成 5 条铁律 + 6 条检测规则,
  CI 一把抓,PR review 不再"逐行 grep `_tickMs`"。

> **一句话总结**:UI 改状态走 `game.tickStateSvc`,读状态走
> `game.tickStateView`,断言用 `view.getState()` 拿快照。三条铁律换一份安心。

---

## 8. 速查表

```text
                 读                          写
    UI 组件   game.tickStateView       game.tickStateSvc(管理面板)
    .getState / .subscribe            .setRate / .pause / ...
    测 试   game.tickStateView       game.tickStateSvc
            (或 svc.getState 拿非 frozen)

禁止:
  ❌ src/ui/* import TickStateService
  ❌ svc._tickMs = 50
  ❌ view.setRate(100)  → 抛 ReadOnlyViewError
  ❌ window.__tickState.getRate()  → 用 view.getState()
  ❌ game.tickStateSvc = newSvc  → 抛 TypeError
  ❌ UI 端 __tickState.__service() → 内部钩子,UI 不应拿
```
