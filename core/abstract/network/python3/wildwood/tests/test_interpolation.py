"""M3.1 Interpolator 单元测试 — 100ms 线性插值 + 100ms 隐藏。

验收对照(方案 §3.1.1):
  ② 校正 100ms 平滑无跳帧
  ③ 校正期间被校正实体隐藏 100ms

边界:
  - t < 0   → 显示 start_pos,隐藏
  - 0 ≤ t ≤ 100ms → 线性插值,隐藏
  - t > 100ms → 显示 target_pos,可见
"""
import pytest
from wildwood.constants import INTERP_DURATION_MS, HIDE_DURATION_MS
from wildwood.interpolation import Interpolator


# ----- 基础生命周期 -----

def test_interpolator_initial_state():
    it = Interpolator(start=(0, 0), target=(100, 0), duration_ms=100)
    # 初始(start_ms=0)→ 显示起点 + 隐藏
    assert it.display_pos_at(0) == (0.0, 0.0)
    assert it.is_hidden_at(0) is True
    assert it.is_complete(0) is False


def test_interpolator_tween_50pct():
    """t=50ms: 50% 处,显示 (50, 0)。"""
    it = Interpolator(start=(0, 0), target=(100, 0), duration_ms=100)
    pos = it.display_pos_at(50)
    assert abs(pos[0] - 50.0) < 0.001
    assert pos[1] == 0.0


def test_interpolator_complete_at_100ms():
    """t=100ms: 显示 target,可见,完成。"""
    it = Interpolator(start=(0, 0), target=(100, 0), duration_ms=100)
    assert it.display_pos_at(100) == (100.0, 0.0)
    assert it.is_hidden_at(100) is False
    assert it.is_complete(100) is True


def test_interpolator_clamps_after_complete():
    """t > 100ms: 钳位到 target,仍可见,仍完成。"""
    it = Interpolator(start=(0, 0), target=(100, 0), duration_ms=100)
    assert it.display_pos_at(200) == (100.0, 0.0)
    assert it.is_hidden_at(200) is False
    assert it.is_complete(200) is True


# ----- 隐藏窗口 100ms -----

def test_hide_100ms_window():
    """方案 §3.1.1: 校正期间被校正实体隐藏 100ms。

    0 ≤ t ≤ 100ms: 隐藏
    t > 100ms: 可见
    """
    it = Interpolator(start=(0, 0), target=(50, 0), duration_ms=100)
    assert it.is_hidden_at(0) is True
    assert it.is_hidden_at(50) is True
    assert it.is_hidden_at(99) is True
    assert it.is_hidden_at(100) is False
    assert it.is_hidden_at(101) is False
    assert it.is_hidden_at(500) is False


# ----- 起点非零 + 2D 插值 -----

def test_interpolator_2d_offset():
    """起点 (10, 20) → 终点 (110, 220),t=50ms 显示 (60, 120)。"""
    it = Interpolator(start=(10, 20), target=(110, 220), duration_ms=100)
    pos = it.display_pos_at(50)
    assert abs(pos[0] - 60.0) < 0.001
    assert abs(pos[1] - 120.0) < 0.001


def test_interpolator_negative_direction():
    """负方向: start=(100, 0) → target=(0, 0),t=50ms 显示 (50, 0)。"""
    it = Interpolator(start=(100, 0), target=(0, 0), duration_ms=100)
    pos = it.display_pos_at(50)
    assert abs(pos[0] - 50.0) < 0.001
    assert pos[1] == 0.0


# ----- 边界:开始时间非 0 -----

def test_interpolator_with_start_offset():
    """start_ms=1000(从绝对时间 1000ms 开始),t=1050 显示 50% 处。"""
    it = Interpolator(
        start=(0, 0), target=(100, 0), duration_ms=100, start_ms=1000
    )
    # t=1000(刚启动)
    assert it.display_pos_at(1000) == (0.0, 0.0)
    assert it.is_hidden_at(1000) is True
    # t=1050(50% 进度)
    pos = it.display_pos_at(1050)
    assert abs(pos[0] - 50.0) < 0.001
    # t=1100(完成)
    assert it.display_pos_at(1100) == (100.0, 0.0)
    assert it.is_hidden_at(1100) is False


# ----- 边界:t < start_ms -----

def test_interpolator_before_start():
    """t < start_ms: 钳位到起点,显示 start_pos,隐藏。"""
    it = Interpolator(
        start=(10, 0), target=(100, 0), duration_ms=100, start_ms=200
    )
    assert it.display_pos_at(100) == (10.0, 0.0)  # 钳位到 start
    assert it.is_hidden_at(100) is True
    assert it.is_complete(100) is False


# ----- 自定义 HIDE_DURATION 与 INTERP_DURATION 解耦 -----

def test_hide_shorter_than_interp():
    """如果 hide_duration < interp_duration,达到 hide_duration 后立即可见。"""
    it = Interpolator(
        start=(0, 0), target=(100, 0),
        duration_ms=200, hide_duration_ms=50,
    )
    assert it.is_hidden_at(0) is True
    assert it.is_hidden_at(49) is True
    assert it.is_hidden_at(50) is False  # 50ms 后可见
    # 但插值还在继续
    pos = it.display_pos_at(100)
    assert abs(pos[0] - 50.0) < 0.001


def test_hide_longer_than_interp_clamped():
    """如果 hide_duration > interp_duration,完成时立刻可见(不能比完成还晚)。"""
    it = Interpolator(
        start=(0, 0), target=(100, 0),
        duration_ms=50, hide_duration_ms=200,
    )
    # 50ms 完成时立刻可见(不能等到 200ms)
    assert it.is_hidden_at(50) is False
    assert it.is_complete(50) is True


# ----- 性能基准 -----

def test_interpolator_no_jump_smooth_path():
    """1000 帧连续插值,任何相邻两帧的位移差 ≤ 单帧 max delta。

    保证"100ms 平滑无跳帧":最大单帧位移 = 总位移 / 帧数。
    """
    it = Interpolator(start=(0, 0), target=(100, 0), duration_ms=100)
    prev_x = 0.0
    max_jump = 0.0
    for t in range(0, 101):
        x, _ = it.display_pos_at(t)
        jump = abs(x - prev_x)
        if jump > max_jump:
            max_jump = jump
        prev_x = x
    # 100 px / 100 ms = 1 px/ms = 1 ms 内的最大单帧位移(浮点)
    # 浮点计算可能 ±0.001 抖动
    assert max_jump <= 1.0 + 0.01
