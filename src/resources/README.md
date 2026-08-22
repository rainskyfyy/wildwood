# M2.10 Resources — Catalog · Inventory · Gather · Crafting · Regrow · Durability

Pure-logic game systems for the **Wildwood** survival game. No DOM, no
framework, ES modules only.

## Files

| File | Purpose |
|---|---|
| `catalog.js` | Loads + queries the three JSON tables; **validates** that recipes reference real items, that tools have `maxDurability`, and that regrow times are non-negative. Exposes `isTool`, `getToolType`, `getMaxDurability`, `checkTool`, `allowedTools`, `isDepletable`, `getMaxHarvests`, `getDepletedTransformsTo`. |
| `resources.json` | 17 harvestable / diggable resources: 8 harvest-category (tree, dead_tree, rock, boulder, grass_tuft, berry_bush, iron_ore, ice_shard, flower_patch) and 5 dig-category (dirt_mound, sapling, carrot, mushroom). Each has `regrowTime` (seconds), `category`, and `drops[]`. |
| `items.json` | 20 items: 12 materials, 3 food (berries, carrot, mushroom), 4 tools (axe, pickaxe, shovel, torch), 1 placeable (campfire). Tools carry `maxDurability` and `toolType`. |
| `recipes.json` | 6 recipes: 3 hand-held (torch, rope, campfire) at 2×2 and 3 science-machine (axe, pickaxe, shovel) at 3×3. |
| `inventory.js` | 6 hotbar + 15 backpack = 21 slots. `add` / `remove` / `move` / `swap` / `compact` / `serialize` / `loadSnapshot`. Tools get their own slot, never merge. `damageTool(slot, by)` decrements durability; at 0 the slot is cleared and `onBreak` fires. |
| `resource-entity.js` | One harvestable world object. `harvest(inv, now)` returns `{granted, regrowAt}`; `update(now)` ticks the regrow timer; `getVisualState()` returns `'full' \| 'regrowing' \| 'depleted'`. |
| `gather.js` | Idle / gathering / just_done state machine. `click(x,y)` picks the closest non-depleted entity in range. `update(player, dt, now)` advances progress; on completion emits `complete` with the loot, the regrow timestamp, and `toolUsed` / `toolStatus`. Damages the equipped tool if compatible. |
| `regrow.js` | `RegrowManager` — ticks every entity's regrow timer each frame, calls `onRegrow(entity)` for any that just respawned. |
| `crafting.js` | Recipe matching and consumption. `matchRecipe(grid, station, recipes)` finds a recipe; `craft(grid, station, inv, recipes)` consumes and outputs. |

## Resource categories

- **`harvest`** — gathered by hand or appropriate tool. tree/dead_tree need
  axe; rock/boulder/iron_ore need pickaxe; berry_bush/grass_tuft/ice_shard/
  flower_patch are bare-handed.
- **`dig`** — intended for shovel use. dirt_mound/sapling/carrot require
  shovel; mushroom accepts shovel **or** bare hands. Wrong tool on a dig
  resource falls back to bare-handed gather (no tool damage).

## Regeneration model

Each resource has a `regrowTime` in seconds. On harvest:

1. `entity.depleted = true`
2. `entity.regrowAt = now + regrowTime * 1000` (ms)
3. `entity.getVisualState()` returns `'regrowing'`
4. `entity.regrowFraction(now)` returns 0..1 toward regrow

When `RegrowManager.update(now)` is called, any entity whose `regrowAt`
has passed:

1. `entity.depleted = false`
2. `entity.regrowAt = 0`
3. RNG is re-seeded with `(x, y, id, now)` so the regrown entity
   drops the same set of items but with a fresh draw
4. `onRegrow(entity)` callback fires (used for VFX/audio/banner)

If `regrowTime === 0`, the resource is **permanently depleted** — useful
for one-off quest nodes or final-tier rocks.

## Depletion model (v1.0.3 — M2.10d)

Some resources are finite. Each node has a `maxHarvests` (positive integer);
after that many successful harvests the entity **permanently exhausts**:

1. `entity.harvestCount` increments by 1 each successful gather
2. If `harvestCount >= maxHarvests`:
   - If `depletedTransformsTo` is set (e.g. `rock`), the entity **mutates
     in place** — id, drops, icon, color, regrow behavior all reload
     from the new resource def; `harvestCount` resets to 0. The same
     world position is now useful as a different (typically lower-tier)
     resource.
   - If `depletedTransformsTo` is null, the entity is permanently
     depleted — `depleted = true`, `regrowAt = 0`, and the entity
     cannot be harvested again (also excluded from `gather.findInRange`).
3. The `complete` event payload includes `harvestCount`, `maxHarvests`,
   `depleted`, and `transformedTo` so the HUD can show progress and
   the banner can announce transform / exhaustion.

Resources without `maxHarvests` (e.g. tree, rock) keep the v1.0.1
infinite-regrow behavior unchanged.

### Depletable resources (all in `mines` biome)

| Resource | maxHarvests | regrowTime (s) | transforms to | Drops |
|---|---|---|---|---|
| `coal`       | 4 | 180 | — | `coal×2`, `stone×1` (30%) |
| `gold_ore`   | 2 | 240 | `rock` | `gold_nugget×1`, `stone×1` (50%) |
| `gem_vein`   | 1 | 300 | `rock` | `gem×1` |
| `tin_ore`    | 3 | 120 | — | `tin×2`, `stone×1` (20%) |

