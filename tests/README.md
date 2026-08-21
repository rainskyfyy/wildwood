# tests/ — 测试目录

三层测试体系,**M1.3 落地**:

| 层 | 子目录 | 框架 | 触发 | 目的 |
|---|---|---|---|---|
| 单元 | `unit/` | GUT 9.2.0 | 每次 push | `core/` 纯函数 / 工具的回归 |
| 集成 | `integration/` | Godot SceneTree 脚本 | 每次 push | 场景加载、配置、资源引用 |
| 端到端 | `e2e/` | Playwright 1.62 + Chromium | 每次 push / M3 提测前 | Web 导出页可启动 + 关键 DOM |

## 目录布局

```
tests/
├── unit/                # GUT 单测
│   ├── test_math_utils.gd
│   ├── test_save_metadata.gd
│   └── .gutconfig.gd
├── integration/         # Godot 集成测试
│   ├── run_integration.gd          # 入口(godot --script 调)
│   ├── test_main_scene_loads.gd
│   ├── test_resource_paths.gd
│   └── test_project_settings.gd
├── e2e/                 # Playwright E2E
│   ├── package.json
│   ├── playwright.config.ts
│   ├── tests/
│   │   └── web-bootstrap.spec.ts
│   ├── mock-godot-export/         # 沙箱可用的 mock web 导出
│   │   ├── index.html
│   │   ├── main.js
│   │   ├── style.css
│   │   └── serve.js              # 零依赖 Node 静态服务
│   ├── screenshots/              # 截图输出(.gitignore)
│   └── .gitignore
├── scripts/             # 运行脚本
│   ├── install_gut.sh            # 拉 GUT 9.2.0
│   ├── run_unit.sh
│   ├── run_integration.sh
│   ├── run_e2e.sh
│   └── run_all.sh
└── README.md
```

## 快速开始

```bash
# 一次性:装 GUT
bash tests/scripts/install_gut.sh

# 跑单层
bash tests/scripts/run_unit.sh         # GUT
bash tests/scripts/run_integration.sh  # Godot 集成
bash tests/scripts/run_e2e.sh          # Playwright

# 一键
bash tests/scripts/run_all.sh
```

## 验收 ①:`godot --headless --test` 跑 GUT

GUT 9.2.0 支持 Godot 4.3 的 `--test` 选项:

```bash
# 等价形式(GUT 自动接管 --test)
godot --headless --test --test-suite-path=res://tests/unit

# 或用 GUT 自带 cmdln(项目 README 历史形式,等价)
godot --headless --path . -s addons/gut/gut_cmdln.gd \
  -gdir=res://tests/unit -gprefix=test_ -gexit
```

## 验收 ②:集成测试通过场景脚本

```bash
# 默认跑全部
bash tests/scripts/run_integration.sh
# 输出:TOTAL pass=X fail=0 → 退出码 0

# 过滤跑
bash tests/scripts/run_integration.sh --filter test_main_scene
```

## 验收 ③:Playwright 打开 Web 导出页面并截屏

```bash
bash tests/scripts/run_e2e.sh
# 截图保存到 tests/e2e/screenshots/web-bootstrap-chromium.png
```

## 沙箱/CI 适配

| 环境 | Unit | Integration | E2E |
|---|---|---|---|
| 本地开发(已装 Godot) | ✓ | ✓ | ✓ |
| CI(Ubuntu + Godot 4.3) | ✓ | ✓ | ✓ |
| 沙箱(无 Godot 引擎) | ⚠ 需装 Godot | ⚠ 需装 Godot | ✓ 用 mock |

E2E 永远能跑,因为默认对接 mock web export。真实 Godot web build 就绪后(M1.2 + M3.10),
只需设置 `WILDEWOOD_E2E_BASE_URL=http://your-web-build-server` 即可切换。

## 命名约定

- 单元测试:`test_<module>.gd`(`test_save_metadata.gd`)
- 测试方法:`test_<behavior>_<expected>()`(`test_is_valid_rejects_empty_id`)
- 集成测试:`tests/integration/test_<feature>.gd`
- 集成测试静态入口:`static func run(ctx) -> Dictionary`

## 覆盖率目标(M3 验收)

- 单元测试:核心模块 ≥ 70%(`core/abstract/` ≥ 90%)
- 集成测试:关键流程全覆盖(MVP 7 大模块各 ≥ 1 端到端用例)
- 联机压测:4 人 30 分钟不掉线(M3.7)
