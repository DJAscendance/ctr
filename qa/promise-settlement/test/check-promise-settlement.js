'use strict';

/*
 * CTR_PROMISE_SETTLEMENT
 *
 * One property, no browser: every startX3D() run settles exactly once.
 *
 * X_ITE 16.2.0 gives a page two ways to hear about a world load, and before
 * this pass startX3D() listened on only one of them.
 *
 *   browser callback   keyed by its first argument, which is the component, so
 *                      there is one slot. A second navigation replaces the
 *                      slot and the first run never hears INITIALIZED_EVENT
 *                      again.
 *   loadURL promise    private to the call. X3DBrowser keeps one current
 *                      FileLoader; a second loadURL installs its own, and when
 *                      the superseded file arrives its load rejects with
 *                      "Loading of X3D file aborted.".
 *
 * The returned loadURL promise was dropped, so a superseded run had no way out
 * at all: its startX3D() promise stayed pending for the life of the page, and
 * so did the loadAndJoinPlace() awaiting it. Rapid navigation stranded one
 * pair per hop.
 *
 * The fix gives the run both paths and one settle-once guard. A rejection may
 * be answered quietly only when it proves two things at once - X_ITE's own
 * supersession message, and a generation a later run has already claimed.
 * Everything else, including an abort on a run that is still current, is a
 * real failure and is re-raised.
 *
 * The fake browser below follows X3DBrowser.js: a second loadURL supersedes
 * the pending one; a good load calls INITIALIZED_EVENT and then resolves
 * loadURL; a bad load calls INITIALIZED_ERROR and then rejects it.
 *
 * The last block is the negative control: the shipped method is rewritten back
 * into the old dropped-promise shape and must strand the first run.
 *
 * Usage:
 *   node qa/promise-settlement/test/check-promise-settlement.js
 */

const fs = require('fs');
const path = require('path');

const COMPONENT = path.join(
  __dirname, '..', '..', '..',
  'spa', 'src', 'pages', 'world-browser', 'WorldBrowserPage.vue');

const SOURCE = fs.readFileSync(COMPONENT, 'utf8');

const ABORT_MESSAGE = 'Loading of X3D file aborted.';
const FAILED_MESSAGE = "Couldn't load X3D file.";

const results = [];
function check(name, pass, detail) {
  results.push({ name: name, pass: !!pass, detail: detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass && detail !== undefined) {
    process.stdout.write(`  (${JSON.stringify(detail)})`);
  }
  process.stdout.write('\n');
}

/* ------------------------------------------------------------------ *
 * Lift the real methods.
 *
 * The component is a .vue file with TypeScript annotations, so it cannot be
 * required. Each method is cut out by its own boundaries and only its header
 * is rewritten - nothing inside a body is touched, so what runs below is the
 * shipped code.
 * ------------------------------------------------------------------ */

function cut(openMarker, closeMarker) {
  const open = SOURCE.indexOf(openMarker);
  const close = SOURCE.indexOf(closeMarker);
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`${openMarker.trim()} not found in WorldBrowserPage.vue`);
  }
  let body = SOURCE.slice(open, close).trimEnd();
  let previous = null;
  while (previous !== body) {
    previous = body;
    body = body.replace(/\/\*(?:(?!\*\/)[^])*\*\/$/, '').trimEnd();
    body = body.replace(/\/\/[^\n]*$/, '').trimEnd();
  }
  return body.replace(/,$/, '');
}

/* The comments name the very calls the source checks forbid, so only
 * executable text is searched. */
function code(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
}

const START_OPEN = '    async startX3D(generation: number): Promise<any> {';
const START_CLOSE = '    resetGravity(browser: any): void {';
const SUPERSEDED_OPEN = '    supersededWorldLoad(error: any): boolean {';
const SUPERSEDED_CLOSE = '    recordUnexpectedLoadAbort(generation: number): void {';
const RECORD_CLOSE = START_OPEN;

const startSource = cut(START_OPEN, START_CLOSE);
const supersededSource = cut(SUPERSEDED_OPEN, SUPERSEDED_CLOSE);
const recordSource = cut(SUPERSEDED_CLOSE, RECORD_CLOSE);

function compile(body, openMarker, header, name, X3D) {
  const rewritten = body.replace(openMarker.trim(), header);
  /* eslint-disable no-new-func */
  return new Function('X3D', `${rewritten}\nreturn ${name};`)(X3D);
  /* eslint-enable no-new-func */
}

/* ------------------------------------------------------------------ *
 * A fake X_ITE that supersedes the way the real one does.
 * ------------------------------------------------------------------ */

