// Entry point: import every *.test.js suite, then run them. Exit non-zero on
// failure so CI and `npm test` behave. No test framework, no dependencies.

import { runAll } from './harness.js';

await import('./rng.test.js');
await import('./genome.test.js');
await import('./spatial.test.js');
await import('./brain.test.js');
await import('./world.test.js');
await import('./persistence.test.js');

const ok = await runAll();
process.exit(ok ? 0 : 1);
