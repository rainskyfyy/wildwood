// PoC-3 metrics:打印 RFC §6 PoC-3 通过判据

export function printReport({ npcId, perClient, finalFavor, expectedFavor, snapshots, serverLog }) {
  const lwwStale = serverLog.filter(e => !e.ok && e.reason === 'LWW_STALE').length;
  const noRollback = snapshots.every((v, i, a) => i === 0 || v >= a[i - 1]);
  const pass = {
    favorCorrect: finalFavor === expectedFavor,
    noRollback,
    noLwwStale: lwwStale === 0,
  };

  console.log('');
  console.log('═══ PoC-3 NPC 好感度 LWW-Set — RFC v0.2 §6 ═══');
  console.log(`NPC: ${npcId}  perClient: ${perClient}  expected: ${expectedFavor}`);
  console.log('');
  console.log(`  final favor: ${finalFavor}  ${pass.favorCorrect ? '✓' : '✗ FAIL'}`);
  console.log(`  snapshots:    ${snapshots.join(' → ')}`);
  console.log(`  LWW stale:   ${lwwStale}  ${pass.noLwwStale ? '✓' : '✗ FAIL'}`);
  console.log(`  no rollback: ${noRollback ? '✓' : '✗ FAIL'}`);
  console.log('');
  console.log('═══ PoC-3 通过判据 ═══');
  console.log(`  最终好感度正确:    ${pass.favorCorrect ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  无回退:            ${pass.noRollback ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  无 LWW 过期丢弃:   ${pass.noLwwStale ? '✓ PASS' : '✗ FAIL'}`);
  console.log('');
  if (Object.values(pass).every(Boolean)) {
    console.log('✓ PoC-3 通过 — LWW-Set 适合 NPC 好感度子域');
  } else {
    console.log('✗ PoC-3 未通过 — 回滚:单 NPC 单 tick 只接受一人');
  }
}
