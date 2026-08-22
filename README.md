# Wildwood

> **类饥荒 × 星露谷暖色基底** · 2D 像素合作生存游戏 · Web 优先零安装 · 4 人小队 · 联机 + 单机

[![看板同步](https://img.shields.io/badge/看板-同步%20正常-4a7a4e)](https://rainskyfyy.github.io/wildwood/roadmap.html)
[![进度](https://img.shields.io/badge/v0.1--v0.7-73%20%2F%2073-4a7a4e)](https://rainskyfyy.github.io/wildwood/roadmap.html)
[![协议](https://img.shields.io/badge/协议-WS%20relay-6fa972)](server/relay.mjs)
[![License](https://img.shields.io/badge/license-内部协作-9aa3b2)](#)

[English](#) | 中文

---

## 一句话定位

**Wildwood 是一款基于 HTML5 Canvas 的 2D 像素合作生存游戏,4 人小队玩法,联机 + 单机双模式,Web 优先零安装,类饥荒的核心循环 × 星露谷的暖色美术基调。**

---

## 项目概述

Wildwood 是一支 4 人小队的 2D 像素合作生存游戏,灵感来自 *Don't Starve* 的硬核生存与 *Stardew Valley* 的暖色美术。游戏完全在浏览器中运行,无需安装客户端,主打 30 秒房间创建、4 人 WebSocket 联机与单/联机同代码双模式。

游戏世界由程序化生成(80×60 网格,5 大群系:森林 / 沙漠 / 沼泽 / 雪山 / 火山),玩家采集资源、建造庇护所、合成工具、驯服猪人、挑战季节 Boss、抵御满月事件,形成长期可玩的生存循环。

---

## 技术栈

| 层级 | 选型 | 说明 |
|---|---|---|
| **客户端引擎** | HTML5 Canvas 2D + ES Modules | 纯前端,无框架依赖,首屏 < 100KB |
| **客户端加载** | `<script type="module">` 链式加载 | `assembly.js → runtime.js → main.js` 三段式 |
| **联机协议** | WebSocket(原生 `WebSocket` API) | 房间码 4 位大写字母,host 权威 |
| **服务端** | Node.js 18+ (zero-dep) | `server/relay.mjs`,21KB,只做转发 + 房间生命周期 |
| **资源加载** | PNG + JSON 资源目录 | 24/29 色锁版调色板,0 中间灰阶 |
| **持久化** | `localStorage`(单机)+ 内存(联机) | 60ms 节流 save |
| **看板** | GitHub Pages + Python 静态 HTML | `docs/roadmap.html` 30 分钟自动同步 |
| **看板同步** | Git Data API(blob → tree → commit → ref) | 不依赖 git 凭证,沙箱内可跑 |
| **CI/CD** | GitHub Actions `actions/deploy-pages@v4` | push main 自动部署 |
| **项目管理** | aily 任务平台 + 飞书云文档 | 4 agent 并行 + dispatcher 协调 |

**演进历史**:
- 原 M1 规划为 Godot 4.3 / Go 1.22 房间服务 / Gorilla WebSocket
- M4 起切到纯前端 HTML5 Canvas(降低分发摩擦、便于 4 人协作迭代)
- v0.4 联机用 Node.js zero-dep relay 替代 Go 服务,体积更小、维护更轻

---

## 架构说明

Wildwood 整体分为四大模块,各自职责清晰、依赖单向:

### 1. 客户端 (`src/`)

**职责**:负责所有游戏世界渲染、玩家输入、资源加载、子系统协调。

**关键文件**:
- `src/main.js`(< 30 行入口):只调 `assembleGame` + `runGame`,暴露 `window.bootGame`
- `src/assembly.js`(15.9K 装配层):36 个 import + 子系统实例化,导出 `assembleGame(canvas, opts) → game`
- `src/runtime.js`(22.8K 运行时层):`frame()` 循环 + `render()` + 5Hz tick,导出 `runGame(game) → runtime`
- `src/util/escape-html.js` + `src/util/render-hooks.js`:跨层共享工具,打破装配/运行循环依赖
- `src/world/`:程序化世界生成、群系、装饰、村庄、NPC、过渡
- `src/player/`:玩家 + 摄像机
- `src/resources/`:资源系统(spawner / inventory / gather / catalog)
- `src/buildings/`:建造系统(placer / menu / renderer)
- `src/monster/` + `src/boss/`:战斗系统
- `src/events/`:事件系统(满月 / 陨石雨 / 地震)
- `src/npc/` + `src/trading/` + `src/follower/`:NPC 村 / 交易 / 随从(v0.5.4)
- `src/services/`:服务化抽象层(InventoryService v0.6.0b,后续扩展 Event/Building/Monster)
- `src/net/`:联机层(详见第 3 模块)
- `src/hud/`:顶层 HUD(BossBar / EventBanner / NPCAffinityBar)

**核心设计**:
- **装配/运行分离**:集成新子任务只动 `assembly.js`,调优帧循环只动 `runtime.js`
- **服务化**:所有 mutation 走 `Service.X` 单入口,Manager 字段保留为 UI 只读 pass-through
- **深度排序渲染**:player / decor / resource / building / monster / piglin / follower / remote 统一 `depthKey` 排序

### 2. 服务端 (`server/`)

**职责**:WebSocket 房间中继,只做消息转发 + 房间生命周期管理,**不参与游戏逻辑**(游戏逻辑在 host 浏览器里跑)。

**关键文件**:
- `server/relay.mjs`(21.8K,zero-dep):核心中继服务
  - 启动:`node server/relay.mjs` (默认端口 8787)
  - 房间码:4 位大写字母,host 创建时分配,join 时按码查找
  - 容量:每房 2-4 人
  - 断线:30s 内重连(随机 token)
  - 鉴权:控制消息(host/join/reconnect/leave)只由服务器处理;游戏消息原样广播

**协议**:
- 公共 relay 模式,任何客户端可创建或加入房间
- 协议定义在 `src/net/protocol.js`
- 消息类型:`G_CONTROL` / `G_STATE`(10Hz host 广播)/ `G_INPUT` / `G_ACTION` / `G_EVENT` / `G_CHAT`

**部署**:
- 开发:本地 `node server/relay.mjs` + 浏览器 `?relay=ws://localhost:8787`
- 生产:可部署到任何 Node.js 18+ 环境(Railway / Fly.io / 自建 VPS)

### 3. 联机层 (`src/net/` + `docs/multiplayer-rfc-v0.2.md`)

**职责**:实现 A/B 通用层,把"游戏逻辑"和"网络协议"解耦,使同一份游戏代码可运行在"单机"或"联机"模式。

**三层抽象**(详见 `docs/multiplayer-rfc-v0.2.md`):

| 层 | 关注点 | 谁拥有权威 | 替换难度 |
|---|---|---|---|
| **A 数据层** | 世界状态(地块、生物、库存、NPC 好感) | 服务端 | 高 |
| **B 网络协议层** | 消息类型、序列化、传输、心跳 | 双端共同定义,客户端可替换 | 中 |
| **资源元数据层** | tile 资源哈希、版本、patch 策略 | 服务端权威 | 低 |

**关键文件**:
- `src/net/multiplayer.js`:联机主类,负责 host/join/tick 调度
- `src/net/protocol.js`:协议定义(消息类型 + 序列化)
- `src/net/session.js`:会话管理(self / peers / state)
- `src/net/relay-client.js`:WebSocket 客户端
- `src/net/menu.js`:主菜单 UI(单人/创建房间/加入房间)
- `docs/multiplayer-rfc-v0.1.md`:v0.1 RFC(三层抽象框图)
- `docs/multiplayer-rfc-v0.2.md`:v0.2 RFC(每层 interface signature + 5 个 PoC)

**当前实现**(v0.4 → v0.7 演进):
- v0.4:WebSocket relay + 10Hz host snapshot
- v0.6:装配层 / 运行时层分离,为联机层解耦铺路
- v0.7:A/B 通用层 RFC 落地(7 月份 v0.1,v0.2 补完 interface signature)

### 4. 美术管线 (`assets/art/` + Aseprite 工作流)

**职责**:程序化 + 手绘混合的像素美术生产,保证剪影清晰、调色板统一、网格对齐、命名规范。

**目录结构**:
```
assets/art/
├── biomes/                    # 5 大群系(森林/沙漠/沼泽/雪山/火山)
│   ├── _shared/
│   │   ├── transitions/       # 群系过渡(15 个 3 帧动画)
│   │   └── decorations/       # 跨群系装饰(萤火虫/沙丘蜥蜴/雪松果等 16 个)
│   ├── forest/
│   ├── desert/
│   ├── marsh/
│   ├── snow/
│   └── volcano/
│   └── (每个群系:tiles/ 5 个 + elements/ 5-6 个 + README.md)
├── buildings/                 # 5 个建筑(campfire/bonfire/crock_pot/chest/shelter)
├── hero/protagonist_28frames/ # 主角 4 方向 × 7 状态 = 28 帧
├── monsters/                  # 5+ 怪物(bat_20frames / hound_20frames 等)
├── biomes/_shared/...         # 跨群系共享素材
└── audio/                     # 音效(集成中)
```

**硬约束**(美术铁律,5/5 全过):
1. **剪影**:每个 tile 剪影互不混淆(无需看颜色也能区分)
2. **色板**:29 色字典(24 锁版 + 5 冷色扩展),0 违例
3. **网格**:整数坐标,0 误差
4. **抗锯齿**:0 中间灰阶(纯像素)
5. **暖色占比**:每群系暖色 ≤ 40%(保证冷色群系不被暖色淹没)

**生产模式**:
- 调色板字典 + 形状函数 + 输出循环 = 批量程序化生成
- 29 色字典 + 暖/冷二分标签 + biome affinity 子集
- 飞书云文档 + GitHub 直推双轨交付(参考 v0.6.2a 雪山群系范式)

---

## 图片素材示例

下面是 Wildwood 已交付的部分美术素材,均来自 `assets/art/biomes/`。

### 群系瓦片(每群系 5 块)

| 群系 | 样图 |
|---|---|
| **沙漠**(sand_base) | ![desert sand](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/desert/tiles/sand_base.png) |
| **沼泽**(mud_base) | ![marsh mud](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/marsh/tiles/mud_base.png) |
| **雪山**(snow_base) | ![snow base](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/snow/tiles/snow_base.png) |
| **火山**(lava_flow) | ![lava](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/volcano/tiles/lava_flow.png) |

### 群系元素(树/装饰)

| 元素 | 样图 |
|---|---|
| **雪山松树**(pine_tree_snow) | ![pine](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/snow/elements/pine_tree_snow.png) |
| **冰晶**(ice_crystal) | ![ice](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/snow/elements/ice_crystal.png) |
| **熔岩池**(lava_pool) | ![lava](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/volcano/elements/lava_pool.png) |
| **硫磺晶**(sulfur_crystal) | ![sulfur](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/volcano/elements/sulfur_crystal.png) |
| **仙人掌**(cactus) | ![cactus](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/desert/elements/cactus.png) |
| **毒蘑菇**(poison_mushroom) | ![mushroom](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/marsh/elements/poison_mushroom.png) |

### 跨群系装饰

| 装饰 | 样图 |
|---|---|
| **萤火虫**(forest) | ![firefly](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/_shared/decorations/forest/firefly.png) |
| **沙丘蜥蜴**(desert) | ![lizard](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/_shared/decorations/desert/lizard.png) |
| **雪松果**(snow) | ![pinecone](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/_shared/decorations/snow/pinecone.png) |
| **余烬火星**(volcano) | ![ember](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/_shared/decorations/volcano/ember_spark.png) |

### 群系过渡(3 帧动画)

| 过渡 | 起始帧 |
|---|---|
| **森林→沙漠** | ![forest2desert step0](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/_shared/transitions/forest2desert_step0.png) |
| **森林→雪山** | ![forest2snow step0](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/_shared/transitions/forest2snow_step0.png) |
| **沙漠→火山** | ![desert2volcano step0](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/biomes/_shared/transitions/desert2volcano_step0.png) |

### 建筑

| 建筑 | 样图 |
|---|---|
| **篝火**(campfire) | ![campfire](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/buildings/campfire.png) |
| **大篝火**(bonfire) | ![bonfire](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/buildings/bonfire.png) |
| **陶罐**(crock_pot) | ![crock](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/buildings/crock_pot.png) |
| **箱子**(chest) | ![chest](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/buildings/chest.png) |
| **庇护所**(shelter) | ![shelter](https://raw.githubusercontent.com/rainskyfyy/wildwood/main/assets/art/buildings/shelter.png) |

> 完整素材清单请见 [美术管线 README](#4-美术管线-assetsart--aseprite-工作流) 目录树;每周版本交付会同步更新 [看板](https://rainskyfyy.github.io/wildwood/roadmap.html)。

---

## 版本进展与里程碑

Wildwood 走 M1-M5 路线图,共 73 个子任务,**截至 2026-08-22 全部 100% 完成(v0.1-v0.7)**。完整进度见 [Wildwood 看板](https://rainskyfyy.github.io/wildwood/roadmap.html)。

| 版本 | 主题 | 状态 | 子任务 | 一句话说明 |
|---|---|---|---|---|
| **v0.1** | 美术资产 | ✅ 已完成 | 15/15 | Godot/Go 项目初始化、WebSocket 连通、5 张样稿风格化定版、Aseprite 工作流、A/B 通用层 3 层抽象接口 |
| **v0.2** | 核心引擎 | ✅ 已完成 | 19/19 | 移动/采集/建造/合成/生存属性/死亡复活/世界持久化/4 大群系/季节循环/战斗/图鉴/HUD/4 屏交互 |
| **v0.3** | 游戏系统 | ✅ 已完成 | 14/14 | 资源系统(60+ 资产入库)、建造/工具兼容/重生调度/耐久度;v0.3.5 起纯前端 Canvas 化 |
| **v0.4** | 打磨与联机 | ✅ 已完成 | 4/4 | 音效 + 同步;WebSocket relay + 10Hz host 广播 + 30s 断线重连 + 2-4 人房间 |
| **v0.5** | 内容扩展 | ✅ 已完成 | 7/7 | 烹饪系统、怪物 + 季节 Boss、UI polish、NPC 村落(猪人/交易/随从) |
| **v0.6** | 架构重构 | ✅ 已完成 | 8/8 | main.js 拆分为 assembly + runtime、InventoryService 单向接口、spawner fixture 抗 RNG 漂移、联机 RFC v0.1 |
| **v0.7** | A/B 通用层 | 🔄 当前 | 6/6 | 联机 RFC v0.2(interface signature 补全 + 5 PoC)、看板可观测性、3a 收口、4a NPC 同步、4a 同步抽象 |
| **v1.0** | 正式版 | ⏳ 下一里程碑 | - | 全 A/B 通用层落地 + 全群系完成 + 全系统联机化 + 4 人小队完整玩法 |

---

## 快速开始

### 浏览器打开 demo(单机模式)

```bash
git clone https://github.com/rainskyfyy/wildwood.git
cd wildwood
# 任一静态服务器即可
python3 -m http.server 8080
# 打开 http://localhost:8080/demo.html?mode=offline
```

### 启用联机模式(需先启动 relay)

```bash
# 终端 1:启动 relay 服务
node server/relay.mjs
# 终端 2:打开 demo,默认走 ws://localhost:8787
python3 -m http.server 8080
# 浏览器 1:http://localhost:8080/demo.html → 创建房间 → 拿到 4 位房间码
# 浏览器 2:http://localhost:8080/demo.html → 加入房间 → 输入房间码
```

> 联机模式下,host 浏览器跑游戏逻辑,relay 只做消息转发 + 房间生命周期管理。带宽估算:4 人 × 10Hz × ~500B ≈ 20 KB/s 上行,40 KB/s 下行。

### 运行测试

```bash
node tests/m2.14-smoke.mjs
node tests/m5.2-main-integration.mjs
node tests/m6.0b-inventory-svc.mjs
node tests/v060c-spawner-fixture.mjs
```

### 看板同步(本地)

```bash
export GH_TOKEN=ghp_...
python3 scripts/update_roadmap.py
# 推送 docs/roadmap.html 到 main,GitHub Pages 自动部署
```

---

## 项目结构

```
wildwood/
├── README.md                        ← 你在这里
├── demo.html                        ← 浏览器入口(单机/联机菜单)
├── server/
│   └── relay.mjs                    ← WebSocket 中继(zero-dep, 21.8K)
├── src/
│   ├── main.js                      ← < 30 行入口
│   ├── assembly.js                  ← 装配层
│   ├── runtime.js                   ← 运行时层
│   ├── util/                        ← 跨层工具
│   ├── world/  player/  resources/  buildings/
│   ├── monster/  boss/  events/  npc/  trading/  follower/
│   ├── cooking/  processing/  farming/  ecology/
│   ├── services/                    ← 服务化抽象(InventoryService 等)
│   ├── net/                         ← 联机层
│   ├── hud/  ui/  render/  animation/  audio/
│   └── data/                        ← 静态数据(怪物/资源/群系)
├── assets/
│   └── art/                         ← 美术资产
│       ├── biomes/{forest,desert,marsh,snow,volcano}/
│       ├── biomes/_shared/{transitions,decorations}/
│       ├── buildings/  hero/  monsters/  audio/
├── docs/
│   ├── roadmap.html                 ← 看板(GitHub Pages 自动部署)
│   ├── multiplayer-rfc-v0.1.md
│   ├── multiplayer-rfc-v0.2.md
│   ├── spawner-fixture-guideline.md
│   └── index.html
├── scripts/
│   └── update_roadmap.py            ← 看板自动同步
├── tests/                           ← 单元/集成测试
└── .github/
    └── workflows/pages.yml          ← GitHub Pages 部署
```

---

## 协作与团队

| 角色 | Agent ID | 负责 |
|---|---|---|
| **项目经理** | 小德芙 | 任务派发、看板协调、版本收口 |
| **高级开发工程师** | agent_4kvsawy2e9erytk | 架构设计、核心模块、联机层 |
| **AI 画师** | agent_4kvsb16csvuggf7 | 像素美术、群系元素、调色板字典 |
| **UI 设计师** | agent_4kvsaxazwxb44q0 | HUD 组件、5Hz 同步、NPC 好感度 |
| **工作台搭建师** | agent_4kvsbdu7xschs8w | 看板、CI/CD、GitHub Pages |

**协作模式**:
- 任务派发:aily 平台 `task create --assignee <agent_id>`
- 看板状态:30 分钟自动同步到 GitHub Pages
- 文档交付:飞书云文档 + GitHub commit 双轨
- 代码提交:`v0.X.Ya: <title>` 批次号前缀 + Git Data API 直推

---

## 相关链接

- **看板**:[rainskyfyy.github.io/wildwood/roadmap.html](https://rainskyfyy.github.io/wildwood/roadmap.html)
- **联机 RFC v0.1**:[docs/multiplayer-rfc-v0.1.md](docs/multiplayer-rfc-v0.1.md)
- **联机 RFC v0.2**:[docs/multiplayer-rfc-v0.2.md](docs/multiplayer-rfc-v0.2.md)
- **Spawner Fixture 规范**:[docs/spawner-fixture-guideline.md](docs/spawner-fixture-guideline.md)
- **联机中继服务**:`server/relay.mjs`
- **项目总方案**(飞书):[《项目总方案》](https://hisense.feishu.cn/docx/M5pEdEDvPoUGpGxgiWUcLxSQnGu)
- **任务拆分表**(飞书):[《项目任务拆分表》](https://hisense.feishu.cn/docx/JrCmdC2S9o4ID5xRM70cuSNsnS2)

---

## License

内部协作项目,All rights reserved.

---

<sub>📝 本 README 由 dev 团队维护,如有更新请 PR 修改并 mention 高级开发工程师 + AI 画师。</sub>
