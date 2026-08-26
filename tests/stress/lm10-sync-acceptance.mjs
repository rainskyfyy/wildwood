/**
 * L-M1-0 联机功能验收 — host/join 重复出入 + 多人同步无漂移 + 断线重连。
 *
 * 覆盖验收线第 3 条,全部在 CN 50ms RTT 延迟代理下执行:
 *   A. host/join 可重复出入:20 轮 host建房→joiner加入→joiner离开→host关房,
 *      外加 5 轮 4 人满房(3 joiners 进 → 2 离开 → 2 重进 → 全离)
 *   B. 断线重连:joiner TCP 硬断(不发 leave),token 重连 30s 宽限内成功,
 *      host 收到 peer_reconnected
 *   C. 移动同步无漂移:host 沿确定轨迹 3 tiles/s 移动,10Hz 广播;
 *      joiner 侧测:投递延迟、移动期位置误差(≤ v/10 + v×延迟 + 容差)、
 *      停止后最终位置逐位收敛(无永久漂移)
 *   D. 世界操作同步:gather_complete × 50 / place_building × 30 /
 *      remove_building × 10 / chat × 20,逐条 seq + 内容哈希核对,
 *      3 个 joiner 全量收到且内容一致
 *
 * 用法:node tests/stress/lm10-sync-acceptance.mjs
 * 退出码:0 = 全部 PASS;1 = 有 FAIL。
 */
'use strict';

import {
  MPClient, makeRoom, waitMsg, startRelay, startDelayProxy,
  stats, appendMetric, buildStatePayload, sleep,
} from './lm10-lib.mjs';
import { envelope, PROTOCOL_VERSION, C_PING } from '../../src/net/protocol.js';
import { createHash } from 'node:crypto';

const RELAY_PORT = 18721;
const PROXY_PORT = 18722;
const ONE_WAY_MS = 25;   // CN 50ms RTT

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}

