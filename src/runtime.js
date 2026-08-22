/**
 * v0.6.0a — 运行时层(runtime layer)
 *
 * 职责:
 *   - requestAnimationFrame 主循环
 *   - 输入路由(panel click / 左键放建筑 / 左键采集 / 右键拆除 / 快捷键 B/L/E/F/T/Space)
 *   - 状态机推进(monster / boss / event / dayCycle / npc / follower)
 *   - 联机 tick(state/input 广播)
 *   - 渲染调度(render + HUD + loot banner + placement preview + building menu)
 *   - 持久化(localStorage inventory,1Hz)
 *
 * 不负责:
 *   - 创建 manager / world — 这属于 assembly.js
 *
 * 拆分前历史(同 assembly.js 注释):
 *   v0.5.4 — be97ee86ada2dba1ee1556aa5e3e24d87bf0dc0b — 单 main.js 918 行
 *   拆分后本文件 ~220 行,管线的"运行时"部分;之后改 5Hz tick 或事件分发只动本文件。
 */
'use strict';

import { render } from './assembly.js';
import { screenToWorld } from './render/picker.js';
import { getBuilding } from './buildings/building-config.js';
import { worldToScreen } from './render/isometric.js';
import { drawPlacementPreview } from './buildings/building-renderer.js';
import { BossConfig } from './boss/boss-config.js';
import { EventRegistry } from './events/events.js';
import { traderStock } from './trading/price-engine.js';

/**
 * 启动主循环。基于 assembly.assembleGame(canvas, opts) 返回的 ctx。
 *
 * @param {object} ctx — assembleGame 返回的状态对象
 * @returns {() => void} stopFn — 调用可停止主循环(目前未使用,留作接口)
 */
