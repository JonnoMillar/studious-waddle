// Zero-dependency test harness. Uses only Node's built-in assert. Run all
// suites with `node tests/run.js`. Kept tiny on purpose: the point of the
// project is the simulation, and the tests should add zero install burden.

import assert from 'node:assert/strict';

const suites = [];
let current = null;

export function suite(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function test(name, fn) {
  current.tests.push({ name, fn });
}

export { assert };

export async function runAll() {
  let passed = 0, failed = 0;
  const failures = [];
  for (const s of suites) {
    process.stdout.write(`\n\x1b[1m${s.name}\x1b[0m\n`);
    for (const t of s.tests) {
      try {
        await t.fn();
        passed++;
        process.stdout.write(`  \x1b[32m✓\x1b[0m ${t.name}\n`);
      } catch (err) {
        failed++;
        failures.push({ suite: s.name, test: t.name, err });
        process.stdout.write(`  \x1b[31m✗\x1b[0m ${t.name}\n`);
      }
    }
  }
  process.stdout.write(`\n${'─'.repeat(48)}\n`);
  if (failed === 0) {
    process.stdout.write(`\x1b[32m\x1b[1mAll ${passed} tests passed.\x1b[0m\n`);
  } else {
    process.stdout.write(`\x1b[31m\x1b[1m${failed} failed\x1b[0m, ${passed} passed.\n`);
    for (const f of failures) {
      process.stdout.write(`\n\x1b[31m✗ ${f.suite} › ${f.test}\x1b[0m\n`);
      process.stdout.write(`  ${f.err.stack || f.err.message}\n`);
    }
  }
  return failed === 0;
}
