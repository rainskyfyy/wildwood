/**
 * L-M1-0 压测共享库 — relay 进程管理 + TCP 延迟代理 + 测量工具。
 *
 * 用途:v0.8.18 L-M1-0 联机 PoC 压测(RTT / 4 客户端满载 / 同步验收)。
 *
 * 设计要点:
 *   - startRelay():spawn server/relay.mjs(零依赖 Node 18+)
 *   - startDelayProxy():TCP 层单向前向代理,每个 chunk 延迟 delayMs 毫秒转发,
 *     两个方向各自延迟 → 模拟公网 RTT ≈ 2 × delayMs(不引入丢包,只加延迟)
 *   - MPClient:原生 WebSocket 客户端封装(计数器 + waiter 注册 + token 捕获),
 *     与 tests/m3.0-relay-smoke.mjs 的 TestClient 同型,但带带宽/消息计数
 *   - 线格式与 RelayClient.sendState/sendInput 严格一致:
 *       G_STATE 顶层 {tick, players, snapshot} / G_INPUT 顶层 {ax, ay}
 *     (relay 的 handleGameMessage 读顶层 msg.players/msg.snapshot,
 *      嵌套写法不会更新 lastStateAt,2 分钟后会触发 host_silent 销房)
 *   - percentile()/stats():p50/p95/p99/max/avg
 *   - procSampler():/proc 采样进程 CPU%(单核口径)与 RSS
 *   - appendMetric():按仓库 metrics 规范 append-only 写 jsonl
 *     (source + schema_version 必填)
 */
'use strict';

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { envelope, PROTOCOL_VERSION } from '../../src/net/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
export const RELAY_PATH = path.resolve(REPO_ROOT, 'server/relay.mjs');
export const METRICS_PATH = path.resolve(REPO_ROOT, 'metrics', 'mp_assembly_integration.jsonl');

/* ---------- relay 进程 ---------- */

export async function startRelay(port, { tag = 'relay' } = {}) {
  const child = spawn(process.execPath, [RELAY_PATH], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[${tag}] ${d}`));
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`relay exited early code=${child.exitCode}`);
    if (await portOpen(port)) break;
    if (Date.now() - t0 > 10_000) throw new Error('relay port never opened');
    await sleep(100);
  }
  return {
    child,
    pid: child.pid,
    async stop() {
      child.kill('SIGTERM');
      await Promise.race([sleep(1500), new Promise((r) => child.on('exit', r))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

/* ---------- TCP 延迟代理(模拟公网 RTT)---------- */

/**
 * 启动 TCP 延迟代理:listenPort → targetPort。
 * 每个方向的每个 chunk 延迟 delayMs 后转发。同 delay 的定时器按注册序触发,
 * 消息顺序不变。RTT ≈ 2 × delayMs + 处理开销。
 */
export async function startDelayProxy({ listenPort, targetPort, delayMs }) {
  const sockets = [];
  const server = net.createServer((clientSock) => {
    const serverSock = net.connect(targetPort, '127.0.0.1');
    sockets.push(clientSock, serverSock);
    const delayedPipe = (from, to) => {
      from.on('data', (chunk) => {
        if (delayMs <= 0) { if (!to.destroyed) to.write(chunk); return; }
        setTimeout(() => { if (!to.destroyed) to.write(chunk); }, delayMs);
      });
    };
    delayedPipe(clientSock, serverSock);
    delayedPipe(serverSock, clientSock);
    clientSock.on('error', () => {});
    serverSock.on('error', () => {});
    clientSock.on('close', () => serverSock.destroy());
    serverSock.on('close', () => clientSock.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', resolve);
  });
  return {
    server,
    async stop() {
      for (const s of sockets) if (!s.destroyed) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

/* ---------- 压测客户端 ---------- */

export class MPClient {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.bytesOut = 0;
    this.bytesIn = 0;
    this.msgsIn = 0;
    this.closeEvents = [];   // { code, reason, wasClean, t }
    this.errorEvents = [];
    this.errorMsgs = [];     // S_ERROR 控制层错误
    this.handlers = new Map();
    this.token = null;
    this.id = null;
    this.code = null;
  }

  async connect(url) {
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', (e) => reject(new Error(`${this.name} connect failed: ${e.message || e}`)));
    });
    this.ws.addEventListener('message', (ev) => {
      this.bytesIn += ev.data.length;
      this.msgsIn++;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'joined' && m.token) { this.token = m.token; this.id = m.id; this.code = m.code; }
      if (m.type === 'hosted' && m.token) { this.token = m.token; this.id = m.id; this.code = m.code; }
      if (m.type === 'error') this.errorMsgs.push(m);
      const hs = this.handlers.get(m.type);
      if (hs) for (const h of hs) h(m, ev.data.length);
    });
    this.ws.addEventListener('close', (ev) => {
      this.closeEvents.push({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean, t: Date.now() });
    });
    this.ws.addEventListener('error', (e) => {
      this.errorEvents.push(String(e?.message || e));
    });
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  send(obj) {
    const raw = JSON.stringify(obj);
    this.bytesOut += raw.length;
    this.ws.send(raw);
  }

  /** 硬断 TCP(不发 leave),模拟网络中断。 */
  killSocket() {
    if (this.ws) {
      try { this.ws._socket?.destroy(); } catch (_) { /* ignore */ }
      try { this.ws.close(); } catch (_) { /* ignore */ }
    }
  }

  get closed() { return this.closeEvents.length > 0; }
}

/** host + N joiners 全流程入房,返回 { host, joiners, code } */
export async function makeRoom(url, nJoiners, { hostName = 'Host', joinerPrefix = 'J' } = {}) {
  const host = new MPClient(hostName);
  await host.connect(url);
  host.send(envelope('host', { name: hostName }));
  const hosted = await waitMsg(host, 'hosted', 5000);
  const code = hosted.code;

  const joiners = [];
  for (let i = 0; i < nJoiners; i++) {
    const j = new MPClient(`${joinerPrefix}${i + 1}`);
    await j.connect(url);
    j.send(envelope('join', { code, name: `${joinerPrefix}${i + 1}` }));
    await waitMsg(j, 'joined', 5000);
    joiners.push(j);
  }
  return { host, joiners, code };
}

/** 等待一条指定类型消息(带超时)。 */
export function waitMsg(client, type, timeoutMs, filter = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting '${type}' for ${client.name}`));
    }, timeoutMs);
    const h = (m) => {
      if (filter && !filter(m)) return;
      cleanup();
      resolve(m);
    };
    const cleanup = () => {
      clearTimeout(timer);
      const hs = client.handlers.get(type) || [];
      const i = hs.indexOf(h);
      if (i >= 0) hs.splice(i, 1);
    };
    client.on(type, h);
  });
}

