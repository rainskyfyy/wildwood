#!/usr/bin/env node
/**
 * Wildwood v0.4 联机 — WebSocket relay server (zero-dep, Node 18+).
 *
 * 公共 relay 模式:任何客户端可创建房间或加入房间。服务器只做
 * 消息转发 + 房间生命周期管理,游戏逻辑在 host 浏览器里跑。
 *
 * 启动:
 *   node server/relay.mjs                       # 默认端口 8787
 *   PORT=9000 node server/relay.mjs             # 自定义端口
 *   node server/relay.mjs --host 0.0.0.0 --port 8787
 *
 * 浏览器连接:
 *   const ws = new WebSocket('ws://host:8787');
 *
 * 协议:见 src/net/protocol.js。
 *
 * 关键设计:
 *   - 房间码是 4 位大写字母;host 创建时分配,join 时按码查找
 *   - 每个客户端持有 token(随机串),用于断线 30s 内重连
 *   - 控制消息(host/join/reconnect/leave)只由服务器处理;
 *     其余消息原样广播给同房间其他 peers
 *   - 房间满 4 人后 join 拒绝;host 离开则全房被踢
 */

'use strict';

import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import {
  PROTOCOL_VERSION, ROOM_CODE_LEN, MAX_PLAYERS, RECONNECT_GRACE_MS,
  generateRoomCode, isValidRoomCode, isValidName,
  envelope, parseIncoming,
  validateHost, validateJoin, validateReconnect, validatePlayerState,
  C_HOST, C_JOIN, C_RECONNECT, C_LEAVE, C_PING,
  S_HOSTED, S_JOINED, S_PEER_JOINED, S_PEER_LEFT, S_PEER_RECONNECTED,
  S_KICKED, S_ERROR, S_PONG,
  G_INPUT, G_STATE, G_CHAT, G_WORLD,
  ERR_ROOM_FULL, ERR_BAD_CODE, ERR_NAME_TAKEN, ERR_VERSION,
  ERR_BAD_MESSAGE, ERR_HOST_LEFT, ERR_RECONNECT_BAD, ERR_INTERNAL,
} from '../src/net/protocol.js';

const argv = parseArgs(process.argv.slice(2));
const HOST = argv.host || '0.0.0.0';
const PORT = Number(argv.port || process.env.PORT || 8787);
const QUIET = !!argv.quiet;

/* ============================================================
 * WebSocket framing (RFC 6455 minimal subset, text only)
 * ============================================================ */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsAcceptKey(reqSecKey) {
  return createHash('sha1').update(reqSecKey + WS_GUID).digest('base64');
}

/**
 * 把 socket 升级到 WebSocket(text-only,无 fragmentation)。
 * 返回 { send(text), close(code?, reason?) }。
 */
function upgradeToWS(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return null;
  }
  const accept = wsAcceptKey(key);
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '', ''
  ].join('\r\n');
  socket.write(headers);

  let closed = false;
  const send = (data) => {
    if (closed) return;
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const buf = encodeFrame(text);
    try { socket.write(buf); } catch (_) { close(1011, 'send failed'); }
  };
  const close = (code = 1000, reason = '') => {
    if (closed) return;
    closed = true;
    try {
      const r = Buffer.from(reason, 'utf8');
      const payload = Buffer.alloc(2 + r.length);
      payload.writeUInt16BE(code, 0);
      r.copy(payload, 2);
      socket.write(encodeFrame(payload, 0x8));
    } catch (_) { /* ignore */ }
    try { socket.end(); } catch (_) { /* ignore */ }
  };
  socket.on('error', () => close(1011, 'socket error'));
  socket.on('close', () => { closed = true; });
  return { send, close, socket };
}

function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;
  // Server-to-client frames MUST be unmasked (RFC 6455 §5.1).
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;  // FIN=1
    header[1] = 0x00 | len;     // MASK=0 (server → client)
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x00 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x00 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * 把 socket 解析为 text 消息流。返回 { onMessage(cb), close() }。
 * 处理 unmasked 客户端文本帧(必须 < 1MB),其他 opcode 拒绝。
 */
