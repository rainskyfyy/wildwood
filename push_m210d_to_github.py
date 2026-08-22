#!/usr/bin/env python3
"""Push M2.10d (资源枯竭系统) to rainskyfyy/wildwood@main via Git Data API.

Files changed in M2.10d (relative to M2.10c parent cb318c2):
  - src/resources/resources.json          (4 new resources)
  - src/resources/items.json              (4 new items)
  - src/resources/catalog.js             (depletable exports + validation)
  - src/resources/resource-entity.js      (depletion + transform)
  - src/resources/gather.js               (new payload fields)
  - src/resources/README.md               (M2.10d section)
  - src/render/resource-renderer.js       (4 new icons + depleted X overlay)
  - src/main.js                           (depletion banner)
  - tests/m210d-depletion.mjs             (NEW — 156 tests)
  - push_m210d_to_github.py               (NEW — this script)
"""
import base64, os, sys, requests

REPO  = 'rainskyfyy/wildwood'
TOKEN = os.environ['GITHUB_TOKEN']
HDRS  = {
  'Authorization': f'token {TOKEN}',
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'wildwood-m210d-push',
}

FILES = [
  'src/resources/resources.json',
  'src/resources/items.json',
  'src/resources/catalog.js',
  'src/resources/resource-entity.js',
  'src/resources/gather.js',
  'src/resources/README.md',
  'src/render/resource-renderer.js',
  'src/main.js',
  'tests/m210d-depletion.mjs',
  'push_m210d_to_github.py',
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

    # 3. create blobs
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
        'M2.10d: 资源枯竭系统 + 4 个新矿物(coal/gold_ore/gem_vein/tin_ore) (156 tests)\n\n'
        '- catalog.js 加 isDepletable/getMaxHarvests/getDepletedTransformsTo 导出\n'
        '- resource-entity.js 支持 maxHarvests 达到后永久枯竭或 in-place 变身\n'
        '- gold_ore/gem_vein 枯竭后自动变为 rock(原地变低阶资源)\n'
        '- gather.js payload 加 harvestCount/maxHarvests/depleted/transformedTo\n'
        '- renderer 加 4 个新图标(coal/gold_ore/gem_vein/tin_ore) + depleted 红 X 覆盖\n'
        '- main.js 加 depletion 横幅(transform 提示 + 永久枯竭告警)\n'
        '- README.md 加 M2.10d 章节 + 4 资源表\n'
        '- tests: m210d 156/156 + m210c 76/76 + m210b 67/67 + m210 58/58 + m4 20/20 = 377/377'
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
