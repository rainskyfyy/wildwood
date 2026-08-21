/**
 * Population dynamics (v0.5.1 ecology).
 *
 * One Population per (biome × species) bucket. Updates use a
 * discrete-time logistic growth model with predation pressure:
 *
 *   N_{t+1} = N_t + (birthRate * N_t) * (1 - N_t / K)
 *                  - (deathRate * N_t)
 *                  - (predationLoss)
 *
 * `predationLoss` is computed upstream by FoodChain when predators
 * in the same biome consume this bucket; this module just applies
 * the per-tick birth/death update and clamps the count to [0, K].
 *
 * The constructor clamps `initial` to [0, capacity] so a misconfigured
 * spawn (initial > K) immediately snaps to K instead of waiting for
 * the overpopulation culling on the first tick.
 *
 * All math is integer-safe (Math.floor) so a test fixture can replay
 * any seed and get a stable bit-exact result.
 */

'use strict';

export class Population {
  /**
   * @param {Object} opts
   * @param {string} opts.biome
   * @param {string} opts.species
   * @param {number} opts.initial
   * @param {number} opts.capacity
   * @param {number} opts.birthRate  per tick
   * @param {number} opts.deathRate  per tick
   * @param {() => number} [opts.rng]  — defaults to Math.random
   */
  constructor({ biome, species, initial, capacity, birthRate, deathRate, rng = Math.random }) {
    this.biome = biome;
    this.species = species;
    this.capacity = Math.max(0, capacity);
    this.birthRate = birthRate;
    this.deathRate = deathRate;
    this.rng = rng;
    // Clamp initial to [0, capacity] so a misconfigured spawn snaps
    // to K (carrying capacity) instead of triggering culling later.
    this.count = Math.max(0, Math.min(this.capacity, Math.floor(initial)));
    this.avgHp = 1.0;
    this._lastDelta = 0;
    this._lastBirths = 0;
    this._lastDeaths = 0;
    this._lastPredationLoss = 0;
  }

  /**
   * Run one tick of the population model. `predationLoss` is the
   * number of individuals consumed by predators this tick.
   *
   * @param {number} predationLoss
   * @returns {{ births: number, deaths: number, predationLoss: number, delta: number }}
   */
  tick(predationLoss = 0) {
    if (this.count <= 0 && predationLoss <= 0) {
      this._lastDelta = 0;
      this._lastBirths = 0;
      this._lastDeaths = 0;
      this._lastPredationLoss = 0;
      return { births: 0, deaths: 0, predationLoss: 0, delta: 0 };
    }

    const N = this.count;
    const K = this.capacity;
    let births = 0;
    if (N > 0 && K > 0 && N < K) {
      const logistic = (N / K);
      births = Math.floor(this.birthRate * N * (1 - logistic) + this.rng() * 0.4);
    }
    let deaths = Math.floor(this.deathRate * N + this.rng() * 0.3);
    if (N > K) {
      deaths += Math.floor((N - K) * 0.5 + this.rng() * 0.5);
    }
    const loss = Math.min(N, Math.max(0, Math.floor(predationLoss)));
    const totalOut = Math.min(N, deaths + loss);
    const realDeaths = totalOut - loss;

    const newCount = Math.max(0, Math.min(K, N + births - totalOut));
    this._lastBirths = births;
    this._lastDeaths = realDeaths;
    this._lastPredationLoss = loss;
    this._lastDelta = newCount - N;
    this.count = newCount;
    return {
      births,
      deaths: realDeaths,
      predationLoss: loss,
      delta: this._lastDelta
    };
  }

  /**
   * Adjust the carrying capacity — used when a biome is partially
   * blocked off (e.g. building) or temporarily enriched (berry
   * grove bloom).
   */
  setCapacity(k) {
    this.capacity = Math.max(0, Math.floor(k));
    if (this.count > this.capacity) this.count = this.capacity;
  }

  snapshot() {
    return {
      biome: this.biome,
      species: this.species,
      count: this.count,
      capacity: this.capacity,
      avgHp: this.avgHp
    };
  }

  lastTick() {
    return {
      births: this._lastBirths,
      deaths: this._lastDeaths,
      predationLoss: this._lastPredationLoss,
      delta: this._lastDelta
    };
  }
}
