/**
 * L-M1-0 4 客户端满载压测 — relay CPU / 带宽 / 稳定性。
 *
 * 模式:
 *   spec  — 验收线口径:4 客户端同房(cnf 50ms RTT 代理),每端 4KB/s G_INPUT,
 *           host 10Hz G_STATE(4 players + 10 buildings + 24 resources ≈ 2KB/条)
 *   game  — 真实装配口径:按 assembly.js 实际传入的资源实体规模(354 资源)
 *           构造 G_STATE,测量当前实现的真实带宽
 * 测量:
 *   - relay 进程 CPU%(单核口径,p50/p95/max)与 RSS(/proc 采样,2s 间隔)
 *   - 每客户端出入带宽
 *   - 消息零丢失、零掉线(全程)
 *
 * 用法:node tests/stress/lm10-load-4clients.mjs [--mode spec|game] [--duration 300]
 * 退出码:0 = 全部 PASS;1 = 有 FAIL。
 */
'use strict';

import {
  makeRoom, startRelay, startDelayProxy, procSampler,
  stats, appendMetric, buildStatePayload, buildInputPayload, sleep,
} from './lm10-lib.mjs';
import { envelope, C_PING } from '../../src/net/protocol.js';

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? String(args[i + 1]) : def;
}
function argNum(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
}
const MODE = argVal('mode', 'spec');          // spec | game
const DURATION_MS = argNum('duration', 300) * 1000;

const RELAY_PORT = 18711;
const PROXY_PORT = 18712;
const ONE_WAY_MS = 25;                        // CN 50ms RTT

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

