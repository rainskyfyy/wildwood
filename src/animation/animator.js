/**
 * Frame animation engine — drives sprite-sheet playback with simple
 * state-machine wiring.
 *
 * Two usage modes:
 *   (1) Multi-frame sprite sheet (preferred when art is packed):
 *       new Animator({
 *         sheet,                 // Image or Canvas
 *         frameWidth, frameHeight,
 *         frameCount,
 *         fps,
 *         loop = true,
 *       });
 *   (2) Single-frame state images (one PNG per (state, direction)):
 *       Treat each "state" as a 1-frame sheet; the engine still works
 *       because frameCount=1 means "no internal time progression" —
 *       callers get a fresh image whenever they switch state.
 *
 * The engine is deterministic, dependency-free, and DOM-agnostic: the
 * `tick(dt)` method just advances an internal time accumulator and
 * returns the current frame index; rendering is the caller's job.
 * This makes it cheap to unit-test under Node (no canvas needed).
 *
 * State + direction wiring:
 *   - `setState({ action, facing })` resolves to a sprite (or frame
 *     column on a sheet) via a state-table passed in the constructor.
 *   - Unknown states fall back to the first entry of the table and
 *     log a soft warning once.
 *
 * Why both `tick` and `update`?
 *   - `tick(dt)` is the time advance + frame-index calculation.
 *   - `update(dt)` is a hook for subclasses to do per-frame work
 *     (AI state transitions, etc.). Default = tick.
 */

'use strict';

/**
 * Resolve a sprite source for a given (action, facing) pair.
 * Returned by the caller and stored per (action, facing).
 *
 * @typedef {Object} FrameSource
 * @property {HTMLImageElement|HTMLCanvasElement} image  — the source image
 * @property {number} [sourceX]      — left of the frame in the image (default 0)
 * @property {number} [sourceY]      — top of the frame (default 0)
 * @property {number} [sourceW]      — width of the frame (default = image.naturalWidth)
 * @property {number} [sourceH]      — height of the frame (default = image.naturalHeight)
 * @property {number} [frameIndex=0] — for sprite sheets, which column to draw
 */

export class Animator {
  /**
   * @param {Object} opts
   * @param {HTMLImageElement|HTMLCanvasElement} [opts.sheet]    — single sprite sheet
   * @param {number} [opts.frameWidth]                          — width of each frame in the sheet
   * @param {number} [opts.frameHeight]                         — height of each frame (defaults to image height for 1-row sheets)
   * @param {number} [opts.frameCount]                          — total frames in the sheet (default 1)
   * @param {number} [opts.fps=8]                               — playback rate
   * @param {boolean} [opts.loop=true]                          — loop or play once
   * @param {Function} [opts.stateResolver]                     — (action, facing) => FrameSource
   * @param {string} [opts.defaultAction='idle']               — initial action
   * @param {string} [opts.defaultFacing='down']                — initial facing
   */
  constructor({
    sheet = null,
    frameWidth = 0,
    frameHeight = 0,
    frameCount = 1,
    fps = 8,
    loop = true,
    stateResolver = null,
    defaultAction = 'idle',
    defaultFacing = 'down'
  } = {}) {
    this.sheet = sheet;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.frameCount = Math.max(1, frameCount | 0);
    this.fps = fps;
    this.loop = loop;
    this.stateResolver = stateResolver;

    this.action = defaultAction;
    this.facing = defaultFacing;
    this.time = 0;        // seconds elapsed in current clip
    this.frameIndex = 0;  // current frame (0..frameCount-1)
    this.finished = false;

    this._warnedKeys = new Set();
  }

  /**
   * Advance the animation clock by `dt` seconds. Returns the new
   * `frameIndex`. Side effect: sets `finished = true` when a non-looping
   * clip has played all frames.
   *
   * @param {number} dt — seconds since last tick
   * @returns {number} current frame index
   */
  tick(dt) {
    this.time += dt;
    if (this.frameCount <= 1) {
      this.frameIndex = 0;
      return 0;
    }
    const frameDuration = 1 / this.fps;
    let advanced = Math.floor(this.time / frameDuration);
    if (advanced > 0) {
      // Consume the time so the next tick is correct.
      this.time -= advanced * frameDuration;
      if (this.loop) {
        this.frameIndex = ((this.frameIndex + advanced) % this.frameCount + this.frameCount) % this.frameCount;
      } else {
        this.frameIndex = Math.min(this.frameCount - 1, this.frameIndex + advanced);
        if (this.frameIndex >= this.frameCount - 1) this.finished = true;
      }
    }
    return this.frameIndex;
  }

