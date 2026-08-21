## M3.1 GDScript 1:1 镜像常量 — 客户端预测 + 服务端校正
##
## 权威源: core/abstract/network/python3/wildwood/constants.py
## 改动任一常量 = 协议层破坏,需同步 Python 端并 bump SEMANTICS 版本。
##
## 设计: 所有数值与 Python constants.py 1:1 对应,单位一致(px / ms / Hz / m·s⁻¹)。
## 客户端 Prediction/Interpolation 在 GDScript 端用这些常量,
## 服务端 Go 端用对应的 room.AuthState 常量(也在镜像内,见 auth_state.go)。

# 校正阈值(像素) — 偏差 > 此值触发 100ms 插值
const RECONCILE_THRESHOLD_PX: float = 32.0

# 插值持续时间(毫秒) — 校正期间位置从 current → target 线性插值
const INTERP_DURATION_MS: int = 100

# 隐藏持续时间(毫秒) — 校正期间被校正实体对本地玩家不可见
const HIDE_DURATION_MS: int = 100

# 默认移动速度(米/秒) — 与 M2.1 PlayerController 一致
const DEFAULT_SPEED_MPS: float = 4.0

# 像素/米换算 — 1 米 = 32 像素(基础网格)
const TILE_SIZE_PX: int = 32

# 输入应用步长(秒) — 60Hz 物理步长,M2.1 PlayerController 沿用
const INPUT_DT_S: float = 1.0 / 60.0

# 服务端 tick 频率(Hz) — 方案 §3.4 网络帧 20Hz
const SERVER_TICK_HZ: int = 20

# 服务端 tick 周期(毫秒)
const SERVER_TICK_MS: int = 50

# 输入频率上限(Hz) — 客户端发包率 ≤ 60Hz,服务端校验
const MAX_INPUT_RATE_HZ: int = 60

# 移动 burst 系数 — 单步位移允许超 max_speed 的倍数(避免 1 帧 sub-pixel 卡死)
const MOVE_BURST_MULTIPLIER: float = 1.5

# 世界坐标边界(米) — 4 人 9 宫格流式加载区域的 1/2(M2.7 已定)
const WORLD_HALF_BOUND_M: float = 1024.0
