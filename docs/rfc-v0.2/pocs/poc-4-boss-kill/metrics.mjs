// PoC-4 metrics:打印 RFC §6 PoC-4 通过判据

export function printReport({ battles, bossHp, playerIds, results }) {
  let totalDmgCorrect = 0;
  let winnerHasPositive = 0;
  let lastHitterNotWinnerCount = 0;
  let lastHitterWasWinnerCount = 0;
  const distributionByWinner = {};

  for (const r of results) {
    const totalDmg = Object.values(r.attribution.damageContrib).reduce((a, b) => a + b, 0);
    if (totalDmg === bossHp) totalDmgCorrect++;
    if (r.attribution.winnerId) {
      const winnerDmg = r.attribution.damageContrib[r.attribution.winnerId];
      if (winnerDmg > 0) winnerHasPositive++;
    }
    if (r.lastHitter !== r.attribution.winnerId) lastHitterNotWinnerCount++;
    else lastHitterWasWinnerCount++;
    distributionByWinner[r.attribution.winnerId] = (distributionByWinner[r.attribution.winnerId] ?? 0) + 1;
  }

  const pass = {
    noDmgLoss: totalDmgCorrect === battles,
    winnerAlwaysPositive: winnerHasPositive === battles,
    attributionNotLastHit: lastHitterNotWinnerCount >= Math.floor(battles * 0.2), // 至少 20% 出现反抢人头
  };

  console.log('');
  console.log('═══ PoC-4 boss 击杀权属 — RFC v0.2 §6 ═══');
  console.log(`battles: ${battles}  boss HP: ${bossHp}  players: ${playerIds.join(',')}`);
  console.log('');
  console.log('--- 伤害累加 ---');
  console.log(`  总伤害 = ${bossHp} 场次: ${totalDmgCorrect}/${battles}  ${pass.noDmgLoss ? '✓' : '✗ FAIL'}`);
  console.log('');
  console.log('--- 权属 ---');
  console.log(`  前 1 名伤害占比 > 0: ${winnerHasPositive}/${battles}  ${pass.winnerAlwaysPositive ? '✓' : '✗ FAIL'}`);
  console.log(`  最后一击 ≠ 前 1 名: ${lastHitterNotWinnerCount} 场(占 ${((lastHitterNotWinnerCount / battles) * 100).toFixed(0)}%)`);
  console.log(`  最后一击 = 前 1 名: ${lastHitterWasWinnerCount} 场`);
  console.log('');
  console.log('--- 归属分布 ---');
  for (const [pid, n] of Object.entries(distributionByWinner)) {
    console.log(`  ${pid}: ${n} 场 (${((n / battles) * 100).toFixed(1)}%)`);
  }
  console.log('');
  console.log('═══ PoC-4 通过判据 ═══');
  console.log(`  无伤害丢失:           ${pass.noDmgLoss ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  前 1 名伤害始终 > 0:  ${pass.winnerAlwaysPositive ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  末击 ≠ 前 1 名(反抢): ${pass.attributionNotLastHit ? '✓ PASS' : '✗ FAIL'}`);
  console.log('');
  if (Object.values(pass).every(Boolean)) {
    console.log('✓ PoC-4 通过 — 按总伤害仲裁击杀权属,反"抢人头"作弊成立');
  } else {
    console.log('✗ PoC-4 未通过 — 回滚:全队共享掉落池,按贡献度加权分配');
  }
}
