// A creature is a genome given a body. All numeric "phenotype" values are
// derived once from the genome at birth; per-tick state is position, heading,
// energy and age. Behaviour comes exclusively from the brain's outputs.

import { Brain } from './brain.js';
import { T, TRAIT_COUNT } from './genome.js';

let NEXT_ID = 1;
export function _resetIds(v = 1) { NEXT_ID = v; } // for deterministic tests/loads
export function _peekNextId() { return NEXT_ID; }

export class Creature {
  /**
   * @param {Float64Array} genome
   * @param {number} x @param {number} y
   * @param {number} energy starting energy
   * @param {number} tickBorn
   */
  constructor(genome, x, y, energy, tickBorn, heading = 0, id = null) {
    this.id = id ?? NEXT_ID++;
    this.genome = genome;
    this.brain = new Brain(genome, TRAIT_COUNT);

    // --- phenotype (fixed at birth) ---
    this.radius = 3 + genome[T.SIZE] * 6;                    // 3 … 9
    this.maxSpeed = 0.4 + genome[T.SPEED] * 1.4;             // px / tick
    this.senseRange = 40 + genome[T.SENSE] * 110;            // 40 … 150
    this.diet = genome[T.DIET];                              // 0 herb … 1 carn
    this.maxEnergy = 60 + genome[T.SIZE] * 240;              // big bodies store more
    this.lifespan = Math.round(2200 + genome[T.LONGEVITY] * 4800);
    this.fertilityAt = 0.55 + genome[T.FERTILITY] * 0.4;     // energy fraction
    this.investment = 0.25 + genome[T.INVESTMENT] * 0.4;     // energy to child
    this.hue = genome[T.HUE] * 360;
    this.aggression = genome[T.AGGRESSION];

    // Resting burn: bigger bodies, sharper senses and hotter metabolism all
    // cost energy every tick even when standing still.
    this.baseCost =
      0.010 +
      genome[T.SIZE] * 0.028 +
      genome[T.SENSE] * 0.012 +
      genome[T.METABOLISM] * 0.020;
    // Hot metabolism buys faster action readiness (used as thrust multiplier).
    this.vigor = 0.75 + genome[T.METABOLISM] * 0.5;

    // --- state ---
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.energy = energy;
    this.age = 0;
    this.tickBorn = tickBorn;
    this.alive = true;
    this.speciesId = -1;
    this.parentId = null;
    this.generation = 0;
    this.children = 0;
    this.kills = 0;
    this.lastBite = -999; // tick of most recent successful bite (for FX)
    this.deathCause = null;
  }

  /** Energy fraction 0..1. */
  get fullness() {
    return Math.min(1, this.energy / this.maxEnergy);
  }

  /**
   * True if this creature could eat `other`: a carnivore-enough diet, a
   * meaningfully larger body, and — crucially — a *different species*. Kin
   * protection means predators can't cannibalise their own lineage, so they
   * genuinely depend on a prey population and starve (then crash) when it
   * collapses. That dependence is what produces predator–prey oscillation
   * instead of a self-consuming carnivore monoculture.
   */
  canEat(other) {
    return (
      this.diet > 0.28 &&
      other.speciesId !== this.speciesId &&
      other.radius < this.radius * 0.82
    );
  }

  /**
   * Advance one tick given brain outputs already computed.
   * Returns the movement energy cost.
   */
  applyOutputs(dt = 1) {
    const [turn, thrustRaw] = this.brain.output;
    const thrust = Math.max(0, thrustRaw); // no reverse gear
    this.heading += turn * 0.15 * dt;
    const speed = thrust * this.maxSpeed * this.vigor;
    this.x += Math.cos(this.heading) * speed * dt;
    this.y += Math.sin(this.heading) * speed * dt;
    // Movement cost grows with the square of speed and linearly with size:
    // sprinting is expensive, and being huge makes it worse.
    return speed * speed * (0.006 + this.radius * 0.0016) * dt;
  }

  wantsToBite() {
    return this.brain.output[2] > 0.1 - this.aggression * 0.2;
  }
}
