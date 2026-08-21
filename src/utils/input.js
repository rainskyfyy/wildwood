/**
 * Input — keyboard + mouse state tracker.
 *
 *   isDown('w')      // keyboard boolean
 *   axisH() | axisV()    // -1/0/+1
 *   consumePressed('e')  // keyboard edge (cleared per frame)
 *   mouseX / mouseY      // last mouse position over the canvas
 *   consumeClick()       // left-click edge (cleared per frame)
 *   consumeRightClick()  // right-click edge (cleared per frame)
 */
'use strict';

const DEFAULT_BINDINGS = {
  up:    ['w', 'arrowup'],
  down:  ['s', 'arrowdown'],
  left:  ['a', 'arrowleft'],
  right: ['d', 'arrowright']
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this._clickPending = false;
    this._rightClickPending = false;

    this._onDown = (e) => {
      const k = e.key.toLowerCase();
      if (!this.down.has(k)) this.pressedThisFrame.add(k);
      this.down.add(k);
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    };
    this._onUp = (e) => { this.down.delete(e.key.toLowerCase()); };

    this._onMove = (e) => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (this.canvas.width  / rect.width);
      const sy = (e.clientY - rect.top)  * (this.canvas.height / rect.height);
      this.mouseX = sx;
      this.mouseY = sy;
    };
    this._onClick = (e) => {
      if (e.button === 0) this._clickPending = true;
    };
    this._onContext = (e) => {
      e.preventDefault();
      this._rightClickPending = true;
    };

    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup',   this._onUp);
    if (this.canvas) {
      this.canvas.addEventListener('mousemove',   this._onMove);
      this.canvas.addEventListener('mousedown',   this._onClick);
      this.canvas.addEventListener('contextmenu', this._onContext);
    }
  }

  isDown(key) { return this.down.has(key.toLowerCase()); }

  consumePressed(key) {
    const k = key.toLowerCase();
    if (this.pressedThisFrame.has(k)) {
      this.pressedThisFrame.delete(k);
      return true;
    }
    return false;
  }

  consumeClick() {
    if (this._clickPending) { this._clickPending = false; return true; }
    return false;
  }

  consumeRightClick() {
    if (this._rightClickPending) { this._rightClickPending = false; return true; }
    return false;
  }

  endFrame() { this.pressedThisFrame.clear(); }

  axisH() {
    let v = 0;
    for (const k of DEFAULT_BINDINGS.right) if (this.isDown(k)) v += 1;
    for (const k of DEFAULT_BINDINGS.left)  if (this.isDown(k)) v -= 1;
    return v;
  }
  axisV() {
    let v = 0;
    for (const k of DEFAULT_BINDINGS.down)  if (this.isDown(k)) v += 1;
    for (const k of DEFAULT_BINDINGS.up)    if (this.isDown(k)) v -= 1;
    return v;
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup',   this._onUp);
    if (this.canvas) {
      this.canvas.removeEventListener('mousemove',   this._onMove);
      this.canvas.removeEventListener('mousedown',   this._onClick);
      this.canvas.removeEventListener('contextmenu', this._onContext);
    }
  }
}
