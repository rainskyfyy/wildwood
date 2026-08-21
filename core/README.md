# core — Wildwood 核心游戏逻辑

`core/` 包含 GameManager、NetworkClient、SaveSystem 等 autoload 单例与全局服务。
M1.4-1.6 在 `core/abstract/` 落三层抽象接口(A/B 通用层,切换时不重写)。

## 目录

```
core/
├── abstract/                 A/B 通用层(三层抽象 — M1.4-1.6)
│   └── data/                 数据层(M1.4 关键路径,已完成)
│       ├── SCHEMAS.md
│       ├── schemas.py
│       ├── store.py
│       ├── store_mock.py
│       ├── adapter.py
│       ├── examples/
│       └── tests → ../../tests/unit/test_data_layer.py
│
├── (M1.5) network/           网络协议语义层(Protobuf 消息定义)
├── (M1.6) resources/         资源元数据层(.ase 色板 + 32px 网格)
│
├── GameManager.gd            (M2) 单例,挂载场景 root
├── NetworkClient.gd          (M2) WebSocket 客户端
├── SaveSystem.gd             (M2) 包装 core/abstract/data 供 GDScript 调用
└── ...
```

## 当前状态(M1 框架 W1-W4)

- **M1.1**:Godot 4.3 项目脚手架 ✓
- **M1.4**:数据层抽象接口(本文) ✓ — `core/abstract/data/`
- M1.5:网络协议语义层(下一任务)
- M1.6:资源元数据层(下一任务)
- M1.9-1.11:房间服务 + WebSocket(M1.4 之后)
