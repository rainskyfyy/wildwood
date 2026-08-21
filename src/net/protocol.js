/**
 * Wildwood v0.4 联机协议 — 消息类型枚举 + 编解码 + 校验。
 *
 * Wire format: JSON over WebSocket text frames, one message per frame.
 * 消息分为两层:
 *   1. 控制层 (C↔S): host / join / reconnect / leave / ping / pong / ...
 *   2. 游戏层 (proxied by relay to all peers in room):
 *      state / input / chat / world
 *
 * 版本号:PROTOCOL_VERSION 必须随破坏性变更递增;relay 拒绝版本不匹配的客户端。
 *
 * 关键不变量:
 *   - 所有数字 ID 都是正整数
 *   - 房间码是 4 位大写字母 [A-Z]
 *   - 玩家坐标是浮点(tile 单位)
 *   - state.state.players[i] 由 host 排序,客户端按 id 匹配
 */

'use strict';

export const PROTOCOL_VERSION = 1;

/* ---------- 控制层消息 (client → server) ---------- */
export const C_HOST       = 'host';
export const C_JOIN       = 'join';
export const C_RECONNECT  = 'reconnect';
export const C_LEAVE      = 'leave';
export const C_PING       = 'ping';

/* ---------- 控制层消息 (server → client) ---------- */
export const S_HOSTED            = 'hosted';
export const S_JOINED            = 'joined';
export const S_PEER_JOINED       = 'peer_joined';
export const S_PEER_LEFT         = 'peer_left';
export const S_PEER_RECONNECTED  = 'peer_reconnected';
export const S_KICKED            = 'kicked';
export const S_ERROR             = 'error';
export const S_PONG              = 'pong';

/* ---------- 游戏层消息(双向,经 relay 转发)---------- */
export const G_INPUT  = 'input';
export const G_STATE  = 'state';
export const G_CHAT   = 'chat';
export const G_WORLD  = 'world';

/* ---------- World 操作 ---------- */
export const WORLD_PLACE_BUILDING   = 'place_building';
export const WORLD_REMOVE_BUILDING  = 'remove_building';
export const WORLD_GATHER_COMPLETE  = 'gather_complete';
export const WORLD_RESOURCE_RESPAWN = 'resource_respawn';

/* ---------- 错误原因 ---------- */
export const ERR_ROOM_FULL     = 'room_full';
export const ERR_BAD_CODE      = 'bad_code';
export const ERR_NAME_TAKEN    = 'name_taken';
export const ERR_VERSION       = 'version_mismatch';
export const ERR_BAD_MESSAGE   = 'bad_message';
export const ERR_HOST_LEFT     = 'host_left';
export const ERR_RECONNECT_BAD = 'reconnect_failed';
export const ERR_INTERNAL      = 'internal';

/* ---------- 房间容量 ---------- */
export const MAX_PLAYERS   = 4;
export const ROOM_CODE_LEN = 4;
export const RECONNECT_GRACE_MS = 30_000;

/* ---------- 工具函数 ---------- */

/**
 * 生成 4 位大写字母房间码(26^4 = 456,976 个,碰撞可接受)。
 * 使用 crypto.getRandomValues 优先,降级 Math.random。
 */
export function generateRoomCode() {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // 去掉 I / O 易混
  const bytes = new Uint8Array(ROOM_CODE_LEN);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < ROOM_CODE_LEN; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    out += ALPHA[bytes[i] % ALPHA.length];
  }
  return out;
}

/**
 * 校验房间码格式。返回 true 当且仅当 4 位大写字母。
 */
export function isValidRoomCode(code) {
  return typeof code === 'string'
      && code.length === ROOM_CODE_LEN
      && /^[A-Z]{4}$/.test(code);
}

/**
 * 校验玩家名:1-16 字符,非空,去除前后空白后非空。
 */
export function isValidName(name) {
  if (typeof name !== 'string') return false;
  const t = name.trim();
  return t.length >= 1 && t.length <= 16;
}

/**
 * 精简的协议消息包装。所有出站消息附 v。
 */
export function envelope(type, payload = {}) {
  return { v: PROTOCOL_VERSION, type, ...payload };
}

/**
 * 解析入站消息。返回 { ok, msg, err }。
 *   - 解析失败:err 为描述字符串
 *   - 协议版本不匹配:err = 'version_mismatch'
 *   - 缺 type:err = 'bad_message'
 */
export function parseIncoming(raw) {
  let msg;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return { ok: false, err: ERR_BAD_MESSAGE, detail: 'json parse failed' };
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, err: ERR_BAD_MESSAGE, detail: 'not an object' };
  }
  if (typeof msg.type !== 'string' || msg.type.length === 0 || msg.type.length > 32) {
    return { ok: false, err: ERR_BAD_MESSAGE, detail: 'missing or invalid type' };
  }
  if (msg.v !== undefined && msg.v !== PROTOCOL_VERSION) {
    return { ok: false, err: ERR_VERSION, detail: `client v=${msg.v} server v=${PROTOCOL_VERSION}` };
  }
  return { ok: true, msg };
}

/* ---------- 校验器(每个控制消息一个)---------- */

export function validateHost(msg) {
  if (!isValidName(msg.name)) {
    return { ok: false, err: 'name must be 1-16 chars' };
  }
  return { ok: true };
}

export function validateJoin(msg) {
  if (!isValidRoomCode(msg.code)) {
    return { ok: false, err: 'code must be 4 uppercase letters' };
  }
  if (!isValidName(msg.name)) {
    return { ok: false, err: 'name must be 1-16 chars' };
  }
  return { ok: true };
}

export function validateReconnect(msg) {
  if (typeof msg.token !== 'string' || msg.token.length < 8 || msg.token.length > 128) {
    return { ok: false, err: 'invalid token' };
  }
  return { ok: true };
}

/* ---------- 玩家状态 schema(state.players[i])---------- */

/**
 * 校验单个 player state 对象。返回 { ok, err?, fields? }。
 * fields 列出哪些字段合法,以便主机补默认值。
 */
export function validatePlayerState(p) {
  if (!p || typeof p !== 'object') return { ok: false, err: 'not object' };
  const out = {
    id:     Number.isInteger(p.id) && p.id > 0 ? p.id : null,
    name:   isValidName(p.name) ? p.name : null,
    x:      Number.isFinite(p.x) ? p.x : null,
    y:      Number.isFinite(p.y) ? p.y : null,
    hp:     Number.isFinite(p.hp)     ? Math.max(0, Math.min(100, p.hp))     : null,
    hunger: Number.isFinite(p.hunger) ? Math.max(0, Math.min(100, p.hunger)) : null,
    sanity: Number.isFinite(p.sanity) ? Math.max(0, Math.min(100, p.sanity)) : null,
    facing: ['up', 'down', 'left', 'right'].includes(p.facing) ? p.facing : 'down',
  };
  const missing = [];
  for (const k of ['id', 'name', 'x', 'y', 'hp', 'hunger', 'sanity']) {
    if (out[k] === null) missing.push(k);
  }
  if (missing.length) return { ok: false, err: `missing/invalid: ${missing.join(',')}` };
  return { ok: true, player: out };
}
