// Incremental speciation. Every creature belongs to a species; a species is
// defined by a reference genome (its founder's). When a newborn's genetic
// distance to its parent's species reference exceeds SPECIATION_THRESHOLD, it
// founds a new species whose lineage points at the old one — giving us a real
// phylogenetic tree grown from actual mutation history, not labels.

import { distance } from './genome.js';

export const SPECIATION_THRESHOLD = 0.55;

export class SpeciesTracker {
  constructor() {
    this.species = new Map(); // id -> record
    this.nextId = 1;
  }

  /** Register a founder creature with no ancestry (primordial generation). */
  found(creature, tick) {
    // Primordials try to join an existing living species first, so the first
    // generation doesn't create N singleton species.
    for (const sp of this.species.values()) {
      if (sp.extinctAt === null && distance(creature.genome, sp.reference) < SPECIATION_THRESHOLD) {
        this.assign(creature, sp.id);
        return sp.id;
      }
    }
    return this.create(creature, null, tick);
  }

  create(creature, parentSpeciesId, tick) {
    const id = this.nextId++;
    this.species.set(id, {
      id,
      parentId: parentSpeciesId,
      reference: Float64Array.from(creature.genome),
      foundedAt: tick,
      founderId: creature.id,
      extinctAt: null,
      population: 0,
      peakPopulation: 0,
      totalBorn: 0,
      hue: creature.hue,
    });
    this.assign(creature, id);
    return id;
  }

  /**
   * Called for every birth. The child stays in its parent's species while it
   * remains within SPECIATION_THRESHOLD of that species' reference genome. Once
   * it drifts past the threshold it doesn't blindly found a new species — it
   * first looks for the *nearest existing living species* it now fits into, and
   * only founds a new one if it fits none. This clustering keeps the species
   * count tracking real ecological diversity instead of exploding into a new
   * singleton on every divergent birth.
   */
  classifyBirth(child, parentSpeciesId, tick) {
    const parent = this.species.get(parentSpeciesId);
    if (parent && distance(child.genome, parent.reference) < SPECIATION_THRESHOLD) {
      this.assign(child, parent.id);
      return parent.id;
    }
    // Find the closest living species within threshold.
    let best = null, bestD = SPECIATION_THRESHOLD;
    for (const sp of this.species.values()) {
      if (sp.extinctAt !== null || sp.population <= 0) continue;
      const d = distance(child.genome, sp.reference);
      if (d < bestD) { bestD = d; best = sp; }
    }
    if (best) {
      this.assign(child, best.id);
      return best.id;
    }
    return this.create(child, parentSpeciesId, tick);
  }

  assign(creature, id) {
    creature.speciesId = id;
    const sp = this.species.get(id);
    sp.population++;
    sp.totalBorn++;
    if (sp.population > sp.peakPopulation) sp.peakPopulation = sp.population;
  }

  onDeath(creature, tick) {
    const sp = this.species.get(creature.speciesId);
    if (!sp) return;
    sp.population--;
    if (sp.population <= 0) sp.extinctAt = tick;
  }

  get(id) {
    return this.species.get(id);
  }

  /** Living species sorted by population (descending). */
  living() {
    const out = [];
    for (const sp of this.species.values()) if (sp.extinctAt === null && sp.population > 0) out.push(sp);
    out.sort((a, b) => b.population - a.population);
    return out;
  }

  livingCount() {
    let n = 0;
    for (const sp of this.species.values()) if (sp.extinctAt === null && sp.population > 0) n++;
    return n;
  }

  serialize() {
    return {
      nextId: this.nextId,
      // Full precision: the reference genome drives speciation of future
      // births, so rounding it would change classifications after a reload.
      species: Array.from(this.species.values()).map((sp) => ({
        ...sp,
        reference: Array.from(sp.reference),
      })),
    };
  }

  static deserialize(data) {
    const t = new SpeciesTracker();
    t.nextId = data.nextId;
    for (const sp of data.species) {
      t.species.set(sp.id, { ...sp, reference: Float64Array.from(sp.reference) });
    }
    return t;
  }
}
