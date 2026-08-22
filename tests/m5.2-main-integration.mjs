#!/usr/bin/env node
/**
 * m5.2-main-integration.mjs — Source-level smoke test for main.js v0.5.2 wiring.
 *
 * Verifies the main.js source code contains the expected v0.5.2 wiring
 * calls (imports, manager construction, frame loop tick, key handlers,
 * render branches). The actual bootGame runtime requires a full DOM
 * (HUD uses querySelector etc.) and is exercised manually via
 * demo.html in the browser.
 */
'use strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '..', 'src', 'main.js');
const src = readFileSync(mainPath, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail || ''}`); }
}
function section(n) { console.log(`\n[${n}]`); }

section('imports');
ok('imports MonsterManager', src.includes("from './monster/monster-manager.js'"));
ok('imports BossManager', src.includes("from './boss/boss-manager.js'"));
ok('imports BossConfig', src.includes("from './boss/boss-config.js'"));
ok('imports EventManager', src.includes("from './events/event-manager.js'"));
ok('imports EventRegistry', src.includes("from './events/events.js'"));
ok('imports BossBar', src.includes("from './hud/boss-bar.js'"));
ok('imports EventBanner', src.includes("from './hud/event-banner.js'"));
ok('imports monsters.json', src.includes("./data/monsters.json"));

section('manager construction');
ok('constructs MonsterManager', src.includes('new MonsterManager('));
ok('calls monsterMgr.spawnDefaults', src.includes('monsterMgr.spawnDefaults()'));
ok('constructs BossManager', src.includes('new BossManager('));
ok('BossManager has onDrop hook', src.includes('onDrop: (itemId, count)'));
ok('constructs EventManager', src.includes('new EventManager('));
ok('EventManager has onNotice hook', src.includes('onNotice: (n)'));
ok('constructs BossBar', src.includes('new BossBar(ctx)'));
ok('constructs EventBanner', src.includes('new EventBanner(ctx)'));

section('frame loop ticks');
ok('monsterMgr.update called', src.includes('monsterMgr.update(dt, player)'));
ok('bossMgr.update called', src.includes('bossMgr.update('));
ok('eventMgr.update called', src.includes('eventMgr.update('));
ok('player.attack called (Space)', src.includes('player.attack('));
ok('vitalsState.hp synced from player.hp', src.includes('vitalsState.hp.cur = player.hp'));
ok('event multiplier applied to monsters', src.includes('getMonsterMultiplier()'));
ok('effectiveAtk/effectiveSpeed set on monsters', src.includes('m.effectiveAtk') && src.includes('m.effectiveSpeed'));

section('key handlers');
ok('L key triggers event', src.includes("consumePressed('l')") || src.includes("consumePressed('L')"));
ok('B key spawns boss', src.includes("consumePressed('b')") || src.includes("consumePressed('B')"));
ok('Space key triggers attack', src.includes("consumePressed(' ')"));
ok('cooldown guard for L', src.includes('EVENT_COOLDOWN_S'));
ok('cooldown guard for B', src.includes('BOSS_COOLDOWN_S'));

section('render branches');
ok('monster drawable kind added', src.includes("it.kind === 'monster'"));
ok('poi drawable kind added', src.includes("it.kind === 'poi'"));
ok('BossBar draw call (via _bossBarDraw bridge)', src.includes('_bossBarDraw'));
ok('EventBanner draw call (via _eventBannerDraw bridge)', src.includes('_eventBannerDraw'));
ok('monster has phase tint logic', src.includes('colorTint'));
ok('poi meteor_fall case', src.includes("p.kind === 'meteor_fall'"));

section('module-level bridge for top-level HUD');
ok('_bossBarDraw declared at module level', src.match(/let _bossBarDraw/));
ok('_eventBannerDraw declared at module level', src.match(/let _eventBannerDraw/));

section('helper integration in bootGame');
ok('bootGame sets _bossBarDraw = ...', src.includes('_bossBarDraw = ('));
ok('bootGame sets _eventBannerDraw = ...', src.includes('_eventBannerDraw = ('));
ok('BossConfig.forBiome / all() fallback', src.includes('BossConfig.forBiome') && src.includes('BossConfig.all'));
ok('EventRegistry.all() for random event', src.includes('EventRegistry.all()'));

console.log(`\nm5.2 main-integration smoke: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
