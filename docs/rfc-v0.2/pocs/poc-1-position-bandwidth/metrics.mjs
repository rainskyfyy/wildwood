// PoC-1 metrics:打印 RFC §6 PoC-1 通过判据对照

export function printReport({
  durationS, nBots, reportHz, broadcastMs,
  serverMetrics, cpuUserUs, cpuSystemUs,
}) {
  const reportBytesPerSec = serverMetrics.totalReportBytes / durationS;
  const broadcastBytesPerSec = serverMetrics.totalBroadcastBytes / durationS;
  const totalBytesPerSec = reportBytesPerSec + broadcastBytesPerSec;

  // CPU 估算:user+system 是 µs,占 wall µs 的比例
  const wallUs = durationS * 1e6;
  const cpuUs = cpuUserUs + cpuSystemUs;
  const cpuPct = (cpuUs / wallUs) * 100;

  const pass = {
    p95Rtt: serverMetrics.rttP95Ms < 80,
    cpu: cpuPct < 30,
    bandwidth: totalBytesPerSec < 50 * 1024,
  };

  console.log('');
  console.log('═══ PoC-1 玩家位置同步带宽 — RFC v0.2 §6 ═══');
  console.log(`duration:     ${durationS.toFixed(1)}s  bots: ${nBots}  report: ${reportHz}Hz  broadcast: ${broadcastMs}ms`);
  console.log('');
  console.log('--- 服务端 ---');
  console.log(`  reports received:    ${serverMetrics.totalReports}`);
  console.log(`  broadcasts sent:     ${serverMetrics.totalBroadcasts}`);
  console.log(`  rejected (cheat?):   ${serverMetrics.rejectedCount}  ${serverMetrics.rejectedSample[0] ? JSON.stringify(serverMetrics.rejectedSample[0]) : ''}`);
  console.log('');
  console.log('--- 带宽 ---');
  console.log(`  report:     ${(reportBytesPerSec / 1024).toFixed(2)} KB/s`);
  console.log(`  broadcast:  ${(broadcastBytesPerSec / 1024).toFixed(2)} KB/s`);
  console.log(`  total:      ${(totalBytesPerSec / 1024).toFixed(2)} KB/s  ${pass.bandwidth ? '✓' : '✗ FAIL'}`);
  console.log('');
  console.log('--- RTT (mock 同进程) ---');
  console.log(`  p50: ${serverMetrics.rttP50Ms.toFixed(1)}ms`);
  console.log(`  p95: ${serverMetrics.rttP95Ms.toFixed(1)}ms  ${pass.p95Rtt ? '✓' : '✗ FAIL'}`);
  console.log('');
  console.log('--- 服务端 CPU ---');
  console.log(`  user+sys:   ${cpuPct.toFixed(1)}%  ${pass.cpu ? '✓' : '✗ FAIL'}`);
  console.log('');
  console.log('═══ PoC-1 通过判据 ═══');
  console.log(`  p95 RTT < 80ms:           ${pass.p95Rtt ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  服务端 CPU < 30%:         ${pass.cpu ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  出口带宽 < 50 KB/s/房:    ${pass.bandwidth ? '✓ PASS' : '✗ FAIL'}`);
  console.log('');
  if (Object.values(pass).every(Boolean)) {
    console.log('✓ PoC-1 通过 — 可进入 v0.6.3 B 层接入');
  } else {
    console.log('✗ PoC-1 未通过 — 见回滚方案:reportHz → 10,broadcastMs → 500');
  }
}
