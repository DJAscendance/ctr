/**
 * Runs every compiled test suite in a deterministic order, in its own Node
 * process (so one suite's `process.exit` can't cut another short), and exits
 * non-zero if ANY suite fails. Kept dependency-free - plain Node, no runner.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const SUITES = [
  "tests/.compiled/tests/presence.test.js",
  "tests/.compiled/tests/reconnect-coordinator.test.js",
  "tests/.compiled/tests/server-presence.test.js",
  "tests/.compiled/tests/information-render.test.js",
  "tests/.compiled/tests/chat-access.test.js",
  "tests/.compiled/tests/block-lot-map.test.js",
  "tests/.compiled/tests/chat-access-presentation.test.js",
  "tests/.compiled/tests/place-information-render.test.js",
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
