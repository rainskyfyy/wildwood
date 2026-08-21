# tests/ — 测试目录

按测试粒度分两层:

| 子目录          | 测试类型        | 框架(M1.3 落地)         |
|-----------------|-----------------|--------------------------|
| `unit/`         | 单元测试        | GUT(GDScript Unit Test)  |
| `integration/`  | 集成 / 场景测试 | Godot 集成测试 + Playwright E2E |

## 当前内容

(M1.1 阶段:空。测试框架与首批用例在 M1.3 落地。)

## 命名约定

- 单元测试:`test_<module>.gd`(`test_save_system.gd`)
- 测试方法:`test_<behavior>_<expected>()`(`test_save_load_preserves_inventory`)
- 集成测试:`integration/<feature>.gd`

## 运行测试

```bash
# GUT 命令行运行(M1.3 后)
godot --headless --path . -s addons/gut/gut_cmdln.gd

# Playwright E2E(M1.3 后,需 M1.2 导出 web build)
cd tests/e2e && npx playwright test
```

## 覆盖率目标(M3 验收)

- 单元测试:核心模块 ≥ 70%(`core/abstract/` ≥ 90%)
- 集成测试:关键流程全覆盖(MVP 7 大模块各 ≥ 1 端到端用例)
- 联机压测:4 人 30 分钟不掉线(M3.7)