  /**
   * Hook for per-frame work. Default = tick.
   */
  update(dt) { return this.tick(dt); }

  /**
   * Switch action (idle/walk/attack/...) and/or facing. Resets the
   * clock so the new clip starts from frame 0. If the resolved frame
   * count differs from the previous one, the sheet is implicitly
   * updated (caller is responsible for the sheet itself).
   *
   * @param {{action?: string, facing?: string}} partial
   */
  setState(partial = {}) {
    if (partial.action) this.action = partial.action;
    if (partial.facing) this.facing = partial.facing;
    this.time = 0;
    this.frameIndex = 0;
    this.finished = false;
  }

  /**
   * True iff a non-looping clip has reached its last frame.
   */
  isFinished() { return this.finished; }

  /**
   * Compute the current frame's draw rectangle in the source image.
   * Returns null if no sheet/resolver is configured (caller should
   * hold its own image reference).
   *
   * @returns {{sx:number, sy:number, sw:number, sh:number}|null}
   */
  getFrameRect() {
    // State-resolver path (multi-image mode).
    if (this.stateResolver) {
      const src = this.safeResolve(this.action, this.facing);
      if (!src) return null;
      return {
        sx: src.sourceX || 0,
        sy: src.sourceY || 0,
        sw: src.sourceW || (src.image.naturalWidth || src.image.width),
        sh: src.sourceH || (src.image.naturalHeight || src.image.height)
      };
    }
    // Inline sprite-sheet path.
    if (!this.sheet) return null;
    const fw = this.frameWidth || (this.sheet.naturalWidth || this.sheet.width);
    const fh = this.frameHeight || (this.sheet.naturalHeight || this.sheet.height);
    const cols = Math.max(1, Math.floor((this.sheet.naturalWidth || this.sheet.width) / fw));
    const col = this.frameIndex % cols;
    const row = Math.floor(this.frameIndex / cols);
    return {
      sx: col * fw,
      sy: row * fh,
      sw: fw,
      sh: fh
    };
  }

  /**
   * Resolve the current image source. Returns null if not configured.
   *
   * @returns {HTMLImageElement|HTMLCanvasElement|null}
   */
  getImage() {
    if (this.stateResolver) {
      const src = this.safeResolve(this.action, this.facing);
      return src ? src.image : null;
    }
    return this.sheet;
  }

  safeResolve(action, facing) {
    if (!this.stateResolver) return null;
    const key = `${action}|${facing}`;
    const v = this.stateResolver(action, facing);
    if (!v) {
      if (!this._warnedKeys.has(key)) {
        this._warnedKeys.add(key);
        // Soft warning — engine still works (frameRect is null,
        // caller will draw its fallback).
        // eslint-disable-next-line no-console
        if (typeof console !== 'undefined') {
          console.warn(`[animator] no state for action="${action}" facing="${facing}"`);
        }
      }
      return null;
    }
    return v;
  }
}

/**
 * Build a "single-frame" Animator from a state table. Each (action,
 * facing) entry maps to a FrameSource. Useful when art is per-state
 * rather than packed into one sheet (the common case in M2.14: each
 * monster direction+action is its own PNG).
 *
 * @param {Object<string, Object<string, FrameSource>>} stateTable
 *   stateTable[action][facing] = FrameSource
 * @param {Object} [opts]
 * @param {number} [opts.fps=8]
 * @param {string} [opts.defaultAction='idle']
 * @param {string} [opts.defaultFacing='down']
 * @returns {Animator}
 */
export function buildStateTableAnimator(stateTable, opts = {}) {
  return new Animator({
    frameCount: 1,
    fps: opts.fps ?? 8,
    loop: true,
    stateResolver: (action, facing) => {
      const byAction = stateTable[action];
      if (!byAction) return null;
      return byAction[facing] || byAction['down'] || null;
    },
    defaultAction: opts.defaultAction || 'idle',
    defaultFacing: opts.defaultFacing || 'down'
  });
}
