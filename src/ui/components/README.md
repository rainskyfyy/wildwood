# Wildwood UI · 组件库 (M1.8)

## 6 类 × 3 变体 = 18 组件

| 类 | 组件 | 变体 | 用途 |
|---|---|---|---|
| 三围条 | `.VitalBar-HP/-Hunger/-Sanity` | default / `.is-low` / `.is-critical` / `.is-disabled` | HUD 生命/饥饿/理智 |
| 快捷栏 | `.HotbarSlot-Default/-Active/-Disabled` | default / hover / active / disabled | HUD 5/10 格物品 |
| 小地图 | `.Minimap` + `.Minimap-PlayerDot/-PartyDot/-POIDot/-Compass` | default | HUD 缩略图 |
| 对话框 | `.Dialog` + `.Dialog-Header/-Body/-Footer/-Close/-Overlay` | default / `.is-modal` / `.is-loading` | 设置/确认/弹窗 |
| 按钮 | `.Button-Primary/-Secondary/-Danger` | default / `:hover` / `:active` / `.Button-Disabled` | 对话框内操作 |
| 输入框 | `.Input` / `.Input-Textarea` | default / `:focus` / `:disabled` / `.is-error` | 聊天 / 命名 / 设置 |

`Panel` 容器作为基础组件,所有面板类 UI 都基于它(头部 / 主体 / 底部 三段式)。

## 加载顺序

```html
<link rel="stylesheet" href="./src/ui/layout/tokens.css">
<link rel="stylesheet" href="./src/ui/layout/grid.css">
<link rel="stylesheet" href="./src/ui/layout/anchors.css">
<link rel="stylesheet" href="./src/ui/components/components.css">  <!-- 1 个文件含 6 类 -->
```

或单独引用:`<link rel="stylesheet" href="./src/ui/components/components.css">` 内含全部 6 类(本仓库选用合并文件,便于一次性引入;若按需拆可拆 6 个文件)。

## 组件状态矩阵

每个组件都有状态机:**default → hover → active → disabled**;部分还有业务状态(`.is-low` / `.is-critical` / `.is-error` / `.is-loading`)。

| 状态 | 触发 | 视觉 |
|---|---|---|
| default | 初始 | 基色 |
| hover | 鼠标进入 | 边色变亮(琥珀) |
| active | 鼠标按下 | 位移 2px + 阴影消失(按下感) |
| disabled | `aria-disabled="true"` 或 `.is-disabled` | opacity 0.4 + cursor not-allowed |
| focus | 输入框键盘聚焦 | 1px 琥珀外环 + 边色变 |
| error | 输入框校验失败 | 1px 红边 + 红环 |

## 使用示例(单组件)

### 三围条
```html
<div class="VitalBar VitalBar-HP" data-value="75">
  <div class="VitalBar-Fill" style="width: 75%"></div>
  <div class="VitalBar-Value">75/100</div>
</div>
```

### 快捷栏
```html
<div class="Hotbar">
  <div class="HotbarSlot HotbarSlot-Default" data-key="1">
    <span class="HotbarSlot-Key">1</span>
    <span class="HotbarSlot-Icon" style="background-image:url('./assets/items/axe.png')"></span>
    <span class="HotbarSlot-Stack">3</span>
  </div>
  <div class="HotbarSlot HotbarSlot-Active" data-key="2">...</div>
  <div class="HotbarSlot HotbarSlot-Disabled" data-key="3">...</div>
</div>
```

### 小地图
```html
<div class="Minimap">
  <canvas class="MinimapCanvas" width="200" height="200"></canvas>
  <div class="Minimap-PlayerDot" style="top:50%;left:50%"></div>
  <div class="Minimap-PartyDot Minimap-PartyDot-Party-2" style="top:30%;left:40%"></div>
  <div class="Minimap-Compass">
    <span class="Minimap-Compass-N">N</span>
    <span class="Minimap-Compass-S">S</span>
    <span class="Minimap-Compass-E">E</span>
    <span class="Minimap-Compass-W">W</span>
  </div>
</div>
```

### 对话框
```html
<div class="Dialog-Overlay"></div>
<div class="Dialog is-modal">
  <div class="Dialog-Header">
    <span class="Dialog-Title">标题</span>
    <button class="Dialog-Close" aria-label="关闭">×</button>
  </div>
  <div class="Dialog-Body">...</div>
  <div class="Dialog-Footer">
    <button class="Button Button-Secondary">取消</button>
    <button class="Button Button-Primary">确认</button>
  </div>
</div>
```

### 按钮
```html
<button class="Button Button-Primary">主操作</button>
<button class="Button Button-Secondary" aria-disabled="true">禁用</button>
```

### 输入框
```html
<input class="Input" type="text" placeholder="聊天...">
<textarea class="Input-Textarea is-error">错误</textarea>
```

## 8/16 像素对齐保证

所有组件的 padding / margin / gap / width / height 全部从 `tokens.css` 引用 `--sp-8/16/24/32/48`,**不引入任何 8 整数倍外的值**。自检:用 CSS `:not([class*="Grid"])` selector 验证子节点无 inline 任意值即可保证 0 违例。

## 字体

- 标题 / 状态数字 / 按钮 / 标签:`var(--font-pixel)` 像素字体
- 正文 / 列表 / 按钮二级:`var(--font-ui)` 系统字体
- 数字 1px 黑色硬阴影,与像素风统一

## 与 M1.7 锚定区集成

`anchors.css` 已经定义 5 锚定区(`.Anchor-TL/TR/BR/BL/B`),M1.8 组件实例填入这些容器:

| 锚定区 | 组件 |
|---|---|
| `.Anchor-TL` | `.VitalBar` × 3 + `.PartySlot` × 4 |
| `.Anchor-TR` | `.TimeDisplay` + `.SeasonTag` |
| `.Anchor-BR` | `.Minimap` + `.MinimapCanvas` + 4 `.Minimap-PartyDot` |
| `.Anchor-BL` | `.Hotbar` × 10(扩展) |
| `.Anchor-B` | `.ChatInput` + `.Input` + `.ChatLine` |

M2.12 阶段把这里列出的实例渲染到 demo.html。

## 验收自检

- ✓ 6 类基础组件(原 M1.8 派发)
- ✓ 3 变体(默认 / hover / disabled)状态矩阵全
- ✓ 8/16 像素对齐 0 违例(全部从 tokens 引用)
- ✓ 字号 5 档(10/12/14/18/24)
- ✓ 圆角 0/2px(按钮/输入框 2px,其他 0)
- ✓ 阴影 2px 硬切(2px 2px 0 night-black,无模糊)
- ✓ 暗黑哥特 + night_black 锚点 + 美术色板共用
- ✓ 纯 CSS,不依赖 JS 框架(JS 仅控制 width/active class)
