// Package room_test: M3.1 服务端权威状态(AuthState)单元测试
//
// 覆盖 M3.1 任务书验收 ④ 的服务端基础:
//   - 输入立即应用(权威位置 = 已应用输入的位置)
//   - 输入速率上限校验(> 60Hz 拒收)
//   - 移动向量单位化(对角线不过冲)
//   - 速度上限(单轴 |v|>1 拒收;长度 > 1 单位化)
//   - 世界边界裁剪(|x|,|y| > 1024m 拒收)
//
// 注:广播层的 S2C_WorldDelta 由 Task 5 覆盖;本测试只验证状态机本身。
package room_test

import (
	"math"
	"testing"
	"time"

	"github.com/wildwood/net/room"
	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

const (
	m31TestStartX  = 100.0
	m31TestStartY  = 200.0
	m31TestSpeed   = 4.0 // m/s(M2.1 PlayerController 默认)
	m31TestTilePx  = 32  // 1 米 = 32 像素
	m31TestInputDt = 1.0 / 60.0
)

var m31TestStepPx = m31TestSpeed * m31TestInputDt * m31TestTilePx // 单帧单轴位移(像素)
var m31TestDiagPx = m31TestStepPx / math.Sqrt2                     // 对角线单位化后单轴位移

func newAuthStateForTest() *room.AuthState {
	return room.NewAuthState(m31TestStartX, m31TestStartY, m31TestSpeed)
}

// moveInput 构造一个 C2S_PlayerInput(MOVE 动作)
func moveInput(seq uint32, dx, dy float32) *wildwoodv1.C2S_PlayerInput {
	return &wildwoodv1.C2S_PlayerInput{
		InputSeq:     seq,
		Action:       wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:       dx,
		MoveDy:       dy,
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	}
}

// ============================================================
// 1. 初始化
// ============================================================

func TestAuthState_InitialPosition(t *testing.T) {
	s := newAuthStateForTest()
	x, y := s.Pos()
	if x != m31TestStartX || y != m31TestStartY {
		t.Fatalf("initial pos: got (%.3f,%.3f) want (%.3f,%.3f)", x, y, m31TestStartX, m31TestStartY)
	}
	if s.LastInputSeq() != 0 {
		t.Fatalf("initial last_seq: got %d want 0", s.LastInputSeq())
	}
}

func TestAuthState_InitialFacing(t *testing.T) {
	s := newAuthStateForTest()
	if f := s.Facing(); f != 0 {
		t.Fatalf("initial facing: got %.3f want 0", f)
	}
}

// ============================================================
// 2. 输入立即应用(M3.1 验收 ① 服务端版本)
// ============================================================

func TestAuthState_ApplyInput_AdvancesPosition(t *testing.T) {
	s := newAuthStateForTest()
	ok, reason := s.ApplyInput(moveInput(1, 1.0, 0.0))
	if !ok {
		t.Fatalf("apply input: rejected reason=%s", reason)
	}
	x, y := s.Pos()
	wantX := m31TestStartX + m31TestStepPx
	if !floatNear(x, wantX, 0.001) {
		t.Fatalf("pos.x: got %.6f want %.6f", x, wantX)
	}
	if !floatNear(y, m31TestStartY, 0.001) {
		t.Fatalf("pos.y: got %.6f want %.6f", y, m31TestStartY)
	}
}

func TestAuthState_ApplyInput_DiagonalNormalizes(t *testing.T) {
	s := newAuthStateForTest()
	// (1,1) 长度 √2 → 单位化 (1/√2,1/√2) → 单轴位移 = stepPx/√2
	ok, reason := s.ApplyInput(moveInput(1, 1.0, 1.0))
	if !ok {
		t.Fatalf("diagonal rejected: %s", reason)
	}
	x, y := s.Pos()
	wantX := m31TestStartX + m31TestDiagPx
	wantY := m31TestStartY + m31TestDiagPx
	if !floatNear(x, wantX, 0.01) {
		t.Fatalf("x: got %.4f want %.4f", x, wantX)
	}
	if !floatNear(y, wantY, 0.01) {
		t.Fatalf("y: got %.4f want %.4f", y, wantY)
	}
}

func TestAuthState_ApplyInput_IdleNoMovement(t *testing.T) {
	s := newAuthStateForTest()
	ok, _ := s.ApplyInput(moveInput(1, 0.0, 0.0))
	if !ok {
		t.Fatalf("idle rejected")
	}
	x, y := s.Pos()
	if x != m31TestStartX || y != m31TestStartY {
		t.Fatalf("idle moved: got (%.3f,%.3f)", x, y)
	}
}

func TestAuthState_ApplyInput_AdvancesLastSeq(t *testing.T) {
	s := newAuthStateForTest()
	_, _ = s.ApplyInput(moveInput(7, 1.0, 0.0))
	if s.LastInputSeq() != 7 {
		t.Fatalf("last_seq: got %d want 7", s.LastInputSeq())
	}
}

func TestAuthState_ApplyInput_MultipleSteps(t *testing.T) {
	s := newAuthStateForTest()
	// 60 步右移 → 1 秒移动 → 4m/s × 1s = 4m = 128 像素
	for i := uint32(1); i <= 60; i++ {
		ok, reason := s.ApplyInput(moveInput(i, 1.0, 0.0))
		if !ok {
			t.Fatalf("step %d rejected: %s", i, reason)
		}
	}
	x, y := s.Pos()
	wantX := m31TestStartX + 4.0*float64(m31TestTilePx) // 4m = 128px
	if !floatNear(x, wantX, 0.1) {
		t.Fatalf("after 60 steps: x=%.3f want %.3f", x, wantX)
	}
	if y != m31TestStartY {
		t.Fatalf("y drift: got %.3f", y)
	}
}

// ============================================================
// 3. 速度上限 / 越界
// ============================================================

func TestAuthState_RejectOverspeedComponent(t *testing.T) {
	s := newAuthStateForTest()
	ok, reason := s.ApplyInput(moveInput(1, 2.0, 0.0))
	if ok {
		t.Fatalf("overspeed dx=2.0 accepted")
	}
	if reason == "" {
		t.Fatalf("expected rejection reason")
	}
	x, y := s.Pos()
	if x != m31TestStartX || y != m31TestStartY {
		t.Fatalf("pos changed: (%.3f,%.3f)", x, y)
	}
}

func TestAuthState_RejectOverspeedComponent_Y(t *testing.T) {
	s := newAuthStateForTest()
	ok, _ := s.ApplyInput(moveInput(1, 0.0, -1.5))
	if ok {
		t.Fatalf("overspeed dy=-1.5 accepted")
	}
}

func TestAuthState_DiagonalUnderOne_Normalizes(t *testing.T) {
	// (0.9, 0.9) 长度 1.27 → 单位化到 1(不是拒绝)
	s := newAuthStateForTest()
	ok, reason := s.ApplyInput(moveInput(1, 0.9, 0.9))
	if !ok {
		t.Fatalf("(0.9,0.9) rejected: %s", reason)
	}
	// 单位化后单轴位移 = stepPx/√2
	x, _ := s.Pos()
	wantX := m31TestStartX + m31TestDiagPx
	if !floatNear(x, wantX, 0.01) {
		t.Fatalf("x: got %.4f want %.4f (should equal normalized step)", x, wantX)
	}
}

func TestAuthState_RejectOutOfBounds(t *testing.T) {
	// 起点靠近边界: 1023.9m = 32764.8px,1 步高速 = 53.3px → 越界 32818 > 32768
	startX := 1023.9 * float64(m31TestTilePx) // ≈ 32764.8 px
	s := room.NewAuthState(startX, 0, 100.0)  // 100 m/s
	ok, reason := s.ApplyInput(moveInput(1, 1.0, 0.0))
	if ok {
		t.Fatalf("expected out-of-bounds reject, reason=%s", reason)
	}
	if reason == "" {
		t.Fatalf("expected rejection reason")
	}
}

func TestAuthState_AtBoundary_NoMove(t *testing.T) {
	// 起点恰好等于边界,移动应被拒
	maxPx := 1024.0 * float64(m31TestTilePx)
	s := room.NewAuthState(maxPx, 0, m31TestSpeed)
	ok, _ := s.ApplyInput(moveInput(1, 1.0, 0.0))
	if ok {
		t.Fatalf("at-boundary move accepted")
	}
}

// ============================================================
// 4. 速率限制
// ============================================================

func TestAuthState_RateLimit_70Accepted(t *testing.T) {
	// 70 条/1s 全部接受(60Hz × 1s + 10 burst)
	s := newAuthStateForTest()
	for i := uint32(1); i <= 70; i++ {
		ok, reason := s.ApplyInput(moveInput(i, 0.0, 0.0))
		if !ok {
			t.Fatalf("input %d rejected: %s", i, reason)
		}
	}
}

func TestAuthState_RateLimit_71Rejected(t *testing.T) {
	// 71 条/1s → 第 71 条拒收
	s := newAuthStateForTest()
	for i := uint32(1); i <= 70; i++ {
		_, _ = s.ApplyInput(moveInput(i, 0.0, 0.0))
	}
	ok, reason := s.ApplyInput(moveInput(71, 0.0, 0.0))
	if ok {
		t.Fatalf("71st input accepted (should be rate-limited)")
	}
	if reason == "" {
		t.Fatalf("expected rate-limit reason")
	}
}

func TestAuthState_SameSeqReplayed(t *testing.T) {
	// 同一 seq 重发 → 幂等接受(不重放副作用)
	s := newAuthStateForTest()
	ok, _ := s.ApplyInput(moveInput(5, 1.0, 0.0))
	if !ok {
		t.Fatalf("first apply failed")
	}
	x1, _ := s.Pos()
	ok, _ = s.ApplyInput(moveInput(5, 1.0, 0.0)) // 同 seq
	if !ok {
		t.Fatalf("replayed same seq should be accepted (idempotent)")
	}
	x2, _ := s.Pos()
	if x1 != x2 {
		t.Fatalf("replay advanced pos twice: %.6f -> %.6f", x1, x2)
	}
}

// ============================================================
// 5. 朝向 / 非移动动作
// ============================================================

func TestAuthState_FacingUpdatesOnMove(t *testing.T) {
	s := newAuthStateForTest()
	_, _ = s.ApplyInput(&wildwoodv1.C2S_PlayerInput{
		InputSeq:     1,
		Action:       wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:       1.0,
		MoveDy:       0.0,
		Facing:       1.5,
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	})
	if f := s.Facing(); !floatNear(f, 1.5, 0.001) {
		t.Fatalf("facing: got %.3f want 1.5", f)
	}
}

func TestAuthState_NonMoveAction_NoPosChange(t *testing.T) {
	// ATTACK 动作不应改位置
	s := newAuthStateForTest()
	_, _ = s.ApplyInput(&wildwoodv1.C2S_PlayerInput{
		InputSeq:       1,
		Action:         wildwoodv1.InputAction_INPUT_ACTION_ATTACK,
		TargetEntityId: 42,
		ClientTimeMs:   uint64(time.Now().UnixMilli()),
	})
	x, y := s.Pos()
	if x != m31TestStartX || y != m31TestStartY {
		t.Fatalf("ATTACK moved pos: (%.3f,%.3f)", x, y)
	}
	if s.LastInputSeq() != 1 {
		t.Fatalf("ATTACK should still bump last_seq: got %d", s.LastInputSeq())
	}
}

// ============================================================
// 工具
// ============================================================

func floatNear(a, b, eps float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d <= eps
}

// ============================================================
// 6. NaN/Inf 防护(Task 6:服务端校验增强)
// ============================================================

func TestAuthState_RejectNaNMoveVector(t *testing.T) {
	s := newAuthStateForTest()
	// MoveDx = NaN
	in := &wildwoodv1.C2S_PlayerInput{
		InputSeq:     1,
		Action:       wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:       float32(math.NaN()),
		MoveDy:       0.0,
		Facing:       0.0,
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	}
	ok, reason := s.ApplyInput(in)
	if ok {
		t.Fatalf("NaN move vector accepted")
	}
	if reason != "non-finite move vector" {
		t.Logf("reason=%s (expected non-finite move vector)", reason)
	}
	x, y := s.Pos()
	if x != m31TestStartX || y != m31TestStartY {
		t.Fatalf("pos changed after NaN: (%.3f,%.3f)", x, y)
	}
}

func TestAuthState_RejectInfMoveVector(t *testing.T) {
	s := newAuthStateForTest()
	in := &wildwoodv1.C2S_PlayerInput{
		InputSeq:     1,
		Action:       wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:       float32(math.Inf(1)),
		MoveDy:       0.0,
		Facing:       0.0,
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	}
	ok, reason := s.ApplyInput(in)
	if ok {
		t.Fatalf("+Inf move vector accepted")
	}
	if reason == "" {
		t.Fatalf("expected rejection reason")
	}
	x, y := s.Pos()
	if x != m31TestStartX || y != m31TestStartY {
		t.Fatalf("pos changed after Inf: (%.3f,%.3f)", x, y)
	}
}

func TestAuthState_RejectNaNFacing(t *testing.T) {
	s := newAuthStateForTest()
	in := &wildwoodv1.C2S_PlayerInput{
		InputSeq:     1,
		Action:       wildwoodv1.InputAction_INPUT_ACTION_ATTACK,
		TargetEntityId: 42,
		Facing:       float32(math.NaN()),
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	}
	ok, reason := s.ApplyInput(in)
	if ok {
		t.Fatalf("NaN facing accepted")
	}
	if reason != "non-finite facing" {
		t.Logf("reason=%s (expected non-finite facing)", reason)
	}
}

func TestAuthState_RejectInfFacing(t *testing.T) {
	s := newAuthStateForTest()
	in := &wildwoodv1.C2S_PlayerInput{
		InputSeq:     1,
		Action:       wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:       0.5,
		MoveDy:       0.0,
		Facing:       float32(math.Inf(-1)),
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	}
	ok, reason := s.ApplyInput(in)
	if ok {
		t.Fatalf("-Inf facing accepted")
	}
	if reason == "" {
		t.Fatalf("expected rejection reason")
	}
}

func TestAuthState_RejectNaNMoveVector_Dy(t *testing.T) {
	// MoveDy = NaN → 也应被拒
	s := newAuthStateForTest()
	in := &wildwoodv1.C2S_PlayerInput{
		InputSeq:     1,
		Action:       wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:       0.0,
		MoveDy:       float32(math.NaN()),
		Facing:       0.0,
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	}
	if ok, _ := s.ApplyInput(in); ok {
		t.Fatalf("NaN MoveDy accepted")
	}
}

func TestAuthState_RejectNegativeInfMoveVector(t *testing.T) {
	// -Inf 也应被拒(单轴检查会捕获,但显式测试)
	s := newAuthStateForTest()
	in := &wildwoodv1.C2S_PlayerInput{
		InputSeq:     1,
		Action:       wildwoodv1.InputAction_INPUT_ACTION_MOVE,
		MoveDx:       float32(math.Inf(-1)),
		MoveDy:       0.0,
		Facing:       0.0,
		ClientTimeMs: uint64(time.Now().UnixMilli()),
	}
	if ok, _ := s.ApplyInput(in); ok {
		t.Fatalf("-Inf move vector accepted")
	}
}
