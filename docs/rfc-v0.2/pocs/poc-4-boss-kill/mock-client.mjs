// PoC-4 mock bot:每场随机一个 DPS profile。

export class BossBot {
  constructor({ id }) {
    this.id = id;
    this.dps = 0;
  }

  /** 每场重置 DPS(80~200 之间) */
  randomizeDps() {
    this.dps = 80 + Math.floor(Math.random() * 120);
    return this.dps;
  }
}
