/**
 * runtime.js — v0.6.0a
 *
 * 负责游戏循环与渲染:frame() / render() / drawNameHp() / biomeCodeToId()
 * 等纯运行时逻辑,接受 assembly.js 装配好的 game 对象。
 *
 * 拆分动机:
 *  - 装配(assembly.js)与运行(runtime.js)解耦,集成新子任务时改动只落
 *    在装配侧,不动渲染 / 循环逻辑
 *  - frame() 与 render() 的闭包状态集中到 `game.runtime`,避免散落在
 *    main.js 顶层作用域
 *  - 顶层 HUD(BossBar / EventBanner)的 draw 通过 util/render-hooks.js
 *    注入,避免 render() 顶层函数无法访问 bossMgr / eventMgr 的问题
 *
 * 反向依赖:runtime.js → assembly.js(assembleGame 返回的 game 对象)
 * 正向依赖:assembly.js → runtime.js(通过 main.js 串联,见 main.js)
 */
'use strict';

import { getBiome } from './world/biome-config.js';
import { blendColors } from './world/transitions.js';
import {
  TILE_W_HALF, TILE_H_HALF,
  worldToScreen, depthKey
} from './render/isometric.js';
import { getTileSprite, drawDecoration, drawPlayer } from './render/tile-renderer.js';
import { drawResource } from './render/resource-renderer.js';
import { screenToWorld } from './render/picker.js';
import { drawBuilding, drawPlacementPreview } from './buildings/building-renderer.js';
import { getBuilding } from './buildings/building-config.js';
import { BossConfig } from './boss/boss-config.js';
import { EventRegistry } from './events/events.js';
import { PiglinState } from './npc/npc-manager.js';
import { traderStock } from './trading/price-engine.js';
import { drawPiglin, drawFollower, drawBuilding as drawVillageBuilding } from './render/npc-renderer.js';
import { getBossBarDraw, getEventBannerDraw } from './util/render-hooks.js';
import { saveInventory } from './assembly.js';

/* ============================================================
 * Frame loop
 * ============================================================ */

/**
 * 启动 game 的帧循环。返回 frame 控制句柄(目前未用,留作未来暂停/重启)。
 * @param {Object} game — assembleGame() 返回的 game 对象
 * @returns {{ stop: () => void, running: boolean }}
 */
