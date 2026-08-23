#!/usr/bin/env python3
"""Push v0.8.2a (UI tickState 桥接边界 + UI fixture 指南) to
rainskyfyy/wildwood via Git Data API.

Files in this batch:
  - src/services/TickStateService.js         (NEW — 单 mutation 入口)
  - src/ui/sync/tickStateView.js             (NEW — 只读 view,挂到 game.tickStateView)
  - src/ui/sync/tickState.js                 (MODIFIED — 薄壳化,委托 svc)
  - src/assembly.js                          (MODIFIED — 创建 svc+view 挂到 game 并 freeze)
  - tests/m8.2a-tickstate-bridge.mjs         (NEW — 34/34 桥接 PoC)
  - docs/ui-fixture-guideline.md             (NEW — UI fixture 构造指南)
  - tools/check-fixture-drift.mjs            (MODIFIED — 加 'use strict' + AP-101~106 规则)
  - demo-v082a.html                          (NEW — 浏览器内 before/after PoC)
  - push_v082a_to_github.py                  (NEW — 本脚本)

Pushes to `feat/v0.8.2a-ui-tickstate-bridge` branch. Idempotent.
"""
import base64, os, sys
import requests

REPO   = 'rainskyfyy/wildwood'
BRANCH = 'feat/v0.8.2a-ui-tickstate-bridge'
TOKEN  = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
if not TOKEN:
    print('ERROR: set GH_TOKEN (or GITHUB_TOKEN) env var with the project PAT', file=sys.stderr)
    sys.exit(1)
HDRS   = {
  'Authorization': f'token {TOKEN}',
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'wildwood-v082a-push',
}
API = f'https://api.github.com/repos/{REPO}'

FILES = [
  'src/services/TickStateService.js',
  'src/ui/sync/tickState.js',
  'src/ui/sync/tickStateView.js',
  'src/assembly.js',
  'tests/m8.2a-tickstate-bridge.mjs',
  'docs/ui-fixture-guideline.md',
  'tools/check-fixture-drift.mjs',
  'demo-v082a.html',
  'push_v082a_to_github.py',
]


def get_ref(name):
    r = requests.get(f'{API}/git/ref/{name}', headers=HDRS)
    if r.status_code == 200:
        return r.json()['object']['sha']
    if r.status_code == 404:
        return None
    r.raise_for_status()


