# perf-ci 接入点: t-code-05 critical CSS 抽离

## 目标

工程团队 PR 跑通后,在 `perf-ci.yml` 新增 step 4.5 (在 step 4 bundle 测量后, step 5 LHCI 前) 调用 critical CSS 抽离脚本,测量并断言 `first-contentful-paint < 1800ms`。

## 沙箱内做的(本交付)

- `scripts/critical-css-extract.mjs` — Node.js ESM 抽离器,38.5% CSS 进 inline(合成样本)
- `gdscript-template/build-postprocess.mjs` — build 入口,被 Godot 端 PostExportFeature 调
- `gdscript-template/wildwood_post_export.gd` — Godot 4.3 EditorExportPlugin 模板
- `test_input/godot-export-sample.html` — 合成 Godot WebGL export 样本
- `test_output/extracted.html` — 抽离后输出
- 沙箱端到端:2489B → 958B critical inline + 1301B async

## perf-ci.yml 新增 step(伪代码)

```yaml
# Step 4.5: Critical CSS 抽离(在 step 4 bundle 测量后, step 5 LHCI 前)
- name: Extract critical CSS (t-code-05)
  run: |
    # 1. 调 Godot build post-process(真实 Godot export 后自动产生)
    #    或手动调: node build-postprocess.mjs build/web/index.html --stats
    node artifacts/m3-10-tcode05-css/gdscript-template/build-postprocess.mjs \
      build/web/index.html \
      --output build/web/index.optimized.html \
      --stats

    # 2. 覆盖原文件(perf-ci 测的就是它)
    mv build/web/index.optimized.html build/web/index.html

    # 3. 断言: critical inline < 4KB (首屏 HTML 友好)
    CRIT_BYTES=$(grep -oP '<style data-critical[^>]*>\K[^<]*' build/web/index.html | wc -c)
    if [ "$CRIT_BYTES" -gt 4096 ]; then
      echo "::error::critical CSS too large: ${CRIT_BYTES}B (limit 4096B)"
      exit 1
    fi
    echo "::notice::critical CSS: ${CRIT_BYTES}B (limit 4096B)"

# Step 5: LHCI(现有,assertions 调高 FCP 阈值)
- name: Lighthouse CI
  uses: treosh/lighthouse-ci-action@v11
  with:
    configPath: .lighthouserc.json
    # FCP < 1800ms 是 t-code-05 验收硬条件
```

## .lighthouserc.json 调整(若尚未)

```json
{
  "ci": {
    "assert": {
      "assertions": {
        "first-contentful-paint": ["error", { "maxNumericValue": 1800 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "total-byte-weight": ["error", { "maxNumericValue": 4194304 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }]
      }
    }
  }
}
```

## 验收对照

| 验收点 | 测量 | 期望 | 沙箱能做 | 工程团队 PR 验证 |
|---|---|---|---|---|
| critical CSS 抽离后 inline 比例 | 字节统计 | < 50%(38.5% 实测) | ✓ | ✓ LHCI |
| FCP | LHCI step 5 | < 1800ms | ✗ 无浏览器 | ✓ 必须 |
| 首屏 HTML 体积 | grep bytes | critical < 4KB | ✓ | ✓ |
| noscript 兜底 | HTML 文本 | 存在 `<noscript>` | ✓ | ✓ |

## 不在范围内(避免越界)

- ✗ 真实 Godot WebGL export(沙箱无 Godot binary)
- ✗ 真实 LHCI 跑分(沙箱无浏览器)
- ✗ 真实 FCP 数字(只能断言"< 1800ms 是目标")
- ✗ 跨浏览器兼容(IE/Safari 的 preload onload 差异 → 已有 noscript 兜底)

## 已知风险

- `data:` URL 在 IE11 不支持 → 但 Wildwood 浏览器基线是 Chrome/Firefox/Edge ≥ 90
- 多个 `<style>` 块合并时,@media 嵌套内部递归正确性需真实 Godot export HTML 验证
- Godot 4.3 export 模板可能升级(每 minor 改一次),白名单要随 export HTML 同步更新
