// PoC-4: boss 击杀权属 — 最小可跑骨架
// RFC v0.2 §6 PoC-4

import { BossServer } from './mock-server.mjs';
import { BossBot } from './mock-client.mjs';
import { printReport } from './metrics.mjs';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);

const BATTLES = Number(args.battles ?? 1000);
const BOSS_HP = 10000;
const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4'];

// ---- 主流程 ----
const server = new BossServer({ bossHp: BOSS_HP });
const bots = PLAYER_IDS.map(id => new BossBot({ id }));

const results = [];

for (let b = 0; b < BATTLES; b++) {
  server.reset();

  // 每场生成 4 bot 的 DPS profile
  const dpsProfile = bots.map(bot => bot.randomizeDps());
  // 30% 概率"最后一击"是 DPS 最低者(防抢人头作弊)
  const lastHitter = Math.random() < 0.3
    ? bots.map(b => b).sort((a, x) => a.dps - x.dps)[0].id
    : bots.map(b => b).sort((a, x) => x.dps - a.dps)[0].id;

  // 模拟战斗 tick
  let totalDmg = 0;
  let tickCount = 0;
  while (server.getHp() > 0 && tickCount < 5000) {
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      // 最后一击:让 lastHitter 给"致命一击"
      if (totalDmg + bot.dps >= BOSS_HP) {
        const dmg = Math.min(bot.dps, BOSS_HP - totalDmg);
        const killer = (lastHitter === bot.id) ? bot.id : bots[(i + 1) % bots.length].id;
        server.takeDamage(bot.id, dmg);
        totalDmg += dmg;
        if (server.getHp() <= 0) {
          const attribution = server.die(killer);
          results.push({ dpsProfile, attribution, lastHitter, totalDmg });
          break;
        }
      } else {
        server.takeDamage(bot.id, bot.dps);
        totalDmg += bot.dps;
      }
    }
    tickCount++;
  }
}

// ---- 打印报告 ----
printReport({ battles: BATTLES, bossHp: BOSS_HP, playerIds: PLAYER_IDS, results });
