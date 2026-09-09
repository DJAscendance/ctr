'use strict';

/**
 * Verifies the world-return and reload checks inside a rendered capture.
 *
 * The same object must come back to the same transform after leaving and
 * re-entering a place, and after a full page reload. A missing object in
 * either phase is a failure, not a skip.
 *
 * Usage: node tools/check-lifecycle.js [rendered-capture.json]
 */

const fs = require('fs');
const path = require('path');
const { TOLERANCES } = require('../lib/contract');

const FILE = process.argv[2]
  || path.join(__dirname, '..', 'baselines', 'rendered-15.1.12.json');
const capture = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const failures = [];
const counts = { return: 0, reload: 0 };

function check(record, phase, other) {
  if (!other) {
    failures.push(`${record.source}:${record.id} missing after ${phase}`);
    return;
  }
  counts[phase] += 1;
  ['x', 'y', 'z'].forEach(axis => {
    const drift = Math.abs(other.position[axis] - record.rendered.position[axis]);
    if (drift > TOLERANCES.renderedPosition) {
      failures.push(`${record.source}:${record.id} ${phase} position.${axis} drift ${drift}`);
    }
  });
  ['x', 'y', 'z', 'angle'].forEach(field => {
    const tolerance = field === 'angle'
      ? TOLERANCES.renderedRotationAngle : TOLERANCES.renderedRotationAxis;
    const drift = Math.abs(other.rotation[field] - record.rendered.rotation[field]);
    if (drift > tolerance) {
      failures.push(`${record.source}:${record.id} ${phase} rotation.${field} drift ${drift}`);
    }
  });
}

capture.records.forEach(record => {
  check(record, 'return', record.renderedOnReturn);
  check(record, 'reload', record.renderedOnReload);
});

console.log(`engine ${capture.engine}, ${capture.records.length} objects`);
console.log(`world-return re-observed: ${counts.return}`);
console.log(`reload re-observed:       ${counts.reload}`);
failures.forEach(failure => console.log(`FAIL ${failure}`));
console.log(failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);
