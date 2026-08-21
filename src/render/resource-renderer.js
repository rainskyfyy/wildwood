/**
 * Resource renderer — draws a harvestable ResourceEntity as a kind-tinted
 * sprite + (optional) progress bar over the tile.
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
                       }
};

export function drawResource(ctx, sx, sy, entity, progress = 0) {
  const s = (entity.size || 0.7) * 0.55;
  ctx.save();
  ctx.translate(sx, sy - 4);
  const icon = KIND_ICON[entity.icon] || KIND_ICON.rock;
  icon(ctx, s);
  if (entity.depleted) {
    ctx.globalAlpha = 0.3;
    icon(ctx, s);
    ctx.globalAlpha = 1.0;
  } else if (progress > 0 && progress < 1) {
    // gather progress bar above the entity
    const w = 24, h = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-w/2, -28, w, h);
    ctx.fillStyle = '#d4a64a';
    ctx.fillRect(-w/2, -28, w * progress, h);
  }
  ctx.restore();
}
