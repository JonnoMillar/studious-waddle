import { suite, test, assert } from './harness.js';
import { RNG } from '../js/core/rng.js';
import {
  randomGenome, mutate, distance, GENOME_LENGTH, TRAIT_COUNT, T,
  serializeGenome, deserializeGenome,
} from '../js/engine/genome.js';

suite('Genome', () => {
  test('random genome has correct length and bounded loci', () => {
    const g = randomGenome(new RNG(1));
    assert.equal(g.length, GENOME_LENGTH);
    for (let i = 0; i < TRAIT_COUNT; i++) assert.ok(g[i] >= 0 && g[i] <= 1);
    for (let i = TRAIT_COUNT; i < GENOME_LENGTH; i++) assert.ok(g[i] >= -1 && g[i] <= 1);
  });

  test('founders start herbivore-leaning', () => {
    const rng = new RNG(1);
    for (let i = 0; i < 50; i++) {
      const g = randomGenome(rng);
      assert.ok(g[T.DIET] <= 0.25, `founder diet too carnivorous: ${g[T.DIET]}`);
    }
  });

  test('mutate keeps all loci in bounds', () => {
    const rng = new RNG(2);
    let g = randomGenome(rng);
    for (let step = 0; step < 500; step++) {
      g = mutate(g, rng);
      for (let i = 0; i < TRAIT_COUNT; i++) assert.ok(g[i] >= 0 && g[i] <= 1, `trait ${i} = ${g[i]}`);
      for (let i = TRAIT_COUNT; i < GENOME_LENGTH; i++) assert.ok(g[i] >= -1 && g[i] <= 1);
    }
  });

  test('mutation is deterministic given the RNG', () => {
    const parent = randomGenome(new RNG(3));
    const a = mutate(parent, new RNG(10));
    const b = mutate(parent, new RNG(10));
    assert.deepEqual(Array.from(a), Array.from(b));
  });

  test('child usually resembles parent', () => {
    const rng = new RNG(4);
    const parent = randomGenome(rng);
    const child = mutate(parent, rng);
    assert.ok(distance(parent, child) < 0.6, 'single-step mutation drifted too far');
  });

  test('distance is zero to self and symmetric', () => {
    const g1 = randomGenome(new RNG(5));
    const g2 = randomGenome(new RNG(6));
    assert.equal(distance(g1, g1), 0);
    assert.ok(Math.abs(distance(g1, g2) - distance(g2, g1)) < 1e-12);
  });

  test('hue does not affect genetic distance', () => {
    const g1 = randomGenome(new RNG(7));
    const g2 = Float64Array.from(g1);
    g2[T.HUE] = (g1[T.HUE] + 0.5) % 1; // change only hue
    assert.ok(distance(g1, g2) < 1e-9, 'hue leaked into speciation distance');
  });

  test('serialize/deserialize round-trips within precision', () => {
    const g = randomGenome(new RNG(8));
    const back = deserializeGenome(serializeGenome(g));
    for (let i = 0; i < g.length; i++) assert.ok(Math.abs(g[i] - back[i]) < 1e-5);
  });

  test('drift accumulates over generations', () => {
    const rng = new RNG(11);
    let g = randomGenome(rng);
    const start = Float64Array.from(g);
    for (let i = 0; i < 300; i++) g = mutate(g, rng);
    assert.ok(distance(start, g) > 0.1, 'lineage failed to diverge over 300 generations');
  });
});
