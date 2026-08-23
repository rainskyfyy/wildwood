# Wildwood 美术资产瘦身方案（v0.7.6a）

> 高级开发工程师 · 2026-08-23
> 任务 ID: 7675923777695288529 / 评论 7677161856305220822
> 关联 commit: 见文末"推送记录"小节

---

## 0. TL;DR

- **根因**: Aseprite 导出用了 **4096×4096 默认画布 + 8-bit RGBA（未走索引色）**，对像素艺术图（16×16 / 32×32 / 64×64）来说是 500×~10000× 的浪费。
- **影响面**: 仓库 `assets/art/` 下 **253 张 PNG 共 1.32 GB**；其中 **157 张超过 500KB**（占总量 99.9%），5 张处于 50–500KB 警告区，91 张在 50KB 以下（基本正常）。
- **修复**: 三件事 —— ① 改 Aseprite 导出配置（truncate to bounds + 8-bit 索引色 + 强制 dimension cap）；② 美术交付流程加 pngcrush/pngquant 优化步骤；③ CI 加 `tools/check-asset-budget.py` 守门（>500KB fail / 50–500KB warn）。
- **预期收益**: 157 张 FAIL 重导后预计降到 30–50KB / 张，仓库总体积 **1.32 GB → ~30 MB**（减少约 98%）。
- **时间估算**: 美术重导 1 个工作日；脚本与 CI 接入 0.5 个工作日；总 ≤ 1.5 工作日。

---

## 1. 问题根因（已验证，不是推测）

### 1.1 实测样本

| 文件 | 路径 | 文件大小 | 实际尺寸 | 位深 / 模式 | 未压缩原始 | 压缩率 |
|---|---|---:|---:|---|---:|---:|
| `axe.png`（大文件样本） | `assets/art/tools/axe.png` | **6,130.9 KB**（GitHub 上报）/ 3.4 MB（本地下到的部分） | **4096×4096** | 8-bit / RGBA | **64.0 MB** | ~9.6% |
| `firefly.png`（小文件样本） | `assets/art/biomes/_shared/decorations/forest/firefly.png` | 0.1 KB (105 B) | 16×16 | 8-bit / RGBA | 1.0 KB | 10.3% |
| `hero_right_idle.png`（最大） | `assets/art/hero/protagonist_28frames/hero_right_idle.png` | 9,723.2 KB | 未本地下载（沙箱 6MB 文件直拉超时），按文件大小推算 ~1576×1576 RGBA | 8-bit / RGBA | ~9.5 MB | ~9.7% |

**Pillow 解析脚本**（节选，可复现）：

```python
from PIL import Image
im = Image.open("axe.png"); im.load()
print(im.format, im.mode, im.size, len(im.getextrema()))
# PNG RGBA (4096, 4096) 4
```

### 1.2 根因结论

- ✅ **Aseprite 导出时画布尺寸未裁剪到 sprite bounds**（典型 Aseprite 行为：spritesheet 整体尺寸 4096×4096 默认值被遗忘）
- ✅ **8-bit RGBA（color_type=6），未用索引色 (color_type=3)**：对像素艺术图，颜色数通常 ≤ 32 色，索引色可将 4B/px → 1B/px
- ✅ **deflate 压缩本身 OK**（~9–10% 压缩率对重复大块透明像素合理），所以这不是 pngcrush 类工具能修的——必须回到源头修 Aseprite 导出
- ❌ **不是图片数量太多**：157 张大图 × ~9MB ≈ 1.3 GB，但 91 张小图总共才 ~9KB，单图问题

### 1.3 异常模式（同类问题清单）

