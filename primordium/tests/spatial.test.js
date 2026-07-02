import { suite, test, assert } from './harness.js';
import { RNG } from '../js/core/rng.js';
import { SpatialGrid, torusDelta, wrap } from '../js/engine/spatial.js';

// Brute-force reference for the toroidal radius query, to validate the grid.
function bruteForce(items, x, y, radius, W, H) {
  const out = [];
  for (const it of items) {
    const [dx, dy] = torusDelta(x, y, it.x, it.y, W, H);
    if (dx * dx + dy * dy <= radius * radius) out.push(it);
  }
  return out;
}

suite('SpatialGrid', () => {
  const W = 800, H = 600;

  test('wrap keeps values in range', () => {
    assert.equal(wrap(810, 800), 10);
    assert.equal(wrap(-10, 800), 790);
    assert.equal(wrap(0, 800), 0);
  });

  test('torusDelta takes the shortest path across the seam', () => {
    const [dx] = torusDelta(10, 0, 790, 0, W, H);
    assert.equal(dx, -20); // 790 is 20 to the left of 10 across the wrap
  });

  test('query matches brute force on random data', () => {
    const rng = new RNG(1);
    const items = [];
    for (let i = 0; i < 2000; i++) items.push({ x: rng.range(0, W), y: rng.range(0, H), id: i });
    const grid = new SpatialGrid(W, H, 60);
    for (const it of items) grid.insert(it);

    for (let q = 0; q < 200; q++) {
      const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(5, 55);
      const expected = new Set(bruteForce(items, x, y, r, W, H).map((i) => i.id));
      const got = new Set();
      grid.query(x, y, r, (it) => { got.add(it.id); return false; });
      assert.equal(got.size, expected.size, `count mismatch at (${x|0},${y|0}) r=${r|0}`);
      for (const id of expected) assert.ok(got.has(id), `missing ${id}`);
    }
  });

  test('query finds neighbours across the wrap seam', () => {
    const grid = new SpatialGrid(W, H, 60);
    const a = { x: 5, y: 5, id: 'a' };
    const b = { x: 795, y: 595, id: 'b' }; // diagonally opposite corner, but close on a torus
    grid.insert(a); grid.insert(b);
    const got = [];
    grid.query(5, 5, 30, (it) => { got.push(it.id); return false; });
    assert.ok(got.includes('b'), 'did not find wrapped neighbour');
  });

  test('callback can stop early', () => {
    const grid = new SpatialGrid(W, H, 60);
    for (let i = 0; i < 50; i++) grid.insert({ x: 100, y: 100, id: i });
    let count = 0;
    grid.query(100, 100, 20, () => { count++; return true; });
    assert.equal(count, 1);
  });

  test('delta returned to callback is the wrapped displacement', () => {
    const grid = new SpatialGrid(W, H, 60);
    grid.insert({ x: 795, y: 5, id: 'x' });
    let dx = null, dy = null;
    grid.query(5, 5, 30, (it, ddx, ddy) => { dx = ddx; dy = ddy; return true; });
    assert.equal(dx, -10); // 795 is 10px left of 5 across the seam
    assert.equal(dy, 0);
  });
});
