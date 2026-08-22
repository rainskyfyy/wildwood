#!/usr/bin/env python3
"""Push v0.8.0a (装配层 pass-through 字段 Object.freeze) to
rainskyfyy/wildwood via Git Data API.

Files changed in v0.8.0a:
  - src/util/freeze-passthrough.js  (NEW — field-level freeze helper)
  - src/assembly.js                 (MODIFIED — import + call freezePassThroughs)
  - tests/m8.0a-freeze-passthrough.mjs  (NEW — 17/17 PoC tests)

Pushes to a feature branch `feat/v0.8.0a-pass-through-freeze` based on
current main HEAD (latest main at runtime, not a hardcoded SHA — auto-sync
commits come in frequently).
"""
import base64, os, sys
import requests

REPO       = 'rainskyfyy/wildwood'
BRANCH     = 'feat/v0.8.0a-pass-through-freeze'
# 沿用 v0.6.0a/v0.7.0a 的 env var 约定:GH_TOKEN(避免 GitHub secret scanning 命中硬编码)
TOKEN      = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
if not TOKEN:
    print('ERROR: set GH_TOKEN (or GITHUB_TOKEN) env var with the project PAT', file=sys.stderr)
    sys.exit(1)
HDRS       = {
  'Authorization': f'token {TOKEN}',
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'wildwood-v080a-push',
}
API = f'https://api.github.com/repos/{REPO}'

FILES = [
  'src/util/freeze-passthrough.js',
  'src/assembly.js',
  'tests/m8.0a-freeze-passthrough.mjs',
  'push_v080a_to_github.py',
]


def get_ref(name):
    """Return (sha, ref_url) for the given ref, or (None, None) if absent."""
    r = requests.get(f'{API}/git/ref/{name}', headers=HDRS)
    if r.status_code == 200:
        return r.json()['object']['sha'], r.json()['url']
    if r.status_code == 404:
        return None, None
    r.raise_for_status()


def main():
    # 0. 校验本地文件都存在
    missing = [f for f in FILES if not os.path.exists(f)]
    if missing:
        print(f'MISSING local files: {missing}', file=sys.stderr)
        sys.exit(1)

    # 1. main HEAD (作为本次 push 的 base)
    r = requests.get(f'{API}/git/ref/heads/main', headers=HDRS)
    r.raise_for_status()
    main_sha = r.json()['object']['sha']
    print(f'  main HEAD:   {main_sha[:7]}')

    # 2. base tree
    r = requests.get(f'{API}/git/commits/{main_sha}', headers=HDRS)
    r.raise_for_status()
    base_tree = r.json()['tree']['sha']
    print(f'  base tree:   {base_tree[:7]}')

    # 3. 检查目标分支是否已存在
    branch_ref = f'heads/{BRANCH}'
    branch_sha, branch_url = get_ref(f'refs/{branch_ref}')
    if branch_sha:
        print(f'  branch {BRANCH} exists at {branch_sha[:7]} — will PATCH in place')
    else:
        print(f'  branch {BRANCH} does NOT exist — will POST new ref')

    # 4. create blobs
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

    # 5. create tree
    r = requests.post(
        f'{API}/git/trees',
        headers=HDRS,
        json={'base_tree': base_tree, 'tree': blobs},
    )
    r.raise_for_status()
    new_tree = r.json()['sha']
    print(f'  new tree:    {new_tree[:7]}')

    # 6. create commit
    msg = (
        'v0.8.0a: 装配层 pass-through 字段 Object.freeze,堵住 v0.7.0a 泄漏口\n\n'
        '背景:\n'
        '  v0.6.0b / v0.7.0a 把 inventory / eventMgr / buildingMgr / monsterMgr\n'
        '  等 Manager 实例作为 pass-through 字段暴露在 game 上,UI 面板和 runtime\n'
        '  可以只读访问;所有 mutation 必须走 InventoryService / EventService /\n'
        '  BuildingService / MonsterService。但 pass-through 字段本身没冻结,任何\n'
        '  代码都能 `game.inventory = newInv()` 整体换掉 — 状态泄漏,服务层单\n'
        '  入口承诺被绕开。\n\n'
        '改动:\n'
        '  - src/util/freeze-passthrough.js (新):freezePassThroughs(game, fields)\n'
        '    用 Object.defineProperty 把 game 字段描述符锁成 writable=false +\n'
        '    configurable=false。语义等同 Object.freeze 字段在 strict mode 下\n'
        '    的行为(`game.X = newX` 抛 TypeError),但不冻实例本身 — 实例方法\n'
        '    (inventory.add / eventMgr.update 等) 继续工作。\n'
        '  - src/assembly.js:在 game 对象构造后、return 之前调用\n'
        '    freezePassThroughs(game, [23 个 pass-through 字段])。runtime 闭包\n'
        '    状态故意不放进列表(runtime.js 合法 mutate)。\n'
        '  - tests/m8.0a-freeze-passthrough.mjs (新):17/17 PoC,覆盖工具函数 /\n'
        '    before vs after 行为对比 / 装配层集成 sanity / runtime 兼容性。\n\n'
        '验收:\n'
        '  - 只读访问走 pass-through 正常(get 不抛错,方法可调用)\n'
        '  - 写访问(换引用 / delete / redefine)必须抛 TypeError\n'
        '  - 17/17 PoC 测试通过(node tests/m8.0a-freeze-passthrough.mjs)\n'
        '  - 装配层 \'use strict\' 已启用(冻结抛错的前置条件)\n\n'
        'Ref: v0.6.0b InventoryService 单向接口;v0.7.0a Event/Building/Monster\n'
        'Service 拆分(v0.8.0a 是这一系列的收口 — 强约束"换引用"泄漏口)'
    )
    r = requests.post(
        f'{API}/git/commits',
        headers=HDRS,
        json={'message': msg, 'parents': [main_sha], 'tree': new_tree},
    )
    r.raise_for_status()
    new_sha = r.json()['sha']
    print(f'  new commit:  {new_sha[:7]}')

    # 7. push: POST 创建新 ref,或 PATCH 更新已有 ref
    if branch_url:
        # 已有分支 → PATCH 更新
        r = requests.patch(
            branch_url,
            headers=HDRS,
            json={'sha': new_sha, 'force': False},
        )
    else:
        # 新分支 → POST 创建
        r = requests.post(
            f'{API}/git/refs',
            headers=HDRS,
            json={'ref': f'refs/{branch_ref}', 'sha': new_sha},
        )
    r.raise_for_status()
    print(f'  PUSHED {new_sha[:7]} -> {BRANCH}')
    print(f'\nDone: https://github.com/{REPO}/commit/{new_sha}')
    print(f'Branch: https://github.com/{REPO}/tree/{BRANCH}')


if __name__ == '__main__':
    main()
