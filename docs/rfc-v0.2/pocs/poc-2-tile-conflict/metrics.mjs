// PoC-2 metrics:打印 RFC §6 PoC-2 通过判据

export function printReport({ trials, latencies, outcomes }) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;

  // 每次 trial 2 个 client 同时 PLACE 同格 → 必有 1 ok + 1 OCCUPIED
  const pass = {
    p95Latency: p95 < 100,
    everyTrialHasOccupied: outcomes.occupied === trials,    // 每次冲突必有 OCCUPIED
    noLostAck: outcomes.ok + outcomes.occupied + outcomes.notFound + outcomes.other === trials * 2,
  };

  console.log('');
  console.log('═══ PoC-2 tile 编辑冲突 — RFC v0.2 §6 ═══');
  console.log(`trials: ${trials}  (2 client × ${trials} = ${trials * 2} 次 PLACE)`);
  console.log('');
  console.log('--- latency (click → ack) ---');
  console.log(`  p50: ${p50.toFixed(1)}ms`);
  console.log(`  p95: ${p95.toFixed(1)}ms  ${pass.p95Latency ? '✓' : '✗ FAIL'}`);
  console.log(`  p99: ${p99.toFixed(1)}ms`);
  console.log(`  max: ${max}ms`);
  console.log('');
  console.log('--- 冲突结果 ---');
  console.log(`  ok (首次 PLACE):   ${outcomes.ok}    (期望 = trials)`);
  console.log(`  OCCUPIED (冲突):   ${outcomes.occupied}    (期望 = trials)  ${pass.everyTrialHasOccupied ? '✓' : '✗ FAIL'}`);
  console.log(`  NOT_FOUND:         ${outcomes.notFound}`);
  console.log(`  other:             ${outcomes.other}`);
  console.log('');
  console.log('═══ PoC-2 通过判据 ═══');
  console.log(`  p95 < 100ms:                 ${pass.p95Latency ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  每次冲突必有 OCCUPIED:       ${pass.everyTrialHasOccupied ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  无丢 ack:                    ${pass.noLostAck ? '✓ PASS' : '✗ FAIL'}`);
  console.log('');
  if (Object.values(pass).every(Boolean)) {
    console.log('✓ PoC-2 通过 — 服务端串行化策略可接受');
  } else {
    console.log('✗ PoC-2 未通过 — 回滚:热门地块加操作队列 + 视觉锁');
  }
}
