// The World owns everything and advances the simulation one deterministic tick
// at a time. A tick is: rebuild spatial grids → sense+think+act per creature →
// feeding & predation → metabolism, ageing, death → reproduction → plant
// growth → record stats. Given the same seed and config, tick N is always
// bit-identical, which is what the determinism test pins down.

import { RNG } from '../core/rng.js';
import { SpatialGrid, wrap } from './spatial.js';
import { Creature, _resetIds, _peekNextId } from './creature.js';
import { randomGenome, mutate, serializeGenome, deserializeGenome, T, TRAIT_COUNT, GENOME_LENGTH } from './genome.js';
import { SpeciesTracker } from './species.js';
import { History } from './history.js';

export const DEFAULT_CONFIG = {
  width: 2200,
  height: 1400,
  startCreatures: 130,
  startPlants: 750,
  maxCreatures: 1100,     // safety net, not the regulator — food should limit
  maxPlants: 1800,
  plantEnergy: 8,         // energy per plant eaten (herbivory is not a free lunch)
  // Plants grow logistically: fast when the field is sparse, saturating near
  // maxPlants. This gives the ecosystem a real carrying capacity and lets grazing
  // pressure drive genuine boom–bust cycles instead of pinning at a floor.
  plantGrowthRate: 0.02,  // logistic rate per existing plant per tick
  plantSeedRate: 2.2,     // constant regrowth so a grazed-flat field can recover
  plantSpawnClumping: 0.72,// 0 uniform … 1 clustered near existing plants
  biteEnergyFrac: 0.5,    // fraction of drained energy the predator keeps
  biteDamage: 11,         // energy removed from victim per successful bite
  predatorInterference: 0.09, // hunt-success penalty per rival predator nearby
  reproMinAge: 120,       // ticks before a creature can breed
  reproCooldown: 90,      // ticks between births for one creature
  starThreshold: 0,       // energy at/below which a creature dies
  // Immigration: a trickle of outside colonists keeps the world from ever
  // collapsing to a permanent monoculture and lets vacated niches (e.g. an
  // extinct predator guild) be recolonised — the analogue of a mainland seeding
  // an island. Without it, predator–prey oscillation eventually amplifies to
  // extinction and never recovers (the fitness valley can't be re-crossed).
  immigrationInterval: 650, // ticks between colonist waves (0 disables)
  immigrationCount: 4,      // colonists per wave
};

export class World {
  constructor(seed = 'primordium', config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.seed = seed;
    this.reset();
  }

  reset() {
    const c = this.config;
    this.rng = new RNG(this.seed);
    this.tick = 0;
    _resetIds(1);
    this.creatures = [];
    this.plants = [];
    this.speciesTracker = new SpeciesTracker();
    this.history = new History();
    this.stats = { born: 0, died: 0, kills: 0, starved: 0, aged: 0, immigrated: 0 };
    this._plantAccumulator = 0;
    this._reproTimers = new Map(); // creatureId -> last birth tick

    // Grids sized to the largest sensible query radius.
    this.creatureGrid = new SpatialGrid(c.width, c.height, 80);
    this.plantGrid = new SpatialGrid(c.width, c.height, 80);

    // Seed plants.
    for (let i = 0; i < c.startPlants; i++) {
      this.plants.push({
        x: this.rng.range(0, c.width),
        y: this.rng.range(0, c.height),
        energy: c.plantEnergy,
      });
    }
    // Seed the primordial generation across two niches. Evolving predators
    // from an all-herbivore soup means crossing a fitness valley (a half-carnivore
    // is a worse grazer *and* too small to hunt), which won't happen
    // spontaneously — so we seed both niches and let selection refine each.
    for (let i = 0; i < c.startCreatures; i++) this._spawnColonist();
    this.history.maybeSample(this);
  }

  /**
   * Create one founder/colonist and add it to the world. Most are small
   * efficient grazers; ~14% are larger, faster, carnivore-leaning hunters, so
   * both ecological niches are represented. Used for both the initial seeding
   * and for immigration waves.
   */
  _spawnColonist() {
    const c = this.config;
    const g = randomGenome(this.rng);
    if (this.rng.chance(0.14)) {
      g[T.DIET] = 0.55 + this.rng.next() * 0.35;
      g[T.SIZE] = 0.6 + this.rng.next() * 0.35;
      g[T.SPEED] = 0.55 + this.rng.next() * 0.4;
      g[T.SENSE] = 0.5 + this.rng.next() * 0.4;
      g[T.AGGRESSION] = 0.5 + this.rng.next() * 0.5;
    } else {
      g[T.DIET] = this.rng.next() * 0.15;
      g[T.SIZE] = this.rng.next() * 0.4;
    }
    const cr = new Creature(
      g,
      this.rng.range(0, c.width),
      this.rng.range(0, c.height),
      50 + this.rng.range(0, 30),
      this.tick,
      this.rng.range(0, Math.PI * 2),
    );
    cr.generation = 0;
    this.creatures.push(cr);
    this.speciesTracker.found(cr, this.tick);
    return cr;
  }

