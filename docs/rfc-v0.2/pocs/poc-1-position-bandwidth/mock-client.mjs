// PoC-1 mock bot:按 reportHz 上报位置,模拟随机游走。

export class Bot {
  constructor({ id, server, reportHz = 20, startX = 0, startY = 0 }) {
    this.id = id;
    this.server = server;
    this.reportHz = reportHz;
    this.x = startX;
    this.y = startY;
    this.reportTimer = null;
    this.tick = 0;
  }

  start() {
    const intervalMs = Math.floor(1000 / this.reportHz);
    this.reportTimer = setInterval(() => this.tickStep(), intervalMs);
  }

  stop() {
    if (this.reportTimer) clearInterval(this.reportTimer);
  }

  /** 一次 tick 步进:小幅随机游走(物理上 1 步 ≈ 1 tile) */
  tickStep() {
    this.tick += Math.floor(1000 / this.reportHz);
    const dx = (Math.random() - 0.5) * 0.6;
    const dy = (Math.random() - 0.5) * 0.6;
    this.x += dx;
    this.y += dy;
    this.server.receiveReport(this.id, this.x, this.y, this.tick, Date.now());
  }
}
