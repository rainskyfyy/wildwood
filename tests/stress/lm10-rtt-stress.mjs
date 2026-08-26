/**
 * L-M1-0 RTT 压测 — 模拟公网延迟下的 relay 协议稳定性。
 *
 * 场景(单向延迟 × 2 ≈ RTT):
 *   loopback 0ms / cn-30 / cn-50 / intl-100 / intl-200
 * 每场景:1 host + 3 joiners 满房,持续 60s:
 *   - host 以 10Hz 广播 G_STATE(带 seq + tick)
 *   - 每个 joiner 以 30Hz 发 G_INPUT(~136B → ≈4KB/s)
 *   - 所有客户端 1Hz C_PING 测 RTT(客户端侧记发出时刻,pong 到达即 RTT;
 *     ping 周期 1s 远大于 RTT,最近一次 ping 即为对应请求)
 * 验收线:
 *   - 不掉线:全程 0 次非预期 close / kicked / error
 *   - 不丢包:每个 joiner 收到的 G_STATE seq 零缺口
 *   - RTT p95 落在注入延迟 + 60ms 开销内
 *
 * 用法:node tests/stress/lm10-rtt-stress.mjs [--duration 60]
 * 退出码:0 = 全部 PASS;1 = 有 FAIL。
 */
'use strict';

import {
  makeRoom, startRelay, startDelayProxy,
  stats, appendMetric, buildStatePayload, buildInputPayload, sleep,
} from './lm10-lib.mjs';
import { envelope, C_PING } from '../../src/net/protocol.js';

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
}
const DURATION_MS = argVal('duration', 60) * 1000;

const SCENARIOS = [
  { id: 'loopback', oneWayMs: 0 },
  { id: 'cn-30',   oneWayMs: 15 },
  { id: 'cn-50',   oneWayMs: 25 },
  { id: 'intl-100', oneWayMs: 50 },
  { id: 'intl-200', oneWayMs: 100 },
];

const RELAY_PORT = 18701;
const PROXY_PORT = 18702;

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

