// PoC-2 mock client:发 PLACE/REMOVE 请求,带 trialId。

export class ConflictClient {
  constructor({ id, server }) { this.id = id; this.server = server; }

  placeBuilding(trialId, x, y, type) {
    return this.server.applyPlace(trialId, x, y, type, this.id);
  }

  removeBuilding(trialId, x, y) {
    return this.server.applyRemove(trialId, x, y, this.id);
  }
}
