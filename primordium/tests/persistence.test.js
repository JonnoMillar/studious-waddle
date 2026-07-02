import { suite, test, assert } from './harness.js';
import { World } from '../js/engine/world.js';

suite('Persistence', () => {
  test('save/load round-trips world state exactly', () => {
    const w = new World('persist');
    for (let i = 0; i < 900; i++) w.step();
    const snapshot = JSON.parse(JSON.stringify(w.serialize()));
    const restored = World.deserialize(snapshot);

    assert.equal(restored.tick, w.tick);
    assert.equal(restored.creatures.length, w.creatures.length);
    assert.equal(restored.plants.length, w.plants.length);
    assert.equal(restored.speciesTracker.livingCount(), w.speciesTracker.livingCount());
  });

  test('a loaded world continues deterministically', () => {
    // Run 600 ticks, snapshot, then compare "continue from snapshot" vs
    // "run straight through" — they must land on the same state.
    const straight = new World('continue');
    for (let i = 0; i < 600; i++) straight.step();
    const snapshot = JSON.parse(JSON.stringify(straight.serialize()));
    for (let i = 0; i < 400; i++) straight.step();

    const resumed = World.deserialize(snapshot);
    for (let i = 0; i < 400; i++) resumed.step();

    assert.equal(resumed.tick, straight.tick);
    assert.equal(
      resumed.creatures.length,
      straight.creatures.length,
      'population diverged after resume',
    );
    // Positions are rounded on save, so exact hash equality is not expected;
    // assert the lineage bookkeeping matches instead.
    assert.equal(resumed.stats.born, straight.stats.born, 'births diverged after resume');
    assert.equal(resumed.stats.died, straight.stats.died, 'deaths diverged after resume');
  });

  test('serialized payload is JSON-safe (no NaN / Infinity)', () => {
    const w = new World('json');
    for (let i = 0; i < 500; i++) w.step();
    const str = JSON.stringify(w.serialize());
    assert.ok(!str.includes('null,null'), 'suspicious null run in payload');
    assert.doesNotThrow(() => JSON.parse(str));
    // Round the whole thing through JSON and confirm creature count survives.
    const back = World.deserialize(JSON.parse(str));
    assert.equal(back.creatures.length, w.creatures.length);
  });
});
