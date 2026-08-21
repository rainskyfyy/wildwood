# Wildwood UI · v0.5.4 NPC 系统

> 类饥荒 × 暗黑哥特风 · 好感度 / 招募 / 随从 / 村落交易中心

## 模块组成

| 文件 | 职责 |
|---|---|
| `npc.css` | 对话气泡、3 心条、随从 HUD、交易中心、像素猪人头像 |
| `npc.js` | 气泡状态机、好感度逻辑、招募、随从管理、交易中心 |
| `README.md` | 本文件 · API 文档 |

## 核心特性

### 1. 对话气泡(`.NPCBubble`)
- 位置: 锚点(猪人 DOM)上方 8px,水平居中
- 箭头朝下指向猪人(`.NPCBubble-Tail.is-bottom`)
- 3 秒自动 fade out(`.is-fading` 200ms 淡出)
- 点击加速消失
- 3 种类型:
  - `is-positive`(绿框): 喜欢/成功/招募
  - `is-negative`(红框): 厌恶/拒绝/低血
  - `is-neutral`(灰框): 普通/取消

### 2. 语料池(随机抽取)
| 类别 | 数量 | 触发场景 |
|---|---|---|
| `welcome` | 10 | 玩家进入猪人视距 |
| `farewell` | 9 | 玩家离开 |
| `trade` | 8 | 打开交易对话框 |
| `follow` | 9 | 招募后跟随 |
| `low_hp` | 5 | 随从血量低 |
| `recruit_ready` | 4 | 满心可招募 |

### 3. 好感度系统(`.AffinityDisplay`)
- 0-3 心,空心 `♡` / 实心 `♥`
- 喂食: `feedPig(pig, foodItemId)` → `+1 心`
  - 触发 `affinityUp` 动画:心从 0.4 缩放弹到 1.3,再回弹到 1.0
  - `+1` 数字飘字:从心位置上升 24px + 淡出
- 满心: `AffinityRecruitFlag` 琥珀标签闪烁(`steps(2)` 1.2s)
- 满心时可招募: `recruitPig(pig)` → 猪人 mood='follow'

### 4. 随从 HUD(`.FollowerHUD`)
- 位置: 玩家右下角(快捷栏上方 88px,右侧 16px)
- 组成: 猪人头像 + 名字 + 血条 + 好感度 + 3 操作按钮
- 5Hz 血量恢复:1 HP/秒
- 操作: 攻(测试血量) / 停(回到 idle) / 离(解散随从)

### 5. 村落交易中心(`.TradingCenterDialog`)
- 4 Tab: 全部 / 食物 / 材料 / 工具
- 物品卡:图标 + 名称 + 单价 + 库存 + 持有数 + [买入][卖出]
- 价格: 调用 `window.Trading.priceForBuy`(供需+偏好模型)
- 金币: `window.__playerCoins`(外部传入/可改)
- 买不起/不可卖:`TradingCenterItem-NotAffordable` 灰显

### 6. 5Hz 同步
- 气泡 fade 由 setTimeout 触发(3s, 不依赖 tick)
- 随从血量恢复:每 200ms tick 加 0.2 HP
- 状态变化通过 `window.__hudBus` 广播:
  - `npc:affinity-up` { pigId, itemId, affinity }
  - `npc:recruit` { pigId }
  - `npc:leave` { pigId }
  - `trade-center:open` / `trade-center:close`
  - `trade-center:buy` { itemId, count, price }
  - `trade-center:sell` { itemId, count, price }

## 加载顺序

```html
<link rel="stylesheet" href="./src/ui/layout/tokens.css">
<link rel="stylesheet" href="./src/ui/components/components.css">
<link rel="stylesheet" href="./src/ui/trading/trading.css">
<link rel="stylesheet" href="./src/ui/npc/npc.css">

<script src="./src/ui/hud.js"></script>
<script src="./src/ui/trading/trading.js"></script>
<script src="./src/ui/npc/npc.js"></script>
```

## 使用示例

### 显示对话气泡
```javascript
// 一次性
window.NPC.showBubble(pig, '欢迎~', { kind: 'positive' });

// 队列(每 3.2s 切换一句)
window.NPC.showBubbleQueue(pig, [
  '欢迎~',
  '看看带了什么',
  '嗅嗅...木头味'
]);

// 隐藏
window.NPC.hideBubble(pig);
```

### 好感度
```javascript
// 喂食
var result = window.NPC.feedPig(pig, 'carrot');
if (result.success) {
  console.log('新好感度:', result.newAffinity);
}

// 直接渲染(用于其他 UI)
var container = document.getElementById('aff-bar');
window.NPC.renderAffinity(container, 2);  // 2 颗实心
```

### 招募 / 离队
```javascript
// 招募(满心时)
window.NPC.recruitPig(pig);
// → 自动: 猪人 mood='follow', 显示随从 HUD, 推 hudBus

// 离队
window.NPC.dismissFollower(pig);
// → 清除随从 HUD, 推 hudBus
```

### 村落交易中心
```javascript
window.__playerCoins = 100;
window.NPC.openTradingCenter({
  coins: 100,
  inventory: [
    { itemId: 'twigs', count: 8 },
    { itemId: 'flint', count: 4 }
  ],
  pigs: [
    { id: 'pig_forest_1', name: '森林猪人', affinity: 2 }
  ]
});
```

### 浏览器快捷键演示

| 键 | 行为 |
|---|---|
| `N` | 打开 mock 交易(森林猪人) |
| `T` | 打开村落交易中心 |

## 验收自检

- ✓ 好感度 0-3 心,喂食 +1,满心可招募
- ✓ 对话气泡 3 秒自动消失,暗黑哥特风 + 箭头指向
- ✓ 随从 HUD 显示血量/好感度,5Hz 回血
- ✓ 村落交易中心食物/材料/工具 3 Tab
- ✓ 全部从 tokens.css 取值,8/16 像素对齐
- ✓ 复用 `.Dialog` / `.Button` / `.VitalBar` 组件
- ✓ 5Hz 同步(随从回血、状态广播)
- ✓ 交易气泡 3 秒自动消失,点击加速

## 已知限制

- 猪人像素画: 使用单字符 `猪` 占位(等美术提供 4 方向行走 + idle 动画)
- 喂食食物校验: 仅 `tags` 含 `food` 的物品可喂食
- 交易中心的库存数基于 hash 模拟(无真实猪人库存)
- 同一时刻只允许一个交易对话框 + 一个交易中心

## 与其他子任务的关系

| 任务 | 关系 |
|---|---|
| v0.5.4 交易模块 | 调用 `window.Trading.ITEMS` + `priceForBuy` |
| M2.10 资源系统 | 物品 ID 契约 |
| M2.11 图鉴系统 | 物品名称/图标契约 |
| M2.12 HUD 状态机 | 5Hz 同步源 |
| M1.8 组件库 | 复用 `.Dialog` / `.Button` |
| 美术(v0.5.4 AI 画师) | 猪人 4 方向帧动画(本模块使用 `猪` 字占位) |
