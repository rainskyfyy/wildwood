# Wildwood

> 一款 4 人小队合作 2D 像素生存游戏 — 类饥荒 × 星露谷暖色基底,Web 优先零安装。

[![Engine](https://img.shields.io/badge/Godot-4.3-478cbf?logo=godotengine&logoColor=white)](https://godotengine.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Stage](https://img.shields.io/badge/stage-M1-blueviolet)](#里程碑)
[![Status](https://img.shields.io/badge/M1.1-scaffold-success-brightgreen)](#里程碑)

---

## 项目简介

**Wildwood** 是 M1 阶段立项的类饥荒合作生存游戏。技术主线 A 线:**Godot 4.3 + WebSocket + Go 房间服务**,通过三层抽象接口(数据 / 网络协议语义 / 资源元数据)预留 B 线(Unity 6 + Mirror + .NET 8)切换空间。

- **核心循环**:采集 → 制造 → 建造 → 战斗 → 季节循环
- **联机**:4 人小队(1 主机 + 3 队友),服务器权威,20Hz tick,客户端预测 + 服务端校正
- **美术**:32px 基础网格 + 24 暖色板 + 哥特暗黑 × 星露谷暖色
- **目标**:6 个月内可发布可体验的 MVP 完整版

详细方案见[《项目总方案》](https://hisense.feishu.cn/docx/M5pEdEDvPoUGpGxgiWUcLxSQnGu) · 任务拆解见[《项目任务拆分表》](https://hisense.feishu.cn/docx/JrCmdC2S9o4ID5xRM70cuSNsnS2)。

---

## 目录结构

```
wildwood/
├── .editorconfig          # 编辑器统一缩进 / 行尾
├── .gitattributes         # Git 行尾归一化
├── .gitignore             # Godot / 引擎产物 / 资产 / 编辑器忽略
├── LICENSE                # MIT
├── README.md              # 本文件
├── project.godot          # Godot 4.3 项目主配置
├── icon.svg               # 临时图标(M1.12 由 AI 画师替换)
│
├── core/                  # 核心游戏逻辑(autoload 单例 / 全局服务)
│                            包含 GameManager、NetworkClient、SaveSystem 等。
│                            M1.4-1.6 在此落三层抽象接口(A/B 通用层)。
│
├── scripts/               # GDScript 脚本(非 autoload 的纯逻辑)
│                            玩家控制器、怪物 AI、状态机、工具脚本等。
│
├── scenes/                # Godot 场景文件(.tscn / .tres)
│                            主菜单、游戏世界、HUD、背包、地图、图鉴。
│
├── assets/                # 美术 / 音频 / 字体资源
│   ├── art/               # 像素画(M1.12 起 5 张样稿,M2.14 60+ 资产)
│   ├── audio/             # 音效 / 音乐
│   └── fonts/             # 像素字体
│
└── tests/                 # 测试目录
    ├── unit/              # GUT 单元测试(M1.3 落地)
    └── integration/       # 场景级集成测试(M1.3 落地)
```

**分层原则**(对应方案 §3.3 的 A/B 切换接口层):

| 目录        | A 线                | B 线切换            | A/B 通用？ |
|-------------|---------------------|---------------------|-----------|
| `core/`     | 引擎脚本(autoload)  | 引擎脚本(autoload)  | 否(引擎层) |
| `scripts/`  | GDScript 业务       | C# 业务             | 否(引擎层) |
| `scenes/`   | Godot 场景          | Unity 场景          | 否(引擎层) |
| `assets/`   | Godot 导入(`.import`) | Unity 导入        | 否(引擎层) |
| `tests/`    | GUT + Playwright    | Unity Test Framework | 否(引擎层) |
| 三层抽象    | 见 `core/abstract/` | 同左                | **是(通用层)** |

A→B 切换时**仅重写引擎层**(`core/` / `scripts/` / `scenes/`),通用层接口不变。

---

## 环境要求

| 工具              | 版本          | 说明                        |
|-------------------|---------------|-----------------------------|
| Godot Engine      | **4.3.x**     | 必须 ≥ 4.3,推荐 4.3.1+      |
| Git               | 任意现代版本  | LFS 非必需(本仓库不存大文件)|
| Go                | 1.22+         | 仅在 M1.9+ 跑房间服务时需要 |
| Python            | 3.10+         | CI 脚本依赖(可选)          |
| Node.js           | 18+           | Playwright E2E(M1.3 落地)  |

### 安装 Godot 4.3

- **官方下载**:<https://godotengine.org/download> → 选 `Godot v4.3.x` Mono **或** 标准版(M1 阶段 GDScript 即可,Mono 在 C# 实验性场景按需启用)
- **macOS**:`brew install --cask godot@4.3`
- **Linux**:`flatpak install flathub org.godotengine.Godot` 或下载 AppImage
- **Windows**:官方 zip 解压即用

> **CI 环境固化**:M1.2 由工作台搭建师把 Godot 4.3 安装包写入工作台 CI,确保所有 PR 跑同版本引擎。

---

## 构建与运行

### 1. 克隆仓库

```bash
git clone <repo-url> wildwood
cd wildwood
```

### 2. 在 Godot 中打开

#### 方式 A:Godot 编辑器

```bash
godot --editor .
```

首次打开 Godot 会自动创建 `.godot/` 缓存目录(已在 `.gitignore` 中),导入完成后即可在编辑器内点 **▶ Play** 运行。

#### 方式 B:直接运行(无编辑器)

```bash
godot --path . scenes/main.tscn
```

### 3. 调试 / 运行参数

| 场景                | 命令                                                    |
|---------------------|---------------------------------------------------------|
| 编辑器打开          | `godot --editor .`                                      |
| 直接跑主场景        | `godot --path . scenes/main.tscn`                       |
| 跑 GUT 单元测试     | `godot --headless --path . -s addons/gut/gut_cmdln.gd`  |
| Web 导出(HTML5)     | `godot --headless --path . --export-release "Web" build/index.html` |

> Web 导出配置(`export_presets.cfg`)由 M1.2 工作台搭建师提供。本仓库已预留该文件名,但内容为占位。

### 4. 输入操作(默认绑定)

| 操作          | 键位            | 备注                                   |
|---------------|-----------------|----------------------------------------|
| 移动          | `WASD` / 方向键 | 8 方向                                 |
| 互动 / 攻击   | 鼠标左键        | LMB 智能判别(移动 / 攻击 / 采集,M2.1) |
| 退出          | `Esc`           | 主场景根节点监听 `ui_cancel`           |

> 自定义输入映射在 `project.godot` 的 `[input]` 段,直接编辑或 Godot 编辑器 → Project Settings → Input Map 调整。

---

## 验证 M1.1 验收标准

本任务(M1.1)对应三条硬验收:

| 编号 | 验收标准                                            | 状态 |
|------|-----------------------------------------------------|------|
| ①    | 仓库可 `git clone` 后用 Godot 4.3 打开              | ✅ `project.godot` `config_version=5`、含 `4.3` feature tag |
| ②    | 目录结构按 "core / scripts / scenes / assets / tests" 分层 | ✅ 见上方目录结构图 |
| ③    | README 含构建运行说明                                | ✅ 见上方「构建与运行」一节 |

快速自检:

```bash
# 1. 验证项目文件可被 Godot 4.3 识别
godot --headless --check-only --path .

# 2. 验证主场景可加载(不报错即通过)
godot --headless --quit --path . scenes/main.tscn
```

`--check-only` 在 Godot 4.3+ 可用,会校验项目配置合法性而不进入主循环。

---

## 里程碑

| 阶段     | 周次    | 目标                                       | 当前状态 |
|----------|---------|--------------------------------------------|----------|
| **M1 框架**  | W1-W4   | 引擎选型落地、CI/CD、三层抽象接口跑通       | **进行中** (M1.1 ✅) |
| M2 核心循环 | W5-W10  | 单机可玩:核心循环 + 战斗 + 合成 + 图鉴     | 未开始   |
| M3 联机    | W11-W16 | 4 人联机 MVP 完整版可发布                  | 未开始   |

任务依赖图与关键路径见[《项目任务拆分表》§2.1-2.2](https://hisense.feishu.cn/docx/JrCmdC2S9o4ID5xRM70cuSNsnS2)。

---

## 团队与协作

- **老板**:产品决策、需求拍板、对外发布
- **高级开发工程师**(agent):架构设计 + 模块整合 + 代码审查
- **AI 画师**(agent):美术资产 + 风格一致性维护
- **UI 设计师**(agent):交互规范 + 原型 + 组件库
- **工作台搭建师**(agent):DevOps / CI / 房间服务部署

任务通过 aily-cli task 派发,产出以飞书云文档链接交付,跨 agent 不传本地文件路径。

---

## 贡献

### 分支策略(待 M1.2 确认)

- `main`:稳定分支,只接受通过 PR review 的合并
- `develop`:日常开发分支
- `feature/*`:功能分支,命名 `<M1.x>-<slug>`(如 `M1.4-data-layer`)

### PR 评审 5 项自查(美术相关,见方案 §4.5)

1. 剪影测试(转纯黑剪影必须能识别身份)
2. 色板测试(违例色 = 0)
3. 网格测试(像素对齐误差 ≤ 0px)
4. 抗锯齿测试(边缘不允许中间灰阶)
5. 动画流畅度(同动作帧数前后版本变化 ≤ 20%)

> 纯代码 / 逻辑类 PR 暂不强制上述 5 项,采用通用代码评审(可读性 / 测试 / 边界 / 安全 / 性能)。

---

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
