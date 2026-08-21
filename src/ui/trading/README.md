# Wildwood UI · v0.5.4 交易系统 (Trading)

> 类饥荒 × 暗黑哥特风 · 以物易物 + 好感度门 + 实时反应气泡

## 模块组成

| 文件 | 职责 |
|---|---|
| `trading.css` | 交易对话框、报价面板、价格标签、反应气泡 — 全部基于 tokens.css 的 8/16 像素 |
| `trading.js` | 交易状态机、报价校验、价格模型(供需+偏好)、5Hz 同步、事件推送 |
| `README.md` | 本文件 · API 文档 |

## 核心特性

### 1. 交易对话框(基于 `.Dialog` 扩展)
- 左右双栏:玩家物品 / 猪人物品,各 4 列网格
- 中央:双向箭头 + 价值差(正/负/零 三态)+ 交易状态文字
- 底部:我出 → 换回 报价面板(各 3 槽),箭头分隔
- 顶栏:猪人名 + 好感度 + 关闭按钮
- 复用 `.Dialog-Overlay`、`.Dialog-Close`、`.Button` 组件

### 2. 价格模型(`priceForBuy`)
```
玩家从猪人买:  base × (1 + 通胀) × 偏好 × (1 - 好感度折扣) × 抖动
猪人从玩家买:  base × 0.6 × 偏好(喜欢 ×1.5, 厌恶 ×0.3) × 抖动
```

- **基础价**: 每个物品有 `basePrice`(整数金)
- **通胀**: 猪人累计买该物品越多,玩家买越贵(封顶 +40%)
- **偏好**: 物品 tags 与猪人 `preferences.likes/dislikes` 交集
  - 喜欢: 玩家买便宜 0.8×,猪人买贵 1.5×
  - 厌恶: 玩家买贵 2.0×,猪人买便宜 0.3×
- **好感度折扣**: 0/1/2/3 心 → 0%/0%/5%/10% 折扣
- **抖动**: 每次结算 ±5% 随机(避免价格狂跳,5Hz 仍平滑)

### 3. 拖拽交互(4 状态机,沿用 M2.13)
- 拖玩家槽 → 玩家物品栏标 `DragSource` 透明
- 拖到"我出"报价区 → 高亮 `DragOver` → 堆叠或置入
- 拖错边(玩家物品 → 换回)→ `DragInvalid` 红边 + `DragRejectShake` 抖动
- 拖出报价点击 → 放回源栏

### 4. 交易校验
- 总价值差 ≤ ±10% 算公平,可确认
- 完美交换(差额 = 0) → 猪人"perfect"反应
- 玩家多得 → 玩家 +N 金标签
- 玩家多给 → 差额 >10% 时拒绝

### 5. 5Hz 同步
- TICK_MS = 200(与 M2.12 对齐)
- 每 5 ticks 重新计算价格标签(避免 DOM 抖动)
- 每 25 ticks(5 秒)衰减猪人"最近买过"记忆
- 状态变化通过 `window.__hudBus` 广播:
  - `trade:open` / `trade:close`
  - `trade:drag-start`
  - `trade:tick`
  - `trade:complete` { pigId, itemsGiven, itemsReceived, valueGiven, valueReceived }

### 6. 好感度门(集成 `npc.js`)
- 顶栏 0-3 心,鼠标点击 = 喂食 +1(演示用)
- 完美交易 → 自动 +1 心
- 满心 → 显示"可招募"标签,触发招募反应

## 加载顺序

```html
<link rel="stylesheet" href="./src/ui/layout/tokens.css">
<link rel="stylesheet" href="./src/ui/components/components.css">
<link rel="stylesheet" href="./src/ui/trading/trading.css">

<script src="./src/ui/hud.js"></script>
<script src="./src/ui/trading/trading.js"></script>
<script src="./src/ui/npc/npc.js"></script>
```

## 使用示例

