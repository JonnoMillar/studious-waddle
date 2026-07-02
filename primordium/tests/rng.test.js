import { suite, test, assert } from './harness.js';
import { RNG } from '../js/core/rng.js';

suite('RNG', () => {
  test('is deterministic for the same seed', () => {
    const a = new RNG(12345);
    const b = new RNG(12345);
    for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  });

  test('diverges for different seeds', () => {
    const a = new RNG(1);
    const b = new RNG(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    assert.ok(same < 3, `expected near-zero collisions, got ${same}`);
  });

  test('string seeds are accepted and stable', () => {
    const a = new RNG('aurora');
    const b = new RNG('aurora');
    assert.equal(a.next(), b.next());
    assert.notEqual(new RNG('aurora').next(), new RNG('ember').next());
  });

  test('next() stays in [0, 1)', () => {
    const r = new RNG(7);
    for (let i = 0; i < 100000; i++) {
      const v = r.next();
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
  });

  test('int() covers the inclusive range and stays within bounds', () => {
    const r = new RNG(9);
    const seen = new Set();
    for (let i = 0; i < 20000; i++) {
      const v = r.int(3, 8);
      assert.ok(v >= 3 && v <= 8);
      seen.add(v);
    }
    for (let v = 3; v <= 8; v++) assert.ok(seen.has(v), `never produced ${v}`);
  });

  test('gaussian has ~unit mean/variance', () => {
    const r = new RNG(42);
    let sum = 0, sumSq = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const v = r.gaussian(0, 1);
      sum += v; sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    assert.ok(Math.abs(mean) < 0.03, `mean drifted: ${mean}`);
    assert.ok(Math.abs(variance - 1) < 0.05, `variance off: ${variance}`);
  });

  test('save/load restores exact stream', () => {
    const r = new RNG(3);
    for (let i = 0; i < 50; i++) r.next();
    const snap = r.save();
    const expected = [r.next(), r.next(), r.next()];
    const r2 = new RNG(999).load(snap);
    assert.deepEqual([r2.next(), r2.next(), r2.next()], expected);
  });

  test('gaussian spare is captured by save/load', () => {
    const r = new RNG(5);
    r.gaussian(); // primes the spare
    const snap = r.save();
    const expected = r.gaussian();
    const r2 = new RNG(1).load(snap);
    assert.equal(r2.gaussian(), expected);
  });
});