A `gold_ore` node behaves as gold (rare, valuable) for 2 harvests, then
becomes a `rock` node at the same position for as long as the world
lasts (rock has `maxHarvests = Infinity`, regrows every 120s). The
player keeps a useful resource even after the gold runs out.

### Catalog exports for depletion

- `isDepletable(resourceId)` — true if the resource has finite maxHarvests
- `getMaxHarvests(resourceId)` — positive integer or `Infinity`
- `getDepletedTransformsTo(resourceId)` — target resource id, or `null`

`validateCatalog()` checks `maxHarvests` is a positive integer and
`depletedTransformsTo` references an existing resource.

### Times by resource

| Resource | regrowTime (s) | Category | Tool |
|---|---|---|---|
| grass_tuft | 30 | harvest | bare hands |
| sapling | 35 | dig | shovel |
| flower_patch | 40 | harvest | bare hands |
| berry_bush | 45 | harvest | bare hands |
| tree | 60 | harvest | axe |
| dirt_mound | 60 | dig | shovel |
| ice_shard | 75 | harvest | bare hands |
| dead_tree | 90 | harvest | axe |
| carrot | 90 | dig | shovel |
| mushroom | 110 | dig | shovel or bare hands |
| rock | 120 | harvest | pickaxe |
| iron_ore | 180 | harvest | pickaxe |
| boulder | 240 | harvest | pickaxe |

## Tool durability model

A tool is any item with `category: "tool"` and a `maxDurability > 0` in
`items.json`. Each tool instance in the inventory has:

```js
{ itemId: 'axe', count: 1, durability: 47, maxDurability: 50 }
```

- `durability` starts at `maxDurability` when the tool is first added.
- Each successful gather with a **compatible** tool (`checkTool`
  returns `'compatible'`) decrements durability by 1.
- Wrong tool / no tool on a tool-required resource does **not** damage
  the equipped tool (the player is gathering bare-handed).
- When `durability` hits 0, the slot is cleared and `Inventory.onBreak`
  fires with `{ slotIndex, itemId }`.
- Tools are **stackMax 1** and **never merge** — moving one tool stack
  onto another always swaps.

### Compatibility table

| Resource | Allowed tools | Bare hands? |
|---|---|---|
| tree, dead_tree | `axe` | no |
| rock, boulder, iron_ore | `pickaxe` | no |
| dirt_mound, sapling, carrot | `shovel` | no |
| mushroom | `shovel` | **yes** (mushroom is diggable but also bare-handed) |
| berry_bush, grass_tuft, ice_shard, flower_patch | (none) | **yes** |
| (any other) | any compatible or none | yes |

`checkTool(resourceId, toolId)` returns:

- `'no_tool_required'` — bare hands OK, no tool used
- `'compatible'` — right tool, consumes durability
- `'wrong_tool'` — wrong tool, allows bare-handed gather, no durability
- `'tool_required'` — needs a tool, none equipped, gather still proceeds
  (bare-handed) but no tool damage

## Visual states

The renderer (`src/render/resource-renderer.js`) distinguishes three
states for each entity:

- `'full'` — normal sprite (tree / rock / dirt_mound / carrot / etc.)
- `'regrowing'` — small stump + sapling (for tree/dead_tree) or a
  generic "disturbed patch" with a growing green sprout (for dig /
  harvest resources); green regrow progress bar above
- `'depleted'` — 30% alpha + a red X overlay + cracks — for **permanent
  exhaustion** (e.g. coal after 4 hits, or a vein that just transformed
  into a rock and is now in its regrow cycle). Visually distinct from
  the transient `'regrowing'` state so the player knows the node is
  gone for good.

The hotbar and backpack panel show a per-tool durability bar at the
bottom of each tool slot, colored:
- green if `durability/maxDurability > 0.5`
- amber if `> 0.2`
- red if `≤ 0.2`

## Persistence

`Inventory.serialize()` writes a versioned snapshot:

```js
{ v: 2, selected: 0, slots: [
  { itemId: 'log', count: 12 },
  { itemId: 'axe', count: 1, durability: 47, maxDurability: 50 },
  // ...21 slots total
] }
```

`loadSnapshot` accepts both v=1 (old M2.10 format) and v=2 (current).
Old snapshots get the new tool fields filled in with full durability.

## Integration

`src/main.js` wires everything:

```js
const regrow = new RegrowManager({
  entities: resources,
  onRegrow: (e) => { /* show "X 已重生" banner */ }
});

const gather = new Gather({
  entities: resources,
  inventory,
  selectedItemProvider: () => {
    const s = inventory.hotbarSelected();
    return s ? s.itemId : null;
  },
  onEvent: (name, payload) => {
    if (name === 'complete') {
      // show loot banner, tool damage marker
    }
  }
});

// Each frame:
regrow.update(now);
gather.update(player, dt, now);
```

## Tests

```bash
node tests/m210-node-smoke.mjs             # 58/58 — M2.10 base
node tests/m210b-regrow-durability.mjs     # 67/67 — M2.10b regrow + durability
node tests/m210c-shovel-resources.mjs      # 76/76 — M2.10c shovel + new resources
node tests/m210d-depletion.mjs             # 156/156 — M2.10d depletion + transform
node tests/m4-node-smoke.mjs               # 20/20 — M4 world regression
```

## Constraints

- Pure ES modules, no framework
- 21 inventory slots, 20-per-stack cap for materials
- Tools never stack; each tool has its own slot + durability
- 6 recipes: 3 hand 2×2, 3 science 3×3
- All RNG is deterministic given `(x, y, id, now)` — same seed + same
  time → same drops across reloads
