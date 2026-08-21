"""M3.1 客户端预测 + 服务端校正核心逻辑(纯函数,stdlib only)。

设计要点(方案 §3.1.1):
  - predict(): 立即本地应用输入(≤ 1 帧 = 16.67ms 反馈)
  - reconcile(): 收到服务端 S2C_WorldDelta 后调用
    1. 删除已 ack 的输入
    2. 从 auth_pos 重新应用剩余 unacked 输入(re-simulate)
    3. 比较 re-simulated 与本地预测位置
    4. 偏差 > 32px → 返回 Correction(触发 100ms 插值 + 100ms 隐藏)
    5. 偏差 ≤ 32px → 返回 NoCorrection(无视觉变化)

数据流(与 GDScript 1:1 镜像,SEMANTICS.md 同步):
  Predictor ─predict→ Input(seq, dx, dy, t_ms)
            ←reconcile(auth_pos, acked_seqs)─ ReconciliationResult

GDScript 镜像:core/abstract/network/gd/wildwood_predictor.gd
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Set, Union

from wildwood.constants import (
    DEFAULT_SPEED_MPS,
    TILE_SIZE_PX,
    INPUT_DT_S,
    RECONCILE_THRESHOLD_PX,
)


# ============================================================
# 值对象
# ============================================================
@dataclass(frozen=True)
class Vec2:
    """二维位置(像素)。"""
    x: float
    y: float

    def __add__(self, other: "Vec2") -> "Vec2":
        return Vec2(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Vec2") -> "Vec2":
        return Vec2(self.x - other.x, self.y - other.y)

    def length(self) -> float:
        return math.hypot(self.x, self.y)


@dataclass(frozen=True)
class MoveAction:
    """移动输入(dx, dy ∈ [-1, 1])。

    M2.1 LMB 智能判别只对"移动"类输入触发预测;其他 InputAction
    (ATTACK/GATHER/BUILD/USE_ITEM)由 M2.2/M2.10 等任务接入。
    本期(M3.1)只实现 MOVE 路径,其他 action 视为空闲(不预测位移)。
    """
    dx: float
    dy: float


@dataclass(frozen=True)
class Input:
    """一次客户端输入记录(本地缓存,等服务器 ack)。"""
    seq: int           # input_seq(M1.5 C2S_PlayerInput.input_seq)
    dx: float          # 移动方向 x
    dy: float          # 移动方向 y
    t_ms: int          # 客户端时间戳


# ============================================================
# 校正结果(union type,用 dataclass 模拟 sum type)
# ============================================================
@dataclass(frozen=True)
class NoCorrection:
    """无校正(偏差 ≤ 32px 或服务端与本地一致)。"""
    pass


@dataclass(frozen=True)
class Correction:
    """触发校正(偏差 > 32px)。"""
    start_pos: Vec2          # 校正起点(= 校正前的本地位置)
    target_pos: Vec2         # 校正终点(re-simulated 位置)
    delta_px: float          # 偏差距离


ReconciliationResult = Union[NoCorrection, Correction]


# ============================================================
# Predictor
# ============================================================
class Predictor:
    """单玩家预测器。维护本地预测位置 + 未 ack 输入队列。"""

    def __init__(
        self,
        speed_mps: float = DEFAULT_SPEED_MPS,
        tile_px: int = TILE_SIZE_PX,
        dt_s: float = INPUT_DT_S,
    ) -> None:
        self._speed = speed_mps
        self._tile_px = tile_px
        self._dt = dt_s
        self._current_pos: Vec2 = Vec2(0.0, 0.0)
        self._next_seq: int = 1
        self.pending: List[Input] = []
        # 校正起点记录(reconcile 调用前快照,返回 Correction 时给前端做插值起点)
        self._current_pos_before_reconcile: Vec2 = Vec2(0.0, 0.0)

    # ----- 公共属性 -----

    @property
    def current_pos(self) -> Vec2:
        return self._current_pos

    @property
    def current_pos_before_reconcile(self) -> Vec2:
        """上一次 reconcile 调用前的 current_pos(Correction.start_pos 用)。"""
        return self._current_pos_before_reconcile

    @property
    def next_seq(self) -> int:
        return self._next_seq

    # ----- 公共方法 -----

    def predict(self, action: MoveAction) -> Input:
        """本地立即应用输入,返回待发送的 Input(seq, ...)。

        调用方负责把 Input 序列化后通过 C2S_PlayerInput 发到服务端。
        """
        seq = self._next_seq
        self._next_seq += 1
        # 归一化(对角线不超速,8 方向)
        dx, dy = self._normalize(action.dx, action.dy)
        # 应用步长
        step = self._speed * self._tile_px * self._dt
        self._current_pos = Vec2(
            self._current_pos.x + dx * step,
            self._current_pos.y + dy * step,
        )
        inp = Input(
            seq=seq,
            dx=dx,
            dy=dy,
            t_ms=int(time.time() * 1000),
        )
        self.pending.append(inp)
        return inp

    def reconcile(
        self,
        auth_pos: Vec2,
        acked_seqs: Iterable[int],
    ) -> ReconciliationResult:
        """收到 S2C_WorldDelta(权威位置 + 已 ack seq 列表)后调用。

        返回 ReconciliationResult,前端根据结果决定:
          - NoCorrection → 不动(本地继续预测)
          - Correction → 启动 100ms 插值 + 隐藏
        """
        acked: Set[int] = set(acked_seqs)
        # 1. 记录校正起点(reconcile 前)
        self._current_pos_before_reconcile = self._current_pos
        # 2. 丢弃已 ack 输入,按 seq 升序排
        remaining: List[Input] = sorted(
            [pi for pi in self.pending if pi.seq not in acked],
            key=lambda pi: pi.seq,
        )
        # 3. 从 auth_pos 重新应用 remaining(确定性 re-simulate)
        re_sim_pos = auth_pos
        step = self._speed * self._tile_px * self._dt
        for pi in remaining:
            dx, dy = self._normalize(pi.dx, pi.dy)
            re_sim_pos = Vec2(
                re_sim_pos.x + dx * step,
                re_sim_pos.y + dy * step,
            )
        # 4. 计算偏差
        delta = re_sim_pos - self._current_pos
        delta_px = delta.length()
        # 5. 总是把 current_pos 切到 re_simulated(确保下次 predict 基础正确)
        self._current_pos = re_sim_pos
        self.pending = remaining
        # 6. 决策
        if delta_px > RECONCILE_THRESHOLD_PX:
            return Correction(
                start_pos=self._current_pos_before_reconcile,
                target_pos=re_sim_pos,
                delta_px=delta_px,
            )
        return NoCorrection()

    # ----- 内部 -----

    @staticmethod
    def _normalize(dx: float, dy: float) -> tuple:
        """8 方向归一化(2D 向量长度钳制到 1)。

        - (0, 0) 保留 (0, 0): 静止
        - 其他: 长度 > 0 时除以自身长度
        """
        length = math.hypot(dx, dy)
        if length == 0.0:
            return (0.0, 0.0)
        if length > 1.0:
            return (dx / length, dy / length)
        return (dx, dy)
