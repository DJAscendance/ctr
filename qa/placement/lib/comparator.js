'use strict';

const { TOLERANCES } = require('./contract');

/**
 * Compares an X_ITE 15.1.12 placement baseline against a candidate capture
 * taken on a newer engine.
 *
 * A capture is `{ engine, commit, capturedAt, records: [ ... ] }` where each
 * record is keyed by `key` (`<table>:<id>`) and carries a `stored` block that
 * must match exactly plus an optional `rendered` block that may drift within
 * tolerance. Anything that cannot be matched one-to-one is a failure, never a
 * skip.
 */

const EXACT = 0;

function keyOf(record) {
  return `${record.source}:${record.id}`;
}

function missing(value) {
  return value === null || value === undefined;
}

/**
 * Returns the signed change, `0` when both sides are absent in the same way,
 * or `null` when only one side has a value — which is always a failure.
 */
function delta(a, b) {
  if (missing(a) && missing(b)) {
    return 0;
  }
  if (missing(a) || missing(b)) {
    return null;
  }
  return b - a;
}

function within(d, tolerance) {
  if (d === null) {
    return false;
  }
  return tolerance === EXACT ? d === 0 : Math.abs(d) <= tolerance;
}

/** Indexes a record list by key and reports duplicates rather than dropping them. */
function indexRecords(records) {
  const byKey = new Map();
  const duplicates = [];
  records.forEach(record => {
    const key = keyOf(record);
    if (byKey.has(key)) {
      duplicates.push(key);
      return;
    }
    byKey.set(key, record);
  });
  return { byKey, duplicates };
}

function compareVec3(base, cand, tolerance, prefix) {
  const failures = [];
  const deltas = {};
  ['x', 'y', 'z'].forEach(axis => {
    const d = delta(base && base[axis], cand && cand[axis]);
    deltas[axis] = d;
    if (!within(d, tolerance)) {
      failures.push(`${prefix}.${axis}: ${base && base[axis]} -> ${cand && cand[axis]}`);
    }
  });
  return { deltas, failures };
}

function compareRotation(base, cand, axisTolerance, angleTolerance, prefix) {
  const failures = [];
  const deltas = {};
  ['x', 'y', 'z', 'angle'].forEach(field => {
    const tolerance = field === 'angle' ? angleTolerance : axisTolerance;
    const d = delta(base && base[field], cand && cand[field]);
    deltas[field] = d;
    if (!within(d, tolerance)) {
      failures.push(`${prefix}.${field}: ${base && base[field]} -> ${cand && cand[field]}`);
    }
  });
  return { deltas, failures };
}

/** Compares one baseline record against its candidate counterpart. */
function compareRecord(base, cand, tolerances) {
  const failures = [];

  const storedPosition = compareVec3(
    base.stored.position, cand.stored.position, tolerances.storedPosition, 'stored.position');
  const storedRotation = compareRotation(
    base.stored.rotation, cand.stored.rotation,
    tolerances.storedRotation, tolerances.storedRotation, 'stored.rotation');
  failures.push(...storedPosition.failures, ...storedRotation.failures);

  ['placeId', 'objectId', 'memberId', 'url'].forEach(field => {
    if (base.stored[field] !== cand.stored[field]) {
      failures.push(`stored.${field}: ${base.stored[field]} -> ${cand.stored[field]}`);
    }
  });

  const result = {
    key: keyOf(base),
    source: base.source,
    id: base.id,
    placeId: base.stored.placeId,
    storedPositionDelta: storedPosition.deltas,
    storedRotationDelta: storedRotation.deltas,
    renderedPositionDelta: null,
    renderedRotationDelta: null,
    renderedScaleDelta: null,
    status: 'PASS',
    failures,
  };

  const baseRendered = base.rendered;
  const candRendered = cand.rendered;
  if (baseRendered && candRendered) {
    const pos = compareVec3(
      baseRendered.position, candRendered.position,
      tolerances.renderedPosition, 'rendered.position');
    const rot = compareRotation(
      baseRendered.rotation, candRendered.rotation,
      tolerances.renderedRotationAxis, tolerances.renderedRotationAngle, 'rendered.rotation');
    const scale = compareVec3(
      baseRendered.scale, candRendered.scale, tolerances.renderedScale, 'rendered.scale');
    result.renderedPositionDelta = pos.deltas;
    result.renderedRotationDelta = rot.deltas;
    result.renderedScaleDelta = scale.deltas;
    failures.push(...pos.failures, ...rot.failures, ...scale.failures);
  } else if (baseRendered && !candRendered) {
    result.status = 'FAIL';
    failures.push('rendered: present in baseline, missing from candidate');
  }

  if (failures.length > 0) {
    result.status = 'FAIL';
  }
  return result;
}

/**
 * Compares two captures.
 *
 * @returns {{ pass: boolean, summary: object, records: object[] }}
 */
function compareCaptures(baseline, candidate, overrides) {
  const tolerances = Object.assign({}, TOLERANCES, overrides || {});
  const base = indexRecords(baseline.records || []);
  const cand = indexRecords(candidate.records || []);
  const records = [];

  base.duplicates.forEach(key => {
    records.push({
      key, status: 'FAIL', failures: [`duplicate key in baseline capture: ${key}`],
    });
  });
  cand.duplicates.forEach(key => {
    records.push({
      key, status: 'FAIL', failures: [`duplicate key in candidate capture: ${key}`],
    });
  });

  base.byKey.forEach((baseRecord, key) => {
    const candRecord = cand.byKey.get(key);
    if (!candRecord) {
      records.push({
        key, status: 'FAIL', failures: ['missing from candidate capture'],
      });
      return;
    }
    records.push(compareRecord(baseRecord, candRecord, tolerances));
  });

  cand.byKey.forEach((candRecord, key) => {
    if (!base.byKey.has(key)) {
      records.push({
        key, status: 'FAIL', failures: ['unexpected object not present in baseline capture'],
      });
    }
  });

  const failed = records.filter(record => record.status === 'FAIL');
  return {
    pass: failed.length === 0,
    tolerances,
    summary: {
      baselineEngine: baseline.engine,
      candidateEngine: candidate.engine,
      baselineCount: (baseline.records || []).length,
      candidateCount: (candidate.records || []).length,
      compared: records.length,
      failed: failed.length,
    },
    records,
  };
}

module.exports = { compareCaptures, compareRecord, keyOf };