  // ---- main loop -------------------------------------------------------

  step() {
    const c = this.config;
    this._rebuildGrids();

    const births = [];
    for (let i = 0; i < this.creatures.length; i++) {
      const cr = this.creatures[i];
      if (!cr.alive) continue;
      this._sense(cr);
      cr.brain.forward();
      const moveCost = cr.applyOutputs();
      cr.x = wrap(cr.x, c.width);
      cr.y = wrap(cr.y, c.height);
      cr.energy -= moveCost + cr.baseCost;
      cr.age++;

      this._feed(cr);
      if (cr.wantsToBite()) this._attemptBite(cr);

      // Death checks.
      if (cr.energy <= c.starThreshold) {
        this._kill(cr, 'starved');
        continue;
      }
      if (cr.age >= cr.lifespan) {
        this._kill(cr, 'age');
        continue;
      }

      // Reproduction (asexual with mutation).
      if (this._canReproduce(cr)) {
        const child = this._makeChild(cr);
        if (child) births.push(child);
      }
    }

    // Integrate births after the pass so newborns don't act this tick.
    for (const child of births) {
      if (this.creatures.length >= c.maxCreatures) break;
      this.creatures.push(child);
    }

    // Compact out the dead.
    if (this.stats._deadThisTick) {
      this.creatures = this.creatures.filter((cr) => cr.alive);
      this.stats._deadThisTick = 0;
    }

    this._growPlants();
    this._immigrate();
    this.tick++;
    this.history.maybeSample(this);
  }

  _immigrate() {
    const c = this.config;
    if (!c.immigrationInterval) return;
    if (this.tick > 0 && this.tick % c.immigrationInterval === 0) {
      for (let i = 0; i < c.immigrationCount && this.creatures.length < c.maxCreatures; i++) {
        this._spawnColonist();
        this.stats.immigrated++;
      }
    }
  }

  _rebuildGrids() {
    this.creatureGrid.clear();
    for (const cr of this.creatures) if (cr.alive) this.creatureGrid.insert(cr);
    this.plantGrid.clear();
    for (const p of this.plants) this.plantGrid.insert(p);
  }

  // ---- sensing ---------------------------------------------------------

  _sense(cr) {
    const inp = cr.brain.input;
    const cosH = Math.cos(-cr.heading);
    const sinH = Math.sin(-cr.heading);

    // Nearest plant.
    let bestP = null, bestPd2 = Infinity, bpx = 0, bpy = 0;
    this.plantGrid.query(cr.x, cr.y, cr.senseRange, (p, dx, dy, d2) => {
      if (d2 < bestPd2) { bestPd2 = d2; bestP = p; bpx = dx; bpy = dy; }
      return false;
    });

    // Nearest prey and nearest threat among creatures.
    let preyD2 = Infinity, prx = 0, pry = 0;
    let threatD2 = Infinity, thx = 0, thy = 0;
    let crowd = 0;
    this.creatureGrid.query(cr.x, cr.y, cr.senseRange, (o, dx, dy, d2) => {
      if (o === cr) return false;
      crowd++;
      if (cr.canEat(o) && d2 < preyD2) { preyD2 = d2; prx = dx; pry = dy; }
      if (o.canEat(cr) && d2 < threatD2) { threatD2 = d2; thx = dx; thy = dy; }
      return false;
    });

    const sr = cr.senseRange;
    // Rotate world-space deltas into the creature's local frame so "left" is
    // always the same output regardless of heading.
    const local = (dx, dy) => [dx * cosH - dy * sinH, dx * sinH + dy * cosH];

    if (bestP) {
      const [lx, ly] = local(bpx, bpy);
      const d = Math.sqrt(bestPd2) || 1;
      inp[0] = lx / d; inp[1] = ly / d; inp[2] = 1 - Math.sqrt(bestPd2) / sr;
    } else { inp[0] = inp[1] = inp[2] = 0; }

    if (preyD2 < Infinity) {
      const [lx, ly] = local(prx, pry);
      const d = Math.sqrt(preyD2) || 1;
      inp[3] = lx / d; inp[4] = ly / d; inp[5] = 1 - Math.sqrt(preyD2) / sr;
    } else { inp[3] = inp[4] = inp[5] = 0; }

    if (threatD2 < Infinity) {
      const [lx, ly] = local(thx, thy);
      const d = Math.sqrt(threatD2) || 1;
      inp[6] = lx / d; inp[7] = ly / d; inp[8] = 1 - Math.sqrt(threatD2) / sr;
    } else { inp[6] = inp[7] = inp[8] = 0; }

    inp[9] = cr.fullness * 2 - 1;
    inp[10] = Math.min(1, crowd / 12) * 2 - 1;
    inp[11] = Math.sin(this.tick * 0.05 + cr.id);
    inp[12] = 1; // bias
  }

