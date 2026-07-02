// Throughput benchmark. Reports ticks/second at a steady-state population so
// we know the headroom for the browser's 64x fast-forward mode.

import { World } from '../js/engine/world.js';

function bench(seed, warmup, measured) {
  const w = new World(seed);
  for (let i = 0; i < warmup; i++) w.step();
  const pop0 = w.creatures.length;
  const t0 = performance.now();
  for (let i = 0; i < measured; i++) w.step();
  const dt = performance.now() - t0;
  const tps = (measured / dt) * 1000;
  return { tps, dt, pop: w.creatures.length, pop0, species: w.speciesTracker.livingCount() };
}

console.log('Primordium throughput benchmark\n');
for (const seed of ['aurora', 'ember', 'cobalt']) {
  const r = bench(seed, 1500, 2000);
  console.log(
    `seed ${seed.padEnd(8)}  ${r.tps.toFixed(0).padStart(5)} ticks/s  ` +
    `pop ${String(r.pop).padStart(3)}  species ${String(r.species).padStart(2)}  ` +
    `(${r.dt.toFixed(0)}ms for 2000 ticks)`,
  );
}
console.log('\nAt 60fps the UI targets up to 64 ticks/frame ≈ 3840 ticks/s;');
console.log('the loop caps sim time at 12ms/frame so the UI stays responsive.');
