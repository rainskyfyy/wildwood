// PoC-3 mock server:LWW-Set 实现的 NPC 好感度累加。
//
// LWW-Set 规则:每个 gift 元素带 (timestamp, actorId),set 仅当新元素
// (timestamp, actorId) > 旧时才替换。本 PoC 中"元素"=「actorId 这次送礼事件」,
// 简化:timestamp = Date.now() 唯一,不同 microtask 都能保证唯一。

export class FavorServer {
  constructor() {
    this.favor = new Map();      // npcId -> { value, lwwSet: Map<eventKey, (ts, actorId)> }
    this.log = [];               // 每个 apply 的结果
  }

  /**
   * 对应 EventService.applyEvent(NPC_FAVOR_CHANGE)
   * @param eventKey 唯一事件 id(actorId + seq)
   * @param actorId
   * @param npcId
   * @param delta   每次送礼 +1
   * @param ts      timestamp
   */
  applyGift(eventKey, actorId, npcId, delta, ts) {
    const entry = this.favor.get(npcId) ?? { value: 0, lwwSet: new Map() };
    const prev = entry.lwwSet.get(eventKey);
    // LWW:新事件仅当 (ts, actorId) > 旧才覆盖
    if (prev && (prev.ts > ts || (prev.ts === ts && prev.actorId >= actorId))) {
      this.log.push({ eventKey, ok: false, reason: 'LWW_STALE', value: entry.value });
      return { ok: false, reason: 'LWW_STALE', value: entry.value };
    }
    entry.lwwSet.set(eventKey, { ts, actorId });
    entry.value += delta;
    this.favor.set(npcId, entry);
    this.log.push({ eventKey, ok: true, value: entry.value });
    return { ok: true, value: entry.value };
  }

  getFavor(npcId) {
    return this.favor.get(npcId)?.value ?? 0;
  }

  getLog() { return this.log; }
}
