/**
 * Wildwood v0.4 联机协议 — 单元测试。
 * 覆盖:房间码生成 / 校验 / 名称校验 / 消息解析 / 校验器 / 玩家状态校验。
 */
'use strict';

import {
  PROTOCOL_VERSION, generateRoomCode, isValidRoomCode, isValidName,
  envelope, parseIncoming,
  validateHost, validateJoin, validateReconnect, validatePlayerState,
  C_HOST, C_JOIN, C_RECONNECT, C_PING, G_INPUT, G_STATE,
  ERR_BAD_MESSAGE, ERR_VERSION,
  ROOM_CODE_LEN, MAX_PLAYERS
} from '../src/net/protocol.js';

let passed = 0;
let failed = 0;
const failures = [];

function eq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { passed++; }
  else {
    failed++;
    failures.push(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; failures.push(label); }
}

// ---------- generateRoomCode ----------
{
  const code = generateRoomCode();
  ok(typeof code === 'string' && code.length === ROOM_CODE_LEN, 'room code length');
  ok(/^[A-Z]{4}$/.test(code), 'room code is 4 uppercase letters');
}
// Distribution sanity: 1000 codes should yield > 50 unique, no 4-digit collision
{
  const codes = new Set();
  for (let i = 0; i < 1000; i++) codes.add(generateRoomCode());
  ok(codes.size > 900, `room code distribution: ${codes.size} unique / 1000`);
}

// ---------- isValidRoomCode ----------
ok(isValidRoomCode('ABCD'), 'ABCD valid');
ok(isValidRoomCode('ZZZZ'), 'ZZZZ valid');
ok(isValidRoomCode('IOPY'), 'IOPY valid (validator accepts all alpha)');
ok(!isValidRoomCode('ABCD '), 'ABCD+space invalid');
ok(!isValidRoomCode('abc'), 'too short invalid');
ok(!isValidRoomCode('1234'), 'digits invalid');
ok(!isValidRoomCode('AB12'), 'mixed invalid');
ok(!isValidRoomCode(null), 'null invalid');
ok(!isValidRoomCode(''), 'empty invalid');

// ---------- isValidName ----------
ok(isValidName('Alice'), 'Alice valid');
ok(isValidName('  Bob  '), 'padded name valid (will be trimmed)');
ok(!isValidName(''), 'empty name invalid');
ok(!isValidName('   '), 'whitespace-only invalid');
ok(!isValidName('a'.repeat(17)), '17 chars invalid');
ok(isValidName('a'.repeat(16)), '16 chars valid (boundary)');
ok(!isValidName(null), 'null name invalid');

// ---------- envelope ----------
{
  const m = envelope(C_HOST, { name: 'Alice' });
  eq(m.v, PROTOCOL_VERSION, 'envelope includes version');
  eq(m.type, C_HOST, 'envelope includes type');
  eq(m.name, 'Alice', 'envelope passes payload');
}

// ---------- parseIncoming ----------
{
  const r1 = parseIncoming(JSON.stringify(envelope(C_PING)));
  ok(r1.ok && r1.msg.type === C_PING, 'parses valid ping');
}
{
  const r2 = parseIncoming('not json');
  ok(!r2.ok && r2.err === ERR_BAD_MESSAGE, 'rejects invalid json');
}
{
  const r3 = parseIncoming(JSON.stringify({ type: C_PING, v: 999 }));
  ok(!r3.ok && r3.err === ERR_VERSION, 'rejects version mismatch');
}
{
  const r4 = parseIncoming(JSON.stringify({ v: 1 }));  // no type
  ok(!r4.ok && r4.err === ERR_BAD_MESSAGE, 'rejects missing type');
}
{
  const r5 = parseIncoming('[]');  // array, not object
  ok(!r5.ok && r5.err === ERR_BAD_MESSAGE, 'rejects array');
}
{
  const r6 = parseIncoming(JSON.stringify({ type: 'a'.repeat(33), v: 1 }));
  ok(!r6.ok && r6.err === ERR_BAD_MESSAGE, 'rejects overlong type');
}
{
  const r7 = parseIncoming(null);
  ok(!r7.ok, 'rejects null raw');
}

// ---------- validateHost ----------
ok(validateHost({ name: 'Alice' }).ok, 'valid host');
ok(!validateHost({ name: '' }).ok, 'rejects empty host name');
ok(!validateHost({ name: 'a'.repeat(17) }).ok, 'rejects overlong host name');
ok(!validateHost({}).ok, 'rejects missing name');

// ---------- validateJoin ----------
ok(validateJoin({ code: 'ABCD', name: 'Bob' }).ok, 'valid join');
ok(!validateJoin({ code: 'abcd', name: 'Bob' }).ok, 'rejects lowercase code');
ok(!validateJoin({ code: 'AB', name: 'Bob' }).ok, 'rejects short code');
ok(!validateJoin({ code: 'ABCD', name: '' }).ok, 'rejects empty name in join');

// ---------- validateReconnect ----------
ok(validateReconnect({ token: 'tok_abc12345' }).ok, 'valid reconnect');
ok(!validateReconnect({ token: 'short' }).ok, 'rejects short token');
ok(!validateReconnect({ token: 'x'.repeat(200) }).ok, 'rejects overlong token');
ok(!validateReconnect({}).ok, 'rejects missing token');

// ---------- validatePlayerState ----------
{
  const good = validatePlayerState({
    id: 1, name: 'Alice', x: 10, y: 5, hp: 80, hunger: 50, sanity: 100, facing: 'right'
  });
  ok(good.ok, 'valid player state');
  eq(good.player.facing, 'right', 'facing preserved');
  eq(good.player.hp, 80, 'hp preserved');
}
{
  const clamped = validatePlayerState({
    id: 1, name: 'Bob', x: 0, y: 0, hp: 999, hunger: -5, sanity: 100
  });
  ok(clamped.ok, 'clamps hp/hunger');
  eq(clamped.player.hp, 100, 'hp clamped to 100');
  eq(clamped.player.hunger, 0, 'hunger clamped to 0');
  eq(clamped.player.facing, 'down', 'facing defaults to down');
}
{
  const bad = validatePlayerState({ id: 1, name: 'X', x: 'foo', y: 0, hp: 50, hunger: 50, sanity: 50 });
  ok(!bad.ok, 'rejects non-numeric coord');
}
{
  const missing = validatePlayerState({ id: 1, name: 'X', x: 0, y: 0 });
  ok(!missing.ok, 'rejects missing fields');
}
{
  const negId = validatePlayerState({ id: 0, name: 'X', x: 0, y: 0, hp: 50, hunger: 50, sanity: 50 });
  ok(!negId.ok, 'rejects non-positive id');
}

// ---------- constants ----------
eq(MAX_PLAYERS, 4, 'max players = 4');
eq(ROOM_CODE_LEN, 4, 'room code length = 4');

// ---------- Result ----------
console.log(`\nprotocol smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log('  FAIL:', f);
  process.exit(1);
}
console.log('All protocol tests PASSED.');
