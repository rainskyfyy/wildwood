/**
 * Resource renderer — draws a harvestable ResourceEntity as a kind-tinted
 * sprite + (optional) progress bar over the tile.
 *
 * v1.0.1 — regrow visual state:
 *   'full'       — normal
 *   'regrowing'  — small stump / sapling with a regrow progress bar
 *   'depleted'   — permanent depletion, very dim
 *
 * v1.0.2 — dig-category resources (dirt_mound, sapling, carrot, mushroom,
 *   flower_patch) added with their own icons and a generic "depleted patch"
 *   regrow visual.
 *
 * v1.0.3 — depletable resources:
 *   - New icons for coal / gold_ore / gem_vein / tin_ore (mines-only)
 *   - 'depleted' visual state now shows a cracked silhouette + red X
 *     overlay so permanently-exhausted nodes (e.g. coal after 4 hits,
 *     or a node that just transformed into rock) are clearly distinct
 *     from transient 'regrowing' state.
 *
 * v1.0.4 — three-stage growth (M2.10e):
 *   - 6 new defs for the stage variants of tree / dead_tree / berry_bush
 *     (stage 0 = young, stage 1 = mature, stage 2 = old)
 *   - Icons: tree_sprout / tree_old / dead_tree_sprout / dead_tree_old /
 *            berry_sprout / berry_bush_old
 *   - Stage 0 (sprout) is smaller and lighter; stage 2 (old) is darker and
 *     bears more fruit / extra branches as the "ripe reward" visual cue.
 */
'use strict';