export function startRuntime(ctx) {
  let lastT = performance.now();
  let stopped = false;

  function frame(now) {
    if (stopped) return;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    // ── 解构出常用引用(只读)────────────────────────────────
    const {
      canvas, ctx2d, mode, playerName,
      world, decor, transitions, resources,
      inventory, gather, buildingMgr, buildingMenu,
      input, camera, player, hud,
      monsterMgr, bossMgr, bossBar, eventMgr, eventBanner,
      dayCycle, npcMgr, tradeState, tradeUI, followerMgr,
      vitalsState, loot, place,
      pushChat, updateChatDom,
      tryPlaceBuilding, tryFeed, tryRecruit, tryToggleTrade,
      saveInventory,
    } = ctx;
    const mp = ctx.mp;  // offline 时为 null

    // ── 输入路由 ─────────────────────────────────────────
    hud.processPanelToggles();
    let panelConsumed = false;
    if (input.consumeClick()) {
      panelConsumed = hud.handlePanelClick(input.mouseX, input.mouseY, canvas.width, canvas.height);
    }
    const menuSelected = buildingMenu.update(input, canvas.width, canvas.height);
    if (menuSelected) {
      const typeId = buildingMenu.consumeSelection();
      if (typeId) {
        place.pending = typeId;
        pushChat(`[系统] 已选择建筑:${getBuilding(typeId)?.name || typeId},移动鼠标 + 左键放置`);
      }
    }

    // 移动 + 采集(本地)
    if (!hud.inventoryPanel.visible && !hud.craftingPanel.visible && !buildingMenu.isOpen) {
      player.update(dt, input);
    }
    camera.follow(player);
    gather.update(player, dt);

    // 联机:tick 驱动 state/input 广播
    if (mp) mp.tick(now, input);

    // 鼠标左键:建筑放置 or 采集
    if (!panelConsumed && !buildingMenu.isOpen && input.consumeClick()) {
      const w = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
      const tx = Math.floor(w.x);
      const ty = Math.floor(w.y);
      if (place.pending) {
        tryPlaceBuilding(tx, ty);
      } else {
        gather.click(w.x, w.y);
      }
    }

    // 右键:取消待放置 / 拆除 / 配合 building menu
    if (input.consumeRightClick()) {
      if (place.pending) {
        place.pending = null;
        buildingMenu.close();
        pushChat('[系统] 已取消建筑选择');
      } else {
        const w = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
        const tx = Math.floor(w.x);
        const ty = Math.floor(w.y);
        const b = buildingMgr.buildings.find(b => b.contains(tx, ty));
        if (b) {
          const id = b.entityId;
          buildingMgr.remove(b);
          if (mp && mp.mode === 'host') mp.broadcastRemove(id);
          pushChat(`[系统] 拆除了 ${b.typeId}`);
        }
      }
    }
    if (hud.craftingPanel.visible && input.consumeRightClick()) {
      hud.craftingPanel.onClick(
        input.mouseX, input.mouseY, canvas.width, canvas.height,
        inventory.selected);
    }

    // ── v0.5.2 战斗 / Boss / 事件 ──────────────────────────
    // 9a. 应用活动事件到所有 monster(满月 +atk / +speed)
    if (eventMgr && typeof eventMgr.getMonsterMultiplier === 'function') {
      const mul = eventMgr.getMonsterMultiplier();
      for (const m of (monsterMgr?.monsters || [])) {
        m.effectiveAtk = Math.max(1, Math.round((m.config?.atk || 1) * (mul.atkMul || 1)));
        m.effectiveSpeed = (m.config?.speed || 1) * (mul.speedMul || 1);
      }
    }
    // 9b. tick monsters
    if (monsterMgr) monsterMgr.update(dt, player);
    // 9c. 玩家攻击(空格键)
    if (input.consumePressed(' ')) {
      let closest = null, closestD = Infinity;
      for (const m of (monsterMgr?.monsters || [])) {
        if (m.state === 'DEAD' || m.hp <= 0) continue;
        const d = Math.hypot(m.x - player.x, m.y - player.y);
        if (d < closestD) { closestD = d; closest = m; }
      }
      if (closest && player.attack(closest)) {
        loot.lastBanner = `Hit ${closest.typeId || closest.config?.id || 'mob'}`;
        loot.until = performance.now() + 1200;
      }
    }
    // 9d/9e. tick boss + event
    if (bossMgr) bossMgr.update(now / 1000);
    if (eventMgr) eventMgr.update(now / 1000);

    // 9f. 死亡回血(简化)
    if (player.hp <= 0) {
      player.hp = player.maxHp;
      vitalsState.hp.cur = player.maxHp;
      pushChat('[系统] 你倒下了,已被复活 (HP 满)');
    } else {
      vitalsState.hp.cur = player.hp;
    }

    // 9g. 快捷键 B = 召唤季节 Boss
    if (input.consumePressed('b') || input.consumePressed('B')) {
      const nowS = now / 1000;
      const BOSS_COOLDOWN_S = 12.0;
      if (nowS - place.cooldowns.boss >= BOSS_COOLDOWN_S) {
        place.cooldowns.boss = nowS;
        const playerBiome = world.getTile(Math.floor(player.x), Math.floor(player.y));
        const candidates = (typeof BossConfig.forBiome === 'function')
          ? BossConfig.forBiome(playerBiome) : BossConfig.all();
        if (candidates && candidates.length > 0) {
          const b = candidates[0];
          const ix = Math.floor(player.x), iy = Math.floor(player.y);
          let tx = ix, ty = iy;
          outer:
          for (let r = 3; r < 20; r += 2) {
            for (let dx = -r; dx <= r; dx += 2) {
              for (let dy = -r; dy <= r; dy += 2) {
                if (world.isWalkable(ix + dx, iy + dy)) {
                  tx = ix + dx; ty = iy + dy;
                  break outer;
                }
              }
            }
          }
          const spawned = bossMgr.spawnBoss(b.id, tx + 0.5, ty + 0.5);
          if (spawned) {
            pushChat(`[系统] 召唤 Boss:${b.name || b.id}`);
          }
        }
      } else {
        pushChat(`[系统] Boss 召唤冷却中 (${Math.ceil(12.0 - (nowS - place.cooldowns.boss))}s)`);
      }
    }
    // 9h. 快捷键 L = 触发一个随机事件
    if (input.consumePressed('l') || input.consumePressed('L')) {
      const nowS = now / 1000;
      const EVENT_COOLDOWN_S = 8.0;
      if (nowS - place.cooldowns.event >= EVENT_COOLDOWN_S) {
        place.cooldowns.event = nowS;
        const ids = Object.keys(EventRegistry.all());
        if (ids.length > 0) {
          const idx = Math.floor(Math.random() * ids.length);
          const ok = eventMgr.trigger(ids[idx], nowS);
          if (!ok) pushChat(`[系统] 事件 ${ids[idx]} 触发失败`);
        }
      } else {
        pushChat(`[系统] 事件冷却中 (${Math.ceil(8.0 - (nowS - place.cooldowns.event))}s)`);
      }
    }

    // ── v0.5.4 day/night + NPC + follower tick ────────────
    if (!hud.inventoryPanel.visible && !hud.craftingPanel.visible
        && !buildingMenu.isOpen && !tradeUI.isOpen()) {
      dayCycle.update(dt);
      const isDay = dayCycle.isDay();
      npcMgr.update(dt, { isDay, player });
      npcMgr.greetNearby(player, 4);
      followerMgr.update(dt);
    }
    // 9j. v0.5.4: feed / recruit / trade key edges
    if (input.consumePressed('e') || input.consumePressed('E')) tryFeed();
    if (input.consumePressed('f') || input.consumePressed('F')) tryRecruit();
    if (input.consumePressed('t') || input.consumePressed('T')) {
      // 注意:这里只处理 v0.5.4 的 T 键;v0.5.3 农耕 T 键由 cooking/processing 流程内部处理
      if (!hud.craftingPanel.visible) tryToggleTrade();
    }
    // 9k. 刷新 scarcity 快照(轻量,每帧)
    for (const id of traderStock()) {
      tradeState.scarcity[id] = inventory.countOf(id);
    }

    hud.update();
    input.endFrame();

    // vitals 衰减
    vitalsState.hunger.cur = Math.max(0, vitalsState.hunger.cur - dt * 0.4);
    vitalsState.sanity.cur = Math.max(0, vitalsState.sanity.cur - dt * 0.2);

    // ── 渲染 ─────────────────────────────────────────────
    render(ctx2d, canvas, world, decor, transitions, resources, player, camera, gather,
           buildingMgr, place.pending, mp, vitalsState, monsterMgr, bossBar, eventBanner, {
      // v0.5.4
      npcMgr, followerMgr, dayCycle
    });
    hud.draw(canvas.width, canvas.height, vitalsState, world, camera);

    // loot banner
    if (loot.lastBanner && now < loot.until) {
      ctx2d.fillStyle = 'rgba(0,0,0,0.7)';
      ctx2d.fillRect(canvas.width/2 - 110, 50, 220, 28);
      ctx2d.fillStyle = '#d4a64a';
      ctx2d.font = 'bold 14px sans-serif';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(`+ ${loot.lastBanner}`, canvas.width/2, 64);
    } else {
      loot.lastBanner = null;
    }

    // 放置预览(building menu 关闭后,半透明 ghost)
    if (place.pending && !buildingMenu.isOpen) {
      const w = screenToWorld(input.mouseX, input.mouseY, canvas, player, camera);
      const tx = Math.floor(w.x);
      const ty = Math.floor(w.y);
      const s = worldToScreen(tx, ty);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const camScreen = worldToScreen(camera.x, camera.y);
      const offsetX = cx - camScreen.x;
      const offsetY = cy - camScreen.y;
      const sx = s.x + offsetX;
      const sy = s.y + offsetY;
      const can = buildingMgr.canPlace(place.pending, tx, ty, player).ok;
      drawPlacementPreview(ctx2d, sx, sy, place.pending, can);
    }

    // 建造 menu 渲染
    buildingMenu.draw(ctx2d, canvas.width, canvas.height);

    // 1Hz 持久化(用 | 0 把毫秒时间戳截断成秒级,匹配每秒一次)
    if ((now | 0) % 60 === 0) saveInventory(inventory);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return () => { stopped = true; };
}
