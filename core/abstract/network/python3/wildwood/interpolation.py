"""M3.1 Interpolator — 100ms 线性插值 + 100ms 隐藏窗口。

设计要点(方案 §3.1.1):
  - display_pos_at(t_ms): 线性插值 start → target,完成前 100ms 内插值
  - is_hidden_at(t_ms): 0 ≤ t ≤ hide_duration 时返回 True(被校正实体隐藏)
  - is_complete(t_ms): t ≥ duration 时返回 True(校正结束)

GDScript 镜像:core/abstract/network/gd/wildwood_interpolator.gd
"""
from __future__ import annotations

from dataclasses import dataclass

from wildwood.constants import (
    INTERP_DURATION_MS,
    HIDE_DURATION_MS,
)


@dataclass(frozen=True)
class Interpolator:
    """100ms 校正插值器(纯函数,无副作用)。

    start_ms: 校正起点(绝对时间,毫秒);默认 0。
    """
    start: tuple          # (x, y) 起点(像素)
    target: tuple         # (x, y) 终点(像素)
    duration_ms: int = INTERP_DURATION_MS
    hide_duration_ms: int = HIDE_DURATION_MS
    start_ms: int = 0

    def display_pos_at(self, t_ms: int) -> tuple:
        """返回 t_ms 时刻应显示的位置(像素)。

        - t_ms < start_ms: 钳位到 start
        - start_ms ≤ t_ms ≤ start_ms + duration: 线性插值
        - t_ms > start_ms + duration: 钳位到 target
        """
        end = self.start_ms + self.duration_ms
        if t_ms <= self.start_ms:
            return (float(self.start[0]), float(self.start[1]))
        if t_ms >= end:
            return (float(self.target[0]), float(self.target[1]))
        # 进度 0..1
        progress = (t_ms - self.start_ms) / self.duration_ms
        x = self.start[0] + (self.target[0] - self.start[0]) * progress
        y = self.start[1] + (self.target[1] - self.start[1]) * progress
        return (x, y)

    def is_hidden_at(self, t_ms: int) -> bool:
        """t_ms 时刻是否应隐藏被校正实体。

        - hide_duration ≤ duration 时: 0..hide_duration 隐藏
        - hide_duration > duration 时: 0..duration 隐藏(不能比完成还晚)
        - t_ms < start_ms: 仍隐藏(校正即将开始,前端正在准备)
        - t_ms >= start_ms + min(duration, hide_duration): 可见
        """
        hide_end = self.start_ms + min(self.hide_duration_ms, self.duration_ms)
        return t_ms < hide_end

    def is_complete(self, t_ms: int) -> bool:
        """t_ms 时刻校正是否完成。"""
        return t_ms >= self.start_ms + self.duration_ms

    def progress_at(self, t_ms: int) -> float:
        """返回插值进度 0..1(钳位)。"""
        return max(0.0, min(1.0, (t_ms - self.start_ms) / self.duration_ms))
