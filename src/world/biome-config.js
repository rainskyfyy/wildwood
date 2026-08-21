/**
 * Biome configuration for v0.5.1 (6 biomes).
 *
 * 6 biomes total:
 *   - forest    (新增 — 中心,新手区,树木密集、浆果丛)
 *   - plains    (新增 — 过渡带,开阔草原、牛群)
 *   - desert    (M5 原有)
 *   - marsh     (M5 原有 — M2.7 旧名 "plains")
 *   - snow      (M5 原有)
 *   - volcano   (M5 原有)
 *
 * Each biome defines:
 *   - center config (for radial layout in generator.js)
 *   - elevation/moisture thresholds (Perlin field bands) — kept
 *     from M5 for the legacy 4-biome world.
 *   - primary + secondary + accent colors
 *   - decorPool: M3.13 decoration PNGs (desert/snow/volcano) and
 *     procedural kinds for marsh/forest/plains (no real art yet)
 *   - tileArt: PNG paths under assets/art/biomes/<id>/tiles/
 *   - transitionArt: per-neighbor PNG path or null
 *
 * v0.5.1 变更:
 *   - 加 forest + plains 两个新群系
 *   - layout.quadrants 标记四大极端群系在径向布局中各占哪个象限
 *   - 保留原 M5 pickBiome() 函数(4 群系 Perlin 模式)以做旧测兼容
 *   - 新增 pickBiomeRadial() 给 6 群系径向布局使用
 */

'use strict';

const TILE_DIR = id => `./assets/art/biomes/${id}/tiles/`;
const TILE_PNG = (id, name) => `${TILE_DIR(id)}${name}.png`;

const DECOR_DIR = id => `./assets/art/biomes/_shared/decorations/${id}/`;
const DECOR_PNG = (id, name) => `${DECOR_DIR(id)}${name}.png`;

const TRANS_PNG = (a, b, step) =>
  `./assets/art/biomes/_shared/transitions/${a}2${b}_step${step}.png`;

/**
 * v0.5.1 6 群系配置。
 *
 * 顺序固定为 ['forest', 'plains', 'desert', 'marsh', 'snow', 'volcano']。
 * generator.js 的 BIOME_TO_CODE 按本顺序映射 0..5,新加群系请追加到末尾
 * 以免破坏存档/序列化(老世界会把 forest 存成 0, plains 存成 1, etc.)
 */
