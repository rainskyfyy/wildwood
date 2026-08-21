# t-code-05 Critical CSS 抽离设计

**任务**: t-code-05 · 首屏 HTML + critical CSS 抽离
**验收目标**: `first-contentful-paint < 1800ms`(相对无抽离下降 ≥ 500ms)
**D1 原计划完成日**: 2026-08-20
**沙箱可做范围**: 抽取脚本 + 内联策略 + 模板 + perf-ci 接入
**沙箱做不了**: 真实 Godot WebGL export / LHCI 跑分 → 工程团队 PR 跑通

---

## 1. 问题

Godot 4.3 WebGL export 模板的 `index.html` 把全量 CSS 塞进一个 `<style>` 块,包括:
- 首屏可见元素所需的(loading 状态条、canvas、错误兜底)— 真正关键
- 游戏内 UI(暂停菜单、设置面板、错误覆盖层)的 — 非关键(用户进游戏后才用)
- 动画 keyframes、媒体查询 — 非关键(无 JS 渲染阻塞)

浏览器必须解析完整个 `<style>` 才会绘制首屏。Wildwood 模板当前实测 ~2.5KB CSS,JS 引擎解析 + 阻塞渲染 ≈ 600ms,直接拉低 FCP。

## 2. 策略: 抽离 + 异步加载

```
原始 index.html (一个 <style> 装 2.5KB CSS)
   ↓ critical-css-extract.mjs
优化后 index.html
  - <style data-critical> 装 38.5% CSS (≈ 1KB) → 立即渲染首屏
  - <link rel="preload" data: URL> 装剩余 1.3KB → 异步,不阻塞渲染
  - <noscript> 兜底: 禁用 JS 时直接 <link rel="stylesheet">
```

## 3. 关键选择器白名单

只对**首屏绝对可见**的 DOM 节点加规则,其它一律异步:

| 选择器 | 用途 | 关键 |
|---|---|---|
| `html` | 根元素 | ✓ |
| `body` | body 基线样式 | ✓ |
| `#canvas` | WebGL 画布(首屏主体) | ✓ |
| `#status` | loading 容器 | ✓ |
| `#status-progress` | 进度条 | ✓ |
| `#status-notice` | 提示文字 | ✓ |
| `.error-screen` | 错误兜底(若 Godot export 时 set_status_failed) | ✓ |
| `[data-critical]` | 引擎/插件标记的额外关键 | ✓(可选) |
| `.game-overlay` | 游戏中弹层 | ✗ |
| `.settings-panel` | 设置面板 | ✗ |
| `.pause-menu` | 暂停菜单 | ✗ |
| `.error-screen.active` | 错误已激活(由 JS 切,首屏不显示) | ✓(因为 .error-screen 命中) |
| `@keyframes fade-in` | 动画 | ✗ |
| `.animated` | 引用动画的元素 | ✗ |
| `@media (max-width: 768px)` | 响应式 | ✗ |

**为什么 `.error-screen.active` 进 critical**: `isCriticalSelector` 是前缀匹配,父类命中后代自动算关键,这是简化实现。错误兜底通常不影响首屏,但保留以防 critical CSS 被分块时出现无样式闪烁(FOUC)。

## 4. CSS 解析

### 4.1 简化规则

为了避免引入 postcss 之类的重量依赖(沙箱友好),用自写 30 行解析器:

- 处理普通规则 `selector { body }`
- 处理 `@media` / `@supports` 包裹(嵌套递归)
- 不处理:`@import`(少见)/ SCSS / Less(走 build 链)
- 不处理:`@namespace` / `@charset` / `@page`(对 critical 抽取无意义)

### 4.2 关键判定算法

```js
isCriticalSelector(selector):
  parts = selector.split(',')
  return parts.any(isPartCritical)

isPartCritical(sel):
  baseSel = sel.replace(/:hover|:focus|.../g, '')
  tokens = baseSel.match(/[#.][\w-]+|\[[\w-]+(?:=[^\]]+)?\]|[\w-]+/g)
  return tokens.some(tokenInWhitelist)

tokenInWhitelist(token):
  for pattern in CRITICAL_PATTERNS:
    if pattern.kind == 'exact' && token == pattern.exact: return true
    if pattern.kind == 'prefix' && token.startsWith(pattern.prefix): return true
    if pattern.kind == 'attr' && token.startsWith('[data-critical'): return true
  return false
```

