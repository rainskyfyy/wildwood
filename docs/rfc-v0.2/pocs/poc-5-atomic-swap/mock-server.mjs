// PoC-5 mock server:生成 mock 资源 manifest(老/新两版)

function sha256(s) {
  // 简化:用 djb2 模拟 SHA-256 hex(不需要真加密,只要求稳定 + 唯一)
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0').repeat(8);  // 32 hex
}

function buildMap(version, tileIds) {
  const tiles = {};
  for (const id of tileIds) {
    tiles[id] = {
      sha256: sha256(`${id}@v${version}`),
      size: 100,
      deps: [],
      cdnUrl: `/cdn/${id}.png`,
    };
  }
  return {
    schema: 'RES.META.v1',
    version,
    generatedAt: '2026-08-22T00:00:00Z',
    tiles,
  };
}

export function localManifest() {
  return buildMap(41, [
    'tree.oak', 'tree.birch', 'rock.boulder', 'biome.forest',
    // ... 共 30 个
    'tile.dirt', 'tile.grass', 'tile.sand', 'tile.snow',
    'flora.flower', 'flora.mushroom', 'item.twig', 'item.grass',
    'item.wood', 'item.stone', 'item.flint', 'item.hay',
    'item.charcoal', 'item.rope', 'item.gold_ore', 'deco.firefly',
    'deco.rock', 'deco.bones', 'deco.pinecone', 'deco.icicle',
    'deco.ember', 'deco.sulfur', 'tile.ice', 'tile.mud',
    'tile.lava', 'tile.scoria', 'deco.scorpion', 'deco.tumbleweed',
    'deco.rabbit_track',
  ]);
}

export function remoteManifest() {
  // 新版:其中 5 个资源更新(改 sha256)
  return buildMap(42, [
    'tree.oak', 'tree.birch', 'rock.boulder', 'biome.forest',
    'tile.dirt', 'tile.grass', 'tile.sand', 'tile.snow',
    'flora.flower', 'flora.mushroom', 'item.twig', 'item.grass',
    'item.wood', 'item.stone', 'item.flint', 'item.hay',
    'item.charcoal', 'item.rope', 'item.gold_ore', 'deco.firefly',
    'deco.rock', 'deco.bones', 'deco.pinecone', 'deco.icicle',
    'deco.ember', 'deco.sulfur', 'tile.ice', 'tile.mud',
    'tile.lava', 'tile.scoria', 'deco.scorpion', 'deco.tumbleweed',
    'deco.rabbit_track',
  ]);
}
