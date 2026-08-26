/**
 * Wildwood v0.4 联机 — end-to-end smoke。
 *
 * 启动内置 relay(server/relay.mjs) + 2 个 WebSocket 客户端,
 * 验证:host 创建 / 客机加入 / 状态广播 / 聊天 / 建筑放置 / 断线重连。
 */
'use strict';

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  envelope, PROTOCOL_VERSION,
  C_HOST, C_JOIN, C_RECONNECT, C_LEAVE, C_PING,
  S_HOSTED, S_JOINED, S_PEER_JOINED, S_PEER_LEFT, S_PEER_RECONNECTED, S_KICKED, S_ERROR, S_PONG,
  G_INPUT, G_STATE, G_CHAT, G_WORLD,
  WORLD_PLACE_BUILDING, WORLD_REMOVE_BUILDING, WORLD_GATHER_COMPLETE,
} from '../src/net/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY_PATH = path.resolve(__dirname, '../server/relay.mjs');
const PORT = 18801;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) passed++;
  else { failed++; failures.push(label); }
}

/* ============================================================
 * 工具:简单 WebSocket 客户端(自带消息队列 + waiter 注册)
 * ============================================================ */
class TestClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.ws = null;
    this.queue = [];           // 等待消费者取走的消息
    /** @type {Array<{types:Set, filter:Function|null, resolve, reject, timer, active:boolean}>} */
    this.waiters = [];
    this.connected = false;
    this.closed = false;
    this.token = null;
    this.id = null;
    this.roomCode = null;
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', () => {
        this.connected = true;
        this.ws.addEventListener('message', (ev) => this._onMessage(ev));
        resolve();
      });
      this.ws.addEventListener('error', (e) => {
        if (!this.connected) reject(new Error(`${this.name} connect failed: ${e.message || e}`));
      });
      this.ws.addEventListener('close', () => {
        this.closed = true;
        // 拒绝所有未决 waiter
        for (const w of this.waiters) {
          if (w.active) { w.active = false; w.reject(new Error('ws closed')); }
        }
        this.waiters = [];
      });
    });
  }
  _onMessage(ev) {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    // 优先尝试匹配所有 waiter
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      if (!w.active) continue;
      if (!w.types.has(m.type)) continue;
      if (w.filter && !w.filter(m)) continue;
      w.active = false;
      clearTimeout(w.timer);
      this.waiters.splice(i, 1);
      w.resolve(m);
      return;
    }
    // 没有 waiter 匹配,放到队列
    this.queue.push(m);
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  /**
   * 等待消息,带超时。
   *   - type: 字符串 or 字符串数组
   *   - filter: 可选谓词
   *   - timeout: 默认 2000ms
   */
  waitFor(type, { timeout = 2000, filter = null } = {}) {
    const types = Array.isArray(type) ? new Set(type) : new Set([type]);
    return new Promise((resolve, reject) => {
      // 1) 先看队列里已有的
      for (let i = 0; i < this.queue.length; i++) {
        const m = this.queue[i];
        if (types.has(m.type) && (!filter || filter(m))) {
          this.queue.splice(i, 1);
          return resolve(m);
        }
      }
      // 2) 注册 waiter
      const w = { types, filter, resolve, reject, active: true, timer: null };
      w.timer = setTimeout(() => {
        if (!w.active) return;
        w.active = false;
        const idx = this.waiters.indexOf(w);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`${this.name} timeout waiting for ${[...types].join('|')}`));
      }, timeout);
      this.waiters.push(w);
    });
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
  countOf(type) {
    return this.queue.filter(m => m.type === type).length;
  }
  drain() { this.queue.length = 0; }
}

/* ============================================================
 * 启动 relay
 * ============================================================ */
async function startRelay() {
  const proc = spawn('node', [RELAY_PATH, '--port', String(PORT), '--quiet'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 等 /health 返回 200
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return proc;
    } catch (_) { /* not ready */ }
    await sleep(50);
  }
  proc.kill('SIGTERM');
  throw new Error('relay did not start in 2.5s');
}

async function stopRelay(proc) {
  return new Promise((resolve) => {
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} resolve(); }, 1000);
  });
}

/* ============================================================
 * 主测试
 * ============================================================ */
