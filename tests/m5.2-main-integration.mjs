#!/usr/bin/env node
/**
 * m5.2-main-integration.mjs — Source-level smoke test for v0.6.0a
 * (split main → assembly + runtime + main) AND v0.7.0a (3 services
 * split: EventService / BuildingService / MonsterService).
 *
 * The test reads main.js / assembly.js / runtime.js and checks
 * wiring strings (union across the three files). Actual bootGame
 * requires DOM; the user runs demo.html in a browser for the
 * end-to-end visual check.
 *
 * v0.7.0a additions:
 *   - imports the 3 new services from src/services/
 *   - constructs the 3 services (not the raw Managers)
 *   - runtime tick paths go through eventSvc.* / buildingSvc.* /
 *     monsterSvc.* (not eventMgr.* / buildingMgr.* / monsterMgr.*)
 */
'use strict';

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

let src = readFileSync(join(srcDir, 'main.js'), 'utf8');
// v0.6.0a: wiring 分散在 main.js / assembly.js / runtime.js
for (const f of ['assembly.js', 'runtime.js']) {
  const p = join(srcDir, f);
  if (existsSync(p)) src += '\n' + readFileSync(p, 'utf8');
}

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
// v0.7.0a: services
ok('imports EventService',    src.includes("from './services/EventService.js'"));
ok('imports BuildingService', src.includes("from './services/BuildingService.js'"));
ok('imports MonsterService',  src.includes("from './services/MonsterService.js'"));

section('manager construction (legacy, kept for coexistence)');
ok('constructs BossManager', src.includes('new BossManager('));
ok('BossManager has onDrop hook', src.includes('onDrop: (itemId, count)'));
ok('constructs BossBar', src.includes('new BossBar(ctx)'));
ok('constructs EventBanner', src.includes('new EventBanner(ctx)'));

section('v0.7.0a: service construction (mutation single entry)');
ok('constructs EventService',    src.includes('new EventService('));
ok('constructs BuildingService', src.includes('new BuildingService('));
ok('constructs MonsterService',  src.includes('new MonsterService('));
// service exposes pass-through getter for render/Multiplayer
ok('eventMgr pass-through',    /eventMgr\s*=\s*eventSvc\.eventMgr/.test(src));
ok('buildingMgr pass-through', /buildingMgr\s*=\s*buildingSvc\.buildingMgr/.test(src));
ok('monsterMgr pass-through',  /monsterMgr\s*=\s*monsterSvc\.monsterMgr/.test(src));

section('frame loop ticks (v0.7.0a: runtime goes through svc)');
ok('eventSvc.update called',     src.includes('eventSvc.update('));
ok('monsterSvc.update called',   src.includes('monsterSvc.update('));
ok('bossMgr.update called',      src.includes('bossMgr.update('));
ok('player.attack called (Space)', src.includes('player.attack('));
ok('vitalsState.hp synced from player.hp', src.includes('vitalsState.hp.cur = player.hp'));
ok('event multiplier applied (eventSvc.getMonsterMultiplier)', src.includes('eventSvc.getMonsterMultiplier()'));
ok('monsterSvc.update receives multiplier (3rd arg)', /monsterSvc\.update\([^)]*,[^)]*,[^)]*\)/.test(src));
ok('eventSvc.trigger called (L key)', src.includes('eventSvc.trigger('));
ok('monsterSvc.findNearest called (Space attack)', src.includes('monsterSvc.findNearest('));
ok('buildingSvc.findAt called (right-click destroy)', src.includes('buildingSvc.findAt('));
ok('buildingSvc.remove called (right-click destroy)', src.includes('buildingSvc.remove('));
ok('buildingSvc.canPlace called (placement preview)', src.includes('buildingSvc.canPlace('));
ok('buildingSvc.place called (tryPlaceBuilding)', src.includes('buildingSvc.place('));

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
// v0.7.0a: render reads eventSvc.pois (service getter, with fallback to eventMgr.pois)
ok('eventSvc.pois used in render', /eventSvc\s*&&.*eventSvc\.pois/.test(src) || src.includes('eventSvc.pois'));

section('module-level bridge for top-level HUD (v0.6.0a)');
ok('BossBar draw set via setBossBarDraw', src.includes('setBossBarDraw('));
ok('EventBanner draw set via setEventBannerDraw', src.includes('setEventBannerDraw('));
ok('getBossBarDraw called in render', src.includes('getBossBarDraw('));
ok('getEventBannerDraw called in render', src.includes('getEventBannerDraw('));

section('helper integration in assembleGame');
ok('BossConfig.forBiome / all() fallback', src.includes('BossConfig.forBiome') && src.includes('BossConfig.all'));
ok('EventRegistry.all() for random event', src.includes('EventRegistry.all()'));
// v0.7.0a: tryPlaceBuilding uses buildingSvc.place, not buildingMgr.place
ok('tryPlaceBuilding uses buildingSvc.place', /function tryPlaceBuilding[\s\S]{0,200}buildingSvc\.place/.test(src));

section('v0.6.0a split sanity');
ok('assembly.js exports assembleGame', /export function assembleGame/.test(src));
ok('runtime.js exports runGame', /export function runGame/.test(src));
ok('main.js exports bootGame', /export function bootGame/.test(src));
ok('main.js is thin (< 50 lines)', readFileSync(join(srcDir, 'main.js'), 'utf8').split('\n').length < 50);

section('v0.7.0a: backward compat — old Manager fields still in game object');
ok('game.eventMgr    present', /eventMgr[,\s}]/.test(src));
ok('game.buildingMgr present', /buildingMgr[,\s}]/.test(src));
ok('game.monsterMgr  present', /monsterMgr[,\s}]/.test(src));

console.log(`\nm5.2 main-integration smoke: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
