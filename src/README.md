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
