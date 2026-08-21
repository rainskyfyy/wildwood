/**
 * Input — keyboard + mouse state tracker.
 *
 * Keyboard exposes:
 *   - isDown('w')               // boolean
 *   - axis('h') | axis('v')     // -1, 0, +1 for horizontal/vertical
 *   - consumePressed('e')       // returns true once per key-down edge
 *
 * Mouse exposes (M2.9):
 *   - mouseX, mouseY            // canvas-space coords (CSS pixels)
 *   - consumeLeftClick()        // true once per click edge
 *   - consumeRightClick()       // true once per right-click edge
 *
 * The constructor accepts an optional `canvas` (HTMLElement) for mouse
 * listeners. Without a canvas, mouse coords are 0/0 and click
 * consumers always return false. This keeps the module usable in
 * Node (smoke tests) where no DOM is available.
 *
 * Listens at window level for keys, on the supplied canvas for mouse
 * (so coords map to the canvas surface). Cleans up on dispose().
 */

'use strict';

const DEFAULT_BINDINGS = {
  up:    ['w', 'ArrowUp'],
  down:  ['s', 'ArrowDown'],
  left:  ['a', 'ArrowLeft'],
  right: ['d', 'ArrowRight']
};

export class Input {
  constructor(canvas = null) {
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this._leftPressed = false;
    this._rightPressed = false;
    this._canvas = canvas;

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

    if (canvas) {
      this._onMouseMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
      };
      this._onMouseDown = (e) => {
        if (e.button === 0) this._leftPressed = true;
        if (e.button === 2) this._rightPressed = true;
      };
      this._onContextMenu = (e) => {
        // Suppress browser context menu so right-click is game-actionable.
        e.preventDefault();
      };
      canvas.addEventListener('mousemove', this._onMouseMove);
      canvas.addEventListener('mousedown', this._onMouseDown);
      canvas.addEventListener('contextmenu', this._onContextMenu);
    }
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

  /** One-shot: true exactly once per left-click edge. */
  consumeLeftClick() {
    if (this._leftPressed) {
      this._leftPressed = false;
      return true;
    }
    return false;
  }

  /** One-shot: true exactly once per right-click edge. */
  consumeRightClick() {
    if (this._rightPressed) {
      this._rightPressed = false;
      return true;
    }
    return false;
  }

  /** Call once per frame to clear the pressed-edge buffer. */
  endFrame() {
    this.pressedThisFrame.clear();
    // Note: we do NOT clear _leftPressed/_rightPressed here because
    // they are managed by consumeLeftClick/consumeRightClick (they
    // should be consumed as soon as a frame processes them, regardless
    // of how many times the input.update is called per frame).
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
    if (this._canvas) {
      this._canvas.removeEventListener('mousemove', this._onMouseMove);
      this._canvas.removeEventListener('mousedown', this._onMouseDown);
      this._canvas.removeEventListener('contextmenu', this._onContextMenu);
    }
  }
}