export function runGame(game) {
  let lastT = performance.now();
  let running = true;
  let rafId = 0;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    // ---- 1. Panel toggles & panel click consume ----
    game.hud.processPanelToggles();

    let panelConsumed = false;
    if (game.input.consumeClick()) {
      panelConsumed = game.hud.handlePanelClick(
        game.input.mouseX, game.input.mouseY,
        game.canvas.width, game.canvas.height
      );
    }

    // ---- 2. Building menu update ----
    const menuSelected = game.buildingMenu.update(
      game.input, game.canvas.width, game.canvas.height
    );
    if (menuSelected) {
      const typeId = game.buildingMenu.consumeSelection();
      if (typeId) {
        game.runtime.pendingBuilding = typeId;
        game.pushChat(
          `[系统] 已选择建筑:${getBuilding(typeId)?.name || typeId},移动鼠标 + 左键放置`
        );
      }
    }

    // ---- 3. 移动 + 采集(本地) ----
    if (!game.hud.inventoryPanel.visible
        && !game.hud.craftingPanel.visible
        && !game.buildingMenu.isOpen) {
      game.player.update(dt, game.input);
    }
    game.camera.follow(game.player);
    game.gather.update(game.player, dt);

    // ---- 4. 联机:tick 驱动 state/input 广播 ----
    if (game.runtime.mp) game.runtime.mp.tick(now, game.input);

    // ---- 5. 鼠标左键:放置 或 采集 ----
    if (!panelConsumed && !game.buildingMenu.isOpen && game.input.consumeClick()) {
      const w = screenToWorld(
        game.input.mouseX, game.input.mouseY,
        game.canvas, game.player, game.camera
      );
      const tx = Math.floor(w.x);
      const ty = Math.floor(w.y);
      if (game.runtime.pendingBuilding) {
        game.tryPlaceBuilding(tx, ty);
      } else {
        game.gather.click(w.x, w.y);
      }
    }

    // ---- 6. 右键:取消 / 拆除 ----
    if (game.input.consumeRightClick()) {
      if (game.runtime.pendingBuilding) {
        game.runtime.pendingBuilding = null;
        game.buildingMenu.close();
        game.pushChat('[系统] 已取消建筑选择');
      } else {
        // 拆除:找光标下的 building
        const w = screenToWorld(
          game.input.mouseX, game.input.mouseY,
          game.canvas, game.player, game.camera
        );
        const tx = Math.floor(w.x);
        const ty = Math.floor(w.y);
        const b = game.buildingMgr.buildings.find(b => b.contains(tx, ty));
        if (b) {
          const id = b.entityId;
          game.buildingMgr.remove(b);
          if (game.runtime.mp && game.runtime.mp.mode === 'host') {
            game.runtime.mp.broadcastRemove(id);
          }
          game.pushChat(`[系统] 拆除了 ${b.typeId}`);
        }
      }
    }

    // ---- 6b. right-click 配合 crafting panel ----
    if (game.hud.craftingPanel.visible && game.input.consumeRightClick()) {
      game.hud.craftingPanel.onClick(
        game.input.mouseX, game.input.mouseY,
        game.canvas.width, game.canvas.height,
        game.inventory.selected
      );
    }

    // ---- 7. v0.5.2 战斗 / Boss / 事件 ----
    // 7a. 活动事件 → monster multiplier
    if (game.eventMgr && typeof game.eventMgr.getMonsterMultiplier === 'function') {
      const mul = game.eventMgr.getMonsterMultiplier();
      for (const m of (game.monsterMgr?.monsters || [])) {
        m.effectiveAtk = Math.max(1, Math.round((m.config?.atk || 1) * (mul.atkMul || 1)));
        m.effectiveSpeed = (m.config?.speed || 1) * (mul.speedMul || 1);
      }
    }
    // 7b. tick monsters
    if (game.monsterMgr) game.monsterMgr.update(dt, game.player);

    // 7c. 玩家攻击(空格键) — 找最近 monster/boss
    if (game.input.consumePressed(' ')) {
      let closest = null, closestD = Infinity;
      for (const m of (game.monsterMgr?.monsters || [])) {
        if (m.state === 'DEAD' || m.hp <= 0) continue;
        const d = Math.hypot(m.x - game.player.x, m.y - game.player.y);
        if (d < closestD) { closestD = d; closest = m; }
      }
      if (closest && game.player.attack(closest)) {
        game.runtime.lastLootBanner =
          `Hit ${closest.typeId || closest.config?.id || 'mob'}`;
        game.runtime.lastLootUntil = performance.now() + 1200;
      }
    }
    // 7d. tick boss
    if (game.bossMgr) game.bossMgr.update(now / 1000);
    // 7e. tick events
    if (game.eventMgr) game.eventMgr.update(now / 1000);

    // 7f. 死亡后回血(简化)
    if (game.player.hp <= 0) {
      game.player.hp = game.player.maxHp;
      game.vitalsState.hp.cur = game.player.maxHp;
      game.pushChat('[系统] 你倒下了,已被复活 (HP 满)');
    } else {
      game.vitalsState.hp.cur = game.player.hp;
    }

    // 7g. B 键 = 召唤季节 Boss(选最近 biomes)
    if (game.input.consumePressed('b') || game.input.consumePressed('B')) {
      const nowS = now / 1000;
      if (nowS - game.runtime.lastBossTrigger >= game.BOSS_COOLDOWN_S) {
        game.runtime.lastBossTrigger = nowS;
        const playerBiome = game.world.getTile(
          Math.floor(game.player.x), Math.floor(game.player.y)
        );
        const candidates = (typeof BossConfig.forBiome === 'function')
          ? BossConfig.forBiome(playerBiome) : BossConfig.all();
        if (candidates && candidates.length > 0) {
          const b = candidates[0];
          const ix = Math.floor(game.player.x), iy = Math.floor(game.player.y);
          let tx = ix, ty = iy;
          outer:
          for (let r = 3; r < 20; r += 2) {
            for (let dx = -r; dx <= r; dx += 2) {
              for (let dy = -r; dy <= r; dy += 2) {
                if (game.world.isWalkable(ix + dx, iy + dy)) {
                  tx = ix + dx; ty = iy + dy;
                  break outer;
                }
              }
            }
          }
          const spawned = game.bossMgr.spawnBoss(b.id, tx + 0.5, ty + 0.5);
          if (spawned) {
            game.pushChat(`[系统] 召唤 Boss:${b.name || b.id}`);
          }
        }
      } else {
        const remain = Math.ceil(
          game.BOSS_COOLDOWN_S - (nowS - game.runtime.lastBossTrigger)
        );
        game.pushChat(`[系统] Boss 召唤冷却中 (${remain}s)`);
      }
    }

    // 7h. L 键 = 触发随机事件
    if (game.input.consumePressed('l') || game.input.consumePressed('L')) {
      const nowS = now / 1000;
      if (nowS - game.runtime.lastEventTrigger >= game.EVENT_COOLDOWN_S) {
        game.runtime.lastEventTrigger = nowS;
        const ids = Object.keys(EventRegistry.all());
        if (ids.length > 0) {
          const idx = Math.floor(Math.random() * ids.length);
          const ok = game.eventMgr.trigger(ids[idx], nowS);
          if (!ok) game.pushChat(`[系统] 事件 ${ids[idx]} 触发失败`);
        }
      } else {
        const remain = Math.ceil(
          game.EVENT_COOLDOWN_S - (nowS - game.runtime.lastEventTrigger)
        );
        game.pushChat(`[系统] 事件冷却中 (${remain}s)`);
      }
    }

    // ---- 8. v0.5.4: day/night + NPC + follower tick — 仅在无 panel 打开时 ----
    if (!game.hud.inventoryPanel.visible
        && !game.hud.craftingPanel.visible
        && !game.buildingMenu.isOpen
        && !game.tradeUI.isOpen()) {
      game.dayCycle.update(dt);
      const isDay = game.dayCycle.isDay();
      game.npcMgr.update(dt, { isDay, player: game.player });
      game.npcMgr.greetNearby(game.player, 4);
      game.followerMgr.update(dt);
    }
    // 8b. v0.5.4: feed / recruit / trade key edges
    if (game.input.consumePressed('e') || game.input.consumePressed('E')) game.tryFeed();
    if (game.input.consumePressed('f') || game.input.consumePressed('F')) game.tryRecruit();
    if (game.input.consumePressed('t') || game.input.consumePressed('T')) {
      // 注意:这里只处理 v0.5.4 的 T 键;v0.5.3 农耕 T 键由 cooking/processing 流程内部处理
      if (!game.hud.craftingPanel.visible) game.tryToggleTrade();
    }
    // 8c. 刷新 scarcity 快照(每帧)
    for (const id of traderStock()) {
      game.tradeState.scarcity[id] = game.inventory.countOf(id);
    }

    // ---- 9. HUD + render ----
    game.hud.update();
    game.input.endFrame();

    game.vitalsState.hunger.cur = Math.max(
      0, game.vitalsState.hunger.cur - dt * 0.4
    );
    game.vitalsState.sanity.cur = Math.max(
      0, game.vitalsState.sanity.cur - dt * 0.2
    );

    render(game, dt);

    game.hud.draw(
      game.canvas.width, game.canvas.height,
      game.vitalsState, game.world, game.camera
    );

    // ---- 10. loot banner ----
    if (game.runtime.lastLootBanner && now < game.runtime.lastLootUntil) {
      game.ctx.fillStyle = 'rgba(0,0,0,0.7)';
      game.ctx.fillRect(game.canvas.width / 2 - 110, 50, 220, 28);
      game.ctx.fillStyle = '#d4a64a';
      game.ctx.font = 'bold 14px sans-serif';
      game.ctx.textAlign = 'center';
      game.ctx.textBaseline = 'middle';
      game.ctx.fillText(
        `+ ${game.runtime.lastLootBanner}`,
        game.canvas.width / 2, 64
      );
    } else {
      game.runtime.lastLootBanner = null;
    }

    // ---- 11. 放置预览(building menu 关闭后) ----
    if (game.runtime.pendingBuilding && !game.buildingMenu.isOpen) {
      const w = screenToWorld(
        game.input.mouseX, game.input.mouseY,
        game.canvas, game.player, game.camera
      );
      const tx = Math.floor(w.x);
      const ty = Math.floor(w.y);
      const s = worldToScreen(tx, ty);
      const cx = game.canvas.width / 2;
      const cy = game.canvas.height / 2;
      const camScreen = worldToScreen(game.camera.x, game.camera.y);
      const offsetX = cx - camScreen.x;
      const offsetY = cy - camScreen.y;
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;
      const can = game.buildingMgr.canPlace(
        game.runtime.pendingBuilding, tx, ty, game.player
      ).ok;
      drawPlacementPreview(game.ctx, sx, sy, game.runtime.pendingBuilding, can);
    }

    // ---- 12. 建造 menu 渲染 ----
    game.buildingMenu.draw(game.ctx, game.canvas.width, game.canvas.height);

    // ---- 13. periodic save(每 60ms 一次) ----
    if ((now | 0) % 60 === 0) saveInventory(game.inventory);

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return {
    get running() { return running; },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }
  };
}

