# Wildwood M1.5 — 网络协议语义层

> 阶段：M1 框架（W1-W4）  
> 负责人：高级开发工程师  
> 状态：✅ 完成 (2026-08-20)

## 目标

用 Protobuf 定义 21 个 Wildwood 网络消息类型（9 × C2S + 12 × S2C），不绑 WebSocket/UDP，
A/B 通用（Godot 4.3 / Unity 6 双端共用同一份 .proto）。

## 验收对照

| 验收 | 实现 | 证据 |
| --- | --- | --- |
| ① .proto + 编译脚本 | `proto/wildwood/v1/{common,c2s,s2c,wildwood}.proto` | `gen.sh` (protoc 25.1) |
| ② Go + GDScript 双端编解码 | `go/wildwood/v1/*.pb.go` (protoc-gen-go) + `gd/wildwood_*.gd` (手写 wire) | `go test ./...` 34 通过 + `python3/verify_wire.py` 17 通过 |
| ③ mock 客户端/服务端互通 | `go/mocks/{pipe,server}.go` + `gd/wildwood_net.gd` | `go test ./tests/interop_test.go` 5 通过 |
| ④ 消息长度 < 4 KB/tick | 严格预算 | `go run ./cmd/sizeaudit` worst=2851 / 4096 |

## 目录结构

```
core/abstract/network/
├── README.md                    # 本文件
├── Makefile                     # gen / check / test / sizeaudit
├── gen.sh                       # 协议代码生成 (protoc 25.1)
├── proto/wildwood/v1/           # .proto 真相源
│   ├── common.proto             # 公共类型 + 枚举
│   ├── c2s.proto                # 客户端→服务端
│   ├── s2c.proto                # 服务端→客户端
│   └── wildwood.proto           # ProtocolInfo 元数据
├── go/                          # Go 服务端 + protoc 产物
│   ├── wildwood/v1/             # protoc-gen-go 输出
│   ├── codec/                   # 帧格式 + 类型注册表
│   ├── mocks/                   # 内存管道 mock 客户端/服务端
│   ├── tests/                   # 34 个测试 (round-trip / size / interop)
│   └── cmd/sizeaudit/           # 字节预算自检 CLI
├── gd/                          # Godot 客户端 codec (手写 wire)
│   ├── wildwood_wire.gd         # 基础 wire format (varint/zigzag/fixed32/length/frame)
│   ├── wildwood_common.gd       # 公共类型 (Vec2F/PlayerState/EntityState/...)
│   ├── wildwood_c2s.gd          # 9 个 C2S 消息
│   ├── wildwood_s2c.gd          # 12 个 S2C 消息
│   ├── wildwood_net.gd          # MockPipe / MockClient / MockServer + NetClient/NetServer stub
│   └── tests/test_roundtrip.gd  # GDScript 单测 (GD 4.3 headless 跑)
└── python3/verify_wire.py       # 独立 wire format 验证器 (无 Godot 二进制时用)
```

## 设计决策

### 1. transport-agnostic

`codec.go` 只定义帧格式 `[varint LEN][varint TYPE_LEN][TYPE][PAYLOAD]`，
不绑 WebSocket/UDP/QUIC；任何传输层都能直接读写字节。
真实传输（WebSocket/QUIC）由 M1.9 工作台搭建师补到 `gd/wildwood_net.gd` 的 NetClient/NetServer 占位。

### 2. 字段编号一旦发布不变

v1 字段编号锁定；M2.x/M3.x 加新字段用新编号 + 保留旧编号。

### 3. Godot 4 无原生 Protobuf

`gd/wildwood_wire.gd` 手写 wire format 实现，逐字节对齐 `proto/wildwood/v1/*.proto`。
Godot 端用 `preload` + 静态类方法，无第三方插件依赖。

### 4. 客户端预测字段预留

`C2S_PlayerInput.input_seq` + `S2C_WorldDelta.acked_input_seqs` 已在协议层就位，
供 M3.1 客户端预测 + 服务端校正使用（关键路径）。

### 5. 4 人小队硬约束

`wildwood.proto` 中 `max_players = 4`，`S2C_RoomJoined.max_room_players = 4`；
`go/mocks/server.go` 中 `RoomJoin` 强制 `len(members) >= 4` 拒绝。

### 6. 状态条只给百分比

`PlayerStatus` 只有 `hp_pct / hunger_pct / sanity_pct / temp_pct`（0-100），
符合方案 §5.4 隐藏具体数值。

## 运行测试

### Go 端

```bash
cd core/abstract/network
export PATH="$HOME/.aily/.cli/bin:$PATH"   # protoc + protoc-gen-go
./gen.sh                                    # 生成 .pb.go (如 .proto 改过)
go test ./...                               # 34 个测试
go run ./cmd/sizeaudit                      # 字节预算自检
```

### Godot 端

```bash
cd core/abstract/network/gd
gdlint *.gd                                 # 静态检查
godot --headless --script tests/test_roundtrip.gd  # 跑测试 (需 Godot 4.3)
```

### Python 独立验证器（无 Godot 二进制时）

```bash
cd core/abstract/network
python3 python3/verify_wire.py
```

## 已知约束 / 待办

- **M1.5 当前未做**：真实 WebSocket/UDP 传输层（NetClient/NetServer 是 stub）
  → M1.9 由工作台搭建师补
- **M1.5 当前未做**：跨语言 i18n 错误消息
  → 跟随 M3.8 错误码 i18n
- **GDScript 测试**：沙箱内无 Godot 二进制，靠 `gdtoolkit` 静态检查 + Python 验证器交叉验证
  → CI 环境用 Godot 4.3 headless 跑

## A/B 兼容性

- **A 线（Godot 4.3 + WebSocket + Go room service）**：本文件即 A 线 codec
- **B 线（Unity 6 + Mirror + .NET 8）**：复用 `proto/*.proto`，
  由 B 线用 `protoc-gen-csharp` 生成 C# 类型；
  wire format 一致，Unity 端用 C# 等价实现或 NuGet `Google.Protobuf` 库

## 协议 v1 兼容性

字段编号一旦发布不变：
- 加字段：用新编号 + 旧编号保留
- 改字段语义：弃用旧编号 + 开新编号 + 双编号并存 ≥ 1 个 milestone
- 删字段：弃用但保留（用 reserved 关键字）

## 引用

- 《项目总方案》<https://hisense.feishu.cn/docx/M5pEdEDvPoUGpGxgiWUcLxSQnGu> §3.4 §5.4
- 《项目任务拆分表》<https://hisense.feishu.cn/docx/JrCmdC2S9o4ID5xRM70cuSNsnS2> M1.5
- 协议真相源：`proto/wildwood/v1/*.proto`
- Protobuf 规范：<https://protobuf.dev/programming-guides/encoding/>
