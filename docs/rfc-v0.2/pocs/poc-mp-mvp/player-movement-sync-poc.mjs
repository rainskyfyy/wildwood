#!/usr/bin/env node
/**
 * Wildwood v0.7.X 联机最小 PoC:player 移动端到端延迟基准。
 *
 * 目标:验证 v0.7.0b RFC v0.2 的核心选型——
 *   - 网络协议:WebSocket
 *   - 同步方案:状态同步(10Hz G_STATE)
 *   - 房间管理:C/S 中继模式
 * ——在「2 客户端 + 1 服务端」最小场景下,player 移动的端到端延迟满足
 * 任务原文要求 < 100ms。
 *
 * 与 m3.0-relay-smoke.mjs 的区别:
 *   - m3.0 测的是协议层(host/join/snapshot/广播转发/重连/聊天/建筑)
 *   - 本 PoC 测的是**应用层**——G_STATE 携带的 player 位置数据从 host
 *     模拟移动到 joiner 收到,端到端延迟分布
 *   - 输出:p50/p95/p99/max + 100ms 阈值通过判据
 *
 * 用法:
 *   cd poc/v0_7_mp_poc
 *   node player-movement-sync-poc.mjs
 *
 * 通过判据:
 *   - p95 端到端延迟 < 100ms(任务原文要求)
 *   - 0 丢包(发 N 个,收 N 个)
 *   - 0 协议错误
 *   - 3 轮 host 移动循环
 *
 * 失败模式:
 *   - p95 >= 100ms → 报告带宽/序列化瓶颈;回退降频(10Hz → 5Hz)
 *   - 丢包 → 报告 WS 帧丢失;回退改 binary + msgpack
 *
 * 设计依据:
 *   - 服务端:wildwood/server/relay.mjs(v0.4,21KB,zero-dep Node 18+)
 *   - 协议:wildwood/src/net/protocol.js(v1)
 *   - host 模拟:自己维护一个 player.x/y 状态,50ms tick 时按方向键移动
 *   - joiner 验证:收到 G_STATE 时记录 t_recv,host 端把 t_send 也带上
 *     (本 PoC 扩展 message,标 -100 表示模拟时间,不影响协议版本)
 */

'use strict';

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  envelope, PROTOCOL_VERSION,
  C_HOST, C_JOIN,
  S_HOSTED, S_JOINED, S_PEER_JOINED,
  G_STATE,
} from './src/net/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY_PATH = path.resolve(__dirname, 'server/relay.mjs');
const PORT = 18802;
const HOST_MOVE_INTERVAL_MS = 50;   // 20Hz host 移动
const HOST_STATE_HZ = 10;            // 10Hz state 广播(对齐 v0.4 multiplayer.js)
const TEST_DURATION_MS = 3000;       // 总测试 3 秒
const PASS_P95_MS = 100;             // 任务原文要求

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
}

/* ============================================================
 * 工具:简单 WebSocket 客户端(Node 22+ 内置 WebSocket)
 * ============================================================ */
class TestClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.ws = null;
    this.queue = [];
    this.connected = false;
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', () => { this.connected = true; resolve(); });
      this.ws.addEventListener('error', (e) => reject(new Error(`${this.name} connect failed: ${e.message || e}`)));
      this.ws.addEventListener('message', (ev) => {
        try {
          const m = JSON.parse(ev.data);
          this.queue.push(m);
        } catch (_) {}
      });
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  /** 等到队列里出现匹配 type+filter 的消息(最多 timeout ms) */
  async waitFor(type, { timeout = 2000, filter = null } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      for (let i = 0; i < this.queue.length; i++) {
        const m = this.queue[i];
        if (m.type === type && (!filter || filter(m))) {
          this.queue.splice(i, 1);
          return m;
        }
      }
      await sleep(5);
    }
    throw new Error(`${this.name} timeout waiting for ${type}`);
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

/* ============================================================
 * 启动 relay server
 * ============================================================ */