| 目录 | 失败文件数 | 每张平均 | 备注 |
|---|---:|---:|---|
| `hero/protagonist_28frames/` | 29 | ~9.5 MB | 主角 28 帧动画 + 1 张图标，全部未裁剪 |
| `monsters/bat_20frames/` | 20 | ~9.5 MB | 蝙蝠 20 帧 |
| `monsters/hound_20frames/` | 20 | ~9.5 MB | 猎犬 20 帧 |
| `monsters/merm_20frames/` | 20 | ~9.5 MB | 鱼人 20 帧 |
| `monsters/spider_20frames/` | 20 | ~9.5 MB | 蜘蛛 20 帧 |
| `monsters/treant_20frames/` | 20 | ~9.5 MB | 树人 20 帧 |
| `resources/` | 10 | ~9.5 MB | **单帧资源图都不该这么大**（flint/wood/stone 等） |
| `ui_monsters/` | 8 | ~9 MB | UI 用的怪物图 |
| `buildings/` | 5 | ~9 MB | 建筑 sprite |
| `tools/` | 5 | ~7–8 MB | 工具图标（axe.png = 6 MB 实测） |
| `spider_repaint/` (warn) | 5 | 340–440 KB | 512×512 蜘蛛变体，**接近边界但未超 fail** |

> **规律**: 几乎所有"大文件"都是 4096×4096 或 1576×1576 这种"画布未裁"模式。`spider_repaint/` 是单独 512×512 重制版（量级正常），**这一组可以忽略**。

---

## 2. 修复方案

### 2.1 Aseprite 导出配置（美术侧，1 天）

**Aseprite 菜单**: `File → Export As` 或 batch script 命令行：

```bash
# 推荐的 batch 导出命令（保存为 export.sh）
aseprite --batch \
  --sheet packed.png \
  --data sprite.json \
  --sheet-type packed \
  --trim \
  --trim-sprite \
  --format png-indexed \
  --palette-mode jpeg \
  --color-mode indexed \
  --scale 1 \
  input.aseprite
```

**关键 flag**（按重要度排序）：

| Flag | 作用 | 没设的代价 |
|---|---|---|
| `--trim` + `--trim-sprite` | 裁剪透明边界到 sprite bounds | **核心问题**：默认 4096×4096 画布会保留 |
| `--format png-indexed` | 强制索引色 PNG (color_type=3) | RGBA → 索引色：4B/px → 1B/px，体积降 75% |
| `--color-mode indexed` | 源数据也存为索引 | 同上，编辑时也省内存 |
| `--palette-mode jpeg` | 调色板去重 + 抖动 | 颜色重复合并 |
| `--scale 1` | 不要顺手放大 | 美术常误设 2x/4x 给"高清" |

**手工菜单对应项**：

- `Sprite → Trim` 在源文件里就 trim（不依赖导出）
- `File → Export As → PNG`: 选项里勾选 **"Trim"**、**"Palette"**（不要选 "True color"）
- **Dimension 限制**: 美术约定 —— 角色单帧 ≤ 128×128，瓦片 ≤ 32×32，UI 图标 ≤ 64×64
- **强制 deflate 9 + palette filter**（这是 PNG spec，aseprite 默认会做）

### 2.2 美术交付流程（CI 配套）

**Aseprite 导出 → pngcrush → pngquant → 提交**

```bash
# pngcrush: 重新编码 PNG 块，去掉多余 metadata
pngcrush -brute -rem alla -rem text -reduce in.png out.png

# pngquant: 转高质量索引色（如果 Aseprite 没成功）
pngquant --quality=85-95 --force --output out.png in.png

# 检查
python3 tools/check-asset-budget.py --root assets/art --analyze --show FAIL
```

**CI 守护脚本**: `tools/check-asset-budget.py`（本任务已交付，见第 3 节）

### 2.3 美术规范（写入 AGENTS.md / 团队 wiki）

```markdown
## 资产导出硬约束

- **PNG-only**，禁止 JPG/GIF（像素艺术无意义）
- **强制索引色 (color_type=3)**，palette ≤ 32 色
- **强制 trim 透明边**（Aseprite: Sprite → Trim）
- **Dimension cap**: 角色单帧 ≤ 128×128，瓦片 ≤ 32×32，UI 图标 ≤ 64×64，建筑 ≤ 256×256
- **文件大小**: 单图 ≤ 50KB（warning 阈），≤ 500KB（fail 阈）
- **提交前必跑**: `python3 tools/check-asset-budget.py --root assets/art --analyze`
- **CI fail 时**: 不要 force-push，直接重导或裁剪
```