const KIND_ICON = {
  tree:    (c, s) => { /* trunk */
                       c.fillStyle = '#3a2a1a';
                       c.fillRect(-2*s, -6*s, 4*s, 12*s);
                       /* foliage */
                       c.fillStyle = '#3a5a2a';
                       c.beginPath();
                       c.arc(0, -10*s, 10*s, 0, Math.PI*2);
                       c.fill();
                       c.fillStyle = '#5a7a3a';
                       c.beginPath();
                       c.arc(-4*s, -12*s, 5*s, 0, Math.PI*2);
                       c.fill();
                       c.beginPath();
                       c.arc(5*s, -8*s, 5*s, 0, Math.PI*2);
                       c.fill();
                     },
  dead_tree:(c, s) => { c.fillStyle = '#3a2a1a';
                       c.fillRect(-2*s, -8*s, 4*s, 14*s);
                       c.fillStyle = '#5a3a2a';
                       c.beginPath(); c.moveTo(-2*s, -6*s);
                       c.lineTo(2*s, -3*s); c.lineTo(0, -1*s); c.closePath(); c.fill();
                       c.beginPath(); c.moveTo(0, -4*s);
                       c.lineTo(3*s, -1*s); c.lineTo(1*s, 1*s); c.closePath(); c.fill();
                     },
  rock:    (c, s) => { c.fillStyle = '#7a7070';
                       c.beginPath();
                       c.ellipse(0, 0, 9*s, 7*s, 0, 0, Math.PI*2);
                       c.fill();
                       c.fillStyle = 'rgba(255,255,255,0.15)';
                       c.beginPath();
                       c.ellipse(-3*s, -3*s, 4*s, 2*s, 0, 0, Math.PI*2);
                       c.fill();
                     },
  boulder: (c, s) => { c.fillStyle = '#4a3a3a';
                       c.beginPath();
                       c.ellipse(0, 2*s, 13*s, 10*s, 0, 0, Math.PI*2);
                       c.fill();
                       c.fillStyle = '#5a4a4a';
                       c.beginPath();
                       c.ellipse(0, -2*s, 11*s, 7*s, 0, 0, Math.PI*2);
                       c.fill();
                     },
  grass_tuft: (c, s) => { c.fillStyle = '#5a8a3a';
                          c.fillRect(-6*s, 0, 2*s, 5*s);
                          c.fillRect(-2*s, -2*s, 2*s, 7*s);
                          c.fillRect(2*s, -1*s, 2*s, 6*s);
                          c.fillRect(5*s, 0, 2*s, 5*s);
                        },
  berry_bush: (c, s) => { c.fillStyle = '#5a7a2a';
                          c.beginPath();
                          c.arc(0, 0, 8*s, 0, Math.PI*2);
                          c.fill();
                          c.fillStyle = '#8a2a4a';
                          c.beginPath(); c.arc(-3*s, -2*s, 2*s, 0, Math.PI*2); c.fill();
                          c.beginPath(); c.arc(2*s, -1*s, 2*s, 0, Math.PI*2); c.fill();
                          c.beginPath(); c.arc(0, 3*s, 2*s, 0, Math.PI*2); c.fill();
                        },
  iron_ore: (c, s) => { c.fillStyle = '#5a5560';
                        c.beginPath();
                        c.ellipse(0, 0, 8*s, 6*s, 0, 0, Math.PI*2);
                        c.fill();
                        c.fillStyle = '#a85a3a';
                        c.fillRect(-4*s, -2*s, 3*s, 3*s);
                        c.fillRect(1*s, 1*s, 3*s, 3*s);
                      },
  ice_shard: (c, s) => { c.fillStyle = '#a8d4e8';
                         c.beginPath();
                         c.moveTo(0, -10*s); c.lineTo(4*s, 0);
                         c.lineTo(0, 8*s); c.lineTo(-4*s, 0);
                         c.closePath(); c.fill();
                         c.fillStyle = 'rgba(255,255,255,0.4)';
                         c.beginPath();
                         c.moveTo(0, -10*s); c.lineTo(2*s, -2*s);
                         c.lineTo(0, 0); c.lineTo(-2*s, -2*s);
                         c.closePath(); c.fill();
                       },
  // v1.0.2 — dig-category resources
  dirt_mound: (c, s) => { c.fillStyle = '#7a5a3a';
                          c.beginPath();
                          c.ellipse(0, 2*s, 8*s, 5*s, 0, 0, Math.PI*2);
                          c.fill();
                          c.fillStyle = '#9a7a4a';
                          c.beginPath();
                          c.ellipse(-2*s, 0, 4*s, 2*s, 0, 0, Math.PI*2);
                          c.fill();
                          c.fillStyle = '#5a3a2a';
                          c.beginPath();
                          c.arc(3*s, 1*s, 1*s, 0, Math.PI*2);
                          c.arc(-4*s, 2*s, 1*s, 0, Math.PI*2);
                          c.fill();
                        },
  sapling: (c, s) => { c.fillStyle = '#3a2a1a';
                        c.fillRect(-1*s, 0, 2*s, 5*s);
                        c.fillStyle = '#5a8a3a';
                        c.beginPath();
                        c.arc(0, -2*s, 4*s, 0, Math.PI*2);
                        c.fill();
                        c.fillStyle = '#7ab04a';
                        c.beginPath();
                        c.arc(-2*s, -4*s, 2*s, 0, Math.PI*2);
                        c.fill();
                        c.beginPath();
                        c.arc(2*s, -1*s, 2*s, 0, Math.PI*2);
                        c.fill();
                      },
  carrot:   (c, s) => { c.fillStyle = '#3a5a2a';
                        c.beginPath();
                        c.moveTo(-3*s, -5*s); c.lineTo(0, -7*s); c.lineTo(3*s, -5*s);
                        c.lineTo(2*s, -2*s); c.lineTo(-2*s, -2*s);
                        c.closePath(); c.fill();
                        c.fillStyle = '#d4802a';
                        c.beginPath();
                        c.moveTo(0, -2*s); c.lineTo(2*s, 2*s); c.lineTo(0, 5*s);
                        c.lineTo(-2*s, 2*s); c.closePath(); c.fill();
                        c.fillStyle = '#a85a1a';
                        c.fillRect(-1*s, 1*s, 2*s, 3*s);
                      },
  mushroom: (c, s) => { c.fillStyle = '#f4e0c4';
                        c.fillRect(-1*s, 0, 2*s, 5*s);
                        c.fillStyle = '#b8704a';
                        c.beginPath();
                        c.ellipse(0, -1*s, 7*s, 4*s, 0, 0, Math.PI);
                        c.fill();
                        c.fillStyle = '#d4906a';
                        c.beginPath();
                        c.ellipse(-2*s, -2*s, 2*s, 1*s, 0, 0, Math.PI*2);
                        c.fill();
                        c.beginPath();
                        c.arc(2*s, -1*s, 1*s, 0, Math.PI*2);
                        c.fill();
                      },
  flower_patch: (c, s) => { c.fillStyle = '#5a8a3a';
                            c.fillRect(-6*s, 0, 12*s, 3*s);
                            // 3 flowers
                            const drawFlower = (fx, fy, color) => {
                              c.fillStyle = color;
                              c.beginPath(); c.arc(fx, fy, 2*s, 0, Math.PI*2); c.fill();
                              c.fillStyle = '#f4d44a';
                              c.beginPath(); c.arc(fx, fy, 1*s, 0, Math.PI*2); c.fill();
                            };
                            drawFlower(-4*s, -1*s, '#d4628a');
                            drawFlower(0,   -2*s, '#e8a04a');
                            drawFlower(4*s, -1*s, '#b4628a');
                          },
  // v1.0.3 — depletable mines resources
  coal:     (c, s) => { c.fillStyle = '#3a3a40';
                        c.beginPath();
                        c.ellipse(0, 0, 8*s, 6*s, 0, 0, Math.PI*2);
                        c.fill();
                        c.fillStyle = '#1a1a1a';
                        c.fillRect(-5*s, -3*s, 3*s, 3*s);
                        c.fillRect(1*s, 0, 4*s, 2*s);
                        c.fillRect(-2*s, 2*s, 2*s, 2*s);
                        c.fillStyle = '#5a5a60';
                        c.beginPath();
                        c.ellipse(-3*s, -3*s, 2*s, 1*s, 0, 0, Math.PI*2);
                        c.fill();
                      },
  gold_ore: (c, s) => { c.fillStyle = '#5a5560';
                        c.beginPath();
                        c.ellipse(0, 0, 8*s, 6*s, 0, 0, Math.PI*2);
                        c.fill();
                        c.fillStyle = '#d4a02a';
                        c.fillRect(-4*s, -2*s, 3*s, 3*s);
                        c.fillRect(1*s, 1*s, 3*s, 3*s);
                        c.fillStyle = '#f4c84a';
                        c.beginPath();
                        c.arc(-2*s, -3*s, 1*s, 0, Math.PI*2);
                        c.fill();
                        c.beginPath();
                        c.arc(2*s, 0, 1*s, 0, Math.PI*2);
                        c.fill();
                      },
  gem_vein: (c, s) => { c.fillStyle = '#3a4a5a';
                         c.beginPath();
                         c.ellipse(0, 0, 8*s, 5*s, 0, 0, Math.PI*2);
                         c.fill();
                         // Crystal shards
                         c.fillStyle = '#5abcd4';
                         c.beginPath();
                         c.moveTo(-3*s, -3*s); c.lineTo(-1*s, -5*s);
                         c.lineTo(1*s, -3*s); c.lineTo(0, 0);
                         c.closePath(); c.fill();
                         c.fillStyle = '#7adcf4';
                         c.beginPath();
                         c.moveTo(1*s, -1*s); c.lineTo(3*s, -3*s);
                         c.lineTo(4*s, 0); c.lineTo(2*s, 2*s);
                         c.closePath(); c.fill();
                         c.fillStyle = '#aaeefc';
                         c.beginPath();
                         c.arc(0, -2*s, 1*s, 0, Math.PI*2);
                         c.fill();
                       },
  tin_ore:  (c, s) => { c.fillStyle = '#5a5560';
                        c.beginPath();
                        c.ellipse(0, 0, 8*s, 6*s, 0, 0, Math.PI*2);
                        c.fill();
                        c.fillStyle = '#b8b8c8';
                        c.fillRect(-4*s, -2*s, 3*s, 3*s);
                        c.fillRect(1*s, 1*s, 3*s, 3*s);
                        c.fillStyle = '#d4d4e0';
                        c.beginPath();
                        c.ellipse(-2*s, -3*s, 2*s, 1*s, 0, 0, Math.PI*2);
                        c.fill();
                      },
  // v1.0.4 — three-stage growth stages (icon for each of the 6 new defs)
  // Stage 0 = young/sapling. Stage 2 = old/mature. These are sub-icons of
  // tree / dead_tree / berry_bush and only appear as part of a growth cycle.
  tree_sprout: (c, s) => { /* small sapling, ~50% size of mature tree */
                          c.fillStyle = '#3a2a1a';
                          c.fillRect(-1*s, 0, 2*s, 4*s);
                          c.fillStyle = '#6a8a3a';
                          c.beginPath();
                          c.arc(0, -2*s, 5*s, 0, Math.PI*2);
                          c.fill();
                          c.fillStyle = '#8aa84a';
                          c.beginPath();
                          c.arc(-2*s, -4*s, 2*s, 0, Math.PI*2);
                          c.fill();
                        },
  tree_old:  (c, s) => { /* gnarly old tree, slightly larger, darker + bare branches */
                        c.fillStyle = '#3a2a1a';
                        c.fillRect(-3*s, -6*s, 6*s, 14*s);
                        c.fillStyle = '#2a4a1a';
                        c.beginPath();
                        c.arc(0, -10*s, 11*s, 0, Math.PI*2);
                        c.fill();
                        c.fillStyle = '#1a3a0a';
                        c.beginPath();
                        c.arc(-5*s, -12*s, 5*s, 0, Math.PI*2);
                        c.fill();
                        // Bare branches
                        c.fillStyle = '#3a2a1a';
                        c.fillRect(-9*s, -5*s, 6*s, 1.5*s);
                        c.fillRect(4*s, -7*s, 6*s, 1.5*s);
                        c.fillRect(-7*s, -10*s, 1.5*s, 5*s);
                        c.fillRect(5*s, -12*s, 1.5*s, 4*s);
                      },
  dead_tree_sprout: (c, s) => { /* small dead twig, mostly brown */
                              c.fillStyle = '#5a3a2a';
                              c.fillRect(-1*s, 0, 2*s, 4*s);
                              c.fillStyle = '#7a5a3a';
                              c.fillRect(-3*s, -2*s, 6*s, 1.5*s);
                              c.fillRect(-2*s, -5*s, 1*s, 4*s);
                            },
  dead_tree_old:  (c, s) => { /* old dead tree, dark + crumbling */
                            c.fillStyle = '#2a1a1a';
                            c.fillRect(-2*s, -6*s, 4*s, 12*s);
                            c.fillStyle = '#4a2a1a';
                            c.beginPath(); c.moveTo(-2*s, -4*s);
                            c.lineTo(2*s, -1*s); c.lineTo(0, 1*s); c.closePath(); c.fill();
                            c.beginPath(); c.moveTo(0, -3*s);
                            c.lineTo(4*s, 0); c.lineTo(2*s, 2*s); c.closePath(); c.fill();
                            c.beginPath(); c.moveTo(-4*s, -2*s);
                            c.lineTo(-2*s, 1*s); c.lineTo(-3*s, 3*s); c.closePath(); c.fill();
                            // Cracks
                            c.fillStyle = '#1a0a0a';
                            c.fillRect(-1*s, -4*s, 1*s, 2*s);
                            c.fillRect(0, 1*s, 1*s, 2*s);
                          },
  berry_sprout: (c, s) => { /* small berry bush, ~50% size, no berries yet */
                          c.fillStyle = '#6a8a3a';
                          c.beginPath();
                          c.arc(0, 0, 5*s, 0, Math.PI*2);
                          c.fill();
                          c.fillStyle = '#8aa84a';
                          c.beginPath();
                          c.arc(-2*s, -2*s, 2*s, 0, Math.PI*2);
                          c.fill();
                        },
  berry_bush_old: (c, s) => { /* large mature bush, dense berries */
                            c.fillStyle = '#4a6a1a';
                            c.beginPath();
                            c.arc(0, 0, 10*s, 0, Math.PI*2);
                            c.fill();
                            c.fillStyle = '#6a8a2a';
                            c.beginPath();
                            c.arc(-3*s, -4*s, 5*s, 0, Math.PI*2);
                            c.fill();
                            c.beginPath();
                            c.arc(4*s, -2*s, 5*s, 0, Math.PI*2);
                            c.fill();
                            // Many berries (ripe reward)
                            c.fillStyle = '#8a2a4a';
                            for (const [bx, by] of [[-4, 1], [-1, -3], [2, 0], [5, 1], [-3, -5], [3, -4], [0, 3]]) {
                              c.beginPath();
                              c.arc(bx*s, by*s, 1.5*s, 0, Math.PI*2);
                              c.fill();
                            }
                          }
};

