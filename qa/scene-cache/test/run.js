'use strict';

/**
 * Minimal async test runner, matching qa/placement/test/run.js.
 *
 * These assertions are pure logic against a fake FileLoader, so they run on the
 * pinned Node 14 with no install step and no browser.
 */

const tests = require('./scene-cache.test');

async function main() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL  ${name}`);
      console.log(`      ${error.message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
