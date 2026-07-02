// The genome is a flat Float64Array. The first TRAIT_COUNT loci are named
// body/behaviour traits stored in [0,1]; everything after them is the brain's
// weight vector stored in [-1,1]. Mutation is Gaussian perturbation whose
// rate and scale are themselves encoded in the genome (meta-mutation), so
// lineages can evolve to be more or less evolvable.

import { BRAIN_GENE_COUNT } from './brain.js';

// Named trait loci. Order is part of the save format — append only.
export const T = {
  SIZE: 0,        // body radius scale — big is strong & slow, small is quick & cheap
  SPEED: 1,       // max thrust
  SENSE: 2,       // sense radius scale
  DIET: 3,        // 0 = pure herbivore … 1 = pure carnivore
  METABOLISM: 4,  // resting energy burn (low = efficient but sluggish senses)
  FERTILITY: 5,   // energy fraction threshold to reproduce (low = r-strategist)
  INVESTMENT: 6,  // fraction of energy given to offspring
  HUE: 7,         // display hue; drifts with mutation so clades share colour
  MUT_RATE: 8,    // meta: per-locus mutation probability
  MUT_SIZE: 9,    // meta: mutation step scale
  LONGEVITY: 10,  // lifespan scale
  AGGRESSION: 11, // bite damage / willingness threshold shaping
};
export const TRAIT_COUNT = 12;
export const GENOME_LENGTH = TRAIT_COUNT + BRAIN_GENE_COUNT;

const TRAIT_NAMES = [
  'size', 'speed', 'sense', 'diet', 'metabolism', 'fertility',
  'investment', 'hue', 'mut rate', 'mut size', 'longevity', 'aggression',
];
export function traitName(i) {
  return TRAIT_NAMES[i] ?? `w${i - TRAIT_COUNT}`;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp11 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);

/** A fresh random genome for the primordial generation. */
export function randomGenome(rng) {
  const g = new Float64Array(GENOME_LENGTH);
  for (let i = 0; i < TRAIT_COUNT; i++) g[i] = rng.next();
  // The founders start near-herbivorous: an all-carnivore soup starves
  // instantly, and predation should be *discovered* by evolution instead.
  g[T.DIET] = rng.next() * 0.25;
  g[T.MUT_RATE] = 0.15 + rng.next() * 0.25;
  g[T.MUT_SIZE] = 0.15 + rng.next() * 0.3;
  for (let i = TRAIT_COUNT; i < GENOME_LENGTH; i++) {
    g[i] = rng.gaussian(0, 0.5);
    g[i] = clamp11(g[i]);
  }
  return g;
}

/** Child genome: copy of parent with meta-controlled Gaussian mutation. */
export function mutate(parent, rng) {
  const child = Float64Array.from(parent);
  const rate = 0.01 + parent[T.MUT_RATE] * 0.24;  // 1% … 25% loci touched
  const size = 0.02 + parent[T.MUT_SIZE] * 0.18;  // step std dev
  for (let i = 0; i < GENOME_LENGTH; i++) {
    if (rng.next() >= rate) continue;
    if (i < TRAIT_COUNT) {
      if (i === T.HUE) {
        // Hue is circular: wrap instead of clamping so colour drifts freely.
        child[i] = (child[i] + rng.gaussian(0, size) + 1) % 1;
      } else {
        child[i] = clamp01(child[i] + rng.gaussian(0, size));
      }
    } else {
      child[i] = clamp11(child[i] + rng.gaussian(0, size * 2));
    }
  }
  return child;
}

/**
 * Genetic distance used for speciation. Trait loci dominate (they define the
 * ecological niche); brain weights contribute with a small weight so purely
 * behavioural divergence can eventually split a species too. Hue is excluded:
 * it is cosmetic and shouldn't drive speciation.
 */
export function distance(a, b) {
  let d = 0;
  for (let i = 0; i < TRAIT_COUNT; i++) {
    if (i === T.HUE) continue;
    const diff = a[i] - b[i];
    d += diff * diff;
  }
  let bd = 0;
  for (let i = TRAIT_COUNT; i < GENOME_LENGTH; i++) {
    const diff = a[i] - b[i];
    bd += diff * diff;
  }
  return Math.sqrt(d + bd * 0.02);
}

export function serializeGenome(g) {
  return Array.from(g, (x) => Math.round(x * 1e6) / 1e6);
}

export function deserializeGenome(arr) {
  return Float64Array.from(arr);
}
