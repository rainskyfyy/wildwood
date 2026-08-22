## Wildwood Pull Request Checklist

> v0.7.0c 起执行。每一项都要在 PR 描述里勾选或写明 N/A。CI 也会做静态检查,
> 但**人工 review 仍是主防线** — 自动化只抓得住硬规则。

### 通用

- [ ] **变更范围最小化**:不夹带无关重构或顺手的样式调整。
- [ ] **commit message 写明批次号**(M2.xx / M3.xx / M4.xx / v0.x.y);若是直推
      GitHub API,message 至少包含一段人类可读说明。
- [ ] **没有引入新依赖**;若必须引入,在 PR 描述里说明理由 + 替代方案。
- [ ] **本地 `node --check` 过**(改动过的 .js / .mjs 文件全部)。

### 资源 / spawner / 测试 fixture

- [ ] **fixture 抗漂移检查**(v0.7.0c 起 PR review 必检):本次改动如果触及
      `src/resources/`、`tests/v060c-spawner-fixture.mjs` 或新增测试,确认
      没有出现 `arr.find(pred)[N]` / `const x = arr.find(pred); x[N]`
      模式。详见 `docs/spawner-fixture-guideline.md` 第 2 节。
      CI 已开 `wildwood/no-find-then-index` 规则做静态拦截,本项是 review
      视角的二次兜底(规则覆盖不到的语义边界,例如 `.find` 后立刻
      `.distTo` 然后取"第一个"对象当"最近"用 — 规则不报但也是反模式)。
- [ ] **catalog 改动后跑 `node tests/v060c-spawner-fixture.mjs`**,截图或
      日志贴 PR 描述。
- [ ] **新测试用固定 seed**(推荐 `seed: 20260822` 项目级常量),且只断言
      集合性质(最近 / 范围内 / 至少 N 个),不依赖 spawn 顺序。

### 联机 / 网络 / 并发

- [ ] **WebSocket 消息体含 `seq` 或 `t` 字段**(M3 协议要求,可重放排序)。
- [ ] **客户端只读 server 推送,server 不信任 client 状态**(M3 信任模型)。
- [ ] **断线重连不丢关键事件**(用 `since=lastAckSeq` 续传)。

### 数据 / 资源 / 配置

- [ ] **JSON 数据 schema 在 `src/data/<name>.json` 自带 `$schema` 字段或
      README 说明**,新增字段不破坏既有读取路径。
- [ ] **新增资源/配方/建筑**:已同步更新 `src/data/*.json` 索引、相关 UI
      注册表、对应的 `metadata/reports/<id>_metadata.json`。

### 美术 / 音频

- [ ] **新增 PNG 走 `assets/art/biomes/<biome>/`**(M2.14 起的目录约定),
      不再平铺到 `assets/art/`。
- [ ] **像素图 ≤ 64×64**,色板在 `palette.md` 标注,暖色占比 ≤ 40%(暖色
      基底项目约束)。
- [ ] **音效走 `src/audio/registry.js` 注册**,不直接 `new Audio()`。

### 文档

- [ ] **CHANGELOG / 任务表对应行已更新**;若属新功能,在
      `docs/roadmap.html` 勾对应里程碑。
- [ ] **新增/修改公共 API**(导出的纯函数、JSON 字段名、协议字段):
      在 `src/README.md` 或对应模块 README 写明。

### 安全 / 不可逆

- [ ] **没有直接 push 到 main** — 走 `feat/<name>` 分支,merge 由
      dispatcher(小德芙 / agent_4k3appg6j332v)把控。
- [ ] **没有删除他人分支或 force-push 同事 commit**;如需回滚,做 fix-up
      commit 而非重写历史。

### 风险与回滚

- [ ] **写明影响面**(改了几个模块、几个测试、几条数据)。
- [ ] **写明回滚步骤**(revert 到哪个 commit、是否需要数据迁移)。
- [ ] **不可逆操作(数据库迁移、生产环境配置、删除他人代码)在 PR
      描述里单独标 ⚠️ 段**,等 reviewer 二次确认。
