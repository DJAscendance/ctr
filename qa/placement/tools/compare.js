'use strict';

/**
 * Compares a placement baseline against a candidate capture.
 *
 * Both stored and rendered layers are merged by `<source>:<id>` before the
 * comparison so a single run can prove the database was untouched and the
 * engine still puts objects in the same place.
 *
 * Usage:
 *   node tools/compare.js <baseline-dir-or-file> <candidate-dir-or-file> [report.json]
 *
 * Exits 1 on any FAIL so it can gate a later X_ITE upgrade.
 */

const fs = require('fs');
const path = require('path');
const { compareCaptures } = require('../lib/comparator');

/** Raised when a capture file lists the same CTR object twice. */
class DuplicateObjectKeyError extends Error {}

/**
 * Reads a capture file and refuses it if any `<source>:<id>` appears twice.
 *
 * The duplicate check has to happen here, on the raw record list, because
 * everything downstream merges into a `Map` — and a `Map` silently keeps one of
 * the two rows. Neither "first wins" nor "last wins" is safe: whichever copy is
 * dropped could be the one carrying the drift we are looking for.
 */
function readRecords(file, label) {
  const capture = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Set();
  (capture.records || []).forEach(record => {
    const key = `${record.source}:${record.id}`;
    if (seen.has(key)) {
      throw new DuplicateObjectKeyError(
        `DUPLICATE_OBJECT_KEY ${key} in ${label} capture ${file}`);
    }
    seen.add(key);
  });
  return capture;
}

/** Loads a capture, merging `stored-*.json` and `rendered-*.json` if given a dir. */
function loadCapture(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    return readRecords(target, 'single-file');
  }
  const files = fs.readdirSync(target).filter(f => f.endsWith('.json'));
  const stored = files.find(f => f.startsWith('stored-'));
  const rendered = files.find(f => f.startsWith('rendered-'));
  if (!stored) {
    throw new Error(`no stored-*.json capture in ${target}`);
  }
  const storedCapture = readRecords(path.join(target, stored), 'stored');
  const merged = new Map();
  storedCapture.records.forEach(record => {
    merged.set(`${record.source}:${record.id}`, Object.assign({}, record));
  });
  if (rendered) {
    const renderedCapture = readRecords(path.join(target, rendered), 'rendered');
    renderedCapture.records.forEach(record => {
      const key = `${record.source}:${record.id}`;
      const existing = merged.get(key);
      if (!existing) {
        // A rendered object with no stored row is still reported, never dropped.
        merged.set(key, Object.assign({}, record, { stored: {} }));
        return;
      }
      existing.rendered = record.rendered;
      existing.renderedOnReturn = record.renderedOnReturn;
      existing.renderedOnReload = record.renderedOnReload;
      existing.placeKey = record.placeKey;
    });
  }
  return {
    engine: storedCapture.engine,
    commit: storedCapture.commit,
    capturedAt: storedCapture.capturedAt,
    records: Array.from(merged.values()),
  };
}

const [baselineArg, candidateArg, reportArg] = process.argv.slice(2);
if (!baselineArg || !candidateArg) {
  console.error('usage: node tools/compare.js <baseline> <candidate> [report.json]');
  process.exit(2);
}

let baseline;
let candidate;
try {
  baseline = loadCapture(baselineArg);
  candidate = loadCapture(candidateArg);
} catch (error) {
  if (error instanceof DuplicateObjectKeyError) {
    console.error(error.message);
    console.error('REFUSING: a capture lists the same object twice; no record may be dropped');
    process.exit(3);
  }
  throw error;
}

if (!baseline.engine || !candidate.engine) {
  console.error('REFUSING: a capture is missing its engine version');
  process.exit(2);
}

const result = compareCaptures(baseline, candidate);

result.records
  .filter(record => record.status === 'FAIL')
  .forEach(record => {
    console.log(`FAIL ${record.key}`);
    (record.failures || []).forEach(failure => console.log(`     ${failure}`));
  });

console.log(`\n${baseline.engine} -> ${candidate.engine}`);
console.log(`compared ${result.summary.compared}, failed ${result.summary.failed}`);
console.log(`stored raw mismatches      ${result.summary.storedRawMismatches}`);
console.log(`stored numeric mismatches  ${result.summary.storedNumericMismatches}`);
console.log(`rendered mismatches        ${result.summary.renderedMismatches}`);
console.log(result.pass ? 'PASS' : 'FAIL');

if (reportArg) {
  fs.writeFileSync(reportArg, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`report written to ${reportArg}`);
}

process.exit(result.pass ? 0 : 1);
