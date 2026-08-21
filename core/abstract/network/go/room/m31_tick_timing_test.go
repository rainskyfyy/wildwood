// Package room_test: M3.1 服务端 tick 准时性压测
//
// 覆盖 M3.1 任务书验收 ④:
//   服务端 tick 50ms 校时偏差 < 16ms
//
// 压测方式:跑 1000 tick(50 秒 wall clock),统计 tick 间间隔的 p50/p95/p99/p100。
// 期望:理想 50ms(20Hz),p99 偏差 < 16ms,实测 Go runtime timer 抖动 < 5ms。
package room_test

import (
	"math"
	"sort"
	"testing"
	"time"

	"github.com/wildwood/net/room"
)

func TestM31_HubTick_TimingStress(t *testing.T) {
	if testing.Short() {
		t.Skip("stress test skipped in -short mode")
	}
	const (
		tickHz      = 20
		tickCount   = 1000
		tickPeriod  = time.Second / tickHz
		stopRunaway = 2 * time.Minute // 安全网,正常应 ~50s 完成
	)
	hub := room.NewHub(tickHz)
	hub.Start()
	defer hub.Stop()

	// 用 hub 内部 tick count 自增 + SetTickHook 钩子测量 wall-clock
	// 注意:onTick 是 per-room 调用的,这里无房间,所以 onTick 不会被触发
	//   → 改用极短轮询 tickCount,记录每次增长时的 wall time
	type sample struct {
		tickIdx uint64
		at      time.Time
	}
	samples := make([]sample, 0, tickCount+10)

	prev := uint64(0)
	deadline := time.Now().Add(stopRunaway)
	lastPoll := time.Now()
	for {
		curr := hub.TickCount()
		if curr > prev {
			now := time.Now()
			// 补齐中间可能跳过的 tick
			for missing := prev + 1; missing <= curr && uint64(len(samples)) < tickCount; missing++ {
				samples = append(samples, sample{tickIdx: missing, at: now})
			}
			prev = curr
			if uint64(len(samples)) >= tickCount {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("only got %d/%d samples within %v (final tickCount=%d)", len(samples), tickCount, stopRunaway, curr)
		}
		// 高频轮询,避免漏 tick(每 5ms 一次足够)
		if time.Since(lastPoll) < 5*time.Millisecond {
			time.Sleep(1 * time.Millisecond)
		}
		lastPoll = time.Now()
	}

	// 至少 1000 个样本才统计
	if uint64(len(samples)) < tickCount {
		t.Fatalf("only collected %d samples, want %d", len(samples), tickCount)
	}
	// 只取前 1000 个
	samples = samples[:tickCount]

	// 计算 tick 间间隔
	gaps := make([]time.Duration, 0, len(samples)-1)
	for i := 1; i < len(samples); i++ {
		gaps = append(gaps, samples[i].at.Sub(samples[i-1].at))
	}
	if len(gaps) == 0 {
		t.Fatalf("no gaps to analyze")
	}

	// 排序算百分位
	sortedMs := make([]float64, len(gaps))
	for i, g := range gaps {
		sortedMs[i] = float64(g) / float64(time.Millisecond)
	}
	sort.Float64s(sortedMs)
	pct := func(p float64) float64 {
		idx := int(math.Ceil(p*float64(len(sortedMs)))) - 1
		if idx < 0 {
			idx = 0
		}
		if idx >= len(sortedMs) {
			idx = len(sortedMs) - 1
		}
		return sortedMs[idx]
	}
	p50 := pct(0.50)
	p95 := pct(0.95)
	p99 := pct(0.99)
	p100 := pct(1.0)
	mean := 0.0
	for _, v := range sortedMs {
		mean += v
	}
	mean /= float64(len(sortedMs))

	// 偏差 = |gap - tickPeriod|
	devP99 := math.Abs(p99 - float64(tickPeriod)/float64(time.Millisecond))
	devP100 := math.Abs(p100 - float64(tickPeriod)/float64(time.Millisecond))

	t.Logf("=== M3.1 tick timing stress (%d ticks @ %dHz) ===", tickCount, tickHz)
	t.Logf("target period: %.3f ms", float64(tickPeriod)/float64(time.Millisecond))
	t.Logf("samples: %d", len(samples))
	t.Logf("p50=%.3fms  p95=%.3fms  p99=%.3fms  p100=%.3fms  mean=%.3fms", p50, p95, p99, p100, mean)
	t.Logf("deviation: p99=%.3fms  p100=%.3fms  (target: p99<16ms)", devP99, devP100)

	// 验收:p99 偏差 < 16ms
	if devP99 > 16.0 {
		t.Errorf("p99 deviation %.3fms exceeds 16ms budget", devP99)
	}
	// p100 是单点最大偏差,允许更高(GC pause 等)
	if devP100 > 50.0 {
		t.Logf("WARN: p100 deviation %.3fms is high (likely GC/scheduler)", devP100)
	}

	// 同时报告前 5 个最大 gap(供问题排查)
	tail := sortedMs[len(sortedMs)-5:]
	t.Logf("top-5 max gaps: %v (ms)", tail)
}
