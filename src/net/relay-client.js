/**
 * Wildwood v0.4 联机 — 浏览器端 WebSocket 客户端。
 *
 * 与 server/relay.mjs 协议对齐;支持自动重连 + 断线恢复。
 *
 * 用法:
 *   const client = new RelayClient('ws://host:8787');
 *   client.on('hosted', m => ...);
 *   client.on('joined', m => ...);
 *   client.on('state', m => ...);
 *   client.connect();
 *   client.host('Alice');
 */

'use strict';

import {
  PROTOCOL_VERSION, isValidRoomCode, isValidName,
  envelope, parseIncoming,
  C_HOST, C_JOIN, C_RECONNECT, C_LEAVE, C_PING,
  S_HOSTED, S_JOINED, S_PEER_JOINED, S_PEER_LEFT, S_PEER_RECONNECTED, S_KICKED, S_ERROR, S_PONG,
  G_INPUT, G_STATE, G_CHAT, G_WORLD,
} from './protocol.js';

/**
 * 简单事件发射器。
 */
class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, new Set());
    this._h.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) {
    if (this._h.has(ev)) this._h.get(ev).delete(fn);
  }
  emit(ev, payload) {
    const set = this._h.get(ev);
    if (set) for (const fn of set) {
      try { fn(payload); } catch (e) { console.error(`[net] handler err for ${ev}:`, e); }
    }
  }
  removeAll() { this._h.clear(); }
}

/**
 * 浏览器 WebSocket 客户端。
 *
 * 事件:
 *   - 'open'           — WebSocket 已连接
 *   - 'close'          — WebSocket 关闭 (e: { code, reason, wasClean })
 *   - 'error'          — 网络/解析错误
 *   - 'connecting'     — 正在重连中
 *   - 'hosted'         — { code, token }
 *   - 'joined'         — { token, id, code, snapshot, reconnected? }
 *   - 'peer_joined'    — { id, name }
 *   - 'peer_left'      — { id, reason }
 *   - 'peer_reconnected' — { id, name }
 *   - 'kicked'         — { reason }
 *   - 'error_msg'      — { err, msg }  (server S_ERROR)
 *   - 'state'          — 游戏 state
 *   - 'input'          — 其他 peer 的 input
 *   - 'chat'           — { from, fromId, text }
 *   - 'world'          — 其他 peer 的 world op
 *   - 'pong'           — { ts }
 */
export class RelayClient extends Emitter {
  constructor(url, { autoReconnectMs = 0, maxReconnectMs = 5000 } = {}) {
    super();
    this.url = url;
    this.ws = null;
    this.connected = false;
    /** @type {string|null} token for reconnect */
    this._token = null;
    this._autoReconnectMs = autoReconnectMs;
    this._maxReconnectMs = maxReconnectMs;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._intentionalClose = false;
  }

  /** 打开连接。 */
  connect() {
    if (this.ws) return;
    this._intentionalClose = false;
    this._openSocket();
  }

  /** 主动关闭,不重连。 */
  disconnect() {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(1000, 'client disconnect'); } catch (_) {}
      this.ws = null;
    }
  }

  /** 主动关闭(leave)然后 reconnect 重置。 */
  leave() {
    if (this.ws && this.connected) {
      try { this.sendRaw({ v: PROTOCOL_VERSION, type: C_LEAVE }); } catch (_) {}
    }
    this.disconnect();
  }

  _openSocket() {
    let ws;
    try { ws = new WebSocket(this.url); }
    catch (e) { this.emit('error', e); this._scheduleReconnect(); return; }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.connected = true;
      this._reconnectAttempt = 0;
      this.emit('open');
      // 自动重连
      if (this._token) {
        try { this.sendRaw(envelope(C_RECONNECT, { token: this._token })); }
        catch (e) { this.emit('error', e); }
      }
    });
    ws.addEventListener('message', (ev) => {
      const r = parseIncoming(ev.data);
      if (!r.ok) {
        this.emit('error', new Error(`bad message: ${r.err} ${r.detail || ''}`));
        return;
      }
      this._dispatch(r.msg);
    });
    ws.addEventListener('close', (ev) => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      this.emit('close', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
      if (wasConnected && !this._intentionalClose) this._scheduleReconnect();
    });
    ws.addEventListener('error', (e) => {
      this.emit('error', e);
    });
  }

  _scheduleReconnect() {
    if (this._intentionalClose || this._autoReconnectMs === 0) return;
    this._reconnectAttempt++;
    const delay = Math.min(
      this._maxReconnectMs,
      this._autoReconnectMs * Math.pow(2, this._reconnectAttempt - 1)
    );
    this.emit('connecting', { attempt: this._reconnectAttempt, delayMs: delay });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._openSocket();
    }, delay);
  }

  _dispatch(msg) {
    switch (msg.type) {
      case S_HOSTED:           this._token = msg.token; this.emit('hosted', msg); break;
      case S_JOINED:           this._token = msg.token; this.emit('joined', msg); break;
      case S_PEER_JOINED:      this.emit('peer_joined', msg); break;
      case S_PEER_LEFT:        this.emit('peer_left', msg); break;
      case S_PEER_RECONNECTED: this.emit('peer_reconnected', msg); break;
      case S_KICKED:           this.emit('kicked', msg); break;
      case S_ERROR:            this.emit('error_msg', msg); break;
      case S_PONG:             this.emit('pong', msg); break;
      case G_INPUT:            this.emit('input', msg); break;
      case G_STATE:            this.emit('state', msg); break;
      case G_CHAT:             this.emit('chat', msg); break;
      case G_WORLD:            this.emit('world', msg); break;
      default:
        this.emit('error', new Error(`unhandled type: ${msg.type}`));
    }
  }

  sendRaw(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('ws not open');
    }
    this.ws.send(JSON.stringify(obj));
  }

  host(name) {
    if (!isValidName(name)) throw new Error('invalid name');
    this.sendRaw(envelope(C_HOST, { name: name.trim() }));
  }
  join(code, name) {
    if (!isValidRoomCode(code)) throw new Error('invalid room code');
    if (!isValidName(name)) throw new Error('invalid name');
    this.sendRaw(envelope(C_JOIN, { code: code.toUpperCase(), name: name.trim() }));
  }
  ping() { this.sendRaw(envelope(C_PING)); }
  sendInput(ax, ay) { this.sendRaw(envelope(G_INPUT, { ax, ay })); }
  sendChat(text) { this.sendRaw(envelope(G_CHAT, { text })); }
  sendWorld(op) { this.sendRaw(envelope(G_WORLD, op)); }
  sendState(state) { this.sendRaw(envelope(G_STATE, state)); }
}
