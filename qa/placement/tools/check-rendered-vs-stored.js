'use strict';

/**
 * Proves the rendered transform is the stored transform, on one runtime.
 *
 * This is the check that answers the engine question directly, without needing
 * the database the control baseline was keyed to. `shared_xite.wrl` wires
 * `translation IS translation` and `rotation IS rotation` into `DEF T1
 * Transform` and exposes no scale field, so for every placement row the live
 * scene-graph values must be the two stored columns and the scale must be
 * identity. Anything else is the engine moving an object.
 *
 * Rows the capture could not observe are reported by their classification and
 * are never counted as agreement.
 *
 * Usage: node tools/check-rendered-vs-stored.js <capture-dir> [report.json]
 */

const fs = require('fs');
const path = require('path');
const { TOLERANCES, IMPLIED_SCALE } = require('../lib/contract');

const DIR = process.argv[2];
const REPORT = process.argv[3];
if (!DIR) {
  console.error('usage: node tools/check-rendered-vs-stored.js <capture-dir> [report.json]');
  process.exit(2);
}

function load(prefix) {
  const file = fs.readdirSync(DIR).find(name => name.startsWith(prefix) && name.endsWith('.json'));
  if (!file) {
    throw new Error(`no ${prefix}*.json capture in ${DIR}`);
  }
  return JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
}

const stored = load('stored-');
const rendered = load('rendered-');

const storedByKey = new Map();
stored.records.forEach(record => storedByKey.set(`${record.source}:${record.id}`, record));

const failures = [];
const drift = { position: 0, rotation: 0, scale: 0 };
const observed = { RENDERED: 0 };
let worst = { field: null, delta: 0, key: null };

function compare(key, field, expected, actual, tolerance, bucket) {
  const delta = Math.abs(actual - expected);
  if (delta > worst.delta) {
    worst = { field, delta, key };
  }
  if (delta > tolerance) {
    drift[bucket] += 1;
    failures.push(`${key} ${field}: stored ${expected} -> rendered ${actual} (delta ${delta})`);
  }
}

rendered.records.forEach(record => {
  const key = `${record.source}:${record.id}`;
  const observation = record.observation || (record.rendered ? 'RENDERED' : 'NOT_RENDERED');
  observed[observation] = (observed[observation] || 0) + 1;
  if (observation !== 'RENDERED') {
    return;
  }
  const base = storedByKey.get(key);
  if (!base) {
    failures.push(`${key} rendered but has no stored row`);
    return;
  }
  ['x', 'y', 'z'].forEach(axis => compare(
    key, `position.${axis}`, base.stored.position[axis], record.rendered.position[axis],
    TOLERANCES.renderedPosition, 'position'));
  ['x', 'y', 'z', 'angle'].forEach(field => compare(
    key, `rotation.${field}`, base.stored.rotation[field], record.rendered.rotation[field],
    field === 'angle' ? TOLERANCES.renderedRotationAngle : TOLERANCES.renderedRotationAxis,
    'rotation'));
  ['x', 'y', 'z'].forEach(axis => compare(
    key, `scale.${axis}`, IMPLIED_SCALE[axis], record.rendered.scale[axis],
    TOLERANCES.renderedScale, 'scale'));
});

const summary = {
  engine: rendered.engine,
  storedRecords: stored.records.length,
  renderedRecords: rendered.records.length,
  observed,
  translationMismatches: drift.position,
  rotationMismatches: drift.rotation,
  scaleMismatches: drift.scale,
  largestDelta: worst,
};

console.log(`engine ${rendered.engine}`);
console.log(`stored rows        ${summary.storedRecords}`);
console.log(`rendered rows      ${summary.renderedRecords}`);
Object.keys(observed).forEach(kind => console.log(`  ${kind}: ${observed[kind]}`));
console.log(`translation mismatches ${drift.position}`);
console.log(`rotation mismatches    ${drift.rotation}`);
console.log(`scale mismatches       ${drift.scale}`);
console.log(`largest delta          ${worst.delta} (${worst.field || 'n/a'} on ${worst.key || 'n/a'})`);
failures.forEach(failure => console.log(`FAIL ${failure}`));
console.log(failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`);

if (REPORT) {
  fs.writeFileSync(REPORT, `${JSON.stringify({ summary, failures }, null, 2)}\n`);
}
process.exit(failures.length === 0 ? 0 : 1);
