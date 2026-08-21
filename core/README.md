# core/ — 核心游戏逻辑

放置**所有 autoload 单例、全局服务、跨场景复用的核心模块**。这一层的修改会全局生效,改动需谨慎 + PR 评审。

## 当前内容

(M1.1 阶段:空。autoload 单例在 M1.x 陆续添加。)

## 计划中的模块

| 模块              | 任务       | 备注                                 |
|-------------------|------------|--------------------------------------|
| `GameManager`     | M1.x       | 全局状态机(主菜单 / 游戏中 / 暂停)  |
| `NetworkClient`   | M1.10      | Godot WebSocketPeer + NetClient 封装 |
| `SaveSystem`      | M1.4 + M2.6 | JSON 存档 + 版本迁移                |
| `TimeManager`     | M2.8       | 季节 / 昼夜循环驱动                  |
| `WorldRegistry`   | M2.7       | 生物群系 / chunk 注册表              |

## 三层抽象接口(A/B 通用层)

按方案 §3.3,以下三个目录在 A/B 线切换时**保留**,引擎层重写即可:

- `core/abstract/data/`     — M1.4 数据层抽象(JSON schema + 版本号)
- `core/abstract/network/`  — M1.5 网络协议语义层(Protobuf)
- `core/abstract/assets/`   — M1.6 资源元数据层(Aseprite + 24 色板 + 32px 网格)

> 这些目录将在对应 M1.x 任务中创建,本任务(M1.1)只占位。