export const BIOMES = {
  forest: {
    id: 'forest',
    name: '森林',
    elevation: { min: 0.30, max: 0.75 },
    moisture:  { min: 0.40, max: 0.80 },
    primary:   '#3f6b3a',  // 暗松绿
    secondary: '#2a4a26',
    accent:    '#7a9a4a',  // 嫩绿
    tileArt: [
      TILE_PNG('forest', 'grass_base'),
      TILE_PNG('forest', 'grass_dark'),
      TILE_PNG('forest', 'forest_floor'),
      TILE_PNG('forest', 'moss_ground'),
      TILE_PNG('forest', 'leaf_litter')
    ],
    decorPool: [
      { id: 'mushroom',  weight: 30, art: null, color: '#a87a4a' },
      { id: 'fern',      weight: 35, art: null, color: '#4a8a3a' },
      { id: 'flower_blue', weight: 15, art: null, color: '#5a8ac4' },
      { id: 'log_floor', weight: 20, art: null, color: '#6a4a2a' }
    ],
    // 出生点 + 浆果丛 / 树木 / 蝴蝶 / 猪人(预留)
    ecology: {
      grass: 200,        // 隐式资源,兔群可食
      berry_bush: 12,    // 浆果丛,boar 食物 + 玩家可采集
      tree_density: 0.20,
      butterfly: true,
      pig_village_reserved: true
    },
    walkable: true
  },

  plains: {
    id: 'plains',
    name: '草原',
    elevation: { min: 0.20, max: 0.65 },
    moisture:  { min: 0.30, max: 0.65 },
    primary:   '#9ab86a',  // 嫩草黄绿
    secondary: '#7a9852',
    accent:    '#c4d68a',  // 高草
    tileArt: [
      TILE_PNG('plains', 'grass_plain'),
      TILE_PNG('plains', 'grass_short'),
      TILE_PNG('plains', 'grass_tall'),
      TILE_PNG('plains', 'wildflower_meadow'),
      TILE_PNG('plains', 'dry_grass')
    ],
    decorPool: [
      { id: 'tall_grass',  weight: 45, art: null, color: '#c4d68a' },
      { id: 'wild_flower', weight: 25, art: null, color: '#e8b8c4' },
      { id: 'rock_small',  weight: 15, art: null, color: '#7a7a7a' },
      { id: 'rabbit_hole', weight: 15, art: null, color: '#4a3a2a' }
    ],
    ecology: {
      tall_grass: 200,
      wild_flower: true,
      cow: true,
      rabbit_hole_density: 0.08
    },
    walkable: true
  },

  desert: {
    id: 'desert',
    name: '荒漠',
    elevation: { min: 0.20, max: 0.85 },
    moisture:  { min: 0.00, max: 0.40 },
    primary:   '#c9a96e',
    secondary: '#a88a52',
    accent:    '#e0c89a',
    tileArt: [
      TILE_PNG('desert', 'sand_base'),
      TILE_PNG('desert', 'sand_cracked'),
      TILE_PNG('desert', 'sand_pebbles'),
      TILE_PNG('desert', 'dunes'),
      TILE_PNG('desert', 'sand_dry_grass')
    ],
    decorPool: [
      { id: 'lizard',      weight: 18, art: DECOR_PNG('desert', 'lizard'),      color: '#a87a3a' },
      { id: 'sand_ripple', weight: 40, art: DECOR_PNG('desert', 'sand_ripple'), color: '#c9a96e' },
      { id: 'scorpion',    weight: 12, art: DECOR_PNG('desert', 'scorpion'),    color: '#6e4a2a' },
      { id: 'tumbleweed', weight: 30, art: DECOR_PNG('desert', 'tumbleweed'),  color: '#8a6e3a' }
    ],
    walkable: true
  },

  marsh: {
    id: 'marsh',
    name: '沼泽',
    elevation: { min: 0.05, max: 0.55 },
    moisture:  { min: 0.55, max: 1.00 },
    primary:   '#5a5a3a',
    secondary: '#3a4a2a',
    accent:    '#6e7a3a',
    tileArt: [
      TILE_PNG('marsh', 'mud_base'),
      TILE_PNG('marsh', 'mud_puddle'),
      TILE_PNG('marsh', 'mud_grass'),
      TILE_PNG('marsh', 'dark_mud'),
      TILE_PNG('marsh', 'mud_swamp')
    ],
    decorPool: [
      { id: 'mud_speck',  weight: 50, art: null, color: '#3a4a2a' },
      { id: 'reed',       weight: 25, art: null, color: '#6e7a3a' },
      { id: 'moss_patch', weight: 25, art: null, color: '#4a6a3a' }
    ],
    walkable: true
  },

  snow: {
    id: 'snow',
    name: '雪原',
    elevation: { min: 0.45, max: 0.95 },
    moisture:  { min: 0.00, max: 0.50 },
    primary:   '#d8e4ec',
    secondary: '#a8b8c4',
    accent:    '#f0f4f8',
    tileArt: [
      TILE_PNG('snow', 'snow_base'),
      TILE_PNG('snow', 'ice_crack'),
      TILE_PNG('snow', 'snow_powder'),
      TILE_PNG('snow', 'rocky_snow'),
      TILE_PNG('snow', 'permafrost')
    ],
    decorPool: [
      { id: 'icicle',      weight: 18, art: DECOR_PNG('snow', 'icicle'),      color: '#a8d4e8' },
      { id: 'pinecone',    weight: 30, art: DECOR_PNG('snow', 'pinecone'),    color: '#6e4a2a' },
      { id: 'rabbit_track',weight: 12, art: DECOR_PNG('snow', 'rabbit_track'),color: '#888888' },
      { id: 'snowflake',   weight: 40, art: DECOR_PNG('snow', 'snowflake'),   color: '#f0f4f8' }
    ],
    walkable: true
  },

  volcano: {
    id: 'volcano',
    name: '火山',
    elevation: { min: 0.65, max: 1.00 },
    moisture:  { min: 0.00, max: 0.30 },
    primary:   '#3a2a26',
    secondary: '#5a2a1a',
    accent:    '#d4622a',
    tileArt: [
      TILE_PNG('volcano', 'lava_flow'),
      TILE_PNG('volcano', 'basalt'),
      TILE_PNG('volcano', 'ash_ground'),
      TILE_PNG('volcano', 'magma_crack'),
      TILE_PNG('volcano', 'scorched_earth')
    ],
    decorPool: [
      { id: 'ash',           weight: 35, art: DECOR_PNG('volcano', 'ash'),           color: '#2a201a' },
      { id: 'ember_spark',   weight: 18, art: DECOR_PNG('volcano', 'ember_spark'),   color: '#d4622a' },
      { id: 'lava_bubble',   weight: 12, art: DECOR_PNG('volcano', 'lava_bubble'),   color: '#ff8a3a' },
      { id: 'sulfur_crystal',weight: 35, art: DECOR_PNG('volcano', 'sulfur_crystal'),color: '#d4c84a' }
    ],
    walkable: true
  }
};