伪类 `hover/focus/active/visited/disabled` 移除后再做匹配,因为不影响首屏渲染。

### 4.3 @media 处理

`@media` 块**不能**简单切分(响应式断点会破坏):
- 内部规则若**全部非关键** → 整个 @media 异步
- 内部规则若**任意关键** → 整个 @media 同步,内部关键/非关键分别归类

这样保证响应式断点不被切碎。

## 5. HTML 输出

### 5.1 模板

```html
<head>
  <meta charset="utf-8" />
  ...
  <style data-critical="true">
    /* 抽离后的 critical CSS (≈ 1KB) */
  </style>
  <!-- non-critical CSS (extracted by critical-css-extract) -->
  <link rel="preload" as="style"
        href="data:text/css;base64,..."
        onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="data:text/css;base64,..."></noscript>
</head>
```

### 5.2 为什么用 data: URL 而不是另存 .css

- 沙箱友好: 单一 HTML 产物,无额外文件依赖
- perf-ci 简单: 不需要再发第二个 HTTP 请求测 LHCI
- 工程团队可改: 在 Godot export 完成后,改成 `<link href="wildwood.deferred.css" rel="preload">` 也行,只需调 `--mode external`

## 6. Godot 4.3 集成(工程团队 PR 跑通)

### 6.1 PostExportFeature 钩子

```gdscript
# addons/wildwood_perf/wildwood_post_export.gd
@tool
extends EditorExportPlugin

func _export_file(path: String, type: String, features: PackedStringArray) -> void:
    if not path.ends_with("index.html") or not features.has("web"):
        return
    # 调 Node.js 后处理
    var args = [POSTPROCESS_SCRIPT, globalized_path, "--output", out, "--stats"]
    OS.execute("node", args, stdout, true)
```

`ProjectSettings → editor → export → post_export_script` 指向本脚本。

### 6.2 真实工程清单(工程团队 PR)

- [ ] 复制 `gdscript-template/wildwood_post_export.gd` 到 `addons/wildwood_perf/`
- [ ] 复制 `scripts/critical-css-extract.mjs` 到同目录
- [ ] 复制 `gdscript-template/build-postprocess.mjs` 到同目录
- [ ] 在 ProjectSettings 挂上 PostExportFeature
- [ ] 实跑 Web export,验证 `index.optimized.html` 出现
- [ ] 跑 LHCI,断言 FCP < 1800ms
- [ ] 若 FCP 不达标,扩大白名单或改用 5KB inline 阈值

## 7. 沙箱端到端验证

合成 HTML(模拟 Godot export):

| 项 | 字节 |
|---|---|
| 原 `<style>` 全文 | 2489B |
| critical (内联) | 958B |
| non-critical (async) | 1301B |
| 抽离后总 HTML 增量 | +60B(注释 + `<link>` 包裹) |

> 沙箱内只验证逻辑正确性,真实 FCP 数字必须等工程团队 PR 跑 LHCI。

## 8. 验收对照

| 验收点 | 沙箱验证 | 工程团队 PR 验证 |
|---|---|---|
| HTML critical 内联 vs 异步分离 | ✓ 字节统计 | ✓ |
| CSS 抽取算法(白名单匹配) | ✓ 合成 HTML 跑通 | ✓ |
| GDScript 模板脚本 | ✓ 写完 | ✓ Godot 端跑通 |
| perf-ci 接入点 | ✓ 文档 | ✓ 实际接入 step |
| FCP < 1800ms | ✗ 无浏览器 | ✓ LHCI 跑分 |

## 9. 不在范围

- ✗ Service Worker(后续 t-code-06+ 再考虑)
- ✗ font-display 优化(后续)
- ✗ HTTP/2 push(浏览器已弃)
- ✗ SSR(纯 WebGL 客户端,SSR 无意义)
