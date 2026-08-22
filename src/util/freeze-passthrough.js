/**
 * freeze-passthrough.js — v0.8.0a
 *
 * 装配层 game 对象上的 pass-through 字段(指向 Manager / Service / UI 实例
 * 的引用)在装配完成后立即用 Object.defineProperty 锁成 writable=false,
 * 把"换引用"这种最严重的越权写入变成 TypeError。
 *
 * 动机:
 *   v0.6.0b(v0.7.0a 同理)把 inventory / eventMgr / buildingMgr / monsterMgr
 *   等 Manager 实例作为 pass-through 字段暴露在 game 上,UI 面板和 runtime
 *   可以只读访问;所有 mutation 必须走 InventoryService / EventService /
 *   BuildingService / MonsterService。但 pass-through 字段本身没冻结,任何
 *   代码都能 `game.inventory = newInv()` 整体换掉 — 状态泄漏,服务层单入
 *   口承诺被绕开。本工具用 Object.defineProperty 锁字段描述符,达到与
 *   Object.freeze 字段等价的语义(strict mode 下赋值抛 TypeError)。
 *
 * 设计取舍:
 *   - 锁字段描述符(writable=false + configurable=false),不冻字段值(实
 *     例本身)。原因:Object.freeze(实例) 会让实例的 own props 不可写,
 *     破坏 inventory.add / eventMgr.update / buildingMgr.place 等所有
 *     实例方法的合法 mutation;Service 入口单一性 + 内部 mutability 是
 *     已有约定,本任务只补"换引用"这一最严重泄漏口。
 *   - 不递归深冻:inventory.slots[i] = ... 仍不会抛错。Service 内部
 *     mutation(如 inventory.loadSnapshot 重新赋 this.slots)继续工作。
 *   - 字段级别 freeze(writable=false)等效于 Object.freeze 字段在 strict
 *     mode 下的行为 — 任何对 game.X 的赋值 / delete / redefine 抛
 *     TypeError。
 *   - 'use strict' 是前置条件:sloppy mode 下,赋值静默失败。装配层
 *     assembly.js 顶部有 'use strict';。
 *
 * 用法:
 *   import { freezePassThroughs } from './util/freeze-passthrough.js';
 *   // ... assembleGame 内部 ...
 *   const game = { inventory, eventMgr, buildingMgr, monsterMgr, runtime, ... };
 *   freezePassThroughs(game, [
 *     'inventory', 'eventMgr', 'buildingMgr', 'monsterMgr', 'gather',
 *     'buildingMenu', 'dayCycle', 'npcMgr', 'tradeState', 'tradeUI',
 *     'followerMgr', 'vitalsState', 'decor', 'village', 'transitions',
 *     'resources', 'input', 'camera', 'player', 'hud', 'bossMgr',
 *     'bossBar', 'eventBanner'
 *   ]);
 *   return game;
 */
'use strict';

/**
 * Lock down the given pass-through fields on `game` so that:
 *   - `game.X = newX`     throws TypeError (strict mode, writable=false)
 *   - `delete game.X`     throws TypeError (configurable=false)
 *   - `Object.defineProperty(game, 'X', ...)` throws TypeError
 *
 * Field values (the instance) are NOT frozen, so instance methods like
 * `inventory.add()` keep working. Service-entrypoint contract from
 * v0.6.0b / v0.7.0a (mutation only through the service) is the
 * upper-layer guarantee; this tool seals the "swap the whole reference"
 * leak.
 *
 * @param {Object} game — assembled game object (装配完成,即将 return)
 * @param {string[]} fields — pass-through field names to lock
 * @returns {string[]} — fields that were actually locked (skips null/undef)
 */
export function freezePassThroughs(game, fields) {
  if (!game || typeof game !== 'object') {
    throw new TypeError('freezePassThroughs: game must be an object');
  }
  if (!Array.isArray(fields)) {
    throw new TypeError('freezePassThroughs: fields must be an array');
  }
  const locked = [];
  for (const name of fields) {
    const val = game[name];
    if (val == null) continue;          // skip null/undefined
    // 锁字段描述符,达到与 Object.freeze 字段同等的语义:
    //   - writable=false    → 赋值抛 TypeError
    //   - configurable=false → delete / redefine 抛 TypeError
    Object.defineProperty(game, name, {
      value: val,
      writable: false,
      configurable: false,
      enumerable: true,                  // 保持原 enumerable
    });
    locked.push(name);
  }
  return locked;
}
