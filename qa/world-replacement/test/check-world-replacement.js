'use strict';

/*
 * CTR_WORLD_REPLACEMENT
 *
 * One property, no browser: a world change replaces the world exactly once.
 *
 * X_ITE 16.2.0 keeps a single active replaceWorld slot. Starting a second
 * replacement evicts the first and rejects it, synchronously, with
 * `Error: Replacing world aborted.` - an intentional cancellation signal, not a
 * load failure.
 *
 * loadAndJoinPlace() used to open that slot itself, calling
 * `browser.replaceWorld(null)` before the 3D branch. startX3D() then called
 * `browser.loadURL(...)`, which chains into X_ITE's own `replaceWorld(scene)`,
 * took the slot, and cancelled the first one. So every single 3D-to-3D world
 * change raised "Replacing world aborted." for a replacement that was never
 * needed: loadURL's replacement is what actually tears the old world down.
 *
 * The explicit call is still required where no world load follows it. Routing
 * out of 3D into a 2D place, and unloadPlace() on the way off the page, have
 * nothing to supersede them, so the old world is only released if they ask.
 *
 * Hence the two halves guarded here:
 *
 *   3D -> 3D    exactly one replacement, and it is loadURL's. No explicit
 *               replaceWorld() before it.
 *   3D -> 2D    exactly one replacement, and it is the explicit
 *               replaceWorld(null). No loadURL.
 *   unload      the same explicit replaceWorld(null).
 *
 * The last cases are negative controls: the deleted duplicate is run back
 * through the same assertions and must be rejected, and a fake X_ITE that
 * cancels like the real one shows the rejection the old shape produced.
 *
 * Usage:
 *   node qa/world-replacement/test/check-world-replacement.js
 */

const fs = require('fs');
const path = require('path');

const COMPONENT = path.join(
  __dirname, '..', '..', '..',
  'spa', 'src', 'pages', 'world-browser', 'WorldBrowserPage.vue');

const SOURCE = fs.readFileSync(COMPONENT, 'utf8');

const ABORT_MESSAGE = 'Replacing world aborted.';

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

/* The comments explain the cancellation, so they name the very calls the
 * source checks below forbid. Only executable text is searched. */
function code(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
}

function cut(openMarker, closeMarker) {
  const open = SOURCE.indexOf(openMarker);
  const close = SOURCE.indexOf(closeMarker);
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`${openMarker.trim()} not found in WorldBrowserPage.vue`);
  }
  /* Trailing whitespace, and any comment block that belongs to the method
   * after this one, are dropped before the separating comma, so what is left
   * is exactly one method. */
  let body = SOURCE.slice(open, close).trimEnd();
  let previous = null;
  while (previous !== body) {
    previous = body;
    body = body.replace(/\/\*(?:(?!\*\/)[^])*\*\/$/, '').trimEnd();
    body = body.replace(/\/\/[^\n]*$/, '').trimEnd();
  }
  return body.replace(/,$/, '');
}

const LOAD_OPEN = '    async loadAndJoinPlace(): Promise<void> {';
const UNLOAD_OPEN = '    async unloadPlace(): Promise<void> {';

const loadSource = cut(LOAD_OPEN, UNLOAD_OPEN);
const unloadSource = cut(UNLOAD_OPEN, '    async joinPlace(): Promise<void> {');
const startX3DSource = cut(
  '    async startX3D(): Promise<any> {', '    resetGravity(browser: any): void {');

const DEPENDENCIES = ['X3D', 'isOutlands', 'outlandsTeamOfAvatar', 'clearRemoteMembers'];

function compile(body, openMarker, header, name, scope) {
  const rewritten = body.replace(openMarker.trim(), header);
  const args = DEPENDENCIES.map((key) => scope[key]);
  /* eslint-disable no-new-func */
  return new Function(
    DEPENDENCIES.join(', '), `${rewritten}\nreturn ${name};`).apply(null, args);
  /* eslint-enable no-new-func */
}

/* The duplicate this pass removed, kept verbatim for the negative control:
 * the explicit replacement sits in front of both branches. */
const OLD_BRANCH = [
  '      if(this.browser) {',
  '        const browser = X3D.getBrowser(this.browser);',
  '        browser.replaceWorld(null);',
  '      }',
  '      if(this.$store.data.view3d && !this.force2d) {',
].join('\n');

