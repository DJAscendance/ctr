'use strict';

/*
 * The pass rule for the repeated-world memory run.
 *
 * A surviving renderer is not a pass. The old defect killed the tab at around
 * fifty loads, so a sixty-load run that merely finishes can look identical to
 * a run that is still leaking and would have died at ninety. What separates
 * them is the shape of retained memory over the run, not its endpoint.
 *
 * So the memory gate is a slope, measured on forced-GC checkpoints only. An
 * un-collected heap reading swings with ordinary allocation and would let any
 * threshold be met or missed by timing alone. After GC, what remains is what
 * the application is holding, and holding a constant amount is the property
 * being tested.
 *
 * The slope is fitted from the first checkpoint after warm-up, not from load 1.
 * Load 1 is measured before caches, textures and EXTERNPROTOs have settled, so
 * including it charges one-time startup cost to the per-transition rate and
 * makes a clean run look like a leaking one.
 */

/* Warm-up is over once the engine has loaded a few worlds and filled its caches. */
const WARMUP_TRANSITIONS = 10;

/*
 * Retained-heap growth per transition that counts as flat.
 *
 * The historical signal was tens of megabytes per transition. Real runs still
 * drift by a few hundred kilobytes across a hundred loads from caches that are
 * bounded but not empty, so the bar is set well under the defect and well over
 * that drift.
 */
const MAX_SLOPE_BYTES = 1.5 * 1024 * 1024;