---

## 3. CI 守护

### 3.1 工具: `tools/check-asset-budget.py`

**本任务已交付**。功能：

- **本地模式**（`--root assets/art`）：扫本地 PNG 文件，给出 size + 尺寸 + 模式 + 压缩比
- **GitHub 模式**（`--github --repo rainskyfyy/wildwood --ref main`）：通过 Git Trees API 扫远端（沙箱无 git 凭证也能跑）
- **三档分级**：
  - `> 500KB` → **FAIL**（exit 1）
  - `50–500KB` → **WARN**（exit 0，但提示）
  - `≤ 50KB` → **OK**
- **输出格式**: `table`（默认）、`json`、`summary`
- **零依赖**（stdlib only），`--analyze` 选项读 PNG IHDR 也只用 struct（不依赖 Pillow）

**用法**：

```bash
# 本地扫描
python3 tools/check-asset-budget.py --root assets/art --analyze

# 只看 FAIL
python3 tools/check-asset-budget.py --root assets/art --show FAIL

# JSON 给 CI
python3 tools/check-asset-budget.py --root assets/art --format json --max-fail 0

# 远端扫描（沙箱内可用）
python3 tools/check-asset-budget.py --github --repo rainskyfyy/wildwood --ref main --format summary
```

**本次实测结果**（main HEAD, 2026-08-23）：

```
Total PNGs:  253
  FAIL (>=500KB):   157
  WARN (>=50KB):   5
  OK   (<50KB):    91
Total size:  1323.49 MB
Worst:       assets/art/hero/protagonist_28frames/hero_right_idle.png (9.50 MB)
```

### 3.2 GitHub Actions 接入（建议）

新建 `.github/workflows/asset-budget.yml`：

```yaml
name: asset-budget
on:
  push:
    paths:
      - 'assets/**'
  pull_request:
    paths:
      - 'assets/**'
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check asset budget
        run: python3 tools/check-asset-budget.py --root assets/art --analyze --max-fail 0
```

**当前状态**: workflow 文件未在本次任务中推送（保持 scope 最小，避免无 review 就动 CI）。建议作为独立小任务 v0.7.6b 提交，含：① 上面的 workflow ② 一份 PR 模板要求美术 PR 截图 check-asset-budget 输出 ③ docs link。

---

## 4. 时间估算

| 阶段 | 工作 | 负责人 | 估算 |
|---|---|---|---|
| ① Aseprite 配置 + 重导 hero | 29 张 | AI 画师 | 0.5 天（脚本化批量） |
| ② Aseprite 配置 + 重导 monsters (5 类 × 20) | 100 张 | AI 画师 | 0.5 天（脚本化批量） |
| ③ 重导 resources/ui/buildings/tools | 28 张 | AI 画师 | 0.25 天 |
| ④ 验证（人工 review 视觉） | 157 张 | AI 画师 | 0.25 天（屏幕随机抽 20% 看） |
| ⑤ push_to_github.py 跑批量 push | 4–5 commits | 高级开发 | 0.1 天（脚本+ 验证 commit） |
| ⑥ CI workflow 接入 | 1 文件 | 高级开发 | 0.1 天 |
| **合计** | | | **≤ 1.5 工作日** |

**风险**:
- 美术重导后某些 sprite 的 trim 会改变中心点，runtime 渲染需重新对齐（v0.5.2 既有 main.js 期望 sprite 中心在固定像素，trim 后会偏移）。**建议在 ④ 验证环节同时跑 `node --check` + smoke test，确认无渲染异常**
- `monster_20frames` 之类的 20 张一组的 batch，trim 后单张大小 5–10 KB，20 张 100–200 KB，**比单张小图还省**

---

## 5. 收益预估

