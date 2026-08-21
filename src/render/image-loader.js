/**
 * Image loader — asynchronously loads PNG assets with procedural fallback.
 *
 * Used by M5 to swap real M3.13 art into the rendering pipeline. When a
 * PNG is missing or fails to load, callers fall back to a Canvas-drawn
 * placeholder so the demo stays runnable.
 *
 * Public API:
 *   loadImage(path)        -> Image() (loading in background)
 *   preloadImages(paths)   -> Promise<Image[]> (resolves when all ready)
 *   isReady(path)          -> boolean
 *   getOrFallback(path, fallbackBuilder) -> Image | HTMLCanvasElement
 */

'use strict';

// Cache: path -> Image (or null on failure).
const cache = new Map();
const pending = new Map(); // path -> Promise<Image>

/**
 * Create (and start loading) an Image for the given path. Returns the
 * same Image on repeated calls.
 *
 * @param {string} path — relative URL (e.g. "./assets/art/biomes/desert/tiles/sand_base.png")
 * @returns {HTMLImageElement}
 */
export function loadImage(path) {
  if (cache.has(path)) return cache.get(path);
  const img = new Image();
  img.decoding = 'async';
  let resolved = false;
  const p = new Promise(resolve => {
    img.onload = () => { resolved = true; resolve(img); };
    img.onerror = () => { resolved = true; cache.set(path, null); resolve(null); };
  });
  img.src = path;
  pending.set(path, p);
  cache.set(path, img); // mark as loading; isReady() returns false until onload
  // Replace entry when actually resolved.
  p.then(v => { if (v == null) cache.set(path, null); else cache.set(path, v); });
  return img;
}

/**
 * Pre-load a list of image paths. Resolves when every one has either
 * loaded or errored. Order of the returned array matches `paths`.
 *
 * @param {string[]} paths
 * @returns {Promise<Array<HTMLImageElement|null>>}
 */
export async function preloadImages(paths) {
  const imgs = paths.map(p => loadImage(p));
  await Promise.all(paths.map(p => pending.get(p)));
  return imgs;
}

/**
 * Whether the image at `path` has finished loading successfully.
 * Returns false while loading, true once loaded (or if load failed).
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isReady(path) {
  if (!cache.has(path)) return false;
  const v = cache.get(path);
  if (v == null) return true; // errored — treat as "ready" (use fallback)
  return v.complete && v.naturalWidth > 0;
}

/**
 * Get the loaded Image for `path`, or call `fallbackBuilder` to produce
 * a Canvas-based substitute. This is the rendering hot-path: it never
 * returns null, so callers can `drawImage` directly.
 *
 * @param {string} path
 * @param {() => HTMLCanvasElement} fallbackBuilder
 * @returns {HTMLImageElement|HTMLCanvasElement}
 */
export function getOrFallback(path, fallbackBuilder) {
  const v = cache.get(path);
  if (v && v.complete && v.naturalWidth > 0) return v;
  if (cache.has(path) && v == null) {
    // load errored — cache a single fallback canvas.
    if (!fallbackBuilder._cached) fallbackBuilder._cached = fallbackBuilder();
    return fallbackBuilder._cached;
  }
  if (v && v.complete && v.naturalWidth === 0) {
    if (!fallbackBuilder._cached) fallbackBuilder._cached = fallbackBuilder();
    return fallbackBuilder._cached;
  }
  // Not yet loaded — return a 1x1 transparent canvas as a "still loading" stub.
  // The preloader will refresh render once all images are ready.
  return stubCanvas();
}

function stubCanvas() {
  if (!stubCanvas._cv) {
    const cv = document.createElement('canvas');
    cv.width = 1; cv.height = 1;
    stubCanvas._cv = cv;
  }
  return stubCanvas._cv;
}

/**
 * Clear the entire cache. Used in tests; not needed in production.
 */
export function clearCache() {
  cache.clear();
  pending.clear();
}