/* Least-squares slope of y over x. Returns null when there is nothing to fit. */
function slope(points) {
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const point of points) {
    num += (point.x - meanX) * (point.y - meanY);
    den += (point.x - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

/*
 * Counts that must not grow are checked as first-versus-last after warm-up
 * rather than as a maximum, because a count that rises once and stays put is a
 * different fault from one that rises with every transition, and only the
 * second is unbounded. Both fail here; the report says which was seen.
 */
function growth(rows, field) {
  const values = rows
    .filter(row => row.transition > WARMUP_TRANSITIONS && typeof row[field] === 'number')
    .map(row => ({ x: row.transition, y: row[field] }));
  if (!values.length) return { available: false };
  const first = values[0].y;
  const last = values[values.length - 1].y;
  const max = Math.max(...values.map(v => v.y));
  return {
    available: true,
    first,
    last,
    max,
    delta: last - first,
    perTransition: slope(values),
  };
}

function evaluateGates({ rows, requested, completed, rendererDied, notes = [] }) {
  const failures = [];
  const checkpoints = rows.filter(row => row.checkpoint && typeof row.retainedHeap === 'number');

  if (rendererDied) failures.push(`renderer did not survive the run: ${rendererDied}`);
  if (completed < 60) {
    failures.push(`only ${completed} of ${requested} transitions completed; 60 is the minimum`);
  }

  /* A world that comes back with no root nodes is a blank world, not a fast one. */
  const blank = rows.filter(row => !(row.rootNodes > 0));
  if (blank.length) {
    failures.push(`${blank.length} transition(s) produced an empty world` +
      ` (first at #${blank[0].transition} ${blank[0].route})`);
  }

  /* The UI expects exactly one canvas in #world; a second one is a stranded scene. */
  const badCanvas = rows.filter(row => row.worldCanvasCount !== 1);
  if (badCanvas.length) {
    failures.push(`${badCanvas.length} transition(s) did not have exactly one #world canvas` +
      ` (first at #${badCanvas[0].transition}, count ${badCanvas[0].worldCanvasCount})`);
  }

  const listeners = growth(rows, 'listenerTotal');
  if (!listeners.available) {
    failures.push('socket listener counts were unavailable; the run proves nothing about them');
  } else if (listeners.delta > 0) {
    failures.push(`socket listeners grew from ${listeners.first} to ${listeners.last}` +
      ` after warm-up (${(listeners.perTransition || 0).toFixed(3)} per transition)`);
  }

  const canvases = growth(rows, 'canvasCount');
  if (canvases.available && canvases.delta > 0) {
    failures.push(`canvas count grew from ${canvases.first} to ${canvases.last} after warm-up`);
  }

  const callbacks = growth(rows, 'browserCallbacks');
  if (callbacks.available && callbacks.delta > 0) {
    failures.push(`X_ITE browser callbacks grew from ${callbacks.first} to ${callbacks.last}`);
  }

  /*
   * Shared-object counts must track the place being entered, so they are
   * expected to move up and down across the run. What may not happen is the
   * count for a repeated route drifting upward, which would mean old-world
   * nodes are being counted alongside the new ones.
   */
  const perRoute = new Map();
  for (const row of rows) {
    if (typeof row.sharedObjectsMapSize !== 'number') continue;
    if (!perRoute.has(row.route)) perRoute.set(row.route, []);
    perRoute.get(row.route).push({ x: row.transition, y: row.sharedObjectsMapSize });
  }
  const drifting = [];
  for (const [route, points] of perRoute) {
    const late = points.filter(p => p.x > WARMUP_TRANSITIONS);
    if (late.length < 2) continue;
    if (late[late.length - 1].y > late[0].y) {
      drifting.push(`${route} ${late[0].y} -> ${late[late.length - 1].y}`);
    }
  }
  if (drifting.length) {
    failures.push(`shared-object counts drifted upward for a repeated route: ${drifting.join('; ')}`);
  }

  /* Retained memory: the slope gate. */
  const heapPoints = checkpoints
    .filter(row => row.transition >= WARMUP_TRANSITIONS)
    .map(row => ({ x: row.transition, y: row.retainedHeap }));
  const heapSlope = slope(heapPoints);
  if (heapSlope === null) {
    failures.push('not enough forced-GC checkpoints after warm-up to measure a slope');
  } else if (heapSlope > MAX_SLOPE_BYTES) {
    failures.push(`retained heap grew ${(heapSlope / 1048576).toFixed(2)} MB per transition,` +
      ` over the ${(MAX_SLOPE_BYTES / 1048576).toFixed(2)} MB bar`);
  }

  return {
    verdict: failures.length ? 'FAIL' : 'PASS',
    requested,
    completed,
    rendererDied: rendererDied || null,
    warmupTransitions: WARMUP_TRANSITIONS,
    retainedHeapSlopeBytes: heapSlope,
    maxSlopeBytes: MAX_SLOPE_BYTES,
    listeners,
    canvases,
    callbacks,
    checkpoints: checkpoints.map(row => ({
      transition: row.transition,
      route: row.route,
      retainedHeap: row.retainedHeap,
      totalHeap: row.totalHeap,
      heapUsed: row.heapUsed,
      listenerTotal: row.listenerTotal,
      canvasCount: row.canvasCount,
      rootNodes: row.rootNodes,
    })),
    failures,
    notes,
  };
}

function formatReport(result) {
  const mb = value => (typeof value === 'number' ? `${(value / 1048576).toFixed(1)} MB` : 'n/a');
  const lines = [
    '',
    `VERDICT: ${result.verdict}`,
    `transitions: ${result.completed}/${result.requested}`,
    `retained heap slope: ${result.retainedHeapSlopeBytes === null ? 'n/a'
      : `${(result.retainedHeapSlopeBytes / 1024).toFixed(1)} KB per transition`}`,
    '',
    'checkpoint  route                  retained    listeners  canvas  roots',
  ];
  for (const point of result.checkpoints) {
    lines.push(
      `${String(point.transition).padStart(9)}  ${String(point.route).padEnd(21)}` +
      `${mb(point.retainedHeap).padStart(9)}  ${String(point.listenerTotal).padStart(9)}` +
      `  ${String(point.canvasCount).padStart(6)}  ${String(point.rootNodes).padStart(5)}`);
  }
  if (result.notes.length) {
    lines.push('', 'notes:');
    for (const note of result.notes) lines.push(`  - ${note}`);
  }
  if (result.failures.length) {
    lines.push('', 'failures:');
    for (const failure of result.failures) lines.push(`  - ${failure}`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = { evaluateGates, formatReport, slope, growth, WARMUP_TRANSITIONS, MAX_SLOPE_BYTES };