  // ---- feeding & predation --------------------------------------------

  _feed(cr) {
    // Herbivory: eat the single nearest un-consumed plant within reach each
    // tick. Efficiency falls off as diet leans carnivorous.
    const herbEff = 1 - cr.diet;
    if (herbEff <= 0.05) return;
    const reach = cr.radius + 4;
    let eaten = null;
    this.plantGrid.query(cr.x, cr.y, reach, (p) => {
      if (p._consumed) return false; // already taken this tick
      eaten = p;
      return true; // stop at first available plant
    });
    if (eaten) {
      cr.energy = Math.min(cr.maxEnergy, cr.energy + this.config.plantEnergy * herbEff);
      eaten._consumed = true; // removed in _growPlants pass
    }
  }

  _attemptBite(cr) {
    if (cr.diet < 0.28) return;
    const reach = cr.radius + 6;
    let victim = null;
    let rivals = 0; // other carnivores hunting the same patch
    this.creatureGrid.query(cr.x, cr.y, Math.max(reach, 34), (o, dx, dy, d2) => {
      if (o === cr || !o.alive) return false;
      if (o.diet > 0.28) rivals++;
      if (!victim && d2 <= reach * reach && cr.canEat(o)) victim = o;
      return false;
    });
    if (!victim) return;
    // Predator interference: rival hunters crowding the same prey reduce each
    // one's success, which caps predator density and damps the boom–bust swings
    // that would otherwise amplify to extinction.
    const interference = 1 - Math.min(0.8, rivals * this.config.predatorInterference);
    if (interference < 1 && !this.rng.chance(interference)) { cr.lastBite = this.tick - 6; return; }
    const dmg = this.config.biteDamage * (0.6 + cr.aggression * 0.8);
    const drained = Math.min(victim.energy, dmg);
    victim.energy -= drained;
    // Carnivory efficiency scales with how carnivorous the diet is.
    cr.energy = Math.min(cr.maxEnergy, cr.energy + drained * this.config.biteEnergyFrac * cr.diet);
    cr.lastBite = this.tick;
    if (victim.energy <= 0 && victim.alive) {
      cr.kills++;
      this._kill(victim, 'predation');
    }
  }

  // ---- lifecycle -------------------------------------------------------

  _canReproduce(cr) {
    if (cr.age < this.config.reproMinAge) return false;
    if (cr.fullness < cr.fertilityAt) return false;
    const last = this._reproTimers.get(cr.id) ?? -Infinity;
    if (this.tick - last < this.config.reproCooldown) return false;
    if (this.creatures.length >= this.config.maxCreatures) return false;
    return true;
  }

  _makeChild(parent) {
    const give = parent.energy * parent.investment;
    parent.energy -= give;
    this._reproTimers.set(parent.id, this.tick);
    const g = mutate(parent.genome, this.rng);
    const angle = this.rng.range(0, Math.PI * 2);
    const child = new Creature(
      g,
      wrap(parent.x + Math.cos(angle) * (parent.radius + 3), this.config.width),
      wrap(parent.y + Math.sin(angle) * (parent.radius + 3), this.config.height),
      give,
      this.tick,
      this.rng.range(0, Math.PI * 2),
    );
    child.parentId = parent.id;
    child.generation = parent.generation + 1;
    parent.children++;
    this.speciesTracker.classifyBirth(child, parent.speciesId, this.tick);
    this.stats.born++;
    this.history.noteBirth();
    return child;
  }

  _kill(cr, cause) {
    if (!cr.alive) return;
    cr.alive = false;
    cr.deathCause = cause;
    this.speciesTracker.onDeath(cr, this.tick);
    this._reproTimers.delete(cr.id);
    this.stats.died++;
    this.stats._deadThisTick = (this.stats._deadThisTick || 0) + 1;
    if (cause === 'predation') this.stats.kills++;
    else if (cause === 'starved') this.stats.starved++;
    else if (cause === 'age') this.stats.aged++;
    this.history.noteDeath(cause === 'predation');
  }

