/**
 * Building configuration loader — exposes the M2.9 building catalog.
 *
 * Source of truth: `buildings.json` (next to this file). The JSON is
 * imported via the build pipeline (Vite/esbuild/rollup) OR fetched at
 * runtime — this loader supports both:
 *   - default export: `loadBuildings()` — Promise<Catalog>
 *   - sync helper:    `getBuildingsSync()` — Catalog (uses embedded data)
 *
 * For Node smoke tests we embed the catalog as a JS module so JSON
 * import is not required. For browser, prefer dynamic import('./buildings.json').
 *
 * Catalog shape:
 *   {
 *     version: 1,
 *     buildOrder: ['campfire', 'science_machine', ...],  // menu order
 *     buildings: { [id]: BuildingDef }
 *   }
 *
 * BuildingDef:
 *   { id, name, icon, size:[w,h], hp, cost:{item:qty}, color, outline, accent, description, tags:[] }
 */

'use strict';

import { BUILDINGS_DATA } from './buildings-data.js';

/**
 * Return the embedded building catalog. Synchronous, suitable for both
 * Node smoke tests and the browser game loop.
 *
 * @returns {{version:number, buildOrder:string[], buildings:Object}}
 */
export function getBuildings() {
  return BUILDINGS_DATA;
}

/**
 * Lookup a single building by id; returns null if not found.
 */
export function getBuilding(id) {
  return BUILDINGS_DATA.buildings[id] || null;
}

/**
 * Get buildings in the order they should appear in the build menu.
 * Returns an array of BuildingDef.
 */
export function getBuildingMenuOrder() {
  return BUILDINGS_DATA.buildOrder.map(id => BUILDINGS_DATA.buildings[id]).filter(Boolean);
}

/**
 * Number of building types in the catalog. Useful for radial menu math
 * (e.g. 5 wedges of 72° each).
 */
export function getBuildingCount() {
  return BUILDINGS_DATA.buildOrder.length;
}