const NEW_BRANCH = '      if(this.$store.data.view3d && !this.force2d) {';

/* Put the pre-branch replacement back. `dropTeardown` says whether the 2D one
 * goes with it: without it this is the exact shape this pass replaced, with it
 * kept this is the same regression written carelessly. Both must be rejected. */
function restoreDuplicate(source, dropTeardown) {
  const withDuplicate = source.replace(NEW_BRANCH, OLD_BRANCH);
  if (withDuplicate === source) {
    throw new Error('could not rebuild the old duplicate-replacement shape');
  }
  if (!dropTeardown) return withDuplicate;
  return withDuplicate.replace(
    /if\(this\.browser\) \{\s*X3D\.getBrowser\(this\.browser\)\.replaceWorld\(null\);\s*\}/,
    '');
}

/* ------------------------------------------------------------------ *
 * Stand-ins.
 *
 * The browser records every replacement and who asked for it, and - like
 * X_ITE 16.2.0 - keeps one slot: a new replacement rejects the pending one
 * with the real message. So a duplicate is not merely counted, it produces the
 * same rejection the runtime produces.
 * ------------------------------------------------------------------ */

function makeBrowser(recorder) {
  let pending = null;
  function replace(via) {
    recorder.replacements.push(via);
    if (pending) {
      pending.reject(new Error(ABORT_MESSAGE));
      recorder.aborted.push(pending.via);
      pending = null;
    }
    const slot = { via: via };
    const promise = new Promise((resolve, reject) => {
      slot.resolve = resolve;
      slot.reject = reject;
    });
    /* Nothing awaits these in the component, so an eviction is an unhandled
     * rejection in the page. Counted here instead of thrown. */
    promise.catch((error) => { recorder.rejections.push(error.message); });
    pending = slot;
    /* The replacement settles on the next turn, as the real one does. */
    Promise.resolve().then(() => {
      if (pending === slot) { slot.resolve(); pending = null; }
    });
    return promise;
  }
  return {
    replaceWorld: function () { return replace('replaceWorld'); },
    loadURL: function () { recorder.loadURL += 1; return replace('loadURL'); },
    installBlaxxunRouteShim: function () {},
    installBlaxxunEventDelivery: function () {},
    addBrowserCallback: function (key, callback) {
      recorder.callbacks += 1;
      /* Fire INITIALIZED_EVENT so the awaited startX3D() settles. */
      Promise.resolve().then(() => callback(1));
    },
    currentScene: { rootNodes: [] },
  };
}

function makeRecorder() {
  return {
    replacements: [],
    aborted: [],
    rejections: [],
    loadURL: 0,
    callbacks: 0,
    joined: 0,
    left: 0,
    cleared: 0,
  };
}

function makeScope(recorder) {
  const browser = makeBrowser(recorder);
  return {
    browser: browser,
    X3D: {
      getBrowser: function () { return browser; },
      createBrowser: function () { return { tagName: 'X3D-CANVAS' }; },
      MFString: function () { return {}; },
      X3DConstants: { INITIALIZED_EVENT: 1, CONNECTION_ERROR: 2, INITIALIZED_ERROR: 3 },
    },
    isOutlands: function () { return false; },
    outlandsTeamOfAvatar: function () { return null; },
    clearRemoteMembers: function () { recorder.cleared += 1; },
  };
}

