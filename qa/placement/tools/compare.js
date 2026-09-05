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

/** Loads a capture, merging `stored-*.json` and `rendered-*.json` if given a dir. */
function loadCapture(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  }
  const files = fs.readdirSync(target).filter(f => f.endsWith('.json'));
  const stored = files.find(f => f.startsWith('stored-'));
  const rendered = files.find(f => f.startsWith('rendered-'));
  if (!stored) {
    throw new Error(`no stored-*.json capture in ${target}`);
  }
  const storedCapture = JSON.parse(fs.readFileSync(path.join(target, stored), 'utf8'));
  const merged = new Map();
  storedCapture.records.forEach(record => {
    merged.set(`${record.source}:${record.id}`, Object.assign({}, record));
  });
  if (rendered) {
    const renderedCapture = JSON.parse(fs.readFileSync(path.join(target, rendered), 'utf8'));
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

const baseline = loadCapture(baselineArg);
const candidate = loadCapture(candidateArg);

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
console.log(result.pass ? 'PASS' : 'FAIL');

if (reportArg) {
  fs.writeFileSync(reportArg, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`report written to ${reportArg}`);
}

process.exit(result.pass ? 0 : 1);