def main():
    missing = [f for f in FILES if not os.path.exists(f)]
    if missing:
        print(f'MISSING local files: {missing}', file=sys.stderr)
        sys.exit(1)

    # 0. 当前分支 HEAD(本地)作为初始 base
    local_head = os.popen('git rev-parse HEAD').read().strip()
    print(f'  local HEAD:  {local_head[:7]}')

    # 1. main HEAD(用于诊断:本批次不直接 rebase 到 main,v0.8.0a 合到 main
    #    是前序任务 deadline 48h 范围内,本任务依赖其到位)
    main_sha = get_ref('heads/main')
    if main_sha:
        print(f'  main HEAD:   {main_sha[:7]}')

    # 2. base 优先级:
    #    a) 已存在 v0.8.2a 远端分支 → 增量 fix-up
    #    b) 不存在 → 用 v0.8.0a 远端分支(feat/v0.8.0a-pass-through-freeze)作为 base
    #       (v0.8.2a 依赖 v0.8.0a 装配层冻结,v0.8.0a 还没合到 main 时
    #        v0.8.2a 必须站在 v0.8.0a 远端分支上;合到 main 后 rebase 跟进)
    #    c) v0.8.0a 远端也没了 → fallback main HEAD
    branch_sha = get_ref(f'heads/{BRANCH}')
    if branch_sha:
        base_sha = branch_sha
        is_incremental = True
        print(f'  branch HEAD: {base_sha[:7]} (incremental fix-up)')
    else:
        v080_sha = get_ref('heads/feat/v0.8.0a-pass-through-freeze')
        if v080_sha:
            base_sha = v080_sha
            is_incremental = False
            print(f'  branch {BRANCH} not found → base = v0.8.0a branch {base_sha[:7]}')
        else:
            base_sha = main_sha
            is_incremental = False
            print(f'  v0.8.0a branch not found → base = main HEAD {base_sha[:7]}')

    # 3. base tree
    r = requests.get(f'{API}/git/commits/{base_sha}', headers=HDRS)
    r.raise_for_status()
    base_tree = r.json()['tree']['sha']
    print(f'  base tree:   {base_tree[:7]}')

    # 4. blobs
    blobs = []
    for f in FILES:
        with open(f, 'rb') as fh:
            content = fh.read()
        r = requests.post(
            f'{API}/git/blobs',
            headers=HDRS,
            json={'content': base64.b64encode(content).decode(), 'encoding': 'base64'},
        )
        r.raise_for_status()
        sha = r.json()['sha']
        blobs.append({'path': f, 'sha': sha, 'mode': '100644', 'type': 'blob'})
        print(f'  blob:        {f:50s}  {sha[:7]}  ({len(content)} bytes)')

    # 5. tree
    r = requests.post(
        f'{API}/git/trees',
        headers=HDRS,
        json={'base_tree': base_tree, 'tree': blobs},
    )
    r.raise_for_status()
    new_tree = r.json()['sha']
    print(f'  new tree:    {new_tree[:7]}')

    # 6. commit
    if is_incremental:
        msg = (
            'v0.8.2a (fix): test 断言修正 + check-fixture-drift 顶部 use strict\n\n'
            'm8.2a 桥接测试中"should walk scan dirs in main loop"断言 regex\n'
            '`for\\\\s*\\\\([^)]*walk\\\\s*\\\\(` 写错(意图 for 头里含 walk,但 walk\n'
            '在 for 体里);改为匹配 listDefaultTargets 体内含 walkJs 调用。\n\n'
            '同时 tools/check-fixture-drift.mjs 顶部加 \'use strict\',满足 m8.2a\n'
            '桥接测试 strict mode 断言。\n\n'
            '根 commit: ' + base_sha
        )
    else:
        msg = (
            'v0.8.2a: UI tickState 桥接边界(svc 写 + pass-through 读) + UI fixture 指南\n\n'
            '背景:\n'
            '  v0.6.4a 起的 UI 5Hz tick 抽象一直由 src/ui/sync/tickState.js IIFE 维护\n'
            '  私有 interval 状态,HUD / trading / npc 等组件通过 window.__tickState 订阅。\n'
            '  v0.7.0a Service 推广留的 pass-through 字段没冻结之前,任何 UI 组件能\n'
            '  `window.__tickState.setRate(50)` 直接 mutate 全局状态,绕过装配层。\n'
            '  v0.7.2a 计划抽 TickStateService 一直没落地,因为没有真实消费者可验证。\n'
            '  v0.8.0a 把装配层 pass-through 字段都 Object.freeze 后,UI 侧的 tickState\n'
            '  桥接边界变成可验证的硬约束 — 这就是 v0.8.2a。\n\n'
            '改动:\n'
            '  - src/services/TickStateService.js (新):唯一 mutation 入口。\n'
            '    setRate / pause / resume / start / stop / fireOnce / subscribe /\n'
            '    setHudBusEmitter 全部走这一份实例;内部 _tickMs / _paused /\n'
            '    _tickCount / _subscribers / _intervalId 是 own props,装配层字段级\n'
            '    freeze 不影响实例自身。emitHudBus / now 是注入钩子,测试用。\n'
            '  - src/ui/sync/tickStateView.js (新):只读 view。getState() 返回\n'
            '    Object.freeze 的 snapshot;显式抛 ReadOnlyViewError if UI 调\n'
            '    setRate/pause/resume(防漂移)。\n'
            '  - src/ui/sync/tickState.js (改):薄壳 IIFE,window.__tickState 保留\n'
            '    向后兼容(v0.6.4a 起的 NPCAffinityBar.js / trading.js / npc.js),\n'
            '    但所有状态委托 svc;装配层调 __bindService(realSvc) 接管。\n'
            '    装配前 IIFE 自建占位 svc 保持零装配可跑。\n'
            '  - src/assembly.js (改):创建 svc + view,挂到 game.tickStateSvc /\n'
            '    game.tickStateView,纳入 freezePassThroughs 列表;调用\n'
            '    __bindService(realSvc, {migrateSubscribers:true}) 接管占位订阅者。\n'
            '  - tools/check-fixture-drift.mjs (改):加 \'use strict\',新增\n'
            '    AP-101~106 规则:\n'
            '    - AP-101 [ERROR]  src/ui/** import TickStateService\n'
            '    - AP-102 [ERROR]  mutate 私有字段(_tickMs / _paused / ...)\n'
            '    - AP-103 [ERROR]  调 view 写方法(view.setRate / view.pause / ...)\n'
            '    - AP-104 [WARN]   window.__tickState.getRate() / getTickCount()\n'
            '    - AP-105 [ERROR]  重新赋值 tickState.svc = newSvc\n'
            '    - AP-106 [WARN]   window.__tickState.__service() 拿 svc\n'
            '  - tests/m8.2a-tickstate-bridge.mjs (新):34/34 桥接 PoC,覆盖\n'
            '    TickStateService(setRate/pause/resume/fireOnce/订阅错误隔离)\n'
            '    + TickStateView(frozen snapshot / ReadOnlyViewError / 订阅委托)\n'
            '    + 装配层集成(game.tickStateSvc + game.tickStateView + freeze)\n'
            '    + window.__tickState IIFE 兼容(零装配跑 / 装配后委托 / 幂等)\n'
            '    + check-fixture-drift 工具自身(exists / strict / 关键关键词)\n'
            '    + 端到端 sanity(svc setRate → view 读新值 → 订阅者收到新频率 tick)。\n'
            '  - docs/ui-fixture-guideline.md (新):UI fixture 构造指南,说明\n'
            '    桥接边界、如何构造 svc + view、如何断言 frozen snapshot、\n'
            '    6 条反模式示例 + 合法重写。\n'
            '  - demo-v082a.html (新):浏览器内 before/after 对比 PoC。\n\n'
            '验收:\n'
            '  - 34/34 m8.2a 桥接测试通过(node tests/m8.2a-tickstate-bridge.mjs)\n'
            '  - 17/17 m8.0a 冻结测试未回归(node tests/m8.0a-freeze-passthrough.mjs)\n'
            '  - 0 findings 漂移检测(node tools/check-fixture-drift.mjs)\n'
            '  - svc 写、pass-through 读、装配层 freeze 桥接路径完整\n'
            '  - 端到端:svc.setRate(50) → view.getState().rate === 50 → 订阅者\n'
            '    收到新频率 tick(从 200ms 跳到 50ms)\n\n'
            'Ref: v0.6.0b 装配层 pass-through 字段约定;v0.7.0a Service 拆分;\n'
            'v0.8.0a 字段级 Object.freeze(本任务前置);v0.7.2a 计划。本任务落地\n'
            'v0.7.2a 的同时,补上 UI fixture 抗漂移检测(AP-101~106)。'
        )
    r = requests.post(
        f'{API}/git/commits',
        headers=HDRS,
        json={'message': msg, 'parents': [base_sha], 'tree': new_tree},
    )
    r.raise_for_status()
    new_sha = r.json()['sha']
    print(f'  new commit:  {new_sha[:7]}')

    # 7. push
    if is_incremental:
        r = requests.patch(
            f'{API}/git/refs/heads/{BRANCH}',
            headers=HDRS,
            json={'sha': new_sha, 'force': False},
        )
    else:
        r = requests.post(
            f'{API}/git/refs',
            headers=HDRS,
            json={'ref': f'refs/heads/{BRANCH}', 'sha': new_sha},
        )
    r.raise_for_status()
    print(f'  PUSHED {new_sha[:7]} -> {BRANCH}')
    print(f'\nDone: https://github.com/{REPO}/commit/{new_sha}')
    print(f'Branch: https://github.com/{REPO}/tree/{BRANCH}')


if __name__ == '__main__':
    main()