function makeContext(recorder, scope, view3d, hasBrowser) {
  return {
    worldGeneration: 0,
    loaded: false,
    force2d: false,
    outlandsTeamNeeded: false,
    users: {},
    worldUrl: '/assets/worlds/plaza.wrl',
    browser: hasBrowser ? { tagName: 'X3D-CANVAS' } : null,
    mainComponent: null,
    position: [0, 1.75, 0],
    $route: { params: {} },
    $store: {
      data: {
        place: { id: 4211, slug: 'plaza', type: 'place', assets_dir: 'plaza' },
        user: { token: 'member-token', avatar: { id: 1, filename: 'a.wrl' } },
        view3d: view3d,
      },
      methods: { setView3d: function (value) { this.data = this.data; } },
    },
    $socket: {
      leaveRoom: function () { recorder.left += 1; },
      joinRoom: function () { recorder.joined += 1; return Promise.resolve(); },
      emit: function () {},
    },
    debugMsg: function () {},
    getPlace: function () { return Promise.resolve(); },
    restoreAvatarAfterOutlands: function () { return Promise.resolve(); },
    startX3DListeners: function () {},
    applyTemporaryOutlandsSpawn: function () {},
    applyAvatarIdentity: function () {},
    resetGravity: function () {},
    applyNavigationDefaults: function () {},
    joinPlace: function () { recorder.joined += 1; return Promise.resolve(); },
    startX3D: function () {
      const startX3D = compile(
        startX3DSource, '    async startX3D(): Promise<any> {',
        'async function startX3D() {', 'startX3D', scope);
      return startX3D.call(this);
    },
  };
}

/* Both the component and the mock have to be allowed to settle: the
 * replacement resolves a turn later, and an eviction rejects a turn later. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function runLoad(source, options) {
  const recorder = makeRecorder();
  const scope = makeScope(recorder);
  const loadAndJoinPlace = compile(
    source, LOAD_OPEN, 'async function loadAndJoinPlace() {',
    'loadAndJoinPlace', scope);
  const context = makeContext(
    recorder, scope, options.view3d, options.hasBrowser !== false);
  return loadAndJoinPlace.call(context)
    .then(settle)
    .then(function () { return recorder; });
}

function runUnload() {
  const recorder = makeRecorder();
  const scope = makeScope(recorder);
  const unloadPlace = compile(
    unloadSource, UNLOAD_OPEN, 'async function unloadPlace() {',
    'unloadPlace', scope);
  const context = makeContext(recorder, scope, true, true);
  return unloadPlace.call(context)
    .then(settle)
    .then(function () { return recorder; });
}

/* ------------------------------------------------------------------ *
 * The source contract.
 *
 * Every rule lives here, so the shipped method and each rebuilt regression are
 * judged by exactly the same ones.
 * ------------------------------------------------------------------ */