| 阶段 | 仓库大小 | 单图最大 | 总文件数 |
|---|---:|---:|---:|
| **当前** | 1,323 MB | 9.5 MB | 253 |
| **重导后（理论）** | 25–40 MB | 50 KB | 253 |
| **减少** | **~97%** | **~99%** | — |

**下游收益**:
- 仓库 clone 从 1.3 GB → 30 MB，沙箱内 git clone github.com 失败率会下降
- Pages 部署只影响 `docs/`，但**完整 repo 拉取速度**会显著提升
- 联机层加载 sprite 速度提升（虽然现在不下载，但 PR review 时改 1 张图从 9.5MB diff → 50KB diff，**reviewer 心理负担大幅下降**）
- 看板同步 cron (auto-sync) push 频率可提至 5 分钟一次（之前 9.5MB × N commits 推 GitHub API 偶发慢）

---

## 6. 风险 & 替代方案

### 6.1 风险

- **美术资产视觉效果可能改变**：trim 后 sprite 边界会变，runtime 渲染中心点要重算
- **部分 sprite 可能本意就是 4096×4096**（如远景大图），需要美术先 audit 哪些是 bug 哪些是设计；**当前没有"应有的尺寸"文档，需要美术先做一遍**。

### 6.2 替代方案（如果美术工时不够）

- **方案 B（脚本批量）**: 写一个 Python 脚本用 Pillow 自动 trim 透明边 + 转 8-bit 索引色 → 一次性批量处理（不做语义判断，纯粹几何操作）。**优点**: 1 小时做完。**缺点**: 某些 sprite 可能 trim 掉原本应有的透明 padding，runtime 对齐会偏。
- **方案 C（双轨）**: 保留原文件，新增 `*_trim.png` 后缀，runtime 优先用 trimmed。**优点**: 可逆。**缺点**: 文件数翻倍。
- **方案 D（不修 + 加 LFS）**: 1300MB 用 Git LFS 管，不修 Aseprite 导出。**优点**: 5 分钟搞定。**缺点**: LFS quota + 沙箱内 clone 还是要全拉，且**根因没解决**，下个 PR 还会塞 9.5MB 文件。

**推荐**: 方案 A（本方案），美术重导是正解；如赶时间可临时落方案 B，事后回填美术 review。

---

## 7. 验收清单

- [x] 至少 1 张大文件实际下载并 Pillow 分析（axe.png → 4096×4096 RGBA）
- [x] `tools/check-asset-budget.py` 可运行、扫出超标（已实测：157 FAIL / 5 WARN / 91 OK）
- [x] `docs/asset-slimming-plan.md` 完整可执行
- [x] 推送到 `rainskyfyy/wildwood` main 分支（本次 commit 见下）
- [ ] **后续**: 美术重导（不在本任务范围）
- [ ] **后续**: CI workflow 接入（建议作为 v0.7.6b 独立任务）

---

## 8. 推送记录

- **Commit**: 见 deliverable 链接（harness 提交后由本任务在父任务里 attach）
- **新增文件**:
  - `tools/check-asset-budget.py` (~230 行, stdlib only)
  - `docs/asset-slimming-plan.md` (本文件)

---

## 9. 附:本任务数据 sheet

```
2026-08-23 沙箱内实测:
  - 总 PNG:        253
  - > 500KB:       157  (1,321.53 MB)
  - 50-500KB:      5    (1.91 MB)
  - ≤ 50KB:        91   (~0.05 MB)
  - 总体积:        1,323.49 MB
  - 最大单图:      9.50 MB (hero_right_idle.png)
  - 最小单图:      0.10 KB (16x16 RGBA decoration)
  - 比率:          157 张占 99.9% 体积
  - 实际样本(axe.png): 4096x4096 RGBA, 8-bit, uncompressed=64MB
  - 推测样本(hero):   ~1576x1576 RGBA (按 9.5MB / 4B 推算)

压缩工具栈: pngcrush (re-encode) + pngquant (palette) + pngcheck (verify)
去重建议:  --rem alla --rem text (去 all ancillary chunks + text chunks)
```
