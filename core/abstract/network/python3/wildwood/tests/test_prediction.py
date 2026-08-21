"""M3.1 Predictor 单元测试 — 客户端预测 + 服务端校正核心逻辑。

测试覆盖:
  1. 本地立即执行 (≤ 1 帧立即响应)
  2. 序列号自增 + 唯一
  3. 服务端 ack 后丢弃对应输入
  4. 偏差 < 32px 不触发校正
  5. 偏差 ≥ 32px 触发校正(返回 ReconciliationResult)
  6. re-simulate 严格按 unacked 顺序
  7. 输入方向归一化(8 方向 1.0,不超速)
  8. 静止输入(dx=dy=0)不产生位移
  9. 校正目标 = re-simulated pos,不是 auth_pos(继续预测)
 10. Predictor 状态隔离:两个预测器独立
"""
import pytest
from wildwood.constants import (
    DEFAULT_SPEED_MPS,
    TILE_SIZE_PX,
    INPUT_DT_S,
    RECONCILE_THRESHOLD_PX,
)
from wildwood.prediction import (
    Predictor,
    Input,
    Vec2,
    ReconciliationResult,
    NoCorrection,
    Correction,
    MoveAction,
)


# 一些公用常量
SPEED = DEFAULT_SPEED_MPS
TILE = TILE_SIZE_PX
DT = INPUT_DT_S
STEP = SPEED * TILE * DT  # 单帧位移(像素)


# ----- 1. 本地立即执行 -----

def test_predict_immediate_execution():
    """预测器在 predict() 调用瞬间就推进位置(≤ 1 帧 = 16.67ms)。"""
    p = Predictor()
    p.predict(MoveAction(dx=1.0, dy=0.0))
    assert abs(p.current_pos.x - STEP) < 1e-6
    assert p.current_pos.y == 0.0


def test_predict_initial_position_is_origin():
    """初始位置 (0, 0)。"""
    p = Predictor()
    assert p.current_pos == Vec2(0.0, 0.0)


# ----- 2. 序列号 -----

def test_input_seq_starts_at_1():
    """M1.5 .proto: input_seq 0 是 unspecified,客户端必须从 1 开始。"""
    p = Predictor()
    inp = p.predict(MoveAction(dx=0.0, dy=0.0))
    assert inp.seq == 1


def test_input_seq_monotonic():
    p = Predictor()
    seqs = [p.predict(MoveAction(dx=1.0, dy=0.0)).seq for _ in range(5)]
    assert seqs == [1, 2, 3, 4, 5]


def test_input_seq_unique():
    p = Predictor()
    seen = set()
    for _ in range(100):
        inp = p.predict(MoveAction(dx=1.0, dy=0.0))
        assert inp.seq not in seen
        seen.add(inp.seq)


# ----- 3. 服务端 ack 后丢弃 -----

def test_reconcile_drops_acked_inputs():
    """ack seq 之后的输入从 pending 列表删除,不再 re-simulate。"""
    p = Predictor()
    for _ in range(5):
        p.predict(MoveAction(dx=1.0, dy=0.0))
    assert len(p.pending) == 5
    # 服务端 ack 第 1, 2 帧
    p.reconcile(auth_pos=Vec2(0.0, 0.0), acked_seqs={1, 2})
    assert {pi.seq for pi in p.pending} == {3, 4, 5}
    # pending 只剩 3 帧,current 跳到 re-simulated 位置 = 0 + 3*STEP
    assert abs(p.current_pos.x - 3 * STEP) < 1e-6


# ----- 4. 偏差 < 32px 不触发校正 -----

def test_reconcile_no_correction_when_within_threshold():
    """re-simulated 与本地预测相差 ≤ 32px 时返回 NoCorrection(无跳帧)。"""
    p = Predictor()
    p.predict(MoveAction(dx=1.0, dy=0.0))
    local_pos_before = p.current_pos
    result = p.reconcile(auth_pos=local_pos_before, acked_seqs={1})
    assert isinstance(result, NoCorrection)
    assert p.current_pos == local_pos_before


def test_reconcile_no_correction_when_below_32px():
    """偏差 31.9 px(略低于 32)不触发校正。"""
    p = Predictor()
    p.predict(MoveAction(dx=1.0, dy=0.0))
    # 服务端"稍微落后"31 px
    auth_pos = p.current_pos - Vec2(31.0, 0.0)
    result = p.reconcile(auth_pos=auth_pos, acked_seqs={1})
    assert isinstance(result, NoCorrection)


# ----- 5. 偏差 ≥ 32px 触发校正 -----

def test_reconcile_triggers_correction_above_32px():
    """偏差 32.001 px 触发 100ms 插值校正。"""
    p = Predictor()
    p.predict(MoveAction(dx=1.0, dy=0.0))
    # 本地预测 = STEP ≈ 2.13 px;服务端落后 50 px → 偏差 50 px
    auth_pos = p.current_pos - Vec2(50.0, 0.0)
    # pending 1 个未 ack
    result = p.reconcile(auth_pos=auth_pos, acked_seqs=set())
    assert isinstance(result, Correction)
    assert result.delta_px > RECONCILE_THRESHOLD_PX
    # 校正起点 = reconcile 前的本地位置
    assert result.start_pos == Vec2(STEP, 0.0)
    # 校正目标 = re-simulated 位置(从 auth_pos 应用 1 个 unacked → 输入)
    expected_target_x = auth_pos.x + STEP
    assert abs(result.target_pos.x - expected_target_x) < 1e-6


# ----- 6. re-simulate 严格按 seq 升序(确定性) -----

