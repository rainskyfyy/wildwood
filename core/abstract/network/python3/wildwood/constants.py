"""M3.1 客户端预测 + 服务端校正常量(方案 §3.1.1)。

所有常量是网络协议层的硬约束(参考 M1.5 网络协议语义层 .proto 字段),
改动任一常量 = 协议层破坏,需同步 M1.5 .proto 字段语义。

权威: 方案 §3.1.1
- 客户端本地立即执行(≤ 50ms 反馈),给每条输入打 seq 序号
- 偏差 > 32px(1 网格)时,用 100ms 平滑插值校正
- 校正期间隐藏「被校正实体」100ms
"""
from __future__ import annotations

# 校正阈值(像素) — 偏差 > 此值触发 100ms 插值
RECONCILE_THRESHOLD_PX: float = 32.0

# 插值持续时间(毫秒) — 校正期间位置从 current → target 线性插值
INTERP_DURATION_MS: int = 100

# 隐藏持续时间(毫秒) — 校正期间被校正实体对本地玩家不可见
HIDE_DURATION_MS: int = 100

# 默认移动速度(米/秒) — 与 M2.1 PlayerController 一致
DEFAULT_SPEED_MPS: float = 4.0

# 像素/米换算 — 1 米 = 32 像素(基础网格)
TILE_SIZE_PX: int = 32

# 输入应用步长(秒) — 60Hz 物理步长,M2.1 PlayerController 沿用
INPUT_DT_S: float = 1.0 / 60.0

# 服务端 tick 频率(Hz) — 方案 §3.4 网络帧 20Hz
SERVER_TICK_HZ: int = 20

# 服务端 tick 周期(毫秒)
SERVER_TICK_MS: int = 50

# 输入频率上限(Hz) — 客户端发包率 ≤ 60Hz,服务端校验
MAX_INPUT_RATE_HZ: int = 60

# 移动 burst 系数 — 单步位移允许超 max_speed 的倍数(避免 1 帧 sub-pixel 卡死)
MOVE_BURST_MULTIPLIER: float = 1.5

# 世界坐标边界(米) — 4 人 9 宫格流式加载区域的 1/2(M2.7 已定)
WORLD_HALF_BOUND_M: float = 1024.0
