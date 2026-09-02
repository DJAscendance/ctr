/**
 * Runs every compiled test suite in a deterministic order, in its own Node
 * process (so one suite's `process.exit` can't cut another short), and exits
 * non-zero if ANY suite fails. Kept dependency-free - plain Node, no runner.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const SUITES = [
  "tests/.compiled/tests/map-background-selector.test.js",
  "tests/.compiled/tests/hood-map-background-selector.test.js",
  "tests/.compiled/tests/bxx-ray.test.js",
  "tests/.compiled/tests/bxx-keyboard.test.js",
  "tests/.compiled/tests/bxx-hud.test.js",
  "tests/.compiled/tests/bxx-script.test.js",
  "tests/.compiled/tests/bxx-node.test.js",
  "tests/.compiled/tests/shared-event-codec.test.js",
  "tests/.compiled/tests/legacy-url-policy.test.js",
];

let failed = false;
for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [path.resolve(suite)], { stdio: "inherit" });
  if (result.status !== 0 || result.error) {
    failed = true;
    if (result.error) console.error(`    could not run ${suite}: ${result.error.message}`);
  }
}

process.exit(failed ? 1 : 0);