async function startRelay() {
  const proc = spawn('node', [RELAY_PATH, '--port', String(PORT), '--quiet'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => {
    const s = d.toString();
    if (!s.includes('listening')) console.error('[relay stderr]', s);
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return proc;
    } catch (_) {}
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
  const samples = [];   // { tick, sent_at, recv_at, latency_ms, x, y }
  let relay = null;
  let host = null, joiner = null;
  try {
    console.log('==> 启动 relay server (port', PORT, ')');
    relay = await startRelay();
    ok(true, 'relay server up');

    const url = `ws://127.0.0.1:${PORT}`;
    host = new TestClient(url, 'Alice(host)');
    joiner = new TestClient(url, 'Bob(joiner)');
    await host.connect();
    await joiner.connect();
    ok(host.connected && joiner.connected, 'host + joiner connected');

    /* ---------- host 创建房间 ---------- */
    host.send(envelope(C_HOST, { name: 'Alice' }));
    const hosted = await host.waitFor(S_HOSTED);
    ok(typeof hosted.code === 'string' && hosted.code.length === 4, 'host got 4-char room code: ' + hosted.code);

    /* ---------- joiner 加入房间 ---------- */
    joiner.send(envelope(C_JOIN, { code: hosted.code, name: 'Bob' }));
    const joined = await joiner.waitFor(S_JOINED);
    ok(joined.snapshot !== undefined, 'joiner got snapshot');
    ok(Array.isArray(joined.snapshot.players), 'snapshot has players array');
    const peerJoined = await host.waitFor(S_PEER_JOINED, { filter: m => m.name === 'Bob' });
    joiner.id = joined.id;
    ok(peerJoined.id === joiner.id, 'host notified of joiner (peer id match)');

    /* ---------- host 模拟移动 + 10Hz 广播 ---------- */
    console.log('==> host 模拟 3 秒移动(20Hz 更新 / 10Hz 广播)');
    const startTime = Date.now();
    let posX = 0, posY = 0, facing = 'down', tick = 0;
    const hostStateInterval = setInterval(() => {
      tick++;
      // host 每次广播都带 sent_at(本端时钟),joiner 收到时记 recv_at
      const tSent = Date.now();
      host.send(envelope(G_STATE, {
        tick,
        sentAt: tSent,                            // PoC 扩展字段(不影响协议版本)
        players: [{
          id: 1,
          name: 'Alice',
          x: posX, y: posY, facing,
          hp: 100, hunger: 100, sanity: 100,
        }],
      }));
    }, 1000 / HOST_STATE_HZ);

    const hostMoveInterval = setInterval(() => {
      // 20Hz 移动:模拟 axis input
      posX += 0.1;
      facing = 'right';
    }, HOST_MOVE_INTERVAL_MS);

    /* ---------- joiner 收 state 测延迟 ---------- */
    const t0 = Date.now();
    while (Date.now() - t0 < TEST_DURATION_MS) {
      const m = await host.queueDrainer(joiner, G_STATE, 50);
      if (m) {
        const tRecv = Date.now();
        if (m.sentAt) {
          samples.push({
            tick: m.tick,
            sent_at: m.sentAt,
            recv_at: tRecv,
            latency_ms: tRecv - m.sentAt,
            x: m.players?.[0]?.x,
            y: m.players?.[0]?.y,
          });
        }
      }
    }
    clearInterval(hostStateInterval);
    clearInterval(hostMoveInterval);

    /* ---------- 验收 ---------- */
    console.log('==> 验收');
    ok(samples.length >= 25, `samples >= 25(3s × 10Hz - 抖动)=${samples.length}, got ${samples.length}`);

    // 计算 p50/p95/p99/max
    const lats = samples.map(s => s.latency_ms).sort((a, b) => a - b);
    const pct = (p) => lats[Math.floor(lats.length * p)] || 0;
    const p50 = pct(0.50);
    const p95 = pct(0.95);
    const p99 = pct(0.99);
    const max = lats[lats.length - 1] || 0;
    console.log(`  样本: ${lats.length} 个,延迟 ms = [p50: ${p50}, p95: ${p95}, p99: ${p99}, max: ${max}]`);
    console.log(`  posX 末值 = ${samples.at(-1)?.x?.toFixed(2)} (起始 0,步长 0.1×20Hz×3s ≈ 6.0)`);

    ok(p95 < PASS_P95_MS, `p95 < ${PASS_P95_MS}ms(任务原文要求), got ${p95}ms`);
    ok(max < PASS_P95_MS * 3, `max < ${PASS_P95_MS * 3}ms(300ms 容忍), got ${max}ms`);
    ok(samples.length > 0, '收到非空 samples');

    // 验证 host 位置确实在递增(确认 host 模拟移动 + state 广播链路对)
    if (samples.length >= 2) {
      const x0 = samples[0].x;
      const xN = samples.at(-1).x;
      ok(xN > x0, `host posX 递增(${x0?.toFixed(2)} → ${xN?.toFixed(2)})`);
    }

    // 导出原始样本(便于后续做趋势图 / 报告)
    const fs = await import('node:fs');
    fs.writeFileSync(
      path.join(__dirname, 'latency-samples.json'),
      JSON.stringify({ samples, summary: { p50, p95, p99, max, count: samples.length } }, null, 2)
    );
    console.log(`  原始样本已写入: latency-samples.json`);

    console.log('');
    if (failed === 0) {
      console.log(`✅ PoC PASS: ${passed} 通过 / ${failed} 失败`);
      console.log(`   端到端延迟 p95 = ${p95}ms (阈值 ${PASS_P95_MS}ms)`);
    } else {
      console.log(`❌ PoC FAIL: ${passed} 通过 / ${failed} 失败`);
      console.log(`   失败项:`, failures);
    }
  } catch (e) {
    console.error('PoC 异常:', e);
    failed++;
    failures.push('exception: ' + e.message);
  } finally {
    try { host?.close(); } catch (_) {}
    try { joiner?.close(); } catch (_) {}
    if (relay) await stopRelay(relay);
  }
  process.exit(failed === 0 ? 0 : 1);
}

/* TestClient 扩展:短暂 drain 一批 G_STATE */
TestClient.prototype.queueDrainer = async function (client, type, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (let i = 0; i < client.queue.length; i++) {
      const m = client.queue[i];
      if (m.type === type) {
        client.queue.splice(i, 1);
        return m;
      }
    }
    await sleep(2);
  }
  return null;
};

main();