/**
 * Tiny stump drawn for regrowing state. Half-size, brown.
 */
function drawStump(ctx, s) {
  ctx.fillStyle = '#5a3a2a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 5*s, 3*s, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#3a2a1a';
  ctx.beginPath();
  ctx.ellipse(0, -1*s, 4*s, 2*s, 0, 0, Math.PI*2);
  ctx.fill();
}

/**
 * Sapling drawn for early regrow. Small green sprout.
 */
function drawSapling(ctx, s, t) {
  // t = 0..1 regrow progress; size grows with t
  const k = 0.4 + 0.6 * t;
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(-1*s, 0, 2*s, 4*s*k);
  ctx.fillStyle = '#5a8a3a';
  ctx.beginPath();
  ctx.arc(0, -2*s*k, 3*s*k, 0, Math.PI*2);
  ctx.fill();
}

/**
 * Generic "patch" regrow visual for dig-category resources. A small
 * disturbed earth / sprout that grows with t.
 */
function drawDigPatch(ctx, s, t, color = '#7a5a3a') {
  const k = 0.4 + 0.6 * t;
  ctx.fillStyle = '#5a3a2a';
  ctx.beginPath();
  ctx.ellipse(0, 2*s, 4*s, 2*s, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -1*s*k, 2*s*k, 0, Math.PI*2);
  ctx.fill();
}