/* ============================================================
 * Render
 * ============================================================ */

function render(game, dt) {
  const { ctx, canvas, world, decor, transitions, resources,
          player, camera, gather, buildingMgr, vitalsState,
          monsterMgr, runtime } = game;
  const npcMgr = game.npcMgr;
  const followerMgr = game.followerMgr;
  const dayCycle = game.dayCycle;
  const mp = runtime.mp;

  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bounds = camera.viewBounds();
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const camScreen = worldToScreen(camera.x, camera.y);
  const offsetX = cx - camScreen.x;
  const offsetY = cy - camScreen.y;

  // 1. 地表瓦片 + 群系过渡
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const id = world.getTile(x, y);
      if (!id) continue;
      const biome = getBiome(id);
      const ei = world.idx(x, y);
      const s = worldToScreen(x, y);
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;
      const sprite = getTileSprite(id);
      ctx.drawImage(sprite, sx - TILE_W_HALF, sy - TILE_H_HALF);
      if (transitions.neighbor[ei] >= 0) {
        const otherCode = transitions.neighbor[ei];
        const other = getBiome(biomeCodeToId(otherCode));
        const blended = blendColors(biome.primary, other.primary, transitions.blend[ei]);
        ctx.fillStyle = blended;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(sx, sy - TILE_H_HALF);
        ctx.lineTo(sx + TILE_W_HALF, sy);
        ctx.lineTo(sx, sy + TILE_H_HALF);
        ctx.lineTo(sx - TILE_W_HALF, sy);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    }
  }

  // 2. 收集所有可视对象(深度排序)
  const drawables = [];
  for (const d of decor) {
    if (d.x < bounds.x0 - 1 || d.x > bounds.x1 + 1
     || d.y < bounds.y0 - 1 || d.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'decor', ref: d, depth: depthKey(d.x, d.y) });
  }
  for (const r of resources) {
    if (r.x < bounds.x0 - 1 || r.x > bounds.x1 + 1
     || r.y < bounds.y0 - 1 || r.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'resource', ref: r, depth: depthKey(r.x, r.y) });
  }
  for (const b of (buildingMgr?.buildings || [])) {
    if (b.tx < bounds.x0 - 2 || b.tx > bounds.x1 + 2
     || b.ty < bounds.y0 - 2 || b.ty > bounds.y1 + 2) continue;
    drawables.push({ kind: 'building', ref: b, depth: depthKey(b.tx, b.ty) });
  }
  // v0.5.2 monsters(含 Boss)
  for (const m of (monsterMgr?.monsters || [])) {
    if (m.x < bounds.x0 - 1 || m.x > bounds.x1 + 1
     || m.y < bounds.y0 - 1 || m.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'monster', ref: m, depth: depthKey(m.x, m.y) });
  }
  // v0.5.2 event POIs(cave_poi, meteor_fall)
  if (game.eventMgr && Array.isArray(game.eventMgr.pois)) {
    for (const p of game.eventMgr.pois) {
      if (!p || p.x == null) continue;
      if (p.x < bounds.x0 - 1 || p.x > bounds.x1 + 1
       || p.y < bounds.y0 - 1 || p.y > bounds.y1 + 2) continue;
      drawables.push({ kind: 'poi', ref: p, depth: depthKey(p.x, p.y) });
    }
  }
  // v0.5.4 village buildings
  for (const b of (npcMgr?.buildings || [])) {
    if (b.x < bounds.x0 - 2 || b.x > bounds.x1 + 2
     || b.y < bounds.y0 - 2 || b.y > bounds.y1 + 2) continue;
    drawables.push({ kind: 'villageBuilding', ref: b, depth: depthKey(b.x, b.y) });
  }
  // v0.5.4 piglins
  for (const p of (npcMgr?.piglins || [])) {
    if (p.state === PiglinState.DEAD) continue;
    if (p.x < bounds.x0 - 1 || p.x > bounds.x1 + 1
     || p.y < bounds.y0 - 1 || p.y > bounds.y1 + 1) continue;
    drawables.push({ kind: 'piglin', ref: p, depth: depthKey(p.x, p.y) });
  }
  // v0.5.4 follower
  const follower = followerMgr?.current();
  if (follower && follower.alive) {
    if (follower.x >= bounds.x0 - 1 && follower.x <= bounds.x1 + 1
     && follower.y >= bounds.y0 - 1 && follower.y <= bounds.y1 + 1) {
      drawables.push({ kind: 'follower', ref: follower, depth: depthKey(follower.x, follower.y) });
    }
  }
  drawables.push({ kind: 'player', depth: depthKey(player.x, player.y), ref: player });

  // 远端玩家(联机)
  if (mp && mp.session) {
    for (const p of mp.session.peers.values()) {
      if (!p.state) continue;
      const px = p.state.x, py = p.state.y;
      if (px < bounds.x0 - 1 || px > bounds.x1 + 1
       || py < bounds.y0 - 1 || py > bounds.y1 + 1) continue;
      drawables.push({ kind: 'remote', ref: p, depth: depthKey(px, py) });
    }
  }
  drawables.sort((a, b) => a.depth - b.depth);

  // 3. 深度排序后绘制
  for (const it of drawables) {
    if (it.kind === 'decor') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      drawDecoration(ctx, s.x + offsetX, s.y + offsetY, it.ref);
    } else if (it.kind === 'resource') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      const progress = (gather.target === it.ref) ? gather.progressFraction() : 0;
      drawResource(ctx, s.x + offsetX, s.y + offsetY, it.ref, progress);
    } else if (it.kind === 'building') {
      const s = worldToScreen(it.ref.tx, it.ref.ty);
      drawBuilding(ctx, s.x + offsetX, s.y + offsetY, it.ref, { showHp: true });
    } else if (it.kind === 'player') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      drawPlayer(ctx, s.x + offsetX, s.y + offsetY, it.ref.facing);
      drawNameHp(
        ctx, s.x + offsetX, s.y + offsetY,
        mp?.session?.self?.name || '你',
        vitalsState, true
      );
    } else if (it.kind === 'remote') {
      const s = worldToScreen(it.ref.state.x, it.ref.state.y);
      const facing = it.ref.state.facing || 'down';
      drawPlayer(ctx, s.x + offsetX, s.y + offsetY, facing);
      drawNameHp(
        ctx, s.x + offsetX, s.y + offsetY,
        it.ref.name || '?', it.ref.state, false
      );
    } else if (it.kind === 'villageBuilding') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      drawVillageBuilding(ctx, s.x + offsetX, s.y + offsetY, it.ref);
    } else if (it.kind === 'piglin') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      drawPiglin(ctx, s.x + offsetX, s.y + offsetY, it.ref);
    } else if (it.kind === 'follower') {
      const s = worldToScreen(it.ref.x, it.ref.y);
      drawFollower(ctx, s.x + offsetX, s.y + offsetY, it.ref);
    } else if (it.kind === 'monster') {
      drawMonster(ctx, it.ref, offsetX, offsetY);
    } else if (it.kind === 'poi') {
      drawPoi(ctx, it.ref, offsetX, offsetY);
    }
  }

  // 4. 顶层 HUD:BossBar / EventBanner
  const _bossBarDraw = getBossBarDraw();
  const _eventBannerDraw = getEventBannerDraw();
  if (typeof _bossBarDraw === 'function') _bossBarDraw(dt);
  if (typeof _eventBannerDraw === 'function') _eventBannerDraw(dt);

  // 5. v0.5.4: 右上角 day/night label
  if (dayCycle) {
    const dc = dayCycle;
    const w = 110, h = 20;
    const x = canvas.width - w - 12;
    const y = 12;
    ctx.fillStyle = dc.isDay() ? 'rgba(212,166,74,0.85)' : 'rgba(60,40,80,0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = dc.isDay() ? '#1a1a2a' : '#f0f0f0';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dc.describe(), x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

function drawMonster(ctx, m, offsetX, offsetY) {
  const s = worldToScreen(m.x, m.y);
  const sx = s.x + offsetX, sy = s.y + offsetY;
  const tint = (m.phase && m.phase.colorTint) || m.config?.colorTint
    || (m.config?.biome === 'snow' ? '#cfe8ff'
        : m.config?.biome === 'desert' ? '#d4a04a'
        : m.config?.biome === 'marsh' ? '#5a8a4a'
        : m.config?.biome === 'volcano' ? '#d4623a'
        : '#888');
  const hpPct = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
  const isBoss = !!(m.config && m.config.phases);
  const radius = isBoss ? 22 : 10;
  ctx.save();
  ctx.fillStyle = isBoss ? '#1a0e0e' : '#222';
  ctx.beginPath();
  ctx.arc(sx, sy - radius, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tint;
  ctx.globalAlpha = m.state === 'DEAD' ? 0.4 : 1.0;
  ctx.beginPath();
  ctx.arc(sx, sy - radius, radius - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;
  if (isBoss) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px ui-monospace';
    ctx.textAlign = 'center';
    ctx.fillText(m.config.name || m.config.id, sx, sy - radius * 2 - 4);
  }
  const barW = isBoss ? 36 : 20, barH = 3;
  const bx = sx - barW / 2, by = sy - radius * 2 + (isBoss ? -2 : 4);
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
  ctx.fillStyle = '#400';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = hpPct > 0.5 ? '#5ad870' : hpPct > 0.25 ? '#d4c84a' : '#d45a4a';
  ctx.fillRect(bx, by, barW * hpPct, barH);
  ctx.restore();
}

function drawPoi(ctx, p, offsetX, offsetY) {
  const s = worldToScreen(p.x, p.y);
  const sx = s.x + offsetX, sy = s.y + offsetY;
  ctx.save();
  ctx.fillStyle = (p.kind === 'meteor_fall') ? '#ffb84a' : '#88c8ff';
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(sx, sy - 6, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (p.kind === 'meteor_fall') {
    ctx.strokeStyle = '#ff6a3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy - 14);
    ctx.lineTo(sx, sy - 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNameHp(ctx, sx, sy, name, state, self) {
  if (!state) return;
  const label = self ? `${name} (你)` : name;
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const w = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(sx - w / 2, sy - 32, w, 14);
  ctx.fillStyle = self ? '#d4a64a' : '#88c8ff';
  ctx.fillText(label, sx, sy - 20);
  if (Number.isFinite(state.hp)) {
    const barW = 30, barH = 2;
    const bx = sx - barW / 2, by = sy - 17;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx, by, barW, barH);
    const pct = Math.max(0, Math.min(1, state.hp / 100));
    ctx.fillStyle = pct > 0.5 ? '#5ad870' : pct > 0.25 ? '#d4c84a' : '#d45a4a';
    ctx.fillRect(bx, by, barW * pct, barH);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

const CODE_TO_BIOME = ['forest', 'plains', 'mines', 'snow'];
function biomeCodeToId(c) { return CODE_TO_BIOME[c] || 'plains'; }