const INITIALIZED_EVENT = 1;
const CONNECTION_ERROR = 2;
const INITIALIZED_ERROR = 3;

function makeBrowser(recorder) {
  /* X3DBrowser keeps exactly one current FileLoader; the callbacks are one
   * Map keyed by the first argument. Both are modelled, nothing else is. */
  let currentLoad = null;
  const callbacks = new Map();

  return {
    loadURL: function () {
      recorder.loadURL += 1;
      const slot = { superseded: false, settled: null };
      slot.promise = new Promise((resolve, reject) => {
        slot.resolve = resolve;
        slot.reject = reject;
      });
      slot.promise
        .then(function () { slot.settled = 'resolved'; })
        .catch(function () { slot.settled = 'rejected'; });
      if (currentLoad) currentLoad.superseded = true;
      currentLoad = slot;
      recorder.loads.push(slot);
      return slot.promise;
    },
    /* The world file arrives. `outcome` is what the file turned out to be. */
    deliver: function (slot, outcome) {
      if (slot.superseded) {
        slot.reject(new Error(ABORT_MESSAGE));
        return;
      }
      const callback = callbacks.get(recorder.componentKey);
      if (outcome === 'fail') {
        if (callback) callback(INITIALIZED_ERROR);
        slot.reject(new Error(FAILED_MESSAGE));
        return;
      }
      if (callback) callback(INITIALIZED_EVENT);
      slot.resolve();
    },
    addBrowserCallback: function (key, callback) {
      recorder.componentKey = key;
      recorder.callbackCalls += 1;
      callbacks.set(key, callback);
      recorder.callbackCount = callbacks.size;
    },
    removeBrowserCallback: function () { recorder.removals += 1; },
    installBlaxxunRouteShim: function () {},
    installBlaxxunEventDelivery: function () {},
    currentScene: { rootNodes: [] },
  };
}

function makeRecorder() {
  return {
    loadURL: 0,
    loads: [],
    callbackCalls: 0,
    callbackCount: 0,
    removals: 0,
    componentKey: null,
    unexpectedAborts: [],
  };
}

function makeX3D(browser) {
  return {
    getBrowser: function () { return browser; },
    createBrowser: function () { return { tagName: 'X3D-CANVAS' }; },
    MFString: function () { return {}; },
    X3DConstants: {
      INITIALIZED_EVENT: INITIALIZED_EVENT,
      CONNECTION_ERROR: CONNECTION_ERROR,
      INITIALIZED_ERROR: INITIALIZED_ERROR,
    },
  };
}

/* One page. `startX3D` is the shipped method, bound to this object. */
function makePage(recorder, startSourceText) {
  const browser = makeBrowser(recorder);
  const X3D = makeX3D(browser);
  const startX3D = compile(
    startSourceText, START_OPEN, 'async function startX3D(generation) {', 'startX3D', X3D);
  const supersededWorldLoad = compile(
    supersededSource, SUPERSEDED_OPEN,
    'function supersededWorldLoad(error) {', 'supersededWorldLoad', X3D);

  const page = {
    browser: { tagName: 'X3D-CANVAS' },
    worldGeneration: 0,
    worldUrl: '/assets/worlds/plaza/plaza.wrl',
    fake: browser,
    applyAvatarIdentity: function () {},
    resetGravity: function () {},
    applyNavigationDefaults: function () {},
    supersededWorldLoad: supersededWorldLoad,
    recordUnexpectedLoadAbort: function (generation) {
      recorder.unexpectedAborts.push(generation);
    },
    startX3D: startX3D,
  };

  /* Start one run the way loadAndJoinPlace() does: claim a generation, then
   * hand it to startX3D(). The returned tracker is the promise state. */
  page.run = function () {
    const generation = ++page.worldGeneration;
    const load = recorder.loads.length;
    const tracker = { generation: generation, state: 'pending', value: undefined };
    tracker.promise = page.startX3D(generation).then(
      function (value) { tracker.state = 'resolved'; tracker.value = value; },
      function (error) { tracker.state = 'rejected'; tracker.value = error; });
    tracker.load = recorder.loads[load];
    return tracker;
  };
  return page;
}

/* Both the page and the fake have to be allowed to settle. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/* ------------------------------------------------------------------ *
 * The old shape, rebuilt from the shipped one for the negative control:
 * the loadURL promise is dropped and each path settles unguarded.
 * ------------------------------------------------------------------ */

function dropTheLoadPromise(text) {
  const withoutOwnership = text
    .replace(
      'const load = browser.loadURL(new X3D.MFString(this.worldUrl), new X3D.MFString());',
      'browser.loadURL(new X3D.MFString(this.worldUrl), new X3D.MFString());')
    .replace(/\n *load\.then\([\s\S]*?\n *\);\n/, '\n');
  if (withoutOwnership === text || withoutOwnership.indexOf('load.then') !== -1) {
    throw new Error('could not rebuild the old dropped-promise shape');
  }
  return withoutOwnership;
}

