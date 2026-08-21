// Package room: M3.1 服务端权威状态(AuthState) — 房间内每个玩家的服务端权威位置/朝向/HP。
//
// 设计要点(方案 §3.1.1):
//   - 每条 C2S_PlayerInput 立即应用到状态机(权威位置 = 已应用输入的位置)
//   - 验证:速度上限(单轴 |v|≤1,长度 |v|超 1 则单位化)、世界边界(±1024m)、输入速率(≤60Hz)
//   - 广播:Hub 在 20Hz tick 读 AuthState,封装到 S2C_WorldDelta.entity_updates
//   - 状态机本身不存 pending buffer(不需要 re-simulate;那是客户端的事)
//
// 与 Python 通用层语义对齐(SEMANTICS.md 同步):
//   - 服务端 dt = INPUT_DT_S = 1/60 s
//   - speed 单位 m/s,position 单位 px(1m = 32px)
//   - 输入向量单轴 ∈ [-1,1],长度 > 1 自动单位化(对角线不过冲)
//   - 同一 seq 重发是幂等的(不重放)
package room

import (
	"fmt"
	"math"
	"sync"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

// AuthState 配置常量(与 Python 通用层 wildwood.constants 1:1 对齐)
const (
	AuthStateDefaultSpeedMps = 4.0  // 默认移动速度
	AuthStateTilePx          = 32   // 1 米 = 32 像素
	AuthStateInputDtSec      = 1.0 / 60.0
	AuthStateMaxInputHz      = 60
	AuthStateWorldHalfBound  = 1024.0 // 米(±1024m)
	AuthStateRateLimitWindow = 1 * time.Second
	AuthStateMaxInputsPerWin = 70 // 60Hz × 1s + 10 burst buffer
)

// AuthState 服务端权威状态(单一玩家)
//
// 线程模型:本结构不持房间级锁;Hub 调用方需保证不会并发修改同一实例。
// 房间 tickLoop 单线程 + handlePlayerInput 串行化(同 conn 串行)→ 实际无并发。
// 留 mu 仅为未来多线程做准备。
type AuthState struct {
	mu sync.Mutex

	x, y   float64 // 像素
	facing float64 // 弧度 0-2π
	speed  float64 // m/s(每玩家可独立,默认 4.0)

	lastInputSeq uint32
	lastInputMs  uint64

	// 速率限制滑动窗口
	rateWindowStart time.Time
	rateCount       int
}

// NewAuthState 在 (x0, y0) 创建权威状态,speed m/s
func NewAuthState(x0, y0, speed float64) *AuthState {
	if speed <= 0 {
		speed = AuthStateDefaultSpeedMps
	}
	return &AuthState{
		x:               x0,
		y:               y0,
		speed:           speed,
		rateWindowStart: time.Now(),
	}
}

// Pos 返回权威位置(像素)
func (s *AuthState) Pos() (float64, float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.x, s.y
}

// Facing 返回权威朝向
func (s *AuthState) Facing() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.facing
}

// LastInputSeq 返回最后接受的 input seq
func (s *AuthState) LastInputSeq() uint32 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastInputSeq
}

// ApplyInput 立即应用一条 C2S_PlayerInput,返回 (accepted, reason)
//
// 规则:
//   1. 同 seq 重发:幂等接受,位置不变
//   2. 单轴 |v| > 1 → 拒绝(超速)
//   3. |v| > 1(双轴均 ≤ 1 但长度 > 1)→ 单位化(对角线不过冲)
//   4. 速率窗口 > AuthStateMaxInputsPerWin → 拒绝(>60Hz)
//   5. 应用后位置越界(±1024m) → 拒绝
//   6. NaN/Inf 输入向量或朝向 → 拒绝(防 DoS/状态污染)
func (s *AuthState) ApplyInput(in *wildwoodv1.C2S_PlayerInput) (bool, string) {
	if in == nil {
		return false, "nil input"
	}
	// 6. 朝向 NaN/Inf 防护(任何动作都拒)
	if math.IsNaN(float64(in.Facing)) || math.IsInf(float64(in.Facing), 0) {
		return false, "non-finite facing"
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	// 1. 同 seq 幂等
	if in.InputSeq == s.lastInputSeq && s.lastInputSeq != 0 {
		return true, "duplicate seq (idempotent)"
	}

	// 4. 速率限制(应用前先检查,避免污染窗口)
	now := time.Now()
	if now.Sub(s.rateWindowStart) > AuthStateRateLimitWindow {
		// 窗口过期 → 重置
		s.rateWindowStart = now
		s.rateCount = 0
	}
	s.rateCount++
	if s.rateCount > AuthStateMaxInputsPerWin {
		return false, fmt.Sprintf("rate limit exceeded: %d inputs in %v", s.rateCount, AuthStateRateLimitWindow)
	}

	// 仅处理 MOVE 动作(其它动作不进位置)
	if in.Action != wildwoodv1.InputAction_INPUT_ACTION_MOVE {
		// 仍然记录 seq
		s.lastInputSeq = in.InputSeq
		s.lastInputMs = in.ClientTimeMs
		return true, "non-move action accepted (seq recorded)"
	}

	dx, dy := float64(in.MoveDx), float64(in.MoveDy)

	// 6. NaN/Inf 防护:NaN 让 Hypot/比较失效,Inf 让单轴检查失效
	//   必须显式 IsNaN/IsInf(因为 NaN > 1 == false)
	if math.IsNaN(dx) || math.IsNaN(dy) || math.IsInf(dx, 0) || math.IsInf(dy, 0) {
		return false, "non-finite move vector"
	}

	// 2. 单轴超速
	if math.Abs(dx) > 1.0 || math.Abs(dy) > 1.0 {
		return false, fmt.Sprintf("overspeed component: dx=%.3f dy=%.3f", dx, dy)
	}
	// 3. 长度 > 1 → 单位化(对角线 (1,1) 长度 √2,单位化后 (1/√2,1/√2))
	vlen := math.Hypot(dx, dy)
	if vlen > 1.0 {
		dx /= vlen
		dy /= vlen
	}

	// 应用位移
	stepPx := s.speed * AuthStateInputDtSec * AuthStateTilePx
	nx := s.x + dx*stepPx
	ny := s.y + dy*stepPx

	// 5. 越界检查(像素单位 = 米 × 32;半 bound = 1024m = 32768px)
	maxPx := AuthStateWorldHalfBound * AuthStateTilePx
	if math.IsNaN(nx) || math.IsNaN(ny) || math.IsInf(nx, 0) || math.IsInf(ny, 0) {
		// 防御性:即使上面 NaN/Inf 防护已生效,也兜底检查
		return false, "non-finite position"
	}
	if math.Abs(nx) > maxPx || math.Abs(ny) > maxPx {
		return false, fmt.Sprintf("out of bounds: (%.2f,%.2f) > ±%.0fpx", nx, ny, maxPx)
	}

	s.x = nx
	s.y = ny
	s.facing = float64(in.Facing)
	s.lastInputSeq = in.InputSeq
	s.lastInputMs = in.ClientTimeMs
	return true, ""
}