function sourceViolations(text) {
  const body = code(text);
  const count = (body.match(/replaceWorld\(/g) || []).length;
  const branch = body.indexOf('this.$store.data.view3d && !this.force2d');
  const first = body.indexOf('replaceWorld');
  const found = [];
  if (count === 0) found.push('never replaces the world');
  if (count > 1) found.push('replaces the world more than once');
  if (first !== -1 && branch !== -1 && first < branch) {
    found.push('replaces the world before the 3D/2D branch');
  }
  return found;
}

const loadCode = code(loadSource);
const unloadCode = code(unloadSource);
const startCode = code(startX3DSource);

check('loadAndJoinPlace is still in the component', loadSource.length > 0);
check('unloadPlace is still in the component', unloadSource.length > 0);

check('loadAndJoinPlace replaces the world exactly once in its own text',
  sourceViolations(loadSource).indexOf('replaces the world more than once') === -1,
  loadCode);
check('the one replacement in loadAndJoinPlace is null',
  /replaceWorld\(\s*null\s*\)/.test(loadCode), loadCode);
check('no replacement sits before the 3D/2D branch',
  sourceViolations(loadSource)
    .indexOf('replaces the world before the 3D/2D branch') === -1, loadCode);
check('the surviving replacement is inside the 2D branch',
  loadCode.indexOf('replaceWorld') <
  loadCode.indexOf('main2d.vue'), loadCode);
check('loadAndJoinPlace breaks none of the replacement rules',
  sourceViolations(loadSource).length === 0, sourceViolations(loadSource));
check('the 3D branch still starts X_ITE',
  loadCode.indexOf('await this.startX3D()') !== -1, loadCode);
check('startX3D still owns the 3D replacement, through loadURL',
  startCode.indexOf('browser.loadURL(') !== -1, startCode);
check('startX3D replaces no world itself',
  startCode.indexOf('replaceWorld') === -1, startCode);
check('unloadPlace still tears the world down',
  /replaceWorld\(\s*null\s*\)/.test(unloadCode), unloadCode);
check('nothing suppresses the cancellation message',
  SOURCE.indexOf(ABORT_MESSAGE) === -1
  || code(SOURCE).indexOf(ABORT_MESSAGE) === -1, 'message is only in comments');

/* ------------------------------------------------------------------ *
 * The paths, run.
 * ------------------------------------------------------------------ */

Promise.resolve()
  .then(function () { return runLoad(loadSource, { view3d: true }); })
  .then(function (recorder) {
    check('3D: the world is replaced exactly once',
      recorder.replacements.length === 1, recorder.replacements);
    check('3D: the one replacement is loadURL\'s',
      recorder.replacements[0] === 'loadURL', recorder.replacements);
    check('3D: loadURL is called once', recorder.loadURL === 1, recorder.loadURL);
    check('3D: no replacement is cancelled', recorder.aborted.length === 0,
      recorder.aborted);
    check(`3D: no "${ABORT_MESSAGE}" rejection`,
      recorder.rejections.length === 0, recorder.rejections);
    check('3D: the old members still go with the old world',
      recorder.cleared === 1, recorder.cleared);
    check('3D: the room is still joined', recorder.joined >= 1, recorder.joined);
  })
  .then(function () { return runLoad(loadSource, { view3d: false }); })
  .then(function (recorder) {
    check('2D: the world is replaced exactly once',
      recorder.replacements.length === 1, recorder.replacements);
    check('2D: the one replacement is the explicit teardown',
      recorder.replacements[0] === 'replaceWorld', recorder.replacements);
    check('2D: no world is loaded', recorder.loadURL === 0, recorder.loadURL);
    check('2D: the teardown is not cancelled', recorder.aborted.length === 0,
      recorder.aborted);
    check(`2D: no "${ABORT_MESSAGE}" rejection`,
      recorder.rejections.length === 0, recorder.rejections);
    check('2D: the room is still joined', recorder.joined >= 1, recorder.joined);
  })
  .then(function () {
    return runLoad(loadSource, { view3d: false, hasBrowser: false });
  })
  .then(function (recorder) {
    check('2D with no browser yet: nothing is replaced',
      recorder.replacements.length === 0, recorder.replacements);
  })
  .then(function () { return runUnload(); })
  .then(function (recorder) {
    check('unload: the world is replaced exactly once',
      recorder.replacements.length === 1, recorder.replacements);
    check('unload: the replacement is the explicit teardown',
      recorder.replacements[0] === 'replaceWorld', recorder.replacements);
    check('unload: the teardown is not cancelled', recorder.aborted.length === 0,
      recorder.aborted);
    check(`unload: no "${ABORT_MESSAGE}" rejection`,
      recorder.rejections.length === 0, recorder.rejections);
  })
  .then(function () {
    /* ---------------------------------------------------------------- *
     * Negative control: the duplicate, judged by the same rules.
     * ---------------------------------------------------------------- */
    const old = restoreDuplicate(loadSource, true);
    const both = restoreDuplicate(loadSource, false);
    check('negative control: the rules catch the old duplicate shape',
      sourceViolations(old)
        .indexOf('replaces the world before the 3D/2D branch') !== -1,
      sourceViolations(old));
    check('negative control: the rules catch a duplicate that also keeps the teardown',
      sourceViolations(both)
        .indexOf('replaces the world more than once') !== -1,
      sourceViolations(both));
    check('negative control: neither regression passes the rules',
      sourceViolations(old).length > 0 && sourceViolations(both).length > 0,
      { old: sourceViolations(old), both: sourceViolations(both) });
    return runLoad(old, { view3d: true });
  })
  .then(function (recorder) {
    check('negative control: the duplicate replaces the world twice',
      recorder.replacements.length === 2, recorder.replacements);
    check('negative control: loadURL evicts the explicit replacement',
      recorder.aborted.length === 1 && recorder.aborted[0] === 'replaceWorld',
      recorder.aborted);
    check(`negative control: the duplicate produces "${ABORT_MESSAGE}"`,
      recorder.rejections.length === 1
      && recorder.rejections[0] === ABORT_MESSAGE, recorder.rejections);
  })
  .then(function () {
    const failed = results.filter((result) => !result.pass);
    process.stdout.write(
      `\n${results.length - failed.length}/${results.length} PASS\n`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch(function (error) {
    process.stdout.write(`\nFAIL  ${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
  });