/* ---------- 测量工具 ---------- */

export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s.length ? s[s.length - 1] : NaN,
    avg: s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN,
  };
}

/** 采样进程 CPU%(单核口径)/ RSS(MB)。 */
export function procSampler(pid, intervalMs = 2000) {
  let last = null;
  const samples = [];
  let timer = null;
  const CLK_TCK = 100; // Linux 默认

  async function readOnce() {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const utime = parseInt(after[11], 10);
      const stime = parseInt(after[12], 10);
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const rss = parseInt((status.match(/VmRSS:\s+(\d+) kB/) || [0, 0])[1], 10) / 1024;
      return { ticks: utime + stime, rss, wall: Date.now() };
    } catch {
      return null;
    }
  }

  return {
    start() {
      timer = setInterval(async () => {
        const cur = await readOnce();
        if (cur && last) {
          const cpuPct = ((cur.ticks - last.ticks) / CLK_TCK) / ((cur.wall - last.wall) / 1000) * 100;
          samples.push({ t: cur.wall, cpuPct, rss: cur.rss });
        }
        last = cur || last;
      }, intervalMs);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); },
    result() {
      const cpus = samples.map((s) => s.cpuPct).sort((a, b) => a - b);
      const rss = samples.map((s) => s.rss).sort((a, b) => a - b);
      return {
        samples: samples.length,
        cpu: stats(cpus),
        rss: { p50: percentile(rss, 50), max: rss.length ? rss[rss.length - 1] : NaN },
        raw: samples,
      };
    },
  };
}

/** metrics 规范 append-only 写入(source + schema_version 必填)。 */
export function appendMetric(record) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    source: 'lm10-stress',
    schema_version: '1.0',
    ...record,
  });
  fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
  fs.appendFileSync(METRICS_PATH, line + '\n');
}

/**
 * 构造与 multiplayer.js _broadcastState / RelayClient.sendState 完全同型的
 * G_STATE 线格式(字段在顶层):
 *   {v:1, type:'state', tick, seq, players:[...], snapshot:{buildings, resources}}
 */
export function buildStatePayload(seq, { players = 4, buildings = 10, resources = 24, moving = null } = {}) {
  const ps = [];
  for (let i = 0; i < players; i++) {
    const base = moving && i === 0 ? moving : { x: 10 + i * 3.5, y: 12 + i * 1.5 };
    ps.push({
      id: i + 1, name: `P${i + 1}`,
      x: +base.x.toFixed(3), y: +base.y.toFixed(3), facing: 'down',
      hp: 100 - i, hunger: 80, sanity: 90,
    });
  }
  const bs = [];
  for (let i = 0; i < buildings; i++) {
    bs.push({ entityId: 1000 + i, typeId: 'wall', tx: 5 + i, ty: 5, w: 1, h: 1, hp: 100, maxHp: 100 });
  }
  const rs = [];
  for (let i = 0; i < resources; i++) {
    rs.push({ id: 2000 + i, x: +(i * 2.3).toFixed(1), y: +(i * 1.7).toFixed(1), kind: 'tree', depleted: false, regrowAt: 0 });
  }
  return envelope('state', {
    tick: Date.now(), seq,
    players: ps,
    snapshot: { buildings: bs, resources: rs },
  });
}

/**
 * 构造与 RelayClient.sendInput 同型的 G_INPUT(顶层 {ax, ay}),
 * 额外 seq 供对账,pad 补到 targetBytes(30Hz × 136B ≈ 4KB/s)。
 */
export function buildInputPayload(seq, targetBytes = 136) {
  const base = envelope('input', { ax: 0.5, ay: -0.3, seq, t: Date.now() });
  const raw = JSON.stringify(base);
  if (raw.length >= targetBytes) return base;
  base.pad = 'x'.repeat(targetBytes - raw.length - 9);
  return base;
}

export { sleep };
