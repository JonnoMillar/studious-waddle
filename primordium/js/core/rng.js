// Deterministic seeded PRNG. Every source of randomness in the simulation
// flows through one instance of this, which is what makes worlds reproducible
// from a seed and lets the test suite assert bit-identical replays.

/** splitmix32 — used to scramble string seeds into 32-bit state. */
function splitmix32(a) {
  return function () {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export class RNG {
  /** @param {number|string} seed */
  constructor(seed = 1) {
    this.reseed(seed);
  }

  reseed(seed) {
    if (typeof seed === 'string') {
      // FNV-1a hash of the string, so "aurora" is a valid seed.
      let h = 0x811c9dc5;
      for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      seed = h >>> 0;
    }
    // Warm up state with splitmix so small integer seeds diverge quickly.
    const mix = splitmix32(seed | 0);
    mix();
    this.state = Math.floor(mix() * 4294967296) >>> 0;
    if (this.state === 0) this.state = 0x1a2b3c4d;
    this.seed = seed;
    this._spare = null; // cached second gaussian sample
    return this;
  }

  /** mulberry32 core: float in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }

  /** Standard normal via Marsaglia polar method (deterministic, cached spare). */
  gaussian(mean = 0, std = 1) {
    if (this._spare !== null) {
      const s = this._spare;
      this._spare = null;
      return mean + std * s;
    }
    let u, v, s;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this._spare = v * m;
    return mean + std * u * m;
  }

  /** Pick a uniform random element of an array. */
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Serializable snapshot of generator state. */
  save() {
    return { state: this.state, spare: this._spare };
  }

  load(snap) {
    this.state = snap.state >>> 0;
    this._spare = snap.spare;
    return this;
  }
}
