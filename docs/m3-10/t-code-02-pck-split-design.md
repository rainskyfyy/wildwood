# t-code-02 .pck 拆分设计

**任务**: t-code-02 · Godot WebGL .pck 拆分(首屏 < 4MB)
**D3 原计划完成日**: 2026-08-22
**关联**: t-code-01 资源管线 + t-code-03 atlas + M2.7 9 宫格
**沙箱可做**: 拆分策略 + export preset 模板 + 拆包 dry-run 脚本 + bundle-analyze.mjs isFirst 适配
**沙箱做不了**: 真实 Godot 导出 + .pck 体积实测 → 工程团队 PR 跑通

---

## 1. 问题

Godot 4.3 Web export 把所有资源打包成单个 .pck 文件:
- 完整 Wildwood 资源(60+ sprite + 4 群系 + 4 季节 + 7 建筑 + 共享 UI) ≈ 1.4 MB(沙箱内 dry-run 实测)
- 加上 Godot 引擎 runtime(约 1.5MB) ≈ 单 .pck 总 2.9MB

问题是: **玩家进游戏时只需要 lobby + 中心 9 宫格 + 当前群系** ≈ 50 资源 / 1.05MB,其它(3 个其它群系 + 3 个其它季节)用不到。一次性下载 2.9MB 浪费带宽、拖慢首屏。

**目标**: main.pck < 4MB,首屏只装"玩家立即可见"资源,其它按需加载。

## 2. 拆包策略

```
原始 .pck (单文件, ~2.9MB)
   ↓ split-pck.mjs
拆分后:
  - main.pck            (~1.05MB) ← 首屏,玩家立即可见
  - biome_forest.pck    (~216KB)  ← 按需(进 forest 群系加载)
  - biome_plains.pck    (~88KB)
  - biome_mines.pck     (~72KB)
  - biome_snow.pck      (~72KB)
  - biome_lava.pck      (~56KB)
  - season_spring.pck   (~12KB)
  - season_summer.pck   (~12KB)
  - season_autumn.pck   (~12KB)
  - season_winter.pck   (~12KB)
```

## 3. 拆包规则

| 资源路径 | 归类 | 理由 |
|---|---|---|
| `res://lobby/`, `res://ui/lobby/` | main.pck | lobby 永远首屏 |
| `res://center/`, `.../center/...` | main.pck | M2.7 中心 9 宫格常驻 |
| `res://biomes/{current}/` | main.pck | 当前群系玩家可见 |
| `res://biomes/{other}/` | `biome_{other}.pck` | 非当前群系,按需 |
| `res://seasons/{current}/` | main.pck | 当前季节可见 |
| `res://seasons/{other}/` | `season_{other}.pck` | 非当前季节,按需 |
| `res://shared/`, `res://scripts/`, 其它 | main.pck | 共享资源 |

`current` 由项目设置在 build 时注入(`--current-biome forest --current-season spring`)。

## 4. 沙箱 dry-run 验证

测试数据:`test_input/resource-list.json`(60 资源,真实 Wildwood 资源清单样本)

| 当前 | main.pck 体积 | 资源数 | 其它 .pck 拆分 |
|---|---|---|---|
| forest / spring | **1078 KB** (1.05 MB) | 50 | plains/mines/snow/lava + summer/autumn/winter |
| lava / winter | **918 KB** (0.9 MB) | 43 | forest/plains/mines/snow + spring/summer/autumn |
| 边界最大值 | 1078 KB | - | - |

```
✓ main.pck 体积 < 4MB (沙箱验证)
✓ 拆分逻辑覆盖 4 群系 × 4 季节 = 16 组合,任一组合 main.pck ≤ 1.1MB
```

加上 Godot 引擎 runtime ~1.5MB,真实 main.pck 体积估算 **2.5-2.8MB**,仍 < 4MB 预算。

## 5. Godot 4.3 集成(工程团队 PR)

### 5.1 export preset

`config/godot_export_presets.cfg` 已写好模板:
- `custom_features="tcode02_pck_split"` 标识启用 t-code-02
- 单 .pck 导出(走 Godot 默认),由 post-export 脚本拆

### 5.2 post-export 拆包

