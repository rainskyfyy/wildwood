# Wildwood UI · 布局规范 (M1.7)

## 目标

M4 核心游戏系统已落地 Canvas 视口(`demo.html` + `src/main.js`),本规范在不破坏 M4 引擎的前提下,为 UI 叠加层提供 1440×900 基准的布局基座。

## 文件结构

```
src/ui/layout/
├── tokens.css    # Design Tokens(色板/字号/间距/圆角/阴影)
├── grid.css      # 8/16px 网格基础类(GridMargin / GridPadding / GridSpacing / GridGap)
├── anchors.css   # 5 锚定区(对应方案 §5.2 屏幕分区)
└── README.md     # 本文件
```

## 加载顺序

```html
<link rel="stylesheet" href="./src/ui/layout/tokens.css">  <!-- 1. tokens 必须先于其他 -->
<link rel="stylesheet" href="./src/ui/layout/grid.css">
<link rel="stylesheet" href="./src/ui/layout/anchors.css">
```

## Design Tokens (tokens.css)

| 类别 | 变量 | 取值 | 来源 |
|---|---|---|---|
| 锚点色 | `--night-black` | `#101820` | 美术色板 night_black |
| 锚点色 | `--night-deep` | `#0d0d18` | M4 demo.html 已有 bg |
| 强调色 | `--accent` | `#d4a64a` | 美术 amber 主色 |
| 警示 HP | `--warn-hp` | `#c43a3a` | 24 色板内 |
| 警示饥饿 | `--warn-hunger` | `#d4a64a` | amber |
| 警示理智 | `--warn-sanity` | `#6a4a8a` | 暗紫 |
| 警示温度 | `--warn-cold` | `#4a7a9a` | 冷蓝 |
| 字号 5 档 | `--fs-10/12/14/18/24` | 像素值 | 方案 §5.5 |
| 图标 4 档 | `--icon-16/24/32/64` | 像素值 | 方案 §5.5 |
| 间距 | `--sp-8/16/24/32/48` | 8 整数倍 | 8px 主网格 |
| 圆角 | `--r-0` / `--r-2` | 0 / 2px | HUD 浮窗 0,按钮 2 |
| 阴影 | `--shadow-2` | `2px 2px 0 night-black` | 硬切无模糊 |
| 字体 | `--font-pixel` | Press Start 2P | 状态数字 / 标题 |

## 8/16px 网格基础类 (grid.css)

按 8-20 review 建议,**基础类名加 `Grid` 前缀**,避免与 Godot 自带 `MarginContainer` 命名混淆。

| 类名 | 作用 | 取值 |
|---|---|---|
| `Grid8` / `Grid16` | 调试网格背景 | 8/16px 步长 |
| `GridMargin-8/16/24/32` | 外边距 | 8 整数倍 |
| `GridMargin-X-8/16` | 水平外边距 | 左右对称 |
| `GridPadding-8/16/24/32` | 内边距 | 8 整数倍 |
| `GridGap-8/16/24/32` | flex/grid 间隙 | 8 整数倍 |
| `PixelText` | 像素风文字 | font-pixel + 2px 硬阴影 |

**未在类中提供的任意 padding/margin 值一律不允许**——确保全 UI 8/16 对齐零违例。

## 5 锚定区 (anchors.css)

对应方案 §5.2 屏幕分区,**绝对定位在 .UILayer 内**。

| 区域 | 类名 | 位置 | 尺寸 | 内容 |
|---|---|---|---|---|
| 左上 | `.Anchor-TL` | top/left 16 | 280 宽 | 4 队伍槽(36×36)+ 4 三围状态条 |
| 右上 | `.Anchor-TR` | top/right 16 | 240 宽 | 时间显示 + 季节 tag |
| 右下 | `.Anchor-BR` | bottom 176(避开聊天)/right 16 | 200×200 | 小地图 |
| 左下 | `.Anchor-BL` | bottom 176(避开聊天)/left 16 | 520×60 | 10 格快捷栏(1-0) |
| 底部 | `.Anchor-B` | bottom/left/right 16 | 全宽 × 160 | 聊天频道(全局/队伍/私聊) |

**中央净空区**:PlayArea-Center 不放任何 UI,玩家视野不被遮挡。

## 与 M4 demo.html 集成

```html
<div class="stage">                          <!-- 1440×900,内部 Canvas 720×720 + UI 叠加 -->
  <canvas id="game" width="720" height="720"></canvas>
  <div class="UILayer">                       <!-- UI 叠加层,绝对定位,pointer-events: none -->
    <div class="Anchor-TL">...</div>
    <div class="Anchor-TR">...</div>
    <div class="Anchor-BR"><canvas class="MinimapCanvas"></canvas></div>
    <div class="Anchor-BL">...</div>
    <div class="Anchor-B">...</div>
  </div>
</div>
```

**不动的部分**:`<canvas id="game">` + `<script type="module">` 引入 `src/main.js` 全部保留。

## 下游对接

- **M1.8 UI 组件库**:在 tokens.css + grid.css 基础上新增 `components.css`,定义按钮 / 面板 / 列表 / 对话框 / 滑块 / 输入框 6 类基础组件的视觉与状态。
- **M2.12 HUD 主屏**:在 anchors.css 5 锚定区上挂 M1.8 组件实例,产出 4 屏(主 HUD / 背包+合成 / 地图 / 图鉴)。

## 验收自检

- 1440×900 基准 ✓
- 1280×720 / 2560×1440 缩放下锚定区位置正确(由 stage 父容器 CSS transform 完成)
- 8/16 像素对齐 0 违例(tokens 锁版 + 类名硬约束)
- 字号 5 档 / 图标 4 档 / 圆角 0/2px / 阴影 2px 硬切 全部在 tokens 中固化
- 暗黑哥特 + night_black 锚点 + 美术色板共用
- 不破坏 M4 引擎(demo.html 主体结构保留)
