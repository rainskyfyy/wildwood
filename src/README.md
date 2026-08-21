# M4 核心游戏系统 MVP

> 纯前端 HTML5 Canvas,无框架;32×32 tile;45° 俯视斜角;4 群系(森林/平原/矿区/雪原)。

## 模块布局

```
src/
  world/
    perlin.js          Ken Perlin fBm 噪声(Mulberry32 PRNG,确定性)
    biome-config.js    4 群系定义 + 装饰池 + pickBiome()
    generator.js       WorldGrid 2D 数组:tiles/elevation/moisture
    transitions.js     邻接群系过渡带 + 颜色混合
    decorator.js       按 decorPool 权重散布装饰物
  player/
    player.js          子 tile 精度移动 + 轴分离碰撞
    camera.js          摄像机跟随 + viewBounds() 视口剔除
  render/
    isometric.js       45° 投影 / worldToScreen / depthKey
    tile-renderer.js   群系 sprite 缓存 + 装饰/角色绘制
  hud/
    vitals.js          生命/饥饿/理智三条
    hotbar.js          5 格快捷栏(1-5 切换)
    minimap.js         右上角缩略图 + 摄像机框
    hud.js             顶层装配
  utils/
    input.js           键盘状态 + 边沿触发 + 轴向
  main.js              入口(bootGame(canvas))
  README.md            模块文档
demo.html              可运行 demo 页面
tests/
  m4-node-smoke.mjs    Node 端算法 smoke(20/20 全过)
```

## 启动

```bash
# 任何静态文件服务器都行
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/demo.html
```

## 设计要点

### 1. 群系生成
- `PerlinNoise(seed)` 两个独立 PRNG(高程 + 湿度),默认种子 `20260822`
- `fbm(x*scale, y*scale, 4, 0.5)` — 4 倍频叠加,scale=0.05 → 单群系约 20 tile
- `pickBiome(e, m)` 按优先级:`mines`(高+干)>`snow`(中高+干)>`forest`(湿)>`plains`(兜底)
- 同种子 + 同尺寸 → 完全可复现

### 2. 过渡带
- 4 邻域扫一次,记录第一异群系邻居 + 中点混合
- 渲染层在原 sprite 上叠 55% 透明色遮罩,模拟 `_shared/transitions/`
- 真实 PNG 落地后只需把 `transitions.js` 改为切图,接口不动

### 3. 装饰物
- 按 `biome.decorPool` 权重抽签,4-5 类/群系
- 抖动:装饰相对 tile 中心 ±0.2 tile,大小 0.55-0.9 比例
- 深度排序:与玩家一起按 `(x + y)` 升序绘制

### 4. 玩家 + 摄像机
- 子 tile 精度:玩家用 `(12.4, 7.7)` 表达
- 碰撞:轴分离(X 先,再 Y),4 角 tile 都需可走
- 摄像机 0.18 lerp 跟随,viewBounds 加 1 tile 余量

### 5. HUD
- Vitals 左上、Minimap 右上、Hotbar 底中
- 生命/饥饿/理智持续缓降(0.4/0.2 per second),便于看刷新
- Hotbar 1-5 边沿触发;占位物品 axe/pickaxe/torch/food/rock

## 资产占位

`assets/art/biomes/{biome}/` 暂未入库。本模块以 Canvas 程序绘制:

- 群系 sprite:`src/render/tile-renderer.js` `buildSprite(biomeId)`
  - 32×32 菱形 + 主色填充 + 4 角点缀 + 高光 + 1px 描边
- 装饰:`drawDecoration(ctx, x, y, decor)` 按 kind 分支绘制
- 玩家:`drawPlayer(ctx, x, y, facing)` 头 + 身 + 朝向眼

真实 PNG 落地后:
1. 替换 `assets/art/biomes/{biome}/ground.png` 32×32
2. `tile-renderer.js` 加分支:`if (img loaded) drawImage(img, ...) else buildSprite()`
3. 装饰同理(每类一个 PNG)

## 验证

```bash
node tests/m4-node-smoke.mjs
```

覆盖:
- `PerlinNoise.fbm` 范围/种子稳定性
- `generateWorld` 4 群系比例、确定性
- `scatterDecorations` 总数/平均密度
- `computeTransitions` 邻接边界
- `pickBiome` 阈值分支

GUI 验证(必须有浏览器):打开 `demo.html`,检查
- 4 群系色块可分辨
- 群系边界有渐变过渡
- WASD/方向键移动,贴墙停下
- 摄像机跟随,小地图白框同步
- 快捷栏 1-5 切换高亮
- HP/饥饿/理智缓慢下降