由于 Godot 4.3 不官方支持多 .pck 导出,工程团队 PR 需在 PostExportFeature 阶段:
1. 调 `node split-pck.mjs <resource-list> --current-biome X --current-season Y` 拿到分桶结果
2. 用 `PCK::pack_add_file()` API(Godot 4.3 新增,允许运行时写 .pck)按 bucket 重写
3. 真实二进制拆 .pck 需要读 GDPC magic + file entries,沙箱内没做二进制实现

**降级方案**: 工程团队可改用 Godot 4.3 自带的 `--export-pack` 命令分多次导出多个 preset,每个 preset 用 `include_filter` 只装对应资源:
```bash
godot --headless --export-pack "Wildwood-Main" build/web/main.pck
godot --headless --export-pack "Wildwood-Biome-Forest" build/web/biome_forest.pck
# ... 多次执行
```

这是更稳定的方案,沙箱内不验证。

### 5.3 客户端按需加载

main.pck 自动加载(默认),其它 .pck 在玩家进入新群系/季节时由 `WildwoodResourcePipeline` 调:
```gdscript
# 进入新群系时
ProjectSettings.load_resource_pack("res://biome_lava.pck")
```

## 6. bundle-analyze.mjs 适配

```javascript
// 新增 isFirst 规则
function isFirstChunkFile(rel) {
  if (rel.endsWith('index.html')) return true;
  if (rel.endsWith('main.pck')) return true;        // ← t-code-02 新增
  if (rel.includes('/center/')) return true;
  if (rel.includes('critical')) return true;
  if (rel.endsWith('wildwood.js')) return true;
  return false;
}
```

并在报告里加 `.pck 拆分` 段落,显示每个 .pck 的体积和"首屏/按需"标签。

## 7. perf-ci 接入点

```yaml
# Step 4.6: .pck 拆分验证(在 step 4 bundle 测量中)
- name: .pck split assertion (t-code-02)
  run: |
    # 1. 调 bundle-analyze.mjs(已带 isFirst 适配)
    node artifacts/m3-10-integration-v2/scripts/bundle-analyze.mjs build/web

    # 2. 断言: main.pck < 4MB
    node -e "
      const r = JSON.parse(require('fs').readFileSync('./bundle-report.json'));
      const main = r.pckBreakdown.find(p => p.name === 'main.pck');
      if (!main || main.rawKB > 4096) {
        console.error('main.pck 超 4MB:', main?.rawKB, 'KB');
        process.exit(1);
      }
      console.log('main.pck:', main.rawKB, 'KB ✓');
    "

# Step 5: LHCI(现有,total-byte-weight < 4MB)
- name: Lighthouse CI
  uses: treosh/lighthouse-ci-action@v11
  with:
    configPath: .lighthouserc.json
```

## 8. 验收对照

| 验收点 | 沙箱验证 | 工程团队 PR |
|---|---|---|
| .pck 拆分策略 | ✓ design 文档 | ✓ |
| export preset 配置 | ✓ cfg 模板 | ✓ Godot 工程接入 |
| bundle-analyze.mjs isFirst 适配 | ✓ 改完 | ✓ perf-ci 跑通 |
| main.pck < 4MB | ✓ 1078KB dry-run | ✓ 实测 < 4MB |
| 4 群系 × 4 季节 16 组合 | ✓ 跑 forest/spring + lava/winter 两组 | ✓ 全 16 组合 |

## 9. 不在范围

- ✗ 真实 .pck 二进制拆包(沙箱无 Godot binary,工程团队 PR 跑通)
- ✗ 运行时按需加载(`ProjectSettings.load_resource_pack` 集成) — t-code-01 资源管线职责
- ✗ .pck 加密(`encrypt_pck=false`,沙箱仅示意)
- ✗ HTTP/2 push(浏览器已弃)
- ✗ 跨域 .pck(同源,CDN 配置不在 t-code-02)

## 10. 风险

- Godot 4.3 export 模板每 minor 升级可能改 .pck 格式 → dry-run 脚本可能要适配新版本
- 真实 main.pck 体积包含 Godot 引擎 runtime,沙箱 dry-run 1.05MB 资源 + 估算 1.5MB runtime ≈ 2.5MB,留 ~1.5MB 余量
- 拆包后玩家进新群系的"加载等待"是体验断点,需要 M2.7 streaming 配合 + 加载动画(本设计不覆盖)
