/**
 * Wildwood v0.4 联机 — 本地 session 状态机。
 *
 * 持有:
 *   - 当前 mode: 'offline' | 'hosting' | 'joined'
 *   - room code, token, self id
 *   - peers 列表(name / id / 远端 player state)
 *   - buildings / resources snapshot(从 join 时获得)
 *
 * 事件:
 *   - 'state'        — session.mode 或 self.id 变化
 *   - 'peer_added'   — { peer }
 *   - 'peer_removed' — { id, reason }
 *   - 'peer_updated' — { id, state }
 *   - 'snapshot'     — { snapshot }  (新玩家加入时一次性下发)
 *   - 'error'        — 协议/网络错误
 *
 * 状态机:
 *   offline ──host()──> hosting ──leave()──> offline
 *      │
 *      └──join()──> joined ──leave()──> offline
 */

'use strict';

import { Emitter } from './relay-client.js';

export const MODE_OFFLINE = 'offline';
export const MODE_HOSTING = 'hosting';
export const MODE_JOINED = 'joined';

export class Session extends Emitter {
  constructor() {
    super();
    this.mode = MODE_OFFLINE;
    this.self = { id: null, name: null };
    this.code = null;
    this.token = null;
    /** @type {Map<number, {id, name, state}>} */
    this.peers = new Map();
    /** @type {{players: Array, buildings: Array, resources: Array} | null} */
    this.snapshot = null;
  }

  reset() {
    this.mode = MODE_OFFLINE;
    this.self = { id: null, name: null };
    this.code = null;
    this.token = null;
    this.peers.clear();
    this.snapshot = null;
    this.emit('state');
  }

  /** 标记为 hosting。client.on('hosted') 触发。 */
  setHosted({ code, token }) {
    this.mode = MODE_HOSTING;
    this.code = code;
    this.token = token;
    this.self.id = 1;  // host 总是 1
    this.emit('state');
  }

  /** 标记为 joined。client.on('joined') 触发。 */
  setJoined({ token, id, code, snapshot, reconnected = false }) {
    this.mode = MODE_JOINED;
    this.token = token;
    this.code = code;
    this.self.id = id;
    if (snapshot) {
      this.snapshot = snapshot;
      this.peers.clear();
      // host is in snapshot.players if provided; 永远把自己排除
      for (const p of snapshot.players || []) {
        if (p.id === this.self.id) continue;
        this.peers.set(p.id, { id: p.id, name: p.name, state: p });
      }
      this.emit('snapshot', { snapshot });
    } else {
      this.emit('snapshot', { snapshot: { players: [], buildings: [], resources: [] } });
    }
    if (reconnected) this.emit('reconnected');
    this.emit('state');
  }

  addPeer({ id, name }) {
    if (id === this.self.id) return;
    if (this.peers.has(id)) return;
    this.peers.set(id, { id, name, state: null });
    this.emit('peer_added', { peer: this.peers.get(id) });
  }

  removePeer(id, reason) {
    if (!this.peers.has(id)) return;
    this.peers.delete(id);
    this.emit('peer_removed', { id, reason });
  }

  updatePeerState(id, state) {
    const p = this.peers.get(id);
    if (!p) return;
    p.state = state;
    this.emit('peer_updated', { id, state });
  }

  /** 远端发来 state 广播,更新所有 peer 的 state(只更新已有的,陌生 id 忽略)。 */
  applyStateBroadcast(state) {
    if (!state || !Array.isArray(state.players)) return;
    for (const p of state.players) {
      if (p.id === this.self.id) continue;
      if (this.peers.has(p.id)) {
        this.updatePeerState(p.id, p);
      } else {
        // 收到新 peer 的 state 但还没收到 S_PEER_JOINED(顺序竞争);先建占位
        this.peers.set(p.id, { id: p.id, name: p.name, state: p });
        this.emit('peer_added', { peer: this.peers.get(p.id) });
      }
    }
  }
}