## 与既有 M2.7 数据层的关系

- 4 群系 ID 与 `assets/biomes/biome_map.json` 一致(forest/plains/mines/snow)
- tile 尺寸 32×32 与 M2.7 chunk_grid=32 对齐
- 9 宫格流式加载(M2.7)是后续 M5+ 任务,M4 仅在内存里生成 80×60
- 持久化(M2.6)后续接入,本模块的 WorldGrid 可直接喂给 M2.6 序列化

## 未做(留给后续)

- 网络同步(M3.1 已就位,M4 仅单人本地)
- 物品系统真实数据(目前 5 占位)
- 季节 / 昼夜视觉(M2.8 已通过 LightController 接入,本模块色板固定)
- 4 人队伍 / 主机 host(M3.1 协议层已预埋)

---

# M5 美术资产接入

> 用 M3.13 真实 PNG 替换 M4 的程序绘制;Canvas API 表面不变。

## 接入范围

| 层级 | M4 状态 | M5 状态 |
| --- | --- | --- |
| Tile sprite | 程序菱形 `buildSprite(biomeId)` | 4 群系 × 5 PNG 变体,`getTileSpriteAt(id, x, y)` 按 (x,y) 哈希选变体 |
| Decoration | `drawDecoration` 按 kind 分支程序绘制 | `decor.art` 路径优先 `drawImage`,失败回退程序 |
| Transition | `blendColors` 颜色混合 | `transitionArt(a, b, blend)` 查 M3.13 PNG(3 对有 art),缺失回退 `blendColors` |
| 加载 | 同步 | `preloadImages()` 异步预加载,首帧前显示 Loading 进度条 |

## 4 群系(M5)

| id | 主色 | 装饰池来源 | 过渡 art 覆盖 |
| --- | --- | --- | --- |
| `desert` | 暖沙 `#c9a96e` | `assets/art/biomes/_shared/decorations/desert/`(lizard, sand_ripple, scorpion, tumbleweed) | ↔snow ↔volcano |
| `marsh` | 暗绿泥 `#5a5a3a` | **无真 art,程序回退**(mud_speck / reed / moss_patch) | 无(全走程序) |
| `snow` | 冷白 `#d8e4ec` | `.../decorations/snow/`(icicle, pinecone, rabbit_track, snowflake) | ↔desert ↔volcano |
| `volcano` | 暗红黑 `#3a2a26` | `.../decorations/volcano/`(ash, ember_spark, lava_bubble, sulfur_crystal) | ↔desert ↔snow |

## 模块改动清单

| 文件 | 改动 |
| --- | --- |
| `src/render/image-loader.js` | **新增** — 异步 `loadImage / preloadImages / isReady / getOrFallback` |
| `src/world/biome-config.js` | 4 群系改为 `desert/marsh/snow/volcano`;每群系带 `tileArt[5]` 路径;新增 `transitionArt(a, b, blend)` + `pickTileVariant(x, y, n)` |
| `src/world/generator.js` | `BIOME_TO_CODE` 顺序同步:`[desert, marsh, snow, volcano]` |
| `src/world/decorator.js` | decor 加 `art: string\|null` 字段, marsh 全为 null |
| `src/world/transitions.js` | 转发 `transitionArt`;`blendColors` 不变 |
| `src/render/tile-renderer.js` | `getTileSprite(id, variant=0)` + `getTileSpriteAt(id, x, y)`;`drawDecoration` 走 `decor.art` 优先 |
| `src/main.js` | `bootGame` 启动时 `preloadImages(54 paths)`,首帧画 Loading 进度条;tile 渲染走 `getTileSpriteAt`;过渡渲染查 M3.13 PNG,失败回退 |
| `tests/m4-node-smoke.mjs` | 4 群系名 + tileArt 长度 + decor.art 字段 + transitionArt 覆盖表断言(79/79 全过) |

## 路径约定

所有 PNG 相对 `demo.html` 解析(`./assets/...`):

- Tiles:`./assets/art/biomes/{desert,marsh,snow,volcano}/tiles/<name>.png` × 5 = 20
- Decorations:`./assets/art/biomes/_shared/decorations/{desert,snow,volcano}/<name>.png` × 4 = 12(marsh = 0)
- Transitions:`./assets/art/biomes/_shared/transitions/{a}2{b}_step{0,1,2}.png` × 3 对 × 3 步 = 9
  - 注意:全 18 个 transition PNG 中, 9 个是 `forest↔X` 旧资产(M2.7),M5 不读;3 对(9 个)用于 `desert/snow/volcano` 之间
- **总计 M5 实际加载:20 + 12 + 9 = 41 张**

