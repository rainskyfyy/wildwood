/**
 * Input — keyboard state tracker.
 *
 * Exposes a global Input singleton with:
 *   - isDown('w')      // boolean
 *   - axis('h') | axis('v')  // -1, 0, +1 for horizontal/vertical
 *   - consumePressed('e')    // returns true once per key-down edge
 *
 * Listens at window level; cleans up on dispose().
 */

'use strict';

const DEFAULT_BINDINGS = {
  up:    ['w', 'ArrowUp'],
  down:  ['s', 'ArrowDown'],
  left:  ['a', 'ArrowLeft'],
  right: ['d', 'ArrowRight']
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this._onDown = (e) => {
      const k = e.key.toLowerCase();
      if (!this.down.has(k)) this.pressedThisFrame.add(k);
      this.down.add(k);
      // prevent page scroll on arrow keys / space
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    };
    this._onUp = (e) => {
      this.down.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
  }

  isDown(key) {
    return this.down.has(key.toLowerCase());
  }

  /**
   * Returns true exactly once per key-down edge.
   * Caller must call this once per frame.
   */
  consumePressed(key) {
    const k = key.toLowerCase();
    if (this.pressedThisFrame.has(k)) {
      this.pressedThisFrame.delete(k);
      return true;
    }
    return false;
  }

  /** Call once per frame to clear the pressed-edge buffer. */
  endFrame() {
    this.pressedThisFrame.clear();
  }

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
    window.removeEventListener('keyup', this._onUp);
  }
}
