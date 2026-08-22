"""Push M2.10e (资源三阶段成长) to rainskyfyy/wildwood@main via Git Data API.

Files changed in M2.10e (relative to M2.10d parent c01c55a):
  - src/resources/resources.json            (6 new defs + 3 growthStages)
  - src/resources/items.json                (3 new items: acorn/berry_seed/dead_wood_chunk)
  - src/resources/catalog.js                (growthStages API exports)
  - src/resources/resource-entity.js        (stage init/update/harvest growth cycle)
  - src/render/resource-renderer.js         (6 new stage icons + growth progress bar)
  - src/main.js                             (stage advance banner)
  - README.md                               (M2.10e section)
  - tests/m210-node-smoke.mjs               (tree stage advance)
  - tests/m210b-regrow-durability.mjs       (rock instead of tree)
  - tests/m210d-depletion.mjs               (resource count + rock regrow + growth-capable test)
  - tests/m210e-growth.mjs                  (NEW — 97 tests)
  - push_m210e_to_github.py                 (NEW — this script)
"""
import base64, os, requests

REPO  = 'rainskyfyy/wildwood'
TOKEN = os.environ['GITHUB_TOKEN']
HDRS  = {
  'Authorization': f'token {TOKEN}',
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'wildwood-m210e-push',
}

FILES = [
  'README.md',
  'src/main.js',
  'src/render/resource-renderer.js',
  'src/resources/catalog.js',
  'src/resources/items.json',
  'src/resources/resource-entity.js',
  'src/resources/resources.json',
  'tests/m210-node-smoke.mjs',
  'tests/m210b-regrow-durability.mjs',
  'tests/m210d-depletion.mjs',
  'tests/m210e-growth.mjs',
  'push_m210e_to_github.py',
]

def run():
    # 1. current main HEAD
    r = requests.get(f'https://api.github.com/repos/{REPO}/git/ref/heads/main', headers=HDRS)
    r.raise_for_status()
    base_sha = r.json()['object']['sha']
    print(f'  base main: {base_sha[:7]}')

    # 2. base tree
    r = requests.get(f'https://api.github.com/repos/{REPO}/git/commits/{base_sha}', headers=HDRS)
    r.raise_for_status()
    base_tree = r.json()['tree']['sha']
    print(f'  base tree: {base_tree[:7]}')

    # 3. create blobs (v1.0.4 lesson: tree entries need mode+type, blobs don't)
    blobs = []
    for f in FILES:
        if not os.path.exists(f):
            print(f'  SKIP missing: {f}')
            continue
        with open(f, 'rb') as fh:
            content = fh.read()
        r = requests.post(
            f'https://api.github.com/repos/{REPO}/git/blobs',
            headers=HDRS,
            json={'content': base64.b64encode(content).decode(), 'encoding': 'base64'},
        )
        r.raise_for_status()
        sha = r.json()['sha']
        blobs.append({'path': f, 'sha': sha, 'mode': '100644', 'type': 'blob'})
        print(f'  blob: {f}  {sha[:7]}')

    # 4. create tree
    r = requests.post(
        f'https://api.github.com/repos/{REPO}/git/trees',
        headers=HDRS,
        json={'base_tree': base_tree, 'tree': blobs},
    )
    r.raise_for_status()
    new_tree = r.json()['sha']
    print(f'  new tree: {new_tree[:7]}')

    # 5. create commit
    msg = (
        'M2.10e: 资源三阶段成长 (tree/dead_tree/berry_bush) — 时间驱动 + 阶段 2 稀有种子 (489 tests)\n\n'
        '- catalog.js 加 isGrowthCapable/getGrowthStages/getStageDef/getStageCount 导出 + growthStages 验证\n'
        '- resource-entity.js 加 _rootId/currentStageIndex/stageStartedAt + 链式阶段推进(leftover-time)\n'
        '- harvest() 改写:growth-capable 资源被采后重置到 stage 0,depleted 用被采阶段 regrowTime\n'
        '- harvest() 修 bug:payload.depleted 现在用 this.depleted 而非未同步的局部变量\n'
        '- 6 个新 defs:tree_sprout/tree_old/dead_tree_sprout/dead_tree_old/berry_sprout/berry_bush_old\n'
        '- 3 个新物品:acorn/dead_wood_chunk/berry_seed (category=material, stackMax=20)\n'
        '- renderer 加 6 个 stage 变体图标 + 非终态生长进度条 + 终态星标\n'
        '- main.js 加 stage advance 黄色 banner + regrow 区分 growth 周期重启 vs 普通重生\n'
        '- m210 回归:tree 加 update(31*1000) 推进到 stage 1 保持原断言;用 _rootId 而非 id 找树\n'
        '- m210b 回归:regrow 测试改用 rock(非 growth-capable),避免新 growth 行为干扰\n'
        '- m210d 回归:allResources 17→23,allItems 20→23;§6 tree→rock;§6b 加 growth-capable 测试\n'
        '- README.md 加 M2.10 资源系统(M4 Canvas demo 端)章节,5 里程碑表 + M2.10e 设计详解\n'
        '- tests: m210e 97/97 + m210d 171/171 + m210c 76/76 + m210b 67/67 + m210 58/58 + m4 20/20 = 489/489'
    )
    r = requests.post(
        f'https://api.github.com/repos/{REPO}/git/commits',
        headers=HDRS,
        json={'message': msg, 'parents': [base_sha], 'tree': new_tree},
    )
    r.raise_for_status()
    new_sha = r.json()['sha']
    print(f'  new commit: {new_sha[:7]}')

    # 6. update ref
    r = requests.patch(
        f'https://api.github.com/repos/{REPO}/git/refs/heads/main',
        headers=HDRS,
        json={'sha': new_sha},
    )
    r.raise_for_status()
    print(f'PUSHED {new_sha[:7]} -> main')

if __name__ == '__main__':
    run()