## 程序回退链

```
getOrFallback(path, builder):
  1. 命中已加载 Image → 直接返回
  2. 命中加载失败    → 返回 builder() Canvas(单例缓存)
  3. 仍在加载中      → 返回 1×1 stub,下帧继续试
```

装饰 / 过渡的 procedural fallback 与 M4 等价:矿点用圆点、reed 用竖线、过渡用菱形色块。

## 确定性

- `pickTileVariant(x, y, n)` 是 bit-mix 哈希,无 PRNG 实例化,确定性
- `scatterDecorations` 走原 Mulberry32,decor 数 + 位置完全可复现
- 同一 `seed` + `width` + `height` → 同一世界 → 同一 tile variant 选择

## 验证

```bash
node tests/m4-node-smoke.mjs
```

覆盖(M5 新增):
- `tileArt` 长度=5、`.png` 结尾
- marsh 的 decor.art 全 null,其他 3 群系至少 1 个有 art
- `transitionArt` 3 对有 art(↔ marsh 全 null)、step ∈ [0, 2]
- scatterDecorations 输出的 art 字段存在性
- 4 群系(沙漠/沼泽/雪原/火山)分布 > 0

GUI 验证(浏览器):`demo.html` 打开后:

1. 启动看到 Loading 进度条 → ~几十毫秒后消失
2. 4 群系可分辨(沙黄 / 暗绿 / 雪白 / 红黑)
3. 装饰物以真实 PNG 出现(沙漠蝎子、雪原雪花、火山灰烬等)
4. 群系边界:沙漠↔雪/火 走真实过渡 PNG(渐变菱形),沼泽↔任意 走程序色块
5. 同一世界内同一 tile 始终用同一变体(刷新不变化)

## 与 M3.13 art 链路的边界

- M5 用了 M3.13 的 4 群系 tile / 3 群系 decor / 3 对过渡,**未消费**:
  - 4 群系 `elements/`(cactus / dead_tree / frozen_remains 等)— 留给 M5+ 资源实体
  - `forest` 群系 art(M3.13 不再有 forest 群系 tile)— M2.7 遗留
  - 旧 `forest↔X` 过渡 PNG — M2.7 遗留
- M5 不动 `src/hud/*` — HUD 由 UI 设计师 M1.8/M2.12 接管

# M2.14 怪物动画系统

> 5 怪物 × 4 方向 × 2 动作(idle/walk) 静态 PNG 接入;帧动画引擎 +
> 状态机 AI + A* 寻路 + 碰撞解算;复用 M2.9 `WorldGrid.occupants`
> 屏蔽建筑占用,与 M5 美术资产接入无缝叠加。

## 模块布局

```
src/
  animation/
    animator.js          通用帧动画引擎(单帧 / sprite sheet / 状态机)
  monster/
    pathfinding.js       A* 寻路(4 方向 + 二叉堆,Manhattan 启发)
    monster.js           实体:子 tile 位置 + IDLE/WANDER/CHASE 状态机
    monster-manager.js   协调:spawn / update / resolve sprite / 重叠解算
  data/
    monsters.json        5 怪物属性(HP/速度/侦测/巡游/帧率/方向偏好)
  render/
    tile-renderer.js     追加 drawMonster(ctx, sx, sy, monster, sprite)
  main.js                集成 monsterMgr.update / depth-sorted render
  README.md              本节
tests/
  m2.14-smoke.mjs        Node 端 114/114 全过(animator / A* / 状态机 / 碰撞 / manager)
```

## 启动

```bash
# 不需要额外步骤 —— 复用 demo.html 与现有 M5 启动流程
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/demo.html
# 玩家进入怪物侦测范围(detectRange)即触发 A* 追击
```

## 设计要点

### 1. 帧动画引擎

`Animator` 是与具体资源无关的纯逻辑(无 canvas 依赖,可在 Node 测):

- **多帧 sprite sheet 模式**:`{ sheet, frameWidth, frameHeight, frameCount, fps, loop }`
  - 内部维护 `time` 累加器和 `frameIndex`,`tick(dt)` 推进
  - 循环 / 单次播放 + `finished` 标记
- **单帧状态表模式**:`buildStateTableAnimator({ idle: { down: img, ... }, walk: { ... } })`
  - M2.14 怪物资源是 5 怪 × 4 方向 × 2 动作 = 40 张独立 PNG,每张即一帧
  - 状态切换 = 切换 sprite 引用;`tick` 仍推进但 frameIndex 无变化
- `setState({ action, facing })` 重置时钟,unknown facing 自动回退 down

### 2. 怪物 AI

