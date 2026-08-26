/**
 * Wildwood v0.4 联机 — 游戏循环集成层。
 *
 * 提供 Multiplayer 适配器,把现有 main.js 接到 RelayClient + Session。
 *
 * 三种运行模式:
 *   - 'host'   — 在本地跑完整游戏(自己也是玩家),把世界状态广播给其他 peers;
 *                接收其他 peers 的 input(目前 demo 中其他 peer 也跑同一份代码,
 *                但 host 端只渲染自己 + 接收远端 state 显示他人)
 *   - 'join'   — 不跑本地游戏逻辑(由 host 权威),只接收 host 的 state,
 *                把鼠标/键盘 input 发给 host
 *   - null     — 单人模式,不联网
 *
 * 关键不变量(host 模式):
 *   - 自己的 player 由本地的 update() 推进
 *   - 每个动画帧把 {self, peers from Session} 打包成 G_STATE 广播
 *   - 收到的 world op(place_building/remove_building/gather_complete)应用到本地
 *
 * 关键不变量(join 模式):
 *   - 自己的 player 渲染完全靠收到的 G_STATE
 *   - 自己的 input 发给 host(host 在 demo 中通过 G_STATE 广播回其他人)
 *
 * 注:为简化 v0.4 demo,host 端"其他 peer 的 input"目前**不会**应用到 host 的世界
 * 模拟里 — 只展示他们的位置/状态。这与"world op 同步(建筑/采集)由 host 权威"是
 * 分开的;host 端自己发起建筑/采集,然后通过 G_WORLD 广播,其他 peers 应用。
 * 多人共同操作世界事件时,host 的本地操作会触发 G_WORLD;其他 peers 的
 * G_WORLD 也会应用到 host 的本地世界。
 */

'use strict';

import { G_WORLD, G_STATE, G_INPUT, G_CHAT, WORLD_PLACE_BUILDING,
         WORLD_REMOVE_BUILDING, WORLD_GATHER_COMPLETE, WORLD_RESOURCE_RESPAWN } from './protocol.js';

const STATE_BROADCAST_HZ = 10;     // 10 Hz 状态广播
const INPUT_SEND_HZ      = 30;     // 30 Hz input 发送

/**
 * 构造一个 Multiplayer 适配器。
 *
 * @param {object} opts
 * @param {'host'|'join'|null} opts.mode
 * @param {object} opts.client       — RelayClient
 * @param {object} opts.session      — Session
 * @param {object} opts.player       — 本地 Player 实例(x, y, facing)
 * @param {object} opts.world        — WorldGrid(包含 isWalkable, occupy, free)
 * @param {object} opts.buildingMgr  — BuildingManager(有 buildings 数组 + place/remove)
 * @param {Array}  opts.resources    — 资源实体数组
 * @param {object} opts.gather       — Gather 实例
 * @param {object} opts.vitals       — { hp, hunger, sanity } 当前状态
 * @param {Function} opts.onChat     — (msg) => void  收到聊天
 * @param {Function} opts.onKicked   — (reason) => void
 * @param {Function} opts.onPeerJoined   — (peer) => void
 * @param {Function} opts.onPeerLeft     — ({id, reason}) => void
 * @param {Function} opts.onPeerUpdated  — ({id, state}) => void
 */
export class Multiplayer {
  constructor(opts) {
    this.mode = opts.mode || null;
    this.client = opts.client;
    this.session = opts.session;
    this.player = opts.player;
    this.world = opts.world;
    this.buildingMgr = opts.buildingMgr;
    this.resources = opts.resources;
    this.gather = opts.gather;
    this.vitals = opts.vitals;
    this.onChat = opts.onChat || (() => {});
    this.onKicked = opts.onKicked || (() => {});
    this.onPeerJoined = opts.onPeerJoined || (() => {});
    this.onPeerLeft = opts.onPeerLeft || (() => {});
    this.onPeerUpdated = opts.onPeerUpdated || (() => {});

    this._lastStateAt = 0;
    this._lastInputAt = 0;
    this._lastInput = { ax: 0, ay: 0 };
    this._bound = false;

    this._wireClient();
  }

  _wireClient() {
    if (!this.client) return;
    if (this._bound) return;
    this._bound = true;
    this.client.on('state', (m) => this._onState(m));
    this.client.on('chat', (m) => this._onChat(m));
    this.client.on('world', (m) => this._onWorld(m));
    this.client.on('input', (m) => this._onRemoteInput(m));
    this.client.on('peer_joined', (m) => {
      this.session.addPeer({ id: m.id, name: m.name });
      this.onPeerJoined({ id: m.id, name: m.name });
    });
    this.client.on('peer_left', (m) => {
      this.session.removePeer(m.id, m.reason);
      this.onPeerLeft({ id: m.id, reason: m.reason });
    });
    this.client.on('peer_reconnected', (m) => {
      this.session.addPeer({ id: m.id, name: m.name });
    });
    this.client.on('kicked', (m) => {
      this.onKicked(m.reason || 'kicked');
    });
  }

