// PoC-5 metrics:打印 RFC §6 PoC-5 通过判据

export function printReport({ trials, report }) {
  let noMixed = 0;
  let noFailedSwap = 0;
  let swapAtomicOk = 0;
  const mixedExamples = [];

  for (const r of report) {
    // 关键断言:
    //   - phase='before' 的所有 snapshot.manifestVersion 相同
    //   - phase='after' 的所有 snapshot.manifestVersion 相同
    //   - before 阶段与 after 阶段的 manifestVersion 不同
    const before = r.snapshots.filter(s => s.phase === 'before');
    const after = r.snapshots.filter(s => s.phase === 'after');
    const beforeVers = before.length > 0 ? before[0].manifestVersion : null;
    const afterVers = after.length > 0 ? after[0].manifestVersion : null;
    const allBeforeSame = before.every(s => s.manifestVersion === beforeVers);
    const allAfterSame = after.every(s => s.manifestVersion === afterVers);
    const transitioned = beforeVers !== afterVers;
    const noMid = allBeforeSame && allAfterSame && transitioned;

    if (noMid) noMixed++;
    else mixedExamples.push({ beforeVers, afterVers, allBeforeSame, allAfterSame, transitioned, snapCount: r.snapshots.length });
    if (r.swapResult.ok) noFailedSwap++;
    if (r.swapResult.swappedCount > 0) swapAtomicOk++;
  }

  const pass = {
    noMixedState: noMixed === trials,
    swapSuccess: noFailedSwap === trials,
  };

  console.log('');
  console.log('═══ PoC-5 客户端 patch 原子切换 — RFC v0.2 §6 ═══');
  console.log(`trials: ${trials}  (interrupt 进度循环: 30% / 70% / 99%)`);
  console.log('');
  console.log('--- swap 表现 ---');
  console.log(`  无混合态:        ${noMixed}/${trials}  ${pass.noMixedState ? '✓' : '✗ FAIL'}`);
  console.log(`  swap 成功:       ${noFailedSwap}/${trials}  ${pass.swapSuccess ? '✓' : '✗ FAIL'}`);
  console.log(`  swappedCount>0:  ${swapAtomicOk}/${trials}`);
  console.log('');
  console.log('--- 抽样(前 3 次 trial) ---');
  for (const r of report.slice(0, 3)) {
    const before = r.snapshots.find(s => s.phase === 'before');
    const after = r.snapshots.find(s => s.phase === 'after');
    console.log(`  trial ${r.trial}: interruptAt=${r.interruptAt} planSize=${r.planSize} completed=${r.completed} swap.ok=${r.swapResult.ok} before.v=${before?.manifestVersion} after.v=${after?.manifestVersion}`);
  }
  if (mixedExamples.length) {
    console.log('');
    console.log('--- 失败抽样 ---');
    for (const e of mixedExamples.slice(0, 2)) console.log('  ', JSON.stringify(e));
  }
  console.log('');
  console.log('═══ PoC-5 通过判据 ═══');
  console.log(`  无混合态(全老 or 全新):  ${pass.noMixedState ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  atomicSwap 全部成功:     ${pass.swapSuccess ? '✓ PASS' : '✗ FAIL'}`);
  console.log('');
  if (Object.values(pass).every(Boolean)) {
    console.log('✓ PoC-5 通过 — 临界区 + 原子切换 防止混合态');
  } else {
    console.log('✗ PoC-5 未通过 — 回滚:增加切换临界区,patch 完成前禁止重渲染');
  }
}