async function runScenario(sc, relay, url) {
  console.log(`\n=== 场景 ${sc.id}(单向 ${sc.oneWayMs}ms,RTT≈${sc.oneWayMs * 2}ms,时长 ${DURATION_MS / 1000}s)===`);

  let proxy = null;
  let targetUrl = url;
  if (sc.oneWayMs > 0) {
    proxy = await startDelayProxy({ listenPort: PROXY_PORT, targetPort: RELAY_PORT, delayMs: sc.oneWayMs });
    targetUrl = `ws://127.0.0.1:${PROXY_PORT}`;
  }

  const { host, joiners, code } = await makeRoom(targetUrl, 3);
  console.log(`  房间 ${code} 建立:1 host + 3 joiners`);

  // 测量容器
  const rttSamples = [];          // C_PING → S_PONG(客户端侧记最近 ping 发出时刻)
  const stateLatencies = [];      // host tick → joiner 收到(单向)
  const lossByJoiner = joiners.map(() => ({ received: 0, gaps: 0, maxSeq: -1 }));
  const inputAcks = { received: 0, gaps: 0, maxSeq: -1 };  // host 侧收 joiner input
  const lastPingTs = new Map();   // client → 最近 ping 发出时刻

  host.on('input', (m) => {
    const seq = m?.seq;
    if (typeof seq === 'number') {
      if (inputAcks.maxSeq >= 0 && seq > inputAcks.maxSeq + 1) inputAcks.gaps += seq - inputAcks.maxSeq - 1;
      inputAcks.maxSeq = Math.max(inputAcks.maxSeq, seq);
      inputAcks.received++;
    }
  });
  joiners.forEach((j, i) => {
    j.on('state', (m) => {
      const seq = m?.seq;
      if (typeof seq === 'number') {
        const L = lossByJoiner[i];
        if (L.maxSeq >= 0 && seq > L.maxSeq + 1) L.gaps += seq - L.maxSeq - 1;
        L.maxSeq = Math.max(L.maxSeq, seq);
        L.received++;
        if (m.tick) stateLatencies.push(Date.now() - m.tick);
      }
    });
  });
  const all = [host, ...joiners];
  all.forEach((c) => {
    c.on('pong', () => {
      const ts = lastPingTs.get(c);
      if (ts) rttSamples.push(Date.now() - ts);
    });
  });

  // 流量发生器
  const t0 = Date.now();
  let stateSeq = 0;
  const inputSeqs = joiners.map(() => 0);
  const timers = [];

  timers.push(setInterval(() => { // host 10Hz G_STATE
    stateSeq++;
    host.send(buildStatePayload(stateSeq));
  }, 100));
  joiners.forEach((j, i) => {
    timers.push(setInterval(() => { // joiner 30Hz G_INPUT ≈ 4KB/s
      inputSeqs[i]++;
      j.send(buildInputPayload(inputSeqs[i]));
    }, 33));
  });
  all.forEach((c) => {
    timers.push(setInterval(() => { // 1Hz ping
      lastPingTs.set(c, Date.now());
      c.send(envelope(C_PING, {}));
    }, 1000));
  });

  // 进度心跳
  const prog = setInterval(() => {
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`  [${el}s] state=${stateSeq} rtt_n=${rttSamples.length} closes=${all.filter((c) => c.closed).length}`);
  }, 15_000);
  timers.push(prog);

  await sleep(DURATION_MS);
  for (const t of timers) clearInterval(t);

  // 统计
  const rtt = stats(rttSamples);
  const e2e = stats(stateLatencies);   // tick→joiner 收到:经代理两次,≈端到端 RTT 口径
  const totalGaps = lossByJoiner.reduce((a, l) => a + l.gaps, 0);
  const closes = all.flatMap((c) => c.closeEvents);
  const errors = all.flatMap((c) => c.errorEvents);
  const expectedRtt = sc.oneWayMs * 2;

  const hostKbps = host.bytesOut / (DURATION_MS / 1000) / 1024;
  const joinerKbps = joiners.reduce((a, j) => a + j.bytesOut, 0) / (DURATION_MS / 1000) / 1024 / joiners.length;
  const joinerInKbps = joiners.reduce((a, j) => a + j.bytesIn, 0) / (DURATION_MS / 1000) / 1024 / joiners.length;

  console.log(`  RTT p50/p95/p99/max = ${rtt.p50.toFixed(1)}/${rtt.p95.toFixed(1)}/${rtt.p99.toFixed(1)}/${rtt.max.toFixed(1)} ms(n=${rtt.n})`);
  console.log(`  端到端 state 投递 p50/p95/max = ${e2e.p50.toFixed(1)}/${e2e.p95.toFixed(1)}/${e2e.max.toFixed(1)} ms(n=${e2e.n})`);
  console.log(`  G_STATE seq 缺口 = ${totalGaps};G_INPUT seq 缺口(host 侧)= ${inputAcks.gaps}`);
  console.log(`  close 事件 = ${closes.length};error 事件 = ${errors.length}`);
  console.log(`  带宽:host 出 ${hostKbps.toFixed(2)} KB/s,joiner 出 ${joinerKbps.toFixed(2)} KB/s,joiner 入 ${joinerInKbps.toFixed(2)} KB/s`);

  ok(closes.length === 0, `${sc.id}: 全程零掉线(${closes.length} 次 close)`);
  ok(errors.length === 0, `${sc.id}: 零 error 事件`);
  ok(totalGaps === 0, `${sc.id}: G_STATE 零丢包(缺口 ${totalGaps})`);
  ok(inputAcks.gaps === 0, `${sc.id}: G_INPUT 零丢包(缺口 ${inputAcks.gaps})`);
  const rttBudget = expectedRtt + 60;
  ok(rtt.p95 <= rttBudget, `${sc.id}: RTT p95 ${rtt.p95.toFixed(1)}ms ≤ 注入 RTT ${expectedRtt}ms + 60ms 开销 = ${rttBudget}ms`);
  ok(e2e.p95 <= expectedRtt + 60, `${sc.id}: 端到端 state 投递 p95 ${e2e.p95.toFixed(1)}ms ≤ RTT ${expectedRtt}ms + 60ms 开销`);

  appendMetric({
    kind: 'rtt-stress',
    scenario: sc.id,
    one_way_ms: sc.oneWayMs,
    duration_s: DURATION_MS / 1000,
    rtt_p50: +rtt.p50.toFixed(1), rtt_p95: +rtt.p95.toFixed(1), rtt_p99: +rtt.p99.toFixed(1), rtt_max: +rtt.max.toFixed(1),
    owd_p50: +e2e.p50.toFixed(1), owd_p95: +e2e.p95.toFixed(1),
    state_gaps: totalGaps, input_gaps: inputAcks.gaps,
    closes: closes.length, errors: errors.length,
    host_out_kbps: +hostKbps.toFixed(2), joiner_out_kbps: +joinerKbps.toFixed(2), joiner_in_kbps: +joinerInKbps.toFixed(2),
  });

  // 清理连接
  for (const c of all) { try { c.killSocket(); } catch (_) {} }
  await sleep(300);
  if (proxy) await proxy.stop();
}

async function main() {
  console.log(`L-M1-0 RTT 压测 — relay 端口 ${RELAY_PORT},场景时长 ${DURATION_MS / 1000}s`);
  const relay = await startRelay(RELAY_PORT);
  const url = `ws://127.0.0.1:${RELAY_PORT}`;
  try {
    for (const sc of SCENARIOS) {
      await runScenario(sc, relay, url);
    }
  } finally {
    await relay.stop();
  }
  console.log(`\n==== RTT 压测汇总:${pass} PASS / ${fail} FAIL ====`);
  console.log('metrics 已追加:metrics/mp_assembly_integration.jsonl');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
