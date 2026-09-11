'use strict';

/**
 * Verifies the world-return and reload checks inside a rendered capture, and
 * reconciles the capture against the placement rows it was supposed to observe.
 *
 * The same object must come back to the same transform after leaving and
 * re-entering a place, and after a full page reload. A missing object in any
 * phase is a failure, not a skip.
 *
 * A capture also carries one record per expected placement row, including rows
 * that never rendered. Those are counted and reported by classification here
 * rather than dropped, because a short record list is indistinguishable from a
 * clean run once the rows are gone.
 *
 * `CTR_QA_ACCEPT_PARSE_BLOCK=1` accepts WORLD_PARSE_BLOCK rows as a known,
 * separately-tracked source defect. Nothing else is ever accepted, and even
 * accepted rows are still printed with their ids.
 *
 * Usage: node tools/check-lifecycle.js [rendered-capture.json]
 */

const fs = require('fs');
const path = require('path');
const { TOLERANCES } = require('../lib/contract');

const FILE = process.argv[2]
  || path.join(__dirname, '..', 'baselines', 'rendered-15.1.12.json');
const ACCEPT_PARSE_BLOCK = process.env.CTR_QA_ACCEPT_PARSE_BLOCK === '1';
const capture = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const failures = [];
const counts = { return: 0, reload: 0 };
const byObservation = new Map();

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
  // Captures taken before the observation field existed carry a rendered block
  // for every record they hold, which is the same thing said a shorter way.
  const observation = record.observation || (record.rendered ? 'RENDERED' : 'NOT_RENDERED');
  if (!byObservation.has(observation)) {
    byObservation.set(observation, []);
  }
  byObservation.get(observation).push(`${record.source}:${record.id}`);

  if (observation !== 'RENDERED') {
    if (!(observation === 'WORLD_PARSE_BLOCK' && ACCEPT_PARSE_BLOCK)) {
      failures.push(`${record.source}:${record.id} ${observation} (never observed)`);
    }
    return;
  }
  check(record, 'return', record.renderedOnReturn);
  check(record, 'reload', record.renderedOnReload);
});

const rendered = (byObservation.get('RENDERED') || []).length;

console.log(`engine ${capture.engine}, ${capture.records.length} placement rows`);
(capture.coverage || []).forEach(group => {
  console.log(`  ${group.placeKey.padEnd(7)} expected=${group.expected} ` +
    `world=${group.worldLoaded ? 'loaded' : 'BLOCKED'} initial=${group.initial} ` +
    `return=${group.return} reload=${group.reload}`);
});
byObservation.forEach((ids, observation) => {
  console.log(`${observation}: ${ids.length}`);
  if (observation !== 'RENDERED') {
    console.log(`  ${ids.join(' ')}`);
  }
});
console.log(`initial rendered:         ${rendered}`);
console.log(`world-return re-observed: ${counts.return}`);
console.log(`reload re-observed:       ${counts.reload}`);
failures.forEach(failure => console.log(`FAIL ${failure}`));
console.log(failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);
