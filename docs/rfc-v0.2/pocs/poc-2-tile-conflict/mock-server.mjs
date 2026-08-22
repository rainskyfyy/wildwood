// PoC-2 mock server:同步处理,按 trialId 隔离 namespace
// 避免跨 trial 残留;真实场景下服务端按 room 隔离,这里按 trial 隔离。

export class ConflictServer {
  constructor() { this.tilesByTrial = new Map(); }

  async start() { /* noop for in-process mock */ }
  async stop() { /* noop */ }

  _get(trialId) {
    if (!this.tilesByTrial.has(trialId)) this.tilesByTrial.set(trialId, new Map());
    return this.tilesByTrial.get(trialId);
  }

  /** 对应 BuildingService.applyPatch(PLACE) — 同步 */
  applyPlace(trialId, x, y, buildingType, actorId) {
    const tiles = this._get(trialId);
    const key = `${x},${y}`;
    if (tiles.has(key)) {
      return { ok: false, reason: 'OCCUPIED' };
    }
    tiles.set(key, { type: buildingType, ownerId: actorId, tick: Date.now() });
    return { ok: true };
  }

  /** 对应 BuildingService.applyPatch(REMOVE) */
  applyRemove(trialId, x, y, actorId) {
    const tiles = this._get(trialId);
    const key = `${x},${y}`;
    if (!tiles.has(key)) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    tiles.delete(key);
    return { ok: true };
  }
}
