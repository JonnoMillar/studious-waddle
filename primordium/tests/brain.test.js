import { suite, test, assert } from './harness.js';
import { RNG } from '../js/core/rng.js';
import { Brain, BRAIN_GENE_COUNT, N_IN, N_HID, N_OUT } from '../js/engine/brain.js';
import { GENOME_LENGTH, TRAIT_COUNT } from '../js/engine/genome.js';

suite('Brain', () => {
  test('gene count matches topology', () => {
    assert.equal(BRAIN_GENE_COUNT, N_HID * (N_IN + 1) + N_OUT * (N_HID + 1));
  });

  test('genome layout leaves room for the brain after traits', () => {
    assert.equal(GENOME_LENGTH, TRAIT_COUNT + BRAIN_GENE_COUNT);
  });

  test('outputs are bounded by tanh', () => {
    const g = new Float64Array(GENOME_LENGTH);
    const rng = new RNG(1);
    for (let i = 0; i < g.length; i++) g[i] = rng.gaussian(0, 5); // large weights
    const b = new Brain(g, TRAIT_COUNT);
    for (let i = 0; i < N_IN; i++) b.input[i] = rng.gaussian(0, 3);
    b.forward();
    for (const o of b.output) assert.ok(o >= -1 && o <= 1, `output out of range: ${o}`);
  });

  test('forward pass is pure given inputs and weights', () => {
    const g = new Float64Array(GENOME_LENGTH);
    const rng = new RNG(2);
    for (let i = 0; i < g.length; i++) g[i] = rng.gaussian(0, 1);
    const b = new Brain(g, TRAIT_COUNT);
    for (let i = 0; i < N_IN; i++) b.input[i] = Math.sin(i);
    const first = Array.from(b.forward());
    const second = Array.from(b.forward());
    assert.deepEqual(first, second);
  });

  test('zero weights and zero input give zero output', () => {
    const g = new Float64Array(GENOME_LENGTH); // all zero
    const b = new Brain(g, TRAIT_COUNT);
    b.forward();
    for (const o of b.output) assert.equal(o, 0);
  });

  test('a hand-wired weight produces the expected sign', () => {
    const g = new Float64Array(GENOME_LENGTH);
    // Wire input 0 strongly into hidden 0, and hidden 0 strongly into output 0.
    let w = TRAIT_COUNT;
    g[w] = 0;        // hidden0 bias
    g[w + 1] = 5;    // hidden0 <- input0
    // advance to output block
    w = TRAIT_COUNT + N_HID * (N_IN + 1);
    g[w] = 0;        // output0 bias
    g[w + 1] = 5;    // output0 <- hidden0
    const b = new Brain(g, TRAIT_COUNT);
    b.input[0] = 1;
    b.forward();
    assert.ok(b.output[0] > 0.9, `expected strong positive output, got ${b.output[0]}`);
    b.input[0] = -1;
    b.forward();
    assert.ok(b.output[0] < -0.9, `expected strong negative output, got ${b.output[0]}`);
  });
});