function wsReader(socket) {
  let buf = Buffer.alloc(0);
  let closed = false;
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // 防止恶意客户端堆 buffer
    if (buf.length > 2 * 1024 * 1024) {
      closed = true;
      try { socket.destroy(); } catch (_) {}
      return;
    }
    while (true) {
      const r = tryParseFrame(buf);
      if (r == null) return;
      const { frame, consumed } = r;
      buf = buf.subarray(consumed);
      if (frame.opcode === 0x8) {  // close
        closed = true;
        try { socket.end(); } catch (_) {}
        return;
      }
      if (frame.opcode === 0x9) {  // ping → reply pong
        try { socket.write(encodeFrame(frame.payload, 0xA)); } catch (_) {}
        continue;
      }
      if (frame.opcode === 0x1) {  // text
        const text = frame.payload.toString('utf8');
        try { onMessageCb(text); } catch (e) { log('handler err', e?.message); }
      }
      // 0x2 (binary) / 0xA (pong) / 0x0 (continuation) 忽略
    }
  };
  let onMessageCb = () => {};
  socket.on('data', onData);
  socket.on('end', () => { closed = true; });
  socket.on('error', () => { closed = true; });
  return {
    onMessage: (cb) => { onMessageCb = cb; },
    isClosed: () => closed,
  };
}

function tryParseFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0F;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7F;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  if (masked) {
    if (buf.length < off + 4) return null;
    off += 4;  // skip mask
  }
  if (buf.length < off + len) return null;
  let payload = buf.subarray(off, off + len);
  if (masked) {
    const mask = buf.subarray(off - 4, off);
    const copy = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) copy[i] = payload[i] ^ mask[i & 3];
    payload = copy;
  }
  return { frame: { fin, opcode, payload }, consumed: off + len };
}

/* ============================================================
 * 房间与连接管理
 * ============================================================ */

/**
 * 房间:包含 host + clients(host 也是 client)。
 *   - hostId: 房主 peer.id;若 host 离开则房间销毁
 *   - peers:  Map<id, { id, name, ws, token, state, lastSeen, disconnected, room }>
 *   - state:  最新一次 host 广播的 G_STATE.players(其他 peer 用作占位)
 *   - lastStateAt: 上次收到 G_STATE 的时间(ms),用于 host 死亡检测
 */
class Room {
  constructor(code) {
    this.code = code;
    this.hostId = null;
    /** @type {Map<number, Peer>} */
    this.peers = new Map();
    this.lastState = null;
    this.lastStateAt = 0;
    this.createdAt = Date.now();
  }
  get size() { return this.peers.size; }
  hasName(name) {
    for (const p of this.peers.values()) {
      if (!p.disconnected && p.name === name) return true;
    }
    return false;
  }
  /**
   * 生成 room snapshot(给新加入者使用):{ players, buildings, resources }
   * - players: 当前在房 peers 的最新 state
   * - buildings / resources: 由 host 通过 G_WORLD 累积,服务器不解析,
   *   而是缓存 host 发来的最新 buildings/resources snapshot
   */
  snapshot() {
    const players = [];
    for (const p of this.peers.values()) {
      if (p.state) players.push(p.state);
    }
    return {
      players,
      buildings: this.lastBuildings || [],
      resources: this.lastResources || [],
    };
  }
  alivePeers() {
    const out = [];
    for (const p of this.peers.values()) if (!p.disconnected) out.push(p);
    return out;
  }
}

/**
 * 客户端连接记录。
 */
class Peer {
  constructor({ id, name, token, ws, reader, room }) {
    this.id = id;
    this.name = name;
    this.token = token;
    this.ws = ws;
    this.reader = reader;
    this.room = room;
    this.state = null;     // 最新 player state(G_STATE.players[i])
    this.lastSeen = Date.now();
    this.disconnected = false;
    this.disconnectedAt = 0;
  }
  send(obj) {
    if (this.disconnected) return;
    this.ws.send(obj);
  }
  alive() { return !this.reader.isClosed() && !this.disconnected; }
}

/** @type {Map<string, Room>} */
const rooms = new Map();
let nextPeerId = 1;
let nextRoomCode = null;

function allocPeerId() { return nextPeerId++; }

function newToken() {
  return randomBytes(16).toString('base64url');
}

/* ============================================================
 * 消息路由
 * ============================================================ */