  /* ---------- 接收侧 ---------- */

  _onState(m) {
    // 来自 host 的 state,应用到 session(更新所有 peer 的位置/状态)
    this.session.applyStateBroadcast(m);
    if (m.snapshot) {
      this._applySnapshot(m.snapshot);
    }
  }

  _onChat(m) {
    this.onChat(m);
  }

  _onWorld(m) {
    if (m.op === WORLD_PLACE_BUILDING) {
      // 在自己世界中也建一个(不重复本地的 place)
      this._applyRemotePlace(m);
    } else if (m.op === WORLD_REMOVE_BUILDING) {
      this._applyRemoteRemove(m);
    } else if (m.op === WORLD_GATHER_COMPLETE) {
      this._applyRemoteGather(m);
    } else if (m.op === WORLD_RESOURCE_RESPAWN) {
      this._applyRemoteRespawn(m);
    }
  }

  _onRemoteInput(_m) {
    // 远端 input(简化:仅用于调试显示;host 端不模拟其他玩家的物理)
    // 实际 demo 中,其他 peer 的"游戏世界推进"由 host 全权代理
    // (peer 发 input → host 用同样代码推进 → 广播 state)
    // 这里我们不重复应用,避免双重步进。
  }

  _applySnapshot(snap) {
    // 把 host 提供的 buildings/resources 同步到本地
    // 简单做法:清除并重建
    if (Array.isArray(snap.buildings)) this._syncBuildings(snap.buildings);
    if (Array.isArray(snap.resources)) this._syncResources(snap.resources);
  }

  _syncBuildings(remoteBuildings) {
    if (!this.buildingMgr) return;
    // 简化:全部清空然后重建
    // 注意:entityId 不会复用,但 id 字段(building typeId)由 host 决定
    // v0.4 demo 简化:把所有现存 building 移除,按 remote 列表重建
    while (this.buildingMgr.buildings.length > 0) {
      const b = this.buildingMgr.buildings[0];
      this.buildingMgr.remove(b);
    }
    for (const rb of remoteBuildings) {
      try {
        this.buildingMgr.place(rb.typeId, rb.tx, rb.ty, { x: 0, y: 0 });
      } catch (_) { /* skip invalid (e.g. occupied) */ }
    }
  }

  _syncResources(remoteResources) {
    if (!this.resources || !Array.isArray(remoteResources)) return;
    // 用 entityId 匹配本地 resources,更新 depleted / regrowAt
    const byId = new Map();
    for (const r of this.resources) byId.set(r.id, r);
    for (const rr of remoteResources) {
      const local = byId.get(rr.id);
      if (!local) continue;
      if (rr.depleted !== undefined) local.depleted = !!rr.depleted;
      if (rr.regrowAt !== undefined) local.regrowAt = rr.regrowAt;
    }
  }