3 个状态(`MonsterState`):`IDLE` → `WANDER` → `CHASE` → `WANDER`(失去目标)

- `IDLE`:站立,0.5-1.7s 后切 WANDER
- `WANDER`:随机选 1 个 `wanderRadius` 内的 walkable tile,走过去
- `CHASE`:`chebyshev` 距离 ≤ `detectRange` 触发,每 0.4s 重 A* 一次
  - 玩家走出 `detectRange` → 回 WANDER
  - 路径不存在(被建筑 / 不可走区域包围)→ 回 WANDER,不锁死

### 3. A* 寻路

`src/monster/pathfinding.js`:

- 4 方向移动,`isWalkable(x, y)` 决定 tile 可走(自动屏蔽 `occupants` 建筑)
- Manhattan 启发 + 二叉堆开集(自己写的 `MinHeap`,无外部依赖)
- `gScore` / `cameFrom` / `closed` 都是 `Float32Array` / `Uint32Array`,O(1) 更新
- `maxNodes=2000` 节点上限,避免巨型开放场景死循环
- 性能:80×60 全开网格 < 10ms(实测 8.8ms,留 5× 裕量)

### 4. 碰撞

怪物与 player 走完全一致的 4 角 tile 检查:

```js
const left = floor(x - 0.3), right = floor(x + 0.3);
const top  = floor(y - 0.3), bot   = floor(y + 0.3);
return !world.isWalkable(left, top) || !world.isWalkable(right, top) || ...;
```

轴分离解算(先 X 后 Y)→ 自动沿墙滑行,与 M4 player 行为一致。

怪物 ↔ 怪物:`MonsterManager._resolveOverlaps()` 每次 update 末做一次
最小推出(2 × body_half + 0.05 epsilon),5 怪物一次过。

### 5. 资源加载策略

怪物 PNG 单张 7-10 MB,5 怪 × 4 方向 × 5 动作 = 100 张 ≈ 800 MB,**绝不预加载**。
改走与 `image-loader` 一致的懒加载:

- `MonsterManager._buildStateTable` 触发 `loadImage(path)` 注册到 image-loader 缓存
- 渲染时 `resolveSprite(monster)` 走 `getOrFallback` 链:PNG 就绪 → 画 PNG,否则画程序化菱形 fallback
- `monsters.json` 也用 `fetch` 异步加载,boot 立即跑、JSON 到了再 spawn

`drawMonster` 增量:居中绘制 + walk 时 1px 垂直 bob + hp<maxHp 时 1px HP bar(红→绿)。

## 验证

```bash
node tests/m2.14-smoke.mjs
# → M2.14 smoke: 114/114 pass
```

覆盖:
- monsters.json:5 怪 × 11 字段 + actions ⊇ {idle, walk}
- Animator:多帧循环 / 单次停止 / `setState` 重置 / unknown facing 回退
- A*:直线路径 / 单墙绕路 / 全占用无路径 / 80×60 < 50ms / 同点空路径
- 状态机:IDLE→WANDER、CHASE 触发、A* 路径规划
- 碰撞:占用 tile 阻挡 / 建筑占用阻挡
- Manager:`_meta` 过滤 / 5 怪 spawn / 互不重叠 / 全部 IDLE / state table 路径

GUI 验证(浏览器):`demo.html` 启动后:
1. 几帧后画面出现 5 只程序化菱形(等 PNG 下载)→ 切换为真实怪物 PNG
2. WASD 走向任意怪物 → 接近到 detectRange(5-8 tile)时怪物停止闲逛、朝玩家方向 walk
3. 怪物自动 A* 绕开 M2.9 建筑(若已放置)
4. HP bar 仅在玩家攻击后出现(本里程碑不实装攻击,故全程不显)
5. 怪物重叠时自动弹开,无叠层

## 与其它里程碑的边界

- **M2.14a 资产**:`assets/art/monsters/{bat,treant,spider,merm,hound}_20frames/`,
  5 怪 × 4 方向 × 5 动作(本里程碑只用 idle + walk)
- **M2.9 建筑**:通过 `WorldGrid.occupants` 自动屏蔽,无需修改 placer
- **M5 美术资产**:本里程碑只 `import` `loadImage` / `getOrFallback`,不动 tile-renderer 已有函数
- **未实装**:
  - 玩家 ↔ 怪物伤害(M2.15)
  - 怪物死亡 / 掉落(M2.15)
  - 飞行 / 穿墙(目前走通用陆地寻路,bat 注释里标了 passThroughWalls 预留字段)
  - 群系专属刷怪点(目前 spawn 走 `preferredBiome` 偏好 + 随机 200 次)
  - 联机同步(M3.12+ 接入)