async function main() {
  let relay = null;
  try {
    relay = await startRelay();
    const url = `ws://127.0.0.1:${PORT}`;
    const alice = new TestClient(url, 'alice');
    const bob = new TestClient(url, 'bob');
    await alice.connect();
    await bob.connect();
    ok(alice.connected && bob.connected, 'both clients connected');

    /* ---------- host + join ---------- */
    alice.send(envelope(C_HOST, { name: 'Alice' }));
    const hosted = await alice.waitFor(S_HOSTED);
    ok(typeof hosted.code === 'string' && hosted.code.length === 4, 'host got room code');
    alice.token = hosted.token;
    alice.id = 1;
    alice.roomCode = hosted.code;

    bob.send(envelope(C_JOIN, { code: hosted.code, name: 'Bob' }));
    const joinedBob = await bob.waitFor(S_JOINED);
    ok(joinedBob.snapshot !== undefined, 'joiner got snapshot');
    ok(Array.isArray(joinedBob.snapshot.players), 'snapshot has players array');
    bob.token = joinedBob.token;
    bob.id = joinedBob.id;

    const aliceJoinNotif = await alice.waitFor(S_PEER_JOINED, { filter: m => m.name === 'Bob' });
    ok(aliceJoinNotif.id === bob.id, 'host notified of peer joined');

    /* ---------- room full ---------- */
    const carol = new TestClient(url, 'carol');
    const dave = new TestClient(url, 'dave');
    await carol.connect();
    await dave.connect();
    carol.send(envelope(C_JOIN, { code: hosted.code, name: 'Carol' }));
    dave.send(envelope(C_JOIN,  { code: hosted.code, name: 'Dave' }));
    const joinedCarol = await carol.waitFor(S_JOINED);
    const joinedDave = await dave.waitFor(S_JOINED);
    carol.id = joinedCarol.id;
    dave.id = joinedDave.id;
    await alice.waitFor(S_PEER_JOINED, { filter: m => m.name === 'Dave' });

    // 第 5 个应被拒
    const eve = new TestClient(url, 'eve');
    await eve.connect();
    eve.send(envelope(C_JOIN, { code: hosted.code, name: 'Eve' }));
    const err = await eve.waitFor(S_ERROR, { filter: m => m.err === 'room_full' });
    ok(!!err, '5th player rejected (room_full)');
    eve.close();

    /* ---------- bad code ---------- */
    const flo = new TestClient(url, 'flo');
    await flo.connect();
    flo.send(envelope(C_JOIN, { code: 'ZZZZ', name: 'Flo' }));
    const errBad = await flo.waitFor(S_ERROR, { filter: m => m.err === 'bad_code' });
    ok(!!errBad, 'bad code rejected');
    flo.close();

    /* ---------- state broadcast ---------- */
    // host 广播一个 state,所有 peer 应收到
    alice.drain();
    bob.drain();
    carol.drain();
    dave.drain();
    alice.send(envelope(G_STATE, {
      tick: 1,
      players: [
        { id: 1, name: 'Alice', x: 10, y: 5, hp: 90, hunger: 80, sanity: 100, facing: 'right' },
        { id: 2, name: 'Bob',   x: 12, y: 7, hp: 80, hunger: 70, sanity: 100, facing: 'down' },
      ],
      snapshot: { buildings: [{ entityId: 1, typeId: 'campfire', tx: 10, ty: 5 }], resources: [] },
    }));
    const bobState = await bob.waitFor(G_STATE, { filter: m => m.tick === 1 });
    await carol.waitFor(G_STATE, { filter: m => m.tick === 1 });
    await dave.waitFor(G_STATE, { filter: m => m.tick === 1 });
    ok(bobState.tick === 1, 'bob received state tick 1');
    ok(bob.countOf(G_STATE) === 0, 'bob queue drained of state');

    /* ---------- input broadcast ---------- */
    bob.send(envelope(G_INPUT, { ax: 1, ay: 0 }));
    const aliceSeesInput = await alice.waitFor(G_INPUT, { filter: m => m.ax === 1 });
    ok(aliceSeesInput.fromId === bob.id, 'host saw input from bob');

    /* ---------- chat broadcast ---------- */
    bob.send(envelope(G_CHAT, { text: 'hi all' }));
    const aliceChat = await alice.waitFor(G_CHAT, { filter: m => m.text === 'hi all' });
    ok(aliceChat.from === 'Bob' && aliceChat.fromId === bob.id, 'chat broadcast with from/fromId');

    /* ---------- world: place building ---------- */
    bob.send(envelope(G_WORLD, {
      op: WORLD_PLACE_BUILDING,
      tx: 12, ty: 7, typeId: 'campfire',
      building: { entityId: 99, typeId: 'campfire', tx: 12, ty: 7, w: 1, h: 1, hp: 30, maxHp: 30 },
    }));
    const carolWorld = await carol.waitFor(G_WORLD, { filter: m => m.op === WORLD_PLACE_BUILDING });
    ok(carolWorld.by === bob.id && carolWorld.building.entityId === 99, 'place_building broadcast + by tag');

    /* ---------- world: remove building ---------- */
    alice.send(envelope(G_WORLD, {
      op: WORLD_REMOVE_BUILDING,
      entityId: 99,
    }));
    const daveRemove = await dave.waitFor(G_WORLD, { filter: m => m.op === WORLD_REMOVE_BUILDING && m.entityId === 99 });
    ok(!!daveRemove, 'remove_building broadcast');

    /* ---------- world: gather ---------- */
    alice.send(envelope(G_WORLD, {
      op: WORLD_GATHER_COMPLETE,
      entityId: 7,
      loot: [{ itemId: 'log', count: 1 }],
      regrowAt: 0,
    }));
    const bobGather = await bob.waitFor(G_WORLD, { filter: m => m.op === WORLD_GATHER_COMPLETE });
    ok(bobGather.entityId === 7 && Array.isArray(bobGather.loot), 'gather_complete broadcast');

    /* ---------- ping/pong ---------- */
    carol.send(envelope(C_PING));
    const pong = await carol.waitFor(S_PONG);
    ok(typeof pong.ts === 'number', 'ping → pong');

    /* ---------- disconnect & reconnect within 30s ---------- */
    const bobToken = bob.token;
    bob.close();
    const peerLeft = await alice.waitFor(S_PEER_LEFT, { filter: m => m.id === bob.id });
    ok(!!peerLeft, 'host notified of peer_left');

    // 重新连接 with same token
    const bob2 = new TestClient(url, 'bob2');
    await bob2.connect();
    bob2.send(envelope(C_RECONNECT, { token: bobToken }));
    const rejoined = await bob2.waitFor(S_JOINED, { filter: m => m.reconnected === true });
    ok(rejoined.id === bob.id, 'reconnect restores same peer id');
    const aliceReconnectNotif = await alice.waitFor(S_PEER_RECONNECTED, { filter: m => m.id === bob.id });
    ok(!!aliceReconnectNotif, 'host notified of peer_reconnected');

    // 确认 bob2 现在能正常收消息
    alice.send(envelope(G_STATE, { tick: 999, players: [] }));
    const r = await bob2.waitFor(G_STATE, { filter: m => m.tick === 999 });
    ok(r.tick === 999, 'reconnected peer receives subsequent state');

    /* ---------- bad token ---------- */
    const xavier = new TestClient(url, 'xav');
    await xavier.connect();
    xavier.send(envelope(C_RECONNECT, { token: 'nosuchtoken1234' }));
    const reconnectErr = await xavier.waitFor(S_ERROR, { filter: m => m.err === 'reconnect_failed' });
    ok(!!reconnectErr, 'bad token rejected');
    xavier.close();

    /* ---------- leave ---------- */
    carol.close();
    const aliceLeftNotif = await alice.waitFor(S_PEER_LEFT, { filter: m => m.id === carol.id });
    ok(!!aliceLeftNotif, 'leave → peer_left');

    dave.close();
    bob2.close();
    alice.close();
    await sleep(50);

  } catch (e) {
    failed++;
    failures.push(`exception: ${e?.stack || e}`);
  } finally {
    if (relay) await stopRelay(relay);
  }

  console.log(`\nrelay smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log('  FAIL:', f);
    process.exit(1);
  }
  console.log('All relay tests PASSED.');
}

main();