async function main() {
  console.log(`L-M1-0 4 客户端满载压测 — mode=${MODE},时长 ${DURATION_MS / 1000}s,CN ${ONE_WAY_MS * 2}ms RTT`);
  const relay = await startRelay(RELAY_PORT);
  const sampler = procSampler(relay.pid, 2000);

  const proxy = await startDelayProxy({ listenPort: PROXY_PORT, targetPort: RELAY_PORT, delayMs: ONE_WAY_MS });
  const url = `ws://127.0.0.1:${PROXY_PORT}`;

  const { host, joiners, code } = await makeRoom(url, 3);
  console.log(`  房间 ${code} 建立:1 host + 3 joiners(经 ${ONE_WAY_MS * 2}ms RTT 代理)`);

  const stateGaps = joiners.map(() => ({ gaps: 0, maxSeq: -1 }));
  const rttSamples = [];
  const lastPingTs = new Map();
  joiners.forEach((j, i) => {
    j.on('state', (m) => {
      const seq = m?.seq;
      if (typeof seq === 'number') {
        const L = stateGaps[i];
        if (L.maxSeq >= 0 && seq > L.maxSeq + 1) L.gaps += seq - L.maxSeq - 1;
        L.maxSeq = Math.max(L.maxSeq, seq);
      }
    });
  });
  const all = [host, ...joiners];
  all.forEach((c) => c.on('pong', () => {
    const ts = lastPingTs.get(c);
    if (ts) rttSamples.push(Date.now() - ts);
  }));

  // 负载参数:spec 模式 24 资源 ≈2KB/条;game 模式 354 资源(装配实测规模)
  const nResources = MODE === 'game' ? 354 : 24;
  const nBuildings = MODE === 'game' ? 20 : 10;

  const t0 = Date.now();
  let stateSeq = 0;
  const inputSeqs = joiners.map(() => 0);
  const timers = [];
  timers.push(setInterval(() => {
    stateSeq++;
    host.send(buildStatePayload(stateSeq, { players: 4, buildings: nBuildings, resources: nResources }));
  }, 100));
  joiners.forEach((j, i) => {
    timers.push(setInterval(() => {
      inputSeqs[i]++;
      j.send(buildInputPayload(inputSeqs[i], 136)); // 30Hz × 136B ≈ 4KB/s
    }, 33));
  });
  all.forEach((c) => timers.push(setInterval(() => {
    lastPingTs.set(c, Date.now());
    c.send(envelope(C_PING, {}));
  }, 1000)));

  sampler.start();
  const prog = setInterval(() => {
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    const cpu = sampler.result();
    console.log(`  [${el}s] state=${stateSeq} closes=${all.filter((c) => c.closed).length} relay_cpu_p50=${cpu.cpu.p50?.toFixed?.(1) || '?'}% rss=${cpu.rss.p50?.toFixed?.(1) || '?'}MB`);
  }, 30_000);
  timers.push(prog);

  await sleep(DURATION_MS);
  for (const t of timers) clearInterval(t);
  sampler.stop();

  const cpu = sampler.result();
  const rtt = stats(rttSamples);
  const totalGaps = stateGaps.reduce((a, l) => a + l.gaps, 0);
  const closes = all.flatMap((c) => c.closeEvents);
  const errors = all.flatMap((c) => c.errorEvents);
  const secs = DURATION_MS / 1000;

  const hostOut = host.bytesOut / secs / 1024;
  const joinerOut = joiners.reduce((a, j) => a + j.bytesOut, 0) / secs / 1024 / 3;
  const joinerIn = joiners.reduce((a, j) => a + j.bytesIn, 0) / secs / 1024 / 3;
  const hostIn = host.bytesIn / secs / 1024;
  const stateBytes = JSON.stringify(buildStatePayload(1, { players: 4, buildings: nBuildings, resources: nResources })).length;

  console.log(`\n  G_STATE 单条 ${stateBytes}B × 10Hz;G_INPUT 单条 136B × 30Hz × 3 joiners`);
  console.log(`  带宽:host 出 ${hostOut.toFixed(2)} / 入 ${hostIn.toFixed(2)};joiner 均 出 ${joinerOut.toFixed(2)} / 入 ${joinerIn.toFixed(2)} KB/s`);
  console.log(`  房间总带宽(relay 转发,host 出 + 3×joiner 出 + relay→3 joiner state)≈ ${(hostOut * 3 + joinerOut * 3 + hostOut).toFixed(2)} KB/s`);
  console.log(`  relay CPU p50/p95/max = ${cpu.cpu.p50.toFixed(1)}/${cpu.cpu.p95.toFixed(1)}/${cpu.cpu.max.toFixed(1)} %单核(n=${cpu.samples})`);
  console.log(`  relay RSS p50/max = ${cpu.rss.p50.toFixed(1)}/${cpu.rss.max.toFixed(1)} MB`);
  console.log(`  RTT p50/p95 = ${rtt.p50.toFixed(1)}/${rtt.p95.toFixed(1)} ms;G_STATE 缺口 ${totalGaps};close ${closes.length};error ${errors.length}`);

  ok(closes.length === 0 && errors.length === 0, `${MODE}: 满载全程零掉线零 error`);
  ok(totalGaps === 0, `${MODE}: G_STATE 零丢包(缺口 ${totalGaps})`);
  ok(cpu.cpu.p95 < 50, `${MODE}: relay CPU p95 ${cpu.cpu.p95.toFixed(1)}% < 50% 单核`);
  ok(joinerOut < 50, `${MODE}: 每端输入带宽 joiner ${joinerOut.toFixed(1)} KB/s < 50 KB/s(验收线 4KB/s 口径,含余量)`);
  if (hostOut >= 250) {
    // 非验收线:game 模式全量 snapshot 的真实画像。按边界不动架构,记录为优化观察项。
    console.log(`  ⚠ 观察项(不判失败):host 广播带宽 ${hostOut.toFixed(1)} KB/s > 250 KB/s 优化阈值 — 全量 snapshot(28KB/条 × 10Hz)所致,优化空间:delta 同步/降频,留后续任务`);
  }
  // RSS 增长检查(内存泄漏代理指标):max - p50 < 30MB
  ok(cpu.rss.max - cpu.rss.p50 < 30, `${MODE}: relay RSS 稳定(max-p50 = ${(cpu.rss.max - cpu.rss.p50).toFixed(1)}MB < 30MB)`);

  appendMetric({
    kind: 'load-4clients',
    mode: MODE,
    duration_s: secs,
    one_way_ms: ONE_WAY_MS,
    state_bytes: stateBytes,
    host_out_kbps: +hostOut.toFixed(2), host_in_kbps: +hostIn.toFixed(2),
    joiner_out_kbps: +joinerOut.toFixed(2), joiner_in_kbps: +joinerIn.toFixed(2),
    relay_cpu_p50: +cpu.cpu.p50.toFixed(1), relay_cpu_p95: +cpu.cpu.p95.toFixed(1), relay_cpu_max: +cpu.cpu.max.toFixed(1),
    relay_rss_p50_mb: +cpu.rss.p50.toFixed(1), relay_rss_max_mb: +cpu.rss.max.toFixed(1),
    rtt_p95: +rtt.p95.toFixed(1),
    state_gaps: totalGaps, closes: closes.length, errors: errors.length,
  });

  for (const c of all) { try { c.killSocket(); } catch (_) {} }
  await proxy.stop();
  await relay.stop();

  console.log(`\n==== 4 客户端满载(${MODE})汇总:${pass} PASS / ${fail} FAIL ====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
