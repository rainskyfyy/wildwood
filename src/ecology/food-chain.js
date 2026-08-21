/**
 * Food chain + predation (v0.5.1 ecology).
 *
 * Reads the `foodChain` + `predationEfficiency` sections of
 * ecology.json and exposes:
 *   - getPredators(species)         — who eats this species
 *   - getPrey(species)              — what this species eats
 *   - computePredation(populations) — given current populations,
 *                                      return a map of how many
 *                                      individuals each prey bucket
 *                                      loses this tick.
 *
 * Predation model:
 *
 *   preyRatio(p) = min(1, p.count / max(1, p.capacity * 0.5))
 *                // 1 when prey is at or above half-K, scales to 0
 *                // as prey approaches extinction.
 *
 *   kills(q → p) = min(p.count, floor(q.count * eff(q,p) * preyRatio(p)))
 *
 * The cap `min(p.count, …)` is the saturation limit: 100 foxes can't
 * eat 300 rabbits per tick (only as many as exist). And `preyRatio`
 * is what makes the Lotka-Volterra loop stable — when foxes eat
 * faster than rabbits reproduce, preyRatio drops and so does fox
 * food, leading to fox decline → rabbit recovery.
 *
 * We do NOT model cross-biome predation in v0.5.1 — only same-biome.
 * Migration / cross-biome hunting is a v0.5.3+ feature.
 */

'use strict';

export class FoodChain {
  /**
   * @param {Object} cfg — parsed ecology.json
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.foodChain = cfg.foodChain || {};
    this.efficiency = cfg.predationEfficiency || {};
  }

  /**
   * List species that eat `prey`.
   * @param {string} prey
   * @returns {string[]}
   */
  getPredators(prey) {
    const out = [];
    for (const [pred, info] of Object.entries(this.foodChain)) {
      if ((info.eats || []).includes(prey)) out.push(pred);
    }
    return out;
  }

  /**
   * List species that `pred` eats.
   * @param {string} pred
   * @returns {string[]}
   */
  getPrey(pred) {
    return (this.foodChain[pred] && this.foodChain[pred].eats) || [];
  }

  /**
   * @param {string} predator
   * @param {string} prey
   * @returns {number} per-tick kill rate per predator individual
   */
  _efficiency(predator, prey) {
    return (this.efficiency[predator] && this.efficiency[predator][prey]) || 0;
  }

  /**
   * Compute predation losses for every (biome × species) bucket.
   *
   * @param {Map<string, import('./population.js').Population>} populations
   *   key format: `${biome}|${species}`
   * @returns {Map<string, number>} per-key individuals consumed this tick
   */
  computePredation(populations) {
    const losses = new Map();
    // Group populations by biome so we only consider same-biome
    // predation. Cross-biome predation is rare in v0.5.1 (we don't
    // model migration) and would be expensive to add.
    const byBiome = new Map();
    for (const pop of populations.values()) {
      if (!byBiome.has(pop.biome)) byBiome.set(pop.biome, []);
      byBiome.get(pop.biome).push(pop);
    }
    for (const [, pops] of byBiome) {
      for (const pred of pops) {
        const preyList = this.getPrey(pred.species);
        if (preyList.length === 0) continue;
        for (const preySpecies of preyList) {
          const eff = this._efficiency(pred.species, preySpecies);
          if (eff <= 0) continue;
          const prey = pops.find(p => p.species === preySpecies);
          if (!prey || prey.count <= 0) continue;
          // Prey ratio: 1 if at or above half-K, scales down to 0 if extinct.
          const halfK = Math.max(1, prey.capacity * 0.5);
          const preyRatio = Math.min(1, prey.count / halfK);
          const kills = pred.count * eff * preyRatio;
          const totalKill = Math.min(prey.count, Math.floor(kills));
          if (totalKill > 0) {
            const key = `${prey.biome}|${prey.species}`;
            losses.set(key, (losses.get(key) || 0) + totalKill);
          }
        }
      }
    }
    return losses;
  }
}
