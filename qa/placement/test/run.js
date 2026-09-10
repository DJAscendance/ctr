'use strict';

/**
 * Minimal test runner.
 *
 * The placement toolkit is deliberately standalone CommonJS so it can run on
 * the pinned Node 14 with no install step; the api workspace jest config only
 * picks up `*.spec.ts` under `api/` and boots a DB-backed setup file, so it is
 * not a fit for these pure-logic assertions.
 */

const tests = [
  ...require('./comparator.test'),
  ...require('./cli.test'),
  ...require('./rendered-identity.test'),
  ...require('./lifecycle.test'),
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