  _applyRemotePlace(m) {
    if (!this.buildingMgr || !m.building) return;
    const b = m.building;
    // 如果本地已有同 id,跳过
    if (this.buildingMgr.buildings.some(x => x.entityId === b.entityId)) return;
    // 直接写入(无 range 检查):emit world 占位 + 重建对象
    // 简单做法:调用 place() 用一个 dummy player(0, 0),绕过 range 限制
    // —— place() 不强制 range,canPlace() 才检查
    // 我们需要先 occupy 再 push,绕开 place() 的 range 检查
    try {
      const def = this._getBuildingDef(b.typeId);
      if (!def) return;
      // 检查占用:已被占用则跳过(冲突)
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          if (!this.world.isWalkable(b.tx + dx, b.ty + dy)) return;
          if (this.world.isOccupied(b.tx + dx, b.ty + dy)) return;
        }
      }
      this.world.occupy(b.tx, b.ty, b.entityId);
      for (let dy = 0; dy < b.h; dy++) {
        for (let dx = 0; dx < b.w; dx++) {
          this.world.occupy(b.tx + dx, b.ty + dy, b.entityId);
        }
      }
      const Building = this._getBuildingClass();
      const nb = new Building({
        typeId: b.typeId, tx: b.tx, ty: b.ty, w: b.w, h: b.h,
        hp: b.hp, maxHp: b.maxHp, entityId: b.entityId,
      });
      this.buildingMgr.buildings.push(nb);
    } catch (_) { /* ignore */ }
  }

  _applyRemoteRemove(m) {
    if (!this.buildingMgr) return;
    const idx = this.buildingMgr.buildings.findIndex(b => b.entityId === m.entityId);
    if (idx >= 0) this.buildingMgr.remove(this.buildingMgr.buildings[idx]);
  }

  _applyRemoteGather(m) {
    if (!this.resources) return;
    const e = this.resources.find(r => r.id === m.entityId);
    if (!e) return;
    e.depleted = true;
    e.regrowAt = m.regrowAt || 0;
  }

  _applyRemoteRespawn(m) {
    if (!this.resources) return;
    const e = this.resources.find(r => r.id === m.entityId);
    if (!e) return;
    e.depleted = false;
    e.regrowAt = null;
  }

  /* ---------- 发送侧 ---------- */

  /** 每帧调用,根据需要发送 input / state。 */
  tick(now, input) {
    if (!this.client || !this.client.connected) return;
    // 发送 input:30 Hz,仅 join 模式
    if (this.mode === 'join' && input) {
      if (now - this._lastInputAt >= 1000 / INPUT_SEND_HZ) {
        const ax = input.axisH();
        const ay = input.axisV();
        if (ax !== this._lastInput.ax || ay !== this._lastInput.ay) {
          this.client.sendInput(ax, ay);
          this._lastInput = { ax, ay };
        }
        this._lastInputAt = now;
      }
    }
    // 发送 state:10 Hz,仅 host 模式
    if (this.mode === 'host') {
      if (now - this._lastStateAt >= 1000 / STATE_BROADCAST_HZ) {
        this._broadcastState();
        this._lastStateAt = now;
      }
    }
  }

  _broadcastState() {
    if (!this.client || !this.client.connected) return;
    const self = this.player;
    const selfV = this.vitals || { hp: {cur:100,max:100}, hunger: {cur:100,max:100}, sanity: {cur:100,max:100} };
    const players = [{
      id: this.session.self.id || 1,
      name: this.session.self.name || 'Host',
      x: self.x, y: self.y, facing: self.facing,
      hp: selfV.hp.cur,
      hunger: selfV.hunger.cur,
      sanity: selfV.sanity.cur,
    }];
    // 包含 session 中已知的 peer states
    for (const p of this.session.peers.values()) {
      if (p.state) players.push(p.state);
    }
    // 附上世界 snapshot(供新加入者)
    const buildings = (this.buildingMgr?.buildings || []).map(b => ({
      entityId: b.entityId, typeId: b.typeId, tx: b.tx, ty: b.ty,
      w: b.w, h: b.h, hp: b.hp, maxHp: b.maxHp,
    }));
    const resources = (this.resources || []).map(r => ({
      id: r.id, x: r.x, y: r.y, kind: r.kind, depleted: r.depleted, regrowAt: r.regrowAt,
    }));
    try {
      this.client.sendState({ tick: Date.now(), players, snapshot: { buildings, resources } });
    } catch (_) { /* not open yet */ }
  }

  /* ---------- 主动操作(由本端游戏事件触发)---------- */

  /** 玩家放置了建筑(本地),需要广播。 */
  broadcastPlace(building) {
    if (this.mode !== 'host' || !this.client?.connected) return;
    this.client.sendWorld({
      op: WORLD_PLACE_BUILDING,
      tx: building.tx, ty: building.ty, typeId: building.typeId,
      building: {
        entityId: building.entityId, typeId: building.typeId, tx: building.tx, ty: building.ty,
        w: building.w, h: building.h, hp: building.hp, maxHp: building.maxHp,
      },
    });
  }

  /** 玩家拆除了建筑(本地),需要广播。 */
  broadcastRemove(entityId) {
    if (this.mode !== 'host' || !this.client?.connected) return;
    this.client.sendWorld({ op: WORLD_REMOVE_BUILDING, entityId });
  }

  /** 玩家完成了采集(本地),需要广播。 */
  broadcastGather(entityId, loot, regrowAt = 0) {
    if (this.mode !== 'host' || !this.client?.connected) return;
    this.client.sendWorld({ op: WORLD_GATHER_COMPLETE, entityId, loot, regrowAt });
  }

  broadcastChat(text) {
    if (!this.client?.connected) return;
    this.client.sendChat(text);
  }

  /* ---------- 工具 ---------- */

  _getBuildingDef(typeId) {
    // 走 building-config.getBuilding
    try {
      // dynamic import lazy
      const mod = window.__wildwood_building_config;
      if (mod && mod.getBuilding) return mod.getBuilding(typeId);
    } catch (_) {}
    return null;
  }
  _getBuildingClass() {
    try {
      const mod = window.__wildwood_building_module;
      if (mod && mod.Building) return mod.Building;
    } catch (_) {}
    return null;
  }
}
