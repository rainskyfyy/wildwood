"""M3.1 constants — 验收阈值硬约束测试。"""
from wildwood.constants import (
    RECONCILE_THRESHOLD_PX,
    INTERP_DURATION_MS,
    HIDE_DURATION_MS,
    DEFAULT_SPEED_MPS,
    TILE_SIZE_PX,
    INPUT_DT_S,
    SERVER_TICK_HZ,
    SERVER_TICK_MS,
    MAX_INPUT_RATE_HZ,
    WORLD_HALF_BOUND_M,
    MOVE_BURST_MULTIPLIER,
)


def test_reconcile_threshold_is_32px():
    """方案 §3.1.1: 偏差 > 32px 触发校正。1 grid = 32px。"""
    assert RECONCILE_THRESHOLD_PX == 32.0


def test_interp_duration_is_100ms():
    """方案 §3.1.1: 校正 100ms 平滑无跳帧。"""
    assert INTERP_DURATION_MS == 100


def test_hide_duration_is_100ms():
    """方案 §3.1.1: 校正期间被校正实体隐藏 100ms。"""
    assert HIDE_DURATION_MS == 100


def test_default_speed_matches_m21():
    """与 M2.1 PlayerController.DEFAULT_SPEED_MPS 一致(4 米/秒)。"""
    assert DEFAULT_SPEED_MPS == 4.0


def test_tile_size_32px():
    """1 米 = 32 像素(M2.6 持久化沿用)。"""
    assert TILE_SIZE_PX == 32


def test_input_dt_is_60hz():
    """60Hz 物理步长(16.67ms),M2.1 PlayerController 沿用。"""
    assert abs(INPUT_DT_S - (1.0 / 60.0)) < 1e-9


def test_server_tick_20hz():
    """方案 §3.4: 网络帧 20Hz = 50ms/tick。"""
    assert SERVER_TICK_HZ == 20
    assert SERVER_TICK_MS == 50


def test_max_input_rate_60hz():
    """客户端发包率 ≤ 60Hz,服务端校验。"""
    assert MAX_INPUT_RATE_HZ == 60


def test_world_half_bound_positive():
    """世界半边界必须为正,服务端坐标边界校验用。"""
    assert WORLD_HALF_BOUND_M > 0
