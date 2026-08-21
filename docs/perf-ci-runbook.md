# perf-ci 运行手册

> 适用范围：M3.10 性能优化工作流（`.github/workflows/perf-ci.yml`）。
> 配套脚本：`scripts/lod-memory-estimate.py`、`scripts/split-pck.mjs`、
> `scripts/split-pck/test_input/resource-list.json`。

## 1. 9 步流水线一览

| 步骤 | 名称                  | 入口                                             | 产物 / 指标                       |
| ---: | --------------------- | ------------------------------------------------ | --------------------------------- |
|    1 | checkout              | `actions/checkout@v4`                            | 工作区                            |
|    2 | Node 24               | `actions/setup-node@v4`                          | Node.js 24.x                      |
|    3 | Aseprite CLI          | `neomura/setup-aseprite-cli-action@v1`           | `aseprite --version`              |
|    4 | critical CSS          | `node scripts/critical-css.mjs`                  | 关键 CSS 子集                     |
|    5 | aseprite 32px 检查    | `aseprite -b ...` 尺寸校验                       | 通过/失败                         |
|    6 | LOD 估算              | `python3 scripts/lod-memory-estimate.py --radius 10` | LOD 内存（KB）                |
|    7 | split-pck（dry-run）  | `node scripts/split-pck.mjs scripts/split-pck/test_input/resource-list.json --dry-run` | 主包 + 预加载分片（KB）       |
|    8 | upload scripts        | `actions/upload-artifact@v4`                     | `perf-ci-scripts` artifact        |
|    9 | （隐式）状态汇总      | 由 GitHub Actions 写 run 状态                    | run 列表 / 报告链接               |

## 2. 4 项硬指标（M3.10 验收口径）

| 指标             | 目标 | 数据源                                  |
| ---------------- | ---: | --------------------------------------- |
| Lighthouse 综合  | ≥ 90 | 待接入（见 §5 待办）                    |
| 首屏（首字节可见）| ≤ 3s | 待接入（见 §5 待办）                    |
| 包体（main.pck）  | ≤ 12 MB | 步骤 7 `main.pck` 字段              |
| 首屏懒加载分片   | ≤ 4 MB  | 步骤 7 `preload` 字段                |

## 3. 本轮修复的 3 个问题

按修复时间顺序记录，对应远端 main 上的 3 条 commit。

### 3.1 `22cd364` · LOD 估算 CLI 入参

- **症状**：`ValueError: invalid literal for int() with base 10: '--radius'`
- **根因**：`scripts/lod-memory-estimate.py` 只接受位置参数 `int(sys.argv[1])`，
  perf-ci 第 6 步传的是 `--radius 10`。
- **修法**：同时支持位置参数与 `--radius N` 标志。
  ```python
  args = sys.argv[1:]
  if len(args) >= 2 and args[0] == "--radius":
      radius = int(args[1])
  elif len(args) >= 1:
      radius = int(args[0])
  ```
- **本地验证**：
  ```bash
  python3 scripts/lod-memory-estimate.py 10
  python3 scripts/lod-memory-estimate.py --radius 10
  ```
  两种写法结果一致。

### 3.2 `881e600` · split-pck 测试夹具

- **症状**：`ENOENT: no such file or directory, open 'scripts/split-pck/test_input/resource-list.json'`
- **根因**：perf-ci 第 7 步需要 `resource-list.json`，但该文件未入库。
- **修法**：提交一份 79 资源 / 1402 KB 的最小夹具，覆盖 forest + spring 两个场景。
  字段格式见 §4。

### 3.3 `26e3256` · perf-ci 路径统一

- **症状**：早期一次 run 引用 `m3-10-tcode02-pck/test_input/resource-list.json`（旧 bench 目录）。
- **根因**：脚本与 CI 路径不一致。
- **修法**：perf-ci 第 7 步固定使用 in-tree 路径
  `scripts/split-pck/test_input/resource-list.json`，与脚本自身位置解耦。

## 4. `resource-list.json` 字段约定

```jsonc
{
  "schemaVersion": 1,            // 必填，便于将来字段迁移
  "scene": "forest+spring",      // 描述性，仅展示
  "resources": [
    {
      "id": "forest/tree/oak",   // 资源唯一 ID，split-pck 派生分组键
      "size": 4096,              // 字节
      "type": "texture",         // texture | sprite | audio | ...
      "firstChunk": true         // 是否纳入首屏懒加载分片
    }
  ]
}
```

- 分子（首屏分片大小）：`sum(size where firstChunk == true)`，目前 1078 KB。
- 分母（包体）：`sum(size)`，目前 1402 KB（远低于 12 MB 预算）。

## 5. 待办（next round）

- **Lighthouse ≥ 90**：当前 run 报 `null`，原因是 perf-ci 没有接 LHCI（`@lhci/cli`）。
  计划在第 4 步后插一个 `npx --yes @lhci/cli@0.14.x autorun --collect.url=...`，
  预算为 `lhciData` artifact。
- **首屏 ≤ 3s**：依赖 Lighthouse / WebPageTest；待 §5 落地后即有数据。
- **预算升级**：当 `main.pck` 接近 10 MB 时再上调 `budget.maxBundleKB`，避免一次性放宽到 12 MB。

## 6. 本地 dry-run

```bash
# 不依赖 CI，本地 30 秒内跑完性能脚本链路
python3 scripts/lod-memory-estimate.py --radius 10
node scripts/split-pck.mjs scripts/split-pck/test_input/resource-list.json --dry-run
```

预期输出类似：

```text
[lod] radius=10 → memory ≈ 28 KB
[split-pck] main.pck = 1078 KB · preload = 1078 KB · total = 1402 KB
```