/**
 * 径向布局 (v0.5.1): 中心 = forest, 内圈 = plains, 外圈 = 4 大极端群系
 * 按象限分配。
 *
 * 6 群系布局示意 (80x60 地图):
 *
 *                  SNOW              SNOW
 *              ┌─────────┐     ┌─────────┐
 *              │  snow   │     │ volcano │
 *              │  (NW)   │     │  (NE)   │
 *              └─────────┘     └─────────┘
 *                              ┌─────────┐
 *                              │ PLAINS  │
 *                              │ FOREST  │  ← 中心(40, 30) 玩家出生
 *                              │  ring   │
 *                              └─────────┘
 *              ┌─────────┐     ┌─────────┐
 *              │ marsh   │     │ desert  │
 *              │  (SW)   │     │  (SE)   │
 *              └─────────┘     └─────────┘
 *                  DESERT            DESERT
 *
 * @param {number} x — world tile x
 * @param {number} y — world tile y
 * @param {number} width
 * @param {number} height
 * @returns {string} biome id
 */
export function pickBiomeRadial(x, y, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  const maxR = Math.hypot(cx, cy);
  // Normalize to [0, 1].
  const r = Math.min(1, dist / maxR);

  // 中心 = forest (r < 0.25)
  if (r < 0.25) return 'forest';
  // 内圈 = plains (0.25 <= r < 0.45)
  if (r < 0.45) return 'plains';

  // 外圈 = 4 极端群系,按角度象限分:
  //   NE (volcano): -45° < angle < 45°(右半)
  //   SE (desert):  45° < angle < 135°(下)
  //   SW (marsh):  135° < angle < 225°(左)
  //   NW (snow):   225° < angle < 315°(上)
  // 角度从 +X 顺时针,atan2(dy, dx) 给的是从 +X 逆时针 → 取反。
  const angle = Math.atan2(dy, dx);
  const deg = (angle * 180) / Math.PI;
  // 分四象限 (注意 y 轴向下,所以屏幕"上"是 dy < 0)
  if (dy <= 0 && Math.abs(dy) > Math.abs(dx)) return 'snow';     // NW 上
  if (dy > 0 && Math.abs(dy) > Math.abs(dx))  return 'marsh';    // SW 下
  if (dx > 0)                                  return 'volcano'; // NE 右
  return 'desert';                                              // NW 左
}

/**
 * M5 4 群系 Perlin 模式(保留供 v0.5.0 老世界和测试使用)。
 *
 * @param {number} elevation
 * @param {number} moisture
 * @returns {string} biome id
 */
export function pickBiome(elevation, moisture) {
  if (moisture >= 0.55) return 'marsh';
  if (elevation >= 0.65 && moisture <= 0.30) return 'volcano';
  if (elevation >= 0.50 && moisture <= 0.50) return 'snow';
  return 'desert';
}

/**
 * Lookup biome config; throws on unknown id.
 */
export function getBiome(id) {
  const b = BIOMES[id];
  if (!b) throw new Error(`Unknown biome: ${id}`);
  return b;
}

/**
 * Resolve the transition PNG path for a biome A → biome B pair.
 * v0.5.1: pairs without real art return null (procedural blend).
 * v0.5.0 pairs (desert↔snow/volcano) keep their M3.13 PNGs.
 */
export function transitionArt(a, b, blend) {
  if (a === b) return null;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  // 涉及 forest/plains/marsh 的过渡 — 全部走程序混合(no M3.13 art)
  if (lo === 'marsh' || hi === 'marsh'
   || lo === 'forest' || hi === 'forest'
   || lo === 'plains' || hi === 'plains') {
    return null;
  }
  const step = blend < (1 / 3) ? 0 : blend < (2 / 3) ? 1 : 2;
  return { path: TRANS_PNG(lo, hi, step), step };
}

/**
 * Deterministic Mulberry32-style tile variant hash.
 */
export function pickTileVariant(x, y, n = 5) {
  let h = ((x | 0) * 0x27d4eb2d) ^ ((y | 0) * 0x165667b1);
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % n;
}
