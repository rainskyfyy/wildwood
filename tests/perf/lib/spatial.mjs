/**
 * Shared perf test infrastructure — AABB / Quadtree / Mock canvas ctx.
 *
 * Pure data structures used by all scenarios that need spatial queries
 * or fake canvas. Kept dependency-free so each scenario can import
 * what it needs without pulling in unrelated code.
 */

'use strict';

// ---------------------------------------------------------------------------
// AABB
// ---------------------------------------------------------------------------

export class AABB {
  constructor(minX, minY, maxX, maxY) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }
  intersects(o) {
    return this.minX <= o.maxX && this.maxX >= o.minX &&
           this.minY <= o.maxY && this.maxY >= o.minY;
  }
  get cx() { return (this.minX + this.maxX) * 0.5; }
  get cy() { return (this.minY + this.maxY) * 0.5; }
  quadIndex(x, y) {
    const east = x >= this.cx;
    const north = y < this.cy;
    if (east && north) return 0;
    if (!east && north) return 1;
    if (east && !north) return 2;
    return 3;
  }
  childBounds(i) {
    const cx = this.cx, cy = this.cy;
    if (i === 0) return new AABB(cx, this.minY, this.maxX, cy);
    if (i === 1) return new AABB(this.minX, this.minY, cx, cy);
    if (i === 2) return new AABB(cx, cy, this.maxX, this.maxY);
    return new AABB(this.minX, cy, cx, this.maxY);
  }
}

// ---------------------------------------------------------------------------
// Quadtree (port of core/abstract/ai/quadtree.py)
// ---------------------------------------------------------------------------

const QT_CAP = 8;
const QT_DEPTH = 8;

export class Quadtree {
  constructor(b, d = 0) {
    this.b = b;
    this.d = d;
    this.items = [];
    this.kids = null;
  }
  insert(it) {
    if (this.kids) {
      this.kids[this.b.quadIndex(it.b.cx, it.b.cy)].insert(it);
      return;
    }
    this.items.push(it);
    if (this.items.length > QT_CAP && this.d < QT_DEPTH) this._split();
  }
  _split() {
    this.kids = [0, 1, 2, 3].map(i => new Quadtree(this.b.childBounds(i), this.d + 1));
    for (const it of this.items) this.kids[this.b.quadIndex(it.b.cx, it.b.cy)].insert(it);
    this.items = [];
  }
  queryRegion(r, out = []) {
    if (!this.b.intersects(r)) return out;
    if (this.kids) {
      for (const k of this.kids) k.queryRegion(r, out);
    } else {
      for (const it of this.items) if (it.b.intersects(r)) out.push(it);
    }
    return out;
  }
  rebuild(items) {
    this.items = [];
    this.kids = null;
    for (const it of items) this.insert(it);
  }
}

// ---------------------------------------------------------------------------
// Mock Canvas2D context — cost model approximated for typical Chrome
// Canvas2D on x86_64 (calibrated against a 2019-era laptop).
//
// Used by all render-pipeline scenarios to keep tests hermetic — no
// native dep on libcairo (node-canvas) and identical numbers across
// Linux/macOS/Windows CI.
// ---------------------------------------------------------------------------

export class MockCtx {
  constructor() {
    this.calls = 0;
    this.drawCalls = 0;
    this._fs = '#000';
    this.totalNs = 0;
  }
  _t(ns) { this.calls++; this.totalNs += ns; }
  save()              { this._t(200); }
  restore()           { this._t(200); }
  translate()         { this._t(200); }
  set fillStyle(v)    { this._t(50);  this._fs = v; }
  get fillStyle()     { return this._fs; }
  fillRect()          { this._t(800); this.drawCalls++; }
  clearRect()         { this._t(800); this.drawCalls++; }
  beginPath()         { this._t(100); }
  closePath()         { this._t(100); }
  moveTo()            { this._t(250); }
  lineTo()            { this._t(250); }
  arc()               { this._t(250); }
  fill()              { this._t(600); this.drawCalls++; }
  stroke()            { this._t(600); this.drawCalls++; }
  drawImage()         { this._t(1200); this.drawCalls++; }
}