function log(...args) {
  if (QUIET) return;
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

function sendError(ws, errCode, msg) {
  ws.send(envelope(S_ERROR, { err: errCode, msg: String(msg || '') }));
}

function handleHost(peer, msg) {
  // 创建或接管:简化模型,host 消息只用于创建
  if (peer.room) {
    sendError(peer.ws, ERR_INTERNAL, 'already in a room');
    return;
  }
  const v = validateHost(msg);
  if (!v.ok) { sendError(peer.ws, ERR_BAD_MESSAGE, v.err); return; }
  // 分配唯一的房间码
  let code;
  for (let i = 0; i < 50; i++) {
    const c = generateRoomCode();
    if (!rooms.has(c)) { code = c; break; }
  }
  if (!code) { sendError(peer.ws, ERR_INTERNAL, 'no free room code'); return; }
  const room = new Room(code);
  rooms.set(code, room);
  room.hostId = peer.id;
  peer.room = room;
  room.peers.set(peer.id, peer);
  peer.name = msg.name.trim();
  peer.send(envelope(S_HOSTED, { code, token: peer.token, tick: 0 }));
  log(`host ${peer.name}#${peer.id} created room ${code}`);
}

function handleJoin(peer, msg) {
  if (peer.room) { sendError(peer.ws, ERR_INTERNAL, 'already in a room'); return; }
  const v = validateJoin(msg);
  if (!v.ok) { sendError(peer.ws, ERR_BAD_MESSAGE, v.err); return; }
  const code = msg.code.toUpperCase();
  const room = rooms.get(code);
  if (!room) { sendError(peer.ws, ERR_BAD_CODE, 'no such room'); return; }
  // 检查在位 peers(忽略 disconnected 暂留位)
  const liveCount = room.alivePeers().length;
  if (liveCount >= MAX_PLAYERS) {
    sendError(peer.ws, ERR_ROOM_FULL, 'room full');
    return;
  }
  const trimmed = msg.name.trim();
  if (room.hasName(trimmed)) {
    sendError(peer.ws, ERR_NAME_TAKEN, 'name taken');
    return;
  }
  peer.room = room;
  peer.name = trimmed;
  room.peers.set(peer.id, peer);
  // 通知新加入者 + 广播给房间
  peer.send(envelope(S_JOINED, {
    token: peer.token,
    id: peer.id,
    code: room.code,
    snapshot: room.snapshot(),
  }));
  broadcastToRoom(room, envelope(S_PEER_JOINED, {
    id: peer.id, name: peer.name,
  }), { except: peer.id });
  log(`peer ${peer.name}#${peer.id} joined ${code} (size ${room.size})`);
}

function handleReconnect(peer, msg) {
  const v = validateReconnect(msg);
  if (!v.ok) { sendError(peer.ws, ERR_BAD_MESSAGE, v.err); return; }
  // 在所有房间中找匹配的 token
  for (const room of rooms.values()) {
    const target = room.peers.get(findIdByToken(room, msg.token));
    if (target && target.disconnected) {
      // 恢复连接:关闭旧 ws,绑定新 ws
      try { target.ws.close(1000, 'replaced'); } catch (_) {}
      target.ws = peer.ws;
      target.reader = peer.reader;
      target.disconnected = false;
      target.disconnectedAt = 0;
      target.lastSeen = Date.now();
      // 更新 peer.id 让新 socket 拥有原 id;但我们的 peer 记录已绑定
      // 旧 peer 对象,所以我们直接把原 peer 的 ws 替换,然后让新 peer
      // 通过原 id 走消息 — 简化:丢弃新 peer,继续用原 peer。
      peer.room = room;
      peer.id = target.id;
      peer.name = target.name;
      peer.token = target.token;
      room.peers.set(peer.id, peer);  // 覆盖原 peer 记录
      peer.send(envelope(S_JOINED, {
        token: peer.token,
        id: peer.id,
        code: room.code,
        snapshot: room.snapshot(),
        reconnected: true,
      }));
      broadcastToRoom(room, envelope(S_PEER_RECONNECTED, {
        id: peer.id, name: peer.name,
      }), { except: peer.id });
      log(`peer ${peer.name}#${peer.id} reconnected to ${room.code}`);
      return;
    }
  }
  sendError(peer.ws, ERR_RECONNECT_BAD, 'no matching token');
}

function findIdByToken(room, token) {
  for (const [id, p] of room.peers) {
    if (p.token === token) return id;
  }
  return -1;
}

function handleLeave(peer) {
  detachPeer(peer, { kick: false, reason: 'leave' });
}

function handlePing(peer) {
  peer.send(envelope(S_PONG, { ts: Date.now() }));
}

function handleGameMessage(peer, msg) {
  if (!peer.room) { sendError(peer.ws, ERR_INTERNAL, 'not in a room'); return; }
  peer.lastSeen = Date.now();
  if (msg.type === G_STATE) {
    // host 广播的状态,记录每个 peer 的最新 state,以及可选 snapshot
    if (msg.snapshot) {
      peer.room.lastBuildings = msg.snapshot.buildings || peer.room.lastBuildings || [];
      peer.room.lastResources = msg.snapshot.resources || peer.room.lastResources || [];
    }
    if (Array.isArray(msg.players)) {
      for (const p of msg.players) {
        const v = validatePlayerState(p);
        if (v.ok) {
          if (p.id === peer.id) peer.state = v.player;
          else if (peer.room.peers.has(p.id)) {
            peer.room.peers.get(p.id).state = v.player;
          }
        }
      }
      peer.room.lastState = msg.players;
      peer.room.lastStateAt = Date.now();
    }
  } else if (msg.type === G_CHAT) {
    if (typeof msg.text !== 'string' || msg.text.length === 0 || msg.text.length > 500) {
      sendError(peer.ws, ERR_BAD_MESSAGE, 'chat invalid');
      return;
    }
    msg.from = peer.name;
    msg.fromId = peer.id;
  } else if (msg.type === G_WORLD) {
    // world op 必须带 op 字段;服务器校验基本格式后转发
    if (typeof msg.op !== 'string') {
      sendError(peer.ws, ERR_BAD_MESSAGE, 'world op missing');
      return;
    }
    msg.by = peer.id;
    // 缓存 host 的最新 buildings/resources 用于新加入者
    if (peer.id === peer.room.hostId) {
      if (msg.op === 'place_building' && msg.building) {
        peer.room.lastBuildings = peer.room.lastBuildings || [];
        peer.room.lastBuildings.push(msg.building);
      } else if (msg.op === 'remove_building' && Number.isInteger(msg.entityId)) {
        peer.room.lastBuildings = (peer.room.lastBuildings || []).filter(b => b.entityId !== msg.entityId);
      } else if (msg.op === 'gather_complete' && Number.isInteger(msg.entityId)) {
        peer.room.lastResources = (peer.room.lastResources || []).map(r =>
          r.id === msg.entityId ? { ...r, depleted: true, regrowAt: msg.regrowAt || null } : r
        );
      } else if (msg.op === 'resource_respawn' && Number.isInteger(msg.entityId)) {
        peer.room.lastResources = (peer.room.lastResources || []).map(r =>
          r.id === msg.entityId ? { ...r, depleted: false, regrowAt: null } : r
        );
      } else if (msg.op === 'snapshot' && msg.snapshot) {
        if (Array.isArray(msg.snapshot.buildings)) peer.room.lastBuildings = msg.snapshot.buildings;
        if (Array.isArray(msg.snapshot.resources)) peer.room.lastResources = msg.snapshot.resources;
      }
    }
  } else if (msg.type === G_INPUT) {
    // 为 input 也注入 fromId,客户端可知道是谁的输入(用于回放/调试)
    msg.fromId = peer.id;
  } else {
    sendError(peer.ws, ERR_BAD_MESSAGE, `unknown game type ${msg.type}`);
    return;
  }
  // 转发给同房间其他 peers
  broadcastToRoom(peer.room, msg, { except: peer.id });
}

function broadcastToRoom(room, msg, { except = -1 } = {}) {
  const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const p of room.alivePeers()) {
    if (p.id === except) continue;
    try { p.ws.send(text); } catch (_) { /* ignore */ }
  }
}