  // ---- plants ----------------------------------------------------------

  _growPlants() {
    // Remove consumed plants.
    if (this.plants.some((p) => p._consumed)) {
      this.plants = this.plants.filter((p) => !p._consumed);
    }
    const c = this.config;
    const n = this.plants.length;
    // Logistic growth + a small constant seed rate for recovery from near-zero.
    const logistic = c.plantGrowthRate * n * (1 - n / c.maxPlants);
    this._plantAccumulator += Math.max(0, logistic) + c.plantSeedRate;
    let toSpawn = Math.floor(this._plantAccumulator);
    this._plantAccumulator -= toSpawn;
    while (toSpawn-- > 0 && this.plants.length < c.maxPlants) {
      let x, y;
      if (this.plants.length && this.rng.chance(c.plantSpawnClumping)) {
        // New growth sprouts near an existing plant → patchy meadows form,
        // which makes evolved sensing worth paying for.
        const seed = this.plants[this.rng.int(0, this.plants.length - 1)];
        x = wrap(seed.x + this.rng.gaussian(0, 40), c.width);
        y = wrap(seed.y + this.rng.gaussian(0, 40), c.height);
      } else {
        x = this.rng.range(0, c.width);
        y = this.rng.range(0, c.height);
      }
      this.plants.push({ x, y, energy: c.plantEnergy });
    }
  }

  // ---- stats helpers ---------------------------------------------------

  meanTraits() {
    const m = new Float64Array(TRAIT_COUNT);
    if (!this.creatures.length) return m;
    for (const cr of this.creatures) {
      for (let i = 0; i < TRAIT_COUNT; i++) m[i] += cr.genome[i];
    }
    for (let i = 0; i < TRAIT_COUNT; i++) m[i] /= this.creatures.length;
    return m;
  }

  /** Cheap FNV hash over positions/energy — used by the determinism test. */
  hash() {
    let h = 0x811c9dc5;
    const mix = (v) => {
      // fold a float into the hash via its rounded milli-value
      const n = Math.round(v * 1000) | 0;
      h ^= n & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (n >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (n >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    };
    mix(this.creatures.length);
    mix(this.plants.length);
    for (const cr of this.creatures) { mix(cr.x); mix(cr.y); mix(cr.energy); mix(cr.speciesId); }
    return h >>> 0;
  }

  // ---- persistence -----------------------------------------------------

  serialize() {
    return {
      version: 2,
      seed: this.seed,
      tick: this.tick,
      config: this.config,
      rng: this.rng.save(),
      nextCreatureId: _peekNextId(),
      stats: this.stats,
      plantAccumulator: this._plantAccumulator,
      reproTimers: Array.from(this._reproTimers.entries()),
      // Simulation-affecting fields are stored at full precision so a loaded
      // world resumes bit-identically. Rounding positions here would inject
      // divergence into a chaotic system (the persistence test pins this).
      creatures: this.creatures.map((cr) => ({
        id: cr.id,
        genome: Array.from(cr.genome),
        x: cr.x,
        y: cr.y,
        heading: cr.heading,
        energy: cr.energy,
        age: cr.age,
        tickBorn: cr.tickBorn,
        speciesId: cr.speciesId,
        parentId: cr.parentId,
        generation: cr.generation,
        children: cr.children,
        kills: cr.kills,
      })),
      plants: this.plants.map((p) => ({ x: p.x, y: p.y })),
      species: this.speciesTracker.serialize(),
      history: this.history.serialize(),
    };
  }

  static deserialize(data) {
    const w = new World(data.seed, data.config);
    // reset() seeded a fresh world; overwrite it wholesale.
    w.tick = data.tick;
    w.rng.load(data.rng);
    w.stats = data.stats;
    w._plantAccumulator = data.plantAccumulator ?? 0;
    w._reproTimers = new Map(data.reproTimers ?? []);
    _resetIds(data.nextCreatureId ?? 1);

    w.creatures = data.creatures.map((d) => {
      const cr = new Creature(
        deserializeGenome(d.genome), d.x, d.y, d.energy, d.tickBorn, d.heading, d.id,
      );
      cr.age = d.age;
      cr.speciesId = d.speciesId;
      cr.parentId = d.parentId;
      cr.generation = d.generation;
      cr.children = d.children;
      cr.kills = d.kills;
      return cr;
    });
    w.plants = data.plants.map((p) => ({ x: p.x, y: p.y, energy: w.config.plantEnergy }));
    w.speciesTracker = SpeciesTracker.deserialize(data.species);
    w.history = History.deserialize(data.history);
    return w;
  }
}
