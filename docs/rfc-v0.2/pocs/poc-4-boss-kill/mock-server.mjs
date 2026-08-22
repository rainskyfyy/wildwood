// PoC-4 mock server:boss HP + damage ledger + 死亡权属仲裁
//
// 对应 MonsterService + EventService.BOSS_KILL
// damageLedger 默认不下发客户端,仅服务端保留(PoC 调试时 visible)。

export class BossServer {
  constructor({ bossHp = 10000 } = {}) {
    this.bossHp = bossHp;
    this.maxHp = bossHp;
    this.hp = bossHp;
    this.damageLedger = {};  // playerId -> totalDamage
    this.alive = true;
  }

  reset() {
    this.hp = this.maxHp;
    this.damageLedger = {};
    this.alive = true;
  }

  getHp() { return this.hp; }

  /** 对应 MonsterService.applyDamage */
  takeDamage(actorId, dmg) {
    if (!this.alive) return { ok: false, reason: 'ALREADY_DEAD' };
    this.damageLedger[actorId] = (this.damageLedger[actorId] ?? 0) + dmg;
    this.hp = Math.max(0, this.hp - dmg);
    return { ok: true, newHp: this.hp };
  }

  /** 死亡:按 damageLedger 排序,前 1 名拿 loot */
  die(killerId) {
    if (!this.alive) return { ok: false, reason: 'ALREADY_DEAD' };
    this.alive = false;
    const sorted = Object.entries(this.damageLedger)
      .map(([pid, dmg]) => ({ playerId: pid, dmg, pct: dmg / this.maxHp }))
      .sort((a, b) => b.dmg - a.dmg);
    const winner = sorted[0];
    return {
      ok: true,
      event: 'BOSS_KILL',
      bossId: 'deerclops',
      killerId,                  // 最后一击(用于 PATCH 广播显示)
      winnerId: winner?.playerId, // 掉落物归属(前 1 名)
      damageContrib: this.damageLedger,
      sorted,
    };
  }
}