function detachPeer(peer, { kick = false, reason = '' } = {}) {
  if (!peer.room) return;
  const room = peer.room;
  // 通知其他 peers
  broadcastToRoom(room, envelope(S_PEER_LEFT, { id: peer.id, reason }), { except: peer.id });
  // 如果是 host 离开:踢出所有人,销毁房间
  if (room.hostId === peer.id) {
    for (const p of room.alivePeers()) {
      if (p.id !== peer.id) {
        try { p.send(envelope(S_KICKED, { reason: ERR_HOST_LEFT })); } catch (_) {}
      }
    }
    rooms.delete(room.code);
    log(`host left, room ${room.code} destroyed`);
  } else {
    // 普通 peer 离开:标记为 disconnected,等待 reconnect 窗口
    if (kick) {
      // 立即移除(reconnect 失败或违规)
      room.peers.delete(peer.id);
    } else {
      peer.disconnected = true;
      peer.disconnectedAt = Date.now();
    }
  }
  peer.room = null;
}

/* ============================================================
 * 周期任务:reconnect 超时清理
 * ============================================================ */

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // 检查 host 是否长时间没广播 state(host 死亡检测)
    if (room.lastStateAt > 0 && (now - room.lastStateAt) > 2 * 60_000) {
      log(`room ${code} host silent >2min, destroying`);
      for (const p of room.alivePeers()) {
        try { p.send(envelope(S_KICKED, { reason: 'host_silent' })); } catch (_) {}
      }
      rooms.delete(code);
      continue;
    }
    // 清理过期 disconnected peers
    for (const [id, p] of room.peers) {
      if (p.disconnected && (now - p.disconnectedAt) > RECONNECT_GRACE_MS) {
        log(`room ${code} peer ${p.name}#${id} grace expired, removing`);
        room.peers.delete(id);
      }
    }
    // 房间空了:清理
    if (room.size === 0) rooms.delete(code);
  }
}, 5_000).unref();

