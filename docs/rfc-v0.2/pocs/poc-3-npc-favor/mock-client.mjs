// PoC-3 mock client:发 gift 请求。

export class FavorClient {
  constructor({ id, server }) {
    this.id = id;
    this.server = server;
    this.seq = 0;
  }

  async gift(npcId, itemId, _index) {
    this.seq += 1;
    const eventKey = `${this.id}-${this.seq}`;
    const ts = Date.now() * 1000 + (this.seq % 1000);  // 微妙精度,降低 ts 撞车概率
    // 模拟网络 + 服务端处理
    await new Promise(r => setTimeout(r, Math.random() * 2));
    return this.server.applyGift(eventKey, this.id, npcId, 1, ts);
  }
}
