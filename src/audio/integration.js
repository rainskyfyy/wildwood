/**
 * attach() — bind the audio subsystem to the game world.
 *
 * Returns a controller object:
 *   {
 *     update(dtMs, ctx)        // per-frame: tracks biome, sanity, footsteps
 *     notify(event, payload)   // push high-level game events
 *     sfx, ambient, ui         // child facades
 *   }
 *
 * Wiring expectations (caller supplies):
 *   - audio:    AudioManager instance
 *   - world:    { getTile(x, y) }
 *   - getPlayer: () => { x, y, hp? }
 *   - vitalsState: { hp: {cur}, sanity: {cur, max} }
 */
'use strict';

import { AmbientController } from './ambient.js';
import { SfxDispatcher } from './sfx.js';
import { UiAudio } from './ui.js';

const SAN_MID = 60;
const SAN_LOW = 30;

function tileToBiomeId(world, x, y) {
  try {
    const id = world.getTile(x, y);
    if (!id) return 'plains';
    // The main.js uses getBiome(id).primary; here we just hash by tile id.
    // biome mapping is defined in world/biome-config.js; we only need a stable string.
    const known = ['forest', 'plains', 'mines', 'snow', 'desert', 'marsh', 'volcano'];
    const idx = (typeof id === 'string')
      ? known.findIndex(k => id.toLowerCase().includes(k))
      : -1;
    if (idx >= 0) return known[idx];
    // numeric codes used by world/generator: 0=forest, 1=plains, 2=mines, 3=snow
    if (id === 0) return 'forest';
    if (id === 1) return 'plains';
    if (id === 2) return 'mines';
    if (id === 3) return 'snow';
    return 'plains';
  } catch (_) { return 'plains'; }
}

export function attach(opts) {
  const audio = opts.audio;
  const world = opts.world;
  const getPlayer = opts.getPlayer || (() => null);
  const vitalsState = opts.vitalsState || null;

  const ambient = new AmbientController(audio, { onChange: opts.onBiomeChange });
  const sfx = new SfxDispatcher(audio, opts.sfx || {});
  const ui = new UiAudio(audio);

  let lastPlayerTile = { x: NaN, y: NaN };
  let lastHp = (vitalsState && vitalsState.hp) ? vitalsState.hp.cur : null;

  function update(/* dtMs */) {
    const p = getPlayer();
    if (!p || !world) return;
    // biome switch
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (tx !== lastPlayerTile.x || ty !== lastPlayerTile.y) {
      const biome = tileToBiomeId(world, tx, ty);
      ambient.updateBiome(biome);
      lastPlayerTile = { x: tx, y: ty };
      // footstep on tile change
      sfx.onFootstep();
    }
    // sanity distortion
    if (audio && audio.started && vitalsState && vitalsState.sanity) {
      const max = vitalsState.sanity.max || 100;
      const sNorm = Math.max(0, Math.min(1, vitalsState.sanity.cur / max));
      // 0 = sane, 1 = insane
      let amount;
      if (sNorm >= SAN_MID / max) amount = 0;
      else if (sNorm <= SAN_LOW / max) amount = 1;
      else amount = 1 - (sNorm - SAN_LOW / max) / ((SAN_MID - SAN_LOW) / max);
      audio.setSanityAmount(amount);
    }
    // hurt detection (HP drop)
    if (vitalsState && vitalsState.hp) {
      const cur = vitalsState.hp.cur;
      if (lastHp != null && cur < lastHp) sfx.onHurt();
      lastHp = cur;
    }
  }

  function notify(event, payload) {
    switch (event) {
      case 'gather_start':    sfx.onGatherStart();  break;
      case 'gather_complete': sfx.onGatherComplete(); break;
      case 'gather_cancel':   sfx.onGatherCancel(); break;
      case 'build_place':     sfx.onBuildPlace();  break;
      case 'build_fail':      sfx.onBuildFail();   break;
      case 'build_remove':    sfx.onBuildRemove(); break;
      case 'build_menu_open': sfx.onBuildMenuOpen(); break;
      case 'build_menu_close':sfx.onBuildMenuClose(); break;
      case 'attack':          sfx.onAttack(); break;
      case 'hurt':            sfx.onHurt();   break;
      case 'death':           sfx.onDeath();  break;
      case 'craft':           sfx.onCraft();  break;
      case 'pickup':          sfx.onPickup(); break;
      case 'ui_click':        ui.onClick();  break;
      case 'ui_hover':        ui.onHover();  break;
      case 'ui_open':         ui.onOpen();   break;
      case 'ui_close':        ui.onClose();  break;
      case 'ui_error':        ui.onError();  break;
      default: /* ignore */ break;
    }
    if (payload && payload.sound) {
      // ad-hoc raw id
      audio && audio.play && audio.play(payload.sound, payload.opts);
    }
  }

  return { update, notify, sfx, ambient, ui };
}

/** Alias used by main.js + tests. */
export const attachAudio = attach;
export default attach;