const oldStartSource = dropTheLoadPromise(startSource);

/* ------------------------------------------------------------------ *
 * Source rules.
 * ------------------------------------------------------------------ */

const startCode = code(startSource);
const recordCode = code(recordSource);

check('startX3D is still in the component', startSource.indexOf('loadURL') !== -1);
check('startX3D owns the loadURL promise',
  /const\s+load\s*=\s*browser\.loadURL\(/.test(startCode), startCode);
check('startX3D handles that promise',
  /load\.then\(/.test(startCode), startCode);
check('startX3D keys its callback on the component, not a fresh object',
  startCode.indexOf('addBrowserCallback(this,') !== -1
  && !/addBrowserCallback\(\s*\{\s*\}/.test(startCode), startCode);
check('startX3D removes no callback from the shared slot',
  startCode.indexOf('removeBrowserCallback') === -1, startCode);
check('startX3D swallows nothing globally',
  !/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(startCode)
  && !/catch\(\s*Function\s*\.prototype/.test(startCode), startCode);
check('a quiet cancellation needs an obsolete generation',
  /supersededWorldLoad\(error\)\s*&&\s*generation\s*!==\s*this\.worldGeneration/
    .test(startCode), startCode);
check('only X_ITE\'s own supersession message counts as a cancellation',
  code(supersededSource).indexOf('Loading of X3D file aborted.') !== -1);
check('an abort on the current generation is recorded',
  recordCode.indexOf('ctrUnexpectedWorldLoadAbort') !== -1, recordCode);
check('the success path is still X_ITE\'s initialization event',
  startCode.indexOf('X3D.X3DConstants.INITIALIZED_EVENT') !== -1
  && /INITIALIZED_EVENT:[\s\S]*?settleOnce\(resolve, browser\)/.test(startCode), startCode);
check('loadAndJoinPlace hands its generation to startX3D',
  SOURCE.indexOf('await this.startX3D(generation)') !== -1);

/* ------------------------------------------------------------------ *
 * Behaviour.
 * ------------------------------------------------------------------ */

function normalLoad() {
  const recorder = makeRecorder();
  const page = makePage(recorder, startSource);
  const run = page.run();
  return settle()
    .then(function () {
      page.fake.deliver(run.load, 'ok');
      return settle();
    })
    .then(function () {
      check('normal load: the run resolves', run.state === 'resolved', run.state);
      check('normal load: it resolves with the browser', run.value === page.fake, run.value);
      check('normal load: one loadURL', recorder.loadURL === 1, recorder.loadURL);
      check('normal load: one callback slot', recorder.callbackCount === 1, recorder.callbackCount);
      check('normal load: the loadURL promise is settled',
        run.load.settled === 'resolved', run.load.settled);
    });
}

function realFailure() {
  const recorder = makeRecorder();
  const page = makePage(recorder, startSource);
  const run = page.run();
  return settle()
    .then(function () {
      page.fake.deliver(run.load, 'fail');
      return settle();
    })
    .then(function () {
      check('real failure: the run rejects', run.state === 'rejected', run.state);
      check('real failure: it is not turned into a cancellation',
        run.state === 'rejected' && run.value !== null, run.value);
      check('real failure: nothing is recorded as an unexpected abort',
        recorder.unexpectedAborts.length === 0, recorder.unexpectedAborts);
      check('real failure: one callback slot', recorder.callbackCount === 1, recorder.callbackCount);
    });
}

/* The proven sequence: run 1 loads world A, run 2 loads world B before A
 * arrives, A arrives superseded. */
function rapidNavigation(startSourceText, label) {
  const recorder = makeRecorder();
  const page = makePage(recorder, startSourceText);
  const first = page.run();
  return settle()
    .then(function () {
      const second = page.run();
      return settle().then(function () {
        /* World A arrives after it has been superseded, then world B. */
        page.fake.deliver(first.load, 'ok');
        page.fake.deliver(second.load, 'ok');
        return settle().then(function () {
          return { recorder: recorder, page: page, first: first, second: second, label: label };
        });
      });
    });
}

function rapidCurrent() {
  return rapidNavigation(startSource, 'rapid').then(function (r) {
    check('rapid: the superseded run settles',
      r.first.state !== 'pending', r.first.state);
    check('rapid: the superseded run settles quietly, not as a failure',
      r.first.state === 'resolved' && r.first.value === null, r.first);
    check('rapid: the current run still resolves with the browser',
      r.second.state === 'resolved' && r.second.value === r.page.fake, r.second.state);
    check('rapid: no pending startX3D promise is left',
      r.first.state !== 'pending' && r.second.state !== 'pending');
    check('rapid: both loadURL promises are settled',
      r.first.load.settled === 'rejected' && r.second.load.settled === 'resolved',
      [r.first.load.settled, r.second.load.settled]);
    check('rapid: the expected abort was the superseded run\'s',
      r.first.load.superseded === true && r.second.load.superseded === false);
    check('rapid: the callback slot did not grow',
      r.recorder.callbackCount === 1, r.recorder.callbackCount);
    check('rapid: two callback registrations, one slot',
      r.recorder.callbackCalls === 2 && r.recorder.callbackCount === 1,
      [r.recorder.callbackCalls, r.recorder.callbackCount]);
    check('rapid: the superseded run removed no callback',
      r.recorder.removals === 0, r.recorder.removals);
    check('rapid: no abort was recorded as unexpected',
      r.recorder.unexpectedAborts.length === 0, r.recorder.unexpectedAborts);
  });
}

/* An abort delivered while this run is still the current one. Nothing inside
 * loadAndJoinPlace() can cause that, so it must not be answered quietly. */
function abortWhileCurrent() {
  const recorder = makeRecorder();
  const page = makePage(recorder, startSource);
  const run = page.run();
  return settle()
    .then(function () {
      run.load.superseded = true;
      page.fake.deliver(run.load, 'ok');
      return settle();
    })
    .then(function () {
      check('current-generation abort: the run rejects', run.state === 'rejected', run.state);
      check('current-generation abort: it is recorded as unexpected',
        recorder.unexpectedAborts.length === 1
        && recorder.unexpectedAborts[0] === run.generation, recorder.unexpectedAborts);
    });
}

/* Three hops, the shape the 150 ms live run drives. */
function threeHops() {
  const recorder = makeRecorder();
  const page = makePage(recorder, startSource);
  const a = page.run();
  return settle()
    .then(function () {
      const b = page.run();
      return settle().then(function () {
        const c = page.run();
        return settle().then(function () {
          page.fake.deliver(a.load, 'ok');
          page.fake.deliver(b.load, 'ok');
          page.fake.deliver(c.load, 'ok');
          return settle().then(function () {
            const pending = [a, b, c].filter(function (run) { return run.state === 'pending'; });
            check('three hops: no startX3D promise is left pending',
              pending.length === 0, pending.map(function (run) { return run.generation; }));
            check('three hops: the last run resolves with the browser',
              c.state === 'resolved' && c.value === page.fake, c.state);
            check('three hops: the two superseded runs end quietly',
              a.state === 'resolved' && a.value === null
              && b.state === 'resolved' && b.value === null, [a.value, b.value]);
            check('three hops: one callback slot after three loads',
              recorder.callbackCount === 1 && recorder.callbackCalls === 3,
              [recorder.callbackCount, recorder.callbackCalls]);
            check('three hops: every loadURL promise is settled',
              [a, b, c].every(function (run) { return run.load.settled !== null; }),
              [a.load.settled, b.load.settled, c.load.settled]);
          });
        });
      });
    });
}

/* Negative control: the shipped method rewritten back into the old shape. */
function negativeControl() {
  return rapidNavigation(oldStartSource, 'old').then(function (r) {
    check('negative control: the old shape strands the superseded run',
      r.first.state === 'pending', r.first.state);
    check('negative control: the old shape still resolves the current run',
      r.second.state === 'resolved', r.second.state);
    check('negative control: the old shape leaves the abort unanswered',
      r.first.load.settled === 'rejected' && r.first.state === 'pending');
  });
}

function oldShapeNormalLoad() {
  const recorder = makeRecorder();
  const page = makePage(recorder, oldStartSource);
  const run = page.run();
  return settle()
    .then(function () {
      page.fake.deliver(run.load, 'ok');
      return settle();
    })
    .then(function () {
      check('negative control: the old shape was fine on a single load',
        run.state === 'resolved', run.state);
    });
}

normalLoad()
  .then(realFailure)
  .then(rapidCurrent)
  .then(abortWhileCurrent)
  .then(threeHops)
  .then(negativeControl)
  .then(oldShapeNormalLoad)
  .then(function () {
    const passed = results.filter(function (r) { return r.pass; }).length;
    process.stdout.write(`\n${passed}/${results.length} PASS\n`);
    process.exit(passed === results.length ? 0 : 1);
  })
  .catch(function (error) {
    process.stdout.write(`\nFAIL  ${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
  });
