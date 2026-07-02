import { suite, test, assert } from './harness.js';
import { World } from '../js/engine/world.js';

function run(seed, ticks, config) {
  const w = new World(seed, config);
  for (let i = 0; i < ticks; i++) w.step();
  return w;
}

suite('World / simulation', () => {
  test('same seed produces identical state (determinism)', () => {
    const a = run('determinism', 1500);
    const b = run('determinism', 1500);
    assert.equal(a.hash(), b.hash(), 'hashes diverged for identical seeds');
    assert.equal(a.creatures.length, b.creatures.length);
    assert.equal(a.stats.born, b.stats.born);
    assert.equal(a.stats.died, b.stats.died);
  });

  test('different seeds produce different worlds', () => {
    const a = run('seed-A', 800);
    const b = run('seed-B', 800);
    assert.notEqual(a.hash(), b.hash());
  });

  test('determinism holds when stepping is split into segments', () => {
    const whole = run('split', 1000);
    const piecewise = new World('split');
    for (let i = 0; i < 400; i++) piecewise.step();
    for (let i = 0; i < 600; i++) piecewise.step();
    assert.equal(whole.hash(), piecewise.hash());
  });

  test('population stays within configured bounds', () => {
    const w = run('bounds', 2000);
    assert.ok(w.creatures.length <= w.config.maxCreatures);
    assert.ok(w.plants.length <= w.config.maxPlants);
    assert.ok(w.creatures.length >= 0);
  });

  test('every creature stays inside the toroidal world', () => {
    const w = run('inside', 1000);
    for (const cr of w.creatures) {
      assert.ok(cr.x >= 0 && cr.x < w.config.width, `x out of range: ${cr.x}`);
      assert.ok(cr.y >= 0 && cr.y < w.config.height, `y out of range: ${cr.y}`);
      assert.ok(cr.alive, 'dead creature left in the live array');
    }
  });

  test('energy conservation sanity: no creature exceeds its capacity', () => {
    const w = run('energy', 1200);
    for (const cr of w.creatures) {
      assert.ok(cr.energy <= cr.maxEnergy + 1e-6, `over-full: ${cr.energy} > ${cr.maxEnergy}`);
      assert.ok(cr.energy > 0, 'live creature with non-positive energy');
    }
  });

  test('reproduction and death counters are consistent', () => {
    const w = run('counters', 1500);
    // Every creature ever present entered as a founder, a birth, or an
    // immigrant; every one now gone was a death. The books must balance.
    const expected =
      w.config.startCreatures + w.stats.born + w.stats.immigrated - w.stats.died;
    assert.equal(expected, w.creatures.length, 'population accounting drifted');
  });

  test('immigration reintroduces creatures over time', () => {
    const w = run('immigration', 2000);
    assert.ok(w.stats.immigrated > 0, 'no immigrants arrived');
  });

  test('species are created and tracked', () => {
    const w = run('species', 1500);
    assert.ok(w.speciesTracker.livingCount() >= 1);
    for (const sp of w.speciesTracker.living()) assert.ok(sp.population > 0);
  });

  test('history is sampled and bounded', () => {
    const w = run('history', 3000);
    assert.ok(w.history.length > 1);
    assert.ok(w.history.length <= 1200, `history exceeded cap: ${w.history.length}`);
    // Flow counters should roughly reconcile with lifetime totals.
    const totalBirths = w.history.births.reduce((a, b) => a + b, 0);
    assert.ok(totalBirths > 0);
  });

  test('meanTraits returns valid trait vector', () => {
    const w = run('traits', 500);
    const m = w.meanTraits();
    for (const v of m) assert.ok(v >= 0 && v <= 1, `mean trait out of range: ${v}`);
  });
});
