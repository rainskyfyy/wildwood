extends RefCounted
## 死亡与复活 — 常量集中文件 (M2.5)
##
## 全部使用 ms(毫秒)作为时间单位;距离使用 px(像素);
## 32px = 1 网格(对齐项目硬约束 §3.4)。
##
## 一切与方案 §2.1 "死亡惩罚" / §5.4 "联机硬约束" 对齐。
class_name WildwoodDeathConstants

# ---------------- 时间窗口 ----------------

## 鬼魂态总窗口(玩家死后可被救起的最大时间)
## 验收 ① / ② / ③: 10s 倒计时 / 队友 10s 内接触复活 / 超时生成遗物
const GHOST_WINDOW_MS: int = 10_000

## 复活动作需要持续按住 / 接触的时间(M2.5 简化为瞬时)
## 留接口,后续可以扩展为"按住 E 1.5s 复活"等深度玩法
const REVIVE_HOLD_MS: int = 0

# ---------------- 距离阈值 ----------------

## 队友接触复活的距离阈值(像素)
## 32px 网格 = 1 格,1.5 格 = 48px,够队友在鬼魂身上挤进来
const REVIVE_TOUCH_PX: float = 48.0

## 遗物坐标广播半径(像素)
## 半径内的队友都会在 HUD 上看到遗物提示
const REMAINS_PING_RADIUS_PX: float = 320.0  # 10 网格

# ---------------- 状态机值(对应 common.proto) ----------------

## 与 common.proto PlayerStatus.is_alive 字段语义保持一致
const STATE_ALIVE: int = 0
## 鬼魂态(HP=0 后 10s 窗口,等待复活)
const STATE_GHOST: int = 1
## 濒死(超时,遗物已生成,需要回城 / 队友拾取)
const STATE_DEAD: int = 2

# ---------------- 复活参数 ----------------

## 复活后满血(方案 §2.1 "10s 队友复活窗口" 隐含)
## 简化:队友救起直接满血,超时回城也满血
const REVIVE_HP_PCT: int = 100
## 复活无敌帧(避免刚被救起就被怪物秒)
const REVIVE_INVULN_MS: int = 1_500

# ---------------- 遗物参数 ----------------

## 遗物存续时间(超时未拾取则消失)
const REMAINS_LIFETIME_MS: int = 5 * 60_000  # 5 分钟
## 拾取半径
const REMAINS_PICKUP_PX: float = 48.0

# ---------------- HP provider 接口契约 ----------------

## M2.4 注入的真实 HP 系统的桥接钩子
## mock 实现(测试用):每 1ms 减 1,让玩家能快速进入 GHOST
## 真实实现(M2.4):订阅 damage 事件,HP ≤ 0 时回调
const HP_DROP_RATE_MOCK_PER_MS: float = 1.0   # mock:1 ms = 1 HP
const MOCK_HP_INITIAL: int = 100
const MOCK_HP_MAX: int = 100