### 打开交易
```javascript
// 简单用法:从 mock 玩家背包 + mock 猪人库存开始
window.Trading.open({
  id: 'pig_forest_1',
  name: '森林猪人',
  affinity: 1,
  preferences: { likes: ['food', 'plant'], dislikes: ['mineral'] }
});

// 完整用法:传入玩家背包(24 槽)、猪人库存、回调
window.Trading.open(pig, playerInventory, {
  pigInventory: [{ itemId: 'carrot', count: 3 }],
  onComplete: function (r) {
    console.log('交易成功', r.pig, r.itemsGiven, r.itemsReceived);
  },
  onCancel: function (r) {
    console.log('取消', r.reason);
  }
});
```

### 价格计算
```javascript
// 玩家从猪人买
var price = window.Trading.priceForBuy('carrot', pig, marketState, 'player-buys-from-pig');

// 猪人从玩家买
var sellPrice = window.Trading.priceForBuy('carrot', pig, marketState, 'pig-buys-from-player');
```

### 关闭
```javascript
window.Trading.close();
```

## 物品目录(与 M2.10 兼容)

| ID | 名称 | basePrice | tags |
|---|---|---|---|
| twigs | 树枝 | 1 | plant, common |
| flint | 燧石 | 2 | mineral, common |
| log | 圆木 | 4 | plant, refined |
| cut_grass | 草 | 1 | plant, common |
| rope | 绳索 | 3 | craft, common |
| boards | 木板 | 6 | craft, refined |
| stone | 石头 | 2 | mineral, common |
| gold | 金块 | 50 | mineral, valuable |
| carrot | 胡萝卜 | 5 | food, plant |
| berry | 浆果 | 3 | food, plant |
| meat | 生肉 | 8 | food, animal |
| cooked | 烤肉 | 15 | food, animal, refined |
| axe | 斧头 | 20 | tool, refined |
| pickaxe | 镐子 | 25 | tool, refined |
| torch | 火把 | 2 | tool, common |

## 验收自检

- ✓ 拖拽交换:左栏 → 报价 → 右栏(4 状态:默认/拖动/合法/非法)
- ✓ 价格正确:基准价 × 偏好 × 折扣,±5% 抖动
- ✓ 等价值校验:±10% 算公平,完美交换 +1 好感度
- ✓ 实时反应气泡:3 秒自动消失,点击加速
- ✓ 暗黑哥特风一致:琥珀 `#d4a64a` 主色 + night-deep 背景 + 2px 硬切阴影
- ✓ 8/16 像素对齐:全部从 `tokens.css` 取值,无 0.5 奇数
- ✓ 5Hz 同步:订阅 `__hudBus 'tick'`,事件推 `trade:complete` 等
- ✓ 复用 `.Dialog` / `.Button` / `.Dialog-Overlay`(M1.8 组件库)

## 浏览器演示

```bash
# 启动本地服务器
cd wildwood && python3 -m http.server 8000
# 打开 demo.html,按 N 键打开交易
```

## 已知限制

- 单例:同一时刻只允许一个交易对话框打开
- 拖拽使用 HTML5 Drag and Drop API,触屏设备需 Polyfill
- 价格抖动在 5Hz 下肉眼仍可见小幅波动(由 5 秒记忆衰减平滑)
- 喂食由 `npc.js` 提供,本模块仅在顶栏暴露"心"以便点击演示

## 与其他子任务的关系

| 任务 | 关系 |
|---|---|
| M2.10 资源系统 | 物品 ID 契约、STACK_MAX = 20 规范 |
| M2.11 图鉴系统 | 物品数据/图标来自 codex.js(本模块自带 ITEMS,M2.11 接入后可替换) |
| M2.12 HUD 状态机 | 订阅 `__hudBus 'tick'`(5Hz) |
| M2.13 4 屏交互 | HTML5 Drag and Drop 4 状态机(复用) |
| M1.7 锚定区 | 顶栏好感度 0-3 心延用 VitalBar 视觉规范 |
| M1.8 组件库 | 复用 `.Dialog` / `.Button` / `.Dialog-Overlay` |
| v0.5.4 NPC 模块 | 好感度/招募/随从/交易中心由 `npc.js` 提供 |