export function drawResource(ctx, sx, sy, entity, progress = 0, now = Date.now()) {
  const s = (entity.size || 0.7) * 0.55;
  ctx.save();
  ctx.translate(sx, sy - 4);
  const icon = KIND_ICON[entity.icon] || KIND_ICON.rock;
  const visual = entity.getVisualState ? entity.getVisualState() : (entity.depleted ? 'depleted' : 'full');
  if (visual === 'regrowing') {
    const frac = entity.regrowFraction ? entity.regrowFraction(now) : 0;
    if (entity.icon === 'tree' || entity.icon === 'dead_tree') {
      // Stump + sapling overlay: stump constant, sapling grows with frac.
      drawStump(ctx, s * 0.5);
      drawSapling(ctx, s * 0.5, frac);
    } else {
      // Generic dig/regrow patch (dirt, sprouts growing back)
      const patchColor = entity.color || '#7a5a3a';
      drawDigPatch(ctx, s * 0.5, frac, patchColor);
    }
    // Regrow progress bar above
    const w = 24, h = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-w/2, -28, w, h);
    ctx.fillStyle = '#7ec47e';
    ctx.fillRect(-w/2, -28, w * frac, h);
  } else if (visual === 'depleted') {
    // Permanent depletion (e.g. coal after 4 hits, gold_ore after transform).
    // v1.0.3: draw a dark cracked silhouette + a red X overlay so the player
    // can tell at a glance that this node is gone for good (not just
    // regrowing). 30% alpha + X gives a strong "exhausted" cue without
    // hiding the icon completely.
    ctx.globalAlpha = 0.35;
    icon(ctx, s);
    ctx.globalAlpha = 1.0;
    // X overlay
    ctx.strokeStyle = '#3a1a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6*s, -6*s); ctx.lineTo(6*s, 6*s);
    ctx.moveTo(6*s, -6*s); ctx.lineTo(-6*s, 6*s);
    ctx.stroke();
  } else {
    icon(ctx, s);
    if (progress > 0 && progress < 1) {
      // gather progress bar above the entity
      const w = 24, h = 3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-w/2, -28, w, h);
      ctx.fillStyle = '#d4a64a';
      ctx.fillRect(-w/2, -28, w * progress, h);
    }
    // v1.0.4: growth-stage progress bar for non-terminal growth-capable
    // resources. Helps the player see when the next stage (richer drops)
    // will arrive. Terminal stage (2) has duration=-1 and no bar.
    if (entity.isGrowthCapable && !entity.isTerminalStage) {
      const sp = entity.getStageProgress ? entity.getStageProgress(now) : 0;
      const w = 24, h = 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-w/2, -32, w, h);
      // Color by stage: 0=young (cyan), 1=mature (gold)
      ctx.fillStyle = entity.currentStageIndex === 0 ? '#7ed4d4' : '#d4c47e';
      ctx.fillRect(-w/2, -32, w * sp, h);
    } else if (entity.isGrowthCapable && entity.isTerminalStage) {
      // Terminal: small "ripe" marker above (e.g. ★) so the player knows
      // the resource is in its final, most-rewarding stage.
      ctx.fillStyle = '#f4c84a';
      ctx.beginPath();
      const cx = 0, cy = -32, r = 3;
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        const a2 = a + Math.PI / 5;
        ctx.lineTo(cx + r * 0.4 * Math.cos(a2), cy + r * 0.4 * Math.sin(a2));
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