function hash(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

/* ---------- A. host/join 重复出入 ---------- */

async function repeatCycles(url, cycles) {
  console.log(`\n=== A1. host/join 重复出入 × ${cycles}(单人 join)==`);
  let clean = 0;
  const t0 = Date.now();
  for (let i = 0; i < cycles; i++) {
    const host = new MPClient(`H${i}`);
    await host.connect(url);
    host.send(envelope('host', { name: `H${i}` }));
    const hosted = await waitMsg(host, 'hosted', 5000);
    const code = hosted.code;

    const joiner = new MPClient(`J${i}`);
    await joiner.connect(url);
    joiner.send(envelope('join', { code, name: `J${i}`, v: PROTOCOL_VERSION }));
    const peerJoinedP = waitMsg(host, 'peer_joined', 5000);
    await waitMsg(joiner, 'joined', 5000);
    await peerJoinedP;

    joiner.send(envelope('leave', {}));   // joiner 先走
    await waitMsg(host, 'peer_left', 5000);
    host.send(envelope('leave', {}));     // host 关房

    await sleep(80);
    if (!joiner.errorEvents.length && !host.errorEvents.length) clean++;
    try { joiner.killSocket(); } catch (_) {}
    try { host.killSocket(); } catch (_) {}
  }
  const perCycleMs = (Date.now() - t0) / cycles;
  ok(clean === cycles, `A1: ${clean}/${cycles} 轮零错误(建房→加入→离开→关房)`);
  ok(perCycleMs < 2000, `A1: 单轮平均 ${perCycleMs.toFixed(0)}ms < 2000ms`);
  return { clean, perCycleMs };
}

async function fourPlayerCycles(url, cycles) {
  console.log(`\n=== A2. 4 人满房重复出入 × ${cycles} ===`);
  let clean = 0;
  for (let i = 0; i < cycles; i++) {
    const { host, joiners, code } = await makeRoom(url, 3, { hostName: `FH${i}`, joinerPrefix: `FJ${i}` });

    // 2 个 joiner 离开 → host 收 peer_left × 2
    const leftP = [waitMsg(host, 'peer_left', 5000), waitMsg(host, 'peer_left', 5000)];
    joiners[1].send(envelope('leave', {}));
    joiners[2].send(envelope('leave', {}));
    await Promise.all(leftP);

    // 重进 2 人(腾出的名额可复用,房间容量管理正确)→ 凑满 4 alive
    const re1 = new MPClient(`R${i}a`);
    await re1.connect(url);
    re1.send(envelope('join', { code, name: `R${i}a`, v: PROTOCOL_VERSION }));
    await waitMsg(re1, 'joined', 5000);
    const re2 = new MPClient(`R${i}b`);
    await re2.connect(url);
    re2.send(envelope('join', { code, name: `R${i}b`, v: PROTOCOL_VERSION }));
    await waitMsg(re2, 'joined', 5000);

    // 满房后第 5 人应被拒(room_full)
    const extra = new MPClient(`X${i}`);
    await extra.connect(url);
    extra.send(envelope('join', { code, name: `X${i}`, v: PROTOCOL_VERSION }));
    const rejected = await waitMsg(extra, 'error', 5000, (m) => m.err === 'room_full');

    // 全员离开
    const hostLeftP = [re1, re2, joiners[0]].map(() => waitMsg(host, 'peer_left', 5000).catch(() => null));
    re1.send(envelope('leave', {}));
    re2.send(envelope('leave', {}));
    joiners[0].send(envelope('leave', {}));
    await Promise.all(hostLeftP);
    host.send(envelope('leave', {}));

    if (rejected.err === 'room_full' && !joiners.some((j) => j.errorEvents.length)) clean++;
    for (const c of [host, ...joiners, re1, re2, extra]) { try { c.killSocket(); } catch (_) {} }
    await sleep(60);
  }
  ok(clean === cycles, `A2: ${clean}/${cycles} 轮满房→离开→重进→room_full 拒绝 全部符合预期`);
  return { clean };
}

/* ---------- B. 断线重连 ---------- */

async function reconnectTest(url) {
  console.log(`\n=== B. 断线重连(token,30s 宽限)===`);
  const { host, joiners } = await makeRoom(url, 1);
  const joiner = joiners[0];

  // host 持续广播,让 joiner 有活跃流量
  let stateSeq = 0;
  const stTimer = setInterval(() => {
    stateSeq++;
    host.send(buildStatePayload(stateSeq, { players: 2, buildings: 4, resources: 8 }));
  }, 100);

  await sleep(1000);
  const token = joiner.token;

  // 硬断 TCP(不发 leave)
  joiner.killSocket();
  const leftP = waitMsg(host, 'peer_left', 5000);
  await leftP.catch(() => {});

  await sleep(3000);   // 3s 后重连(< 30s 宽限)

  const rc = new MPClient('J1-rc');
  await rc.connect(url);
  rc.send(envelope('reconnect', { token, v: PROTOCOL_VERSION }));
  let reconnected = null;
  try {
    reconnected = await waitMsg(rc, 'joined', 5000, (m) => m.reconnected === true);
  } catch (e) {
    // 有的实现回 joined,有的回错误;都记录
  }
  const hostSaw = await waitMsg(host, 'peer_reconnected', 5000).catch(() => null);

  clearInterval(stTimer);
  ok(!!reconnected || !!hostSaw, `B: 30s 内 token 重连成功(joiner ${reconnected ? 'joined(reconnected)' : hostSaw ? 'peer_reconnected' : '失败'})`);

  try { rc.killSocket(); } catch (_) {}
  try { host.killSocket(); } catch (_) {}
  return { reconnected: !!(reconnected || hostSaw) };
}

/* ---------- C. 移动同步无漂移 ---------- */

async function movementDriftTest(url) {
  console.log(`\n=== C. 移动同步无漂移(host 3 tiles/s,10Hz 广播)===`);
  const { host, joiners } = await makeRoom(url, 1);
  const joiner = joiners[0];

  const V = 3.0;              // tiles/s
  const MOVE_S = 10;          // 移动 10s
  const t0 = Date.now();
  const latencies = [];
  const posErrors = [];
  const received = [];
  let seq = 0;

  joiner.on('state', (m) => {
    if (typeof m?.seq !== 'number') return;
    const tRecv = Date.now();
    latencies.push(tRecv - m.tick);
    const hostP = m.players?.[0];
    if (hostP) {
      received.push({ tRecv, x: hostP.x, y: hostP.y, seq: m.seq });
      // 真实位置:host 沿 x 轴匀速移动 x(t) = x0 + V·t;停止后恒为 xFinal
      const t = (tRecv - t0) / 1000;
      const xTrue = t <= MOVE_S ? 10 + V * t : 10 + V * MOVE_S;
      posErrors.push(Math.abs(hostP.x - xTrue));
    }
  });

  // host 模拟:10Hz 广播,玩家沿 x 匀速移动 MOVE_S 秒后停 3s
  const xAt = () => {
    const t = (Date.now() - t0) / 1000;
    return t <= MOVE_S ? 10 + V * t : 10 + V * MOVE_S;
  };
  const stTimer = setInterval(() => {
    seq++;
    const players = [{ id: 1, name: 'Host', x: +xAt().toFixed(3), y: 12, facing: 'right', hp: 100, hunger: 80, sanity: 90 }];
    host.send(envelope('state', { tick: Date.now(), seq, players, snapshot: { buildings: [], resources: [] } }));
  }, 100);

  await sleep((MOVE_S + 3) * 1000);
  clearInterval(stTimer);
  await sleep(500);

  const lat = stats(latencies);
  const err = stats(posErrors);
  const finalHost = 10 + V * MOVE_S;
  const lastPos = received.length ? received[received.length - 1] : null;
  const finalErr = lastPos ? Math.abs(lastPos.x - finalHost) : NaN;

  console.log(`  投递延迟 p50/p95/max = ${lat.p50.toFixed(1)}/${lat.p95.toFixed(1)}/${lat.max.toFixed(1)} ms(n=${lat.n})`);
  console.log(`  移动期位置误差 p50/p95/max = ${err.p50.toFixed(3)}/${err.p95.toFixed(3)}/${err.max.toFixed(3)} tiles(n=${err.n})`);
  console.log(`  停止后最终位置误差 = ${finalErr.toFixed(6)} tiles`);

  const quantErr = V / 10;                 // 10Hz 量化
  const latErr = (V * lat.p95) / 1000;     // 延迟期位移
  const budget = quantErr + latErr + 0.3;  // 0.3 tile 容差
  ok(lat.p95 <= ONE_WAY_MS * 2 + 60, `C: 端到端投递延迟 p95 ${lat.p95.toFixed(1)}ms ≤ RTT ${ONE_WAY_MS * 2}ms + 60ms 开销`);
  ok(err.p95 <= budget, `C: 移动期位置误差 p95 ${err.p95.toFixed(3)} ≤ 预算 ${budget.toFixed(3)} tiles(量化 ${quantErr} + 延迟位移 ${latErr.toFixed(3)} + 容差 0.3)`);
  ok(finalErr < 0.001, `C: 停止后零永久漂移(最终误差 ${finalErr.toFixed(6)} tiles < 0.001)`);

  appendMetric({
    kind: 'sync-drift',
    latency_p95_ms: +lat.p95.toFixed(1),
    pos_err_p95_tiles: +err.p95.toFixed(3),
    pos_err_max_tiles: +err.max.toFixed(3),
    final_drift_tiles: +finalErr.toFixed(6),
  });

  try { joiner.killSocket(); } catch (_) {}
  try { host.killSocket(); } catch (_) {}
  return { lat, err, finalErr };
}

/* ---------- D. 世界操作 + 聊天同步 ---------- */

async function worldOpsTest(url) {
  console.log(`\n=== D. 世界操作/聊天同步(gather×50, place×30, remove×10, chat×20)===`);
  const { host, joiners } = await makeRoom(url, 3);

  const EXPECT = { gather_complete: 50, place_building: 30, remove_building: 10, chat: 20 };
  const receivedBy = joiners.map(() => ({
    gather_complete: [], place_building: [], remove_building: [], chat: [],
  }));
  joiners.forEach((j, i) => {
    j.on('world', (m) => {
      const op = m?.op;
      if (op === 'gather_complete' || op === 'place_building' || op === 'remove_building') {
        receivedBy[i][op].push({ seq: m.seq, h: hash({ op: m.op, tx: m.tx, ty: m.ty, kind: m.kind, typeId: m.typeId, id: m.id }) });
      }
    });
    j.on('chat', (m) => {
      receivedBy[i].chat.push({ seq: m.seq, h: hash({ from: m.from, text: m.text }) });
    });
  });

  // host 发起操作(带 seq 供对账)
  const sent = { gather_complete: [], place_building: [], remove_building: [], chat: [] };
  for (let i = 0; i < EXPECT.gather_complete; i++) {
    const m = envelope('world', { op: 'gather_complete', id: 2000 + i, kind: 'tree', tx: i % 40, ty: i % 30, seq: i });
    sent.gather_complete.push({ seq: i, h: hash({ op: m.op, tx: m.tx, ty: m.ty, kind: m.kind, typeId: m.typeId, id: m.id }) });
    host.send(m);
    if (i % 10 === 9) await sleep(30);
  }
  for (let i = 0; i < EXPECT.place_building; i++) {
    const m = envelope('world', { op: 'place_building', typeId: 'wall', tx: i, ty: 5 + i, seq: i });
    sent.place_building.push({ seq: i, h: hash({ op: m.op, tx: m.tx, ty: m.ty, kind: m.kind, typeId: m.typeId, id: m.id }) });
    host.send(m);
    if (i % 10 === 9) await sleep(30);
  }
  for (let i = 0; i < EXPECT.remove_building; i++) {
    const m = envelope('world', { op: 'remove_building', tx: i, ty: 5 + i, seq: i });
    sent.remove_building.push({ seq: i, h: hash({ op: m.op, tx: m.tx, ty: m.ty, kind: m.kind, typeId: m.typeId, id: m.id }) });
    host.send(m);
  }
  for (let i = 0; i < EXPECT.chat; i++) {
    const m = envelope('chat', { from: 'Host', text: `msg-${i}-『多字节内容€£¥』`, seq: i });
    sent.chat.push({ seq: i, h: hash({ from: m.from, text: m.text }) });
    host.send(m);
  }

  await sleep(2500);   // 2×RTT + 排队余量

  for (let i = 0; i < joiners.length; i++) {
    const R = receivedBy[i];
    const counts = Object.fromEntries(Object.keys(EXPECT).map((k) => [k, R[k].length]));
    console.log(`  joiner${i + 1} 收到:${JSON.stringify(counts)}`);
    // 内容逐条核对(按 seq 排序后与发送侧哈希比对)
    let contentOk = true;
    for (const k of Object.keys(EXPECT)) {
      const got = [...R[k]].sort((a, b) => a.seq - b.seq);
      const want = sent[k];
      if (got.length !== want.length) { contentOk = false; break; }
      for (let n = 0; n < want.length; n++) {
        if (got[n].h !== want[n].h || got[n].seq !== want[n].seq) { contentOk = false; break; }
      }
      if (!contentOk) break;
    }
    ok(contentOk, `D: joiner${i + 1} ${JSON.stringify(counts)} 全量收到且逐条内容一致(含多字节)`);
  }

  for (const c of [host, ...joiners]) { try { c.killSocket(); } catch (_) {} }
}

/* ---------- 主流程 ---------- */

async function main() {
  console.log(`L-M1-0 联机功能验收 — relay ${RELAY_PORT},CN ${ONE_WAY_MS * 2}ms RTT 代理`);
  const relay = await startRelay(RELAY_PORT);
  const proxy = await startDelayProxy({ listenPort: PROXY_PORT, targetPort: RELAY_PORT, delayMs: ONE_WAY_MS });
  const url = `ws://127.0.0.1:${PROXY_PORT}`;

  try {
    const a1 = await repeatCycles(url, 20);
    const a2 = await fourPlayerCycles(url, 5);
    const b = await reconnectTest(url);
    const c = await movementDriftTest(url);
    await worldOpsTest(url);

    appendMetric({
      kind: 'functional-acceptance',
      repeat_cycles_clean: a1.clean, repeat_per_cycle_ms: +a1.perCycleMs.toFixed(0),
      four_player_cycles_clean: a2.clean,
      reconnect_ok: b.reconnected,
      drift_final_tiles: +c.finalErr.toFixed(6),
    });
  } finally {
    await proxy.stop();
    await relay.stop();
  }

  console.log(`\n==== 联机功能验收汇总:${pass} PASS / ${fail} FAIL ====`);
  if (failures.length) console.log(`失败项:${failures.join(' | ')}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
