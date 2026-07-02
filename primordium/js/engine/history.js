// Time-series recorder for the analytics dashboard. Samples world stats every
// SAMPLE_EVERY ticks into parallel arrays; when the buffer hits capacity it is
// decimated 2:1 and the sampling interval doubles, so an overnight run keeps a
// full-history overview at bounded memory instead of a sliding window.

export const SAMPLE_EVERY = 30;
const CAPACITY = 1200;

export class History {
  constructor() {
    this.sampleEvery = SAMPLE_EVERY;
    this.ticks = [];
    this.population = [];
    this.plantCount = [];
    this.speciesCount = [];
    this.births = [];   // since previous sample
    this.deaths = [];
    this.kills = [];    // predation deaths since previous sample
    this.avgTraits = []; // Float64Array(TRAIT_COUNT) per sample
    this.speciesPop = []; // Map(speciesId -> population) per sample (top species)
    this._pendingBirths = 0;
    this._pendingDeaths = 0;
    this._pendingKills = 0;
  }

  noteBirth() { this._pendingBirths++; }
  noteDeath(byPredation) {
    this._pendingDeaths++;
    if (byPredation) this._pendingKills++;
  }

  /** @param {import('./world.js').World} world */
  maybeSample(world) {
    if (world.tick % this.sampleEvery !== 0) return false;
    this.ticks.push(world.tick);
    this.population.push(world.creatures.length);
    this.plantCount.push(world.plants.length);
    this.speciesCount.push(world.speciesTracker.livingCount());
    this.births.push(this._pendingBirths);
    this.deaths.push(this._pendingDeaths);
    this.kills.push(this._pendingKills);
    this._pendingBirths = 0;
    this._pendingDeaths = 0;
    this._pendingKills = 0;

    this.avgTraits.push(world.meanTraits());

    const pops = {};
    for (const sp of world.speciesTracker.living()) pops[sp.id] = sp.population;
    this.speciesPop.push(pops);

    if (this.ticks.length >= CAPACITY) this.decimate();
    return true;
  }

  /** Halve resolution: keep every second sample, sum the flow counters. */
  decimate() {
    const keep = (arr) => {
      for (let i = 0, j = 0; i < arr.length; i += 2, j++) arr[j] = arr[i];
      arr.length = Math.ceil(this.ticks.length / 2);
    };
    const sumPairs = (arr) => {
      for (let i = 0, j = 0; i < arr.length; i += 2, j++) {
        arr[j] = arr[i] + (arr[i + 1] ?? 0);
      }
      arr.length = Math.ceil(this.ticks.length / 2);
    };
    sumPairs(this.births);
    sumPairs(this.deaths);
    sumPairs(this.kills);
    keep(this.population);
    keep(this.plantCount);
    keep(this.speciesCount);
    keep(this.avgTraits);
    keep(this.speciesPop);
    keep(this.ticks); // must be last: others use pre-keep length
    this.sampleEvery *= 2;
  }

  get length() {
    return this.ticks.length;
  }

  serialize() {
    return {
      sampleEvery: this.sampleEvery,
      ticks: this.ticks,
      population: this.population,
      plantCount: this.plantCount,
      speciesCount: this.speciesCount,
      births: this.births,
      deaths: this.deaths,
      kills: this.kills,
      avgTraits: this.avgTraits.map((a) => Array.from(a, (x) => Math.round(x * 1e4) / 1e4)),
      speciesPop: this.speciesPop,
    };
  }

  static deserialize(data) {
    const h = new History();
    Object.assign(h, data, {
      avgTraits: data.avgTraits.map((a) => Float64Array.from(a)),
    });
    return h;
  }
}