def test_re_simulate_in_seq_order():
    """re-simulate 必须按 seq 升序应用:两个 pending 顺序不同的预测器,
    ack 相同 seq 后 re-simulated 位置应一致。"""
    p1 = Predictor()
    p2 = Predictor()
    # 两个预测器收到相同 4 个输入,但本地 pending 顺序不同(模拟丢包/乱序)
    # p1 顺序追加
    for i in range(4):
        p1.predict(MoveAction(dx=1.0, dy=0.0))
    # p2 倒序追加
    for i in range(4):
        p2.predict(MoveAction(dx=1.0, dy=0.0))
    p2.pending.reverse()  # [seq=4, seq=3, seq=2, seq=1]
    # 服务端 ack {1, 2} → 两个 predictor 都剩 [seq=3, seq=4]
    p1.reconcile(auth_pos=Vec2(0.0, 0.0), acked_seqs={1, 2})
    p2.reconcile(auth_pos=Vec2(0.0, 0.0), acked_seqs={1, 2})
    # 校正后位置应一致
    assert abs(p1.current_pos.x - p2.current_pos.x) < 1e-6
    assert abs(p1.current_pos.y - p2.current_pos.y) < 1e-6
    # 预期:auth=(0,0) + 2 帧 (seq 3, 4 都是 →) = (2*STEP, 0)
    assert abs(p1.current_pos.x - 2 * STEP) < 1e-6
    assert p1.current_pos.y == 0.0


# ----- 7. 方向归一化(不超速) -----

def test_predict_normalizes_diagonal_length_1():
    """(1,1) 归一化后长度 = 1,单帧单轴位移 = STEP / √2。"""
    p = Predictor()
    p.predict(MoveAction(dx=1.0, dy=1.0))
    expected = STEP / (2 ** 0.5)
    assert abs(p.current_pos.x - expected) < 1e-6
    assert abs(p.current_pos.y - expected) < 1e-6


def test_predict_clamps_input_overspeed():
    """输入 dx > 1 不应导致超速(归一化钳制到长度 1)。"""
    p = Predictor()
    p.predict(MoveAction(dx=5.0, dy=0.0))
    # 归一化后 (1, 0) → 单帧 STEP 像素
    assert abs(p.current_pos.x - STEP) < 1e-6


# ----- 8. 静止输入 -----

def test_predict_idle_no_movement():
    p = Predictor()
    p.predict(MoveAction(dx=0.0, dy=0.0))
    p.predict(MoveAction(dx=0.0, dy=0.0))
    assert p.current_pos == Vec2(0.0, 0.0)
    assert len(p.pending) == 2


# ----- 9. 校正目标 = re-simulated pos(继续预测)-----

def test_correction_target_is_re_simulated_not_auth():
    """校正目标是从 auth_pos 应用剩余 unacked 输入得到的位置(继续预测)。

    这样校正后玩家仍能继续输入,不会出现"校正瞬间被冻结"。
    """
    p = Predictor()
    # 3 帧 → (3*STEP, 0)
    p.predict(MoveAction(dx=1.0, dy=0.0))  # seq=1
    p.predict(MoveAction(dx=1.0, dy=0.0))  # seq=2
    p.predict(MoveAction(dx=1.0, dy=0.0))  # seq=3
    # 服务端"明显落后"50 px,ack 1,2
    auth_pos = Vec2(3 * STEP, 0.0) - Vec2(50.0, 0.0)
    result = p.reconcile(auth_pos=auth_pos, acked_seqs={1, 2})
    # pending 还有 seq=3,re-simulate 后目标 = auth_pos + 1 帧
    assert isinstance(result, Correction)
    expected_target_x = auth_pos.x + STEP
    assert abs(result.target_pos.x - expected_target_x) < 1e-6
    assert result.target_pos.y == 0.0
    # 偏差 = local (3*STEP) - re-simulated (auth.x + STEP) = 2*STEP - 50
    # 触发校正(因为 2*STEP - 50 ≈ 2.13 - 50 = -47.87;绝对值 > 32)
    assert result.delta_px > RECONCILE_THRESHOLD_PX


# ----- 10. 状态隔离 -----

def test_two_predictors_independent():
    p1 = Predictor()
    p2 = Predictor()
    p1.predict(MoveAction(dx=1.0, dy=0.0))
    p2.predict(MoveAction(dx=0.0, dy=1.0))
    assert p1.current_pos.x > 0
    assert p1.current_pos.y == 0
    assert p2.current_pos.x == 0
    assert p2.current_pos.y > 0


# ----- 边界:reconcile 期间追加新输入 -----

def test_reconcile_then_predict_continues_smoothly():
    """校正完后再 predict,新输入 seq 继续自增,基于校正后的位置。"""
    p = Predictor()
    p.predict(MoveAction(dx=1.0, dy=0.0))
    p.predict(MoveAction(dx=1.0, dy=0.0))
    p.predict(MoveAction(dx=1.0, dy=0.0))
    # 强制 50 px 偏差
    auth_pos = p.current_pos - Vec2(50.0, 0.0)
    p.reconcile(auth_pos=auth_pos, acked_seqs={1, 2})
    pos_after_correction = p.current_pos
    # 继续 predict
    p.predict(MoveAction(dx=1.0, dy=0.0))
    # 应基于校正后位置再走 1 帧
    expected = pos_after_correction.x + STEP
    assert abs(p.current_pos.x - expected) < 1e-6
    # pending 校正后剩 1 项(seq=3),再追加 1 项 = 2 项
    assert len(p.pending) == 2