/* ============================================================
 * HTTP + WebSocket 服务器
 * ============================================================ */

const server = http.createServer((req, res) => {
  // 简单 health endpoint
  if (req.url === '/health') {
    const body = JSON.stringify({
      ok: true,
      version: PROTOCOL_VERSION,
      rooms: rooms.size,
      peers: [...rooms.values()].reduce((s, r) => s + r.size, 0),
      uptime: process.uptime(),
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Wildwood relay v${PROTOCOL_VERSION}\nGET /health for status.\n`);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/' && req.url !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  const upgraded = upgradeToWS(req, socket);
  if (!upgraded) return;
  if (head && head.length) socket.unshift(head);
  const reader = wsReader(socket);
  const peer = new Peer({
    id: allocPeerId(),
    name: '(unnamed)',
    token: newToken(),
    ws: upgraded,
    reader,
    room: null,
  });
  reader.onMessage((text) => {
    const r = parseIncoming(text);
    if (!r.ok) {
      sendError(upgraded, r.err, r.detail);
      return;
    }
    const msg = r.msg;
    switch (msg.type) {
      case C_HOST:      handleHost(peer, msg); break;
      case C_JOIN:      handleJoin(peer, msg); break;
      case C_RECONNECT: handleReconnect(peer, msg); break;
      case C_LEAVE:     handleLeave(peer); break;
      case C_PING:      handlePing(peer); break;
      case G_INPUT:
      case G_STATE:
      case G_CHAT:
      case G_WORLD:     handleGameMessage(peer, msg); break;
      default:
        sendError(upgraded, ERR_BAD_MESSAGE, `unknown type: ${msg.type}`);
    }
  });
  socket.on('close', () => {
    if (peer.room) detachPeer(peer, { reason: 'disconnect' });
  });
});

server.listen(PORT, HOST, () => {
  log(`Wildwood relay v${PROTOCOL_VERSION} listening on ws://${HOST}:${PORT}`);
  log(`  health: http://${HOST}:${PORT}/health`);
});

/* ============================================================
 * 优雅关闭
 * ============================================================ */

function shutdown() {
  log('shutting down...');
  for (const room of rooms.values()) {
    for (const p of room.alivePeers()) {
      try { p.send(envelope(S_KICKED, { reason: 'server_shutdown' })); } catch (_) {}
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/* ============================================================
 * 工具
 * ============================================================ */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(`Usage: node server/relay.mjs [--host HOST] [--port N] [--quiet]`);
      process.exit(0);
    }
    if (a === '--quiet' || a === '-q') { out.quiet = true; continue; }
    if (a === '--host' && argv[i + 1]) { out.host = argv[++i]; continue; }
    if (a === '--port' && argv[i + 1]) { out.port = argv[++i]; continue; }
  }
  return out;
}
