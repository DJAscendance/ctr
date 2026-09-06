'use strict';

/*
 * Minimal test runner, matching qa/placement/test/run.js. Standalone CommonJS
 * so it runs on the pinned Node 14 with no install step.
 */

const tests = [
  ...require('./rules.test'),
];

let failed = 0;
tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${error.message}`);
  }
});

console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 0 : 1);
