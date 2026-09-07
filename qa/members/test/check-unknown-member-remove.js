'use strict';

/*
 * CTR_UNKNOWN_REMOTE_MEMBER_REMOVE
 *
 * One property, no browser: an AV:del for a member who is not in the registry
 * is harmless, and an AV:del for a member who is still performs the full
 * cleanup.
 *
 * onAvatarRemoved read `this.users[id].inline` without first asking whether
 * `this.users[id]` existed, so an AV:del for an unknown id threw
 * "Cannot read properties of undefined (reading 'inline')". That is ordinary
 * traffic, not an edge case: an AV:del can be delivered twice, and a world
 * change now clears the whole registry, so any AV:del still in flight for the
 * old room lands after its entry is gone.
 *
 * The throw does not stop at the one handler. socket.io hands an event to its
 * listeners in a plain loop, so a listener that throws stops every later
 * listener registered for that same event. The unknown id therefore cost more
 * than one member's cleanup.
 *
 * The handler is lifted out of WorldBrowserPage.vue and run as written, so
 * this gate fails if the guard is ever removed from the component itself.
 *
 * Usage:
 *   node qa/members/test/check-unknown-member-remove.js
 */

const fs = require('fs');
const path = require('path');

const COMPONENT = path.join(
  __dirname, '..', '..', '..',
  'spa', 'src', 'pages', 'world-browser', 'WorldBrowserPage.vue');

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
 * Lift the real handler.
 *
 * The component is a .vue file with TypeScript annotations, so it cannot be
 * required. The method is cut out by its own boundaries and the one return
 * annotation is dropped - nothing inside the body is rewritten, so what runs
 * below is the shipped code.
 * ------------------------------------------------------------------ */

function loadOnAvatarRemoved(X3D) {
  const source = fs.readFileSync(COMPONENT, 'utf8');
  const open = source.indexOf('    onAvatarRemoved(event): void {');
  const close = source.indexOf('    onSharedEvent(event): void {');
  if (open === -1 || close === -1 || close < open) {
    throw new Error('onAvatarRemoved not found in WorldBrowserPage.vue');
  }
  const body = source.slice(open, close)
    .trimEnd()
    .replace(/,$/, '')
    .replace('onAvatarRemoved(event): void {', 'function onAvatarRemoved(event) {');
  return new Function('X3D', `${body}\nreturn onAvatarRemoved;`)(X3D);
}

/* ------------------------------------------------------------------ *
 * Stand-ins for the X_ITE side. Every call the handler can make is counted,
 * so "did nothing" is checked, not assumed.
 * ------------------------------------------------------------------ */

function makeBrowser() {
  const calls = { unregister: 0, removeRootNode: 0 };
  return {
    calls: calls,
    unregisterBlaxxunAvatar: function () { calls.unregister += 1; },
    currentScene: {
      removeRootNode: function () { calls.removeRootNode += 1; },
    },
  };
}

function makeMember() {
  const disposed = { count: 0 };
  return {
    entry: {
      loaded: true,
      inline: { node: 'inline' },
      'import': { dispose: function () { disposed.count += 1; } },
    },
    disposed: disposed,
  };
}

let browser = makeBrowser();
const onAvatarRemoved = loadOnAvatarRemoved({ getBrowser: function () { return browser; } });

function removeOn(users, id) {
  const context = { users: users, browser: 'world' };
  try {
    onAvatarRemoved.call(context, { id: id });
    return null;
  } catch (error) {
    return error;
  }
}

/* ------------------------------------------------------------------ *
 * Unknown id: the reported defect.
 * ------------------------------------------------------------------ */

browser = makeBrowser();
const empty = {};
const unknownError = removeOn(empty, 'missing-id');
check('unknown id does not throw', unknownError === null,
  unknownError && unknownError.message);
check('unknown id leaves users unchanged', Object.keys(empty).length === 0,
  Object.keys(empty));
check('unknown id calls no removeRootNode', browser.calls.removeRootNode === 0,
  browser.calls.removeRootNode);
check('unknown id calls no unregisterBlaxxunAvatar', browser.calls.unregister === 0,
  browser.calls.unregister);

/* An unknown id must not disturb the members who are present. */
browser = makeBrowser();
const bystander = makeMember();
const populated = { 7: bystander.entry };
const bystanderError = removeOn(populated, 'missing-id');
check('unknown id does not throw beside a live member', bystanderError === null,
  bystanderError && bystanderError.message);
check('unknown id keeps the live member', populated[7] === bystander.entry,
  Object.keys(populated));
check('unknown id disposes nothing', bystander.disposed.count === 0
  && browser.calls.removeRootNode === 0, bystander.disposed.count);

/* Numeric and string ids are the same member to socket.io. */
browser = makeBrowser();
const numeric = makeMember();
const numericUsers = { 7: numeric.entry };
check('a known numeric id is not mistaken for unknown',
  removeOn(numericUsers, 7) === null && numericUsers[7] === undefined,
  Object.keys(numericUsers));

/* ------------------------------------------------------------------ *
 * Known id: the cleanup that must not weaken.
 * ------------------------------------------------------------------ */

browser = makeBrowser();
const known = makeMember();
const knownUsers = { 42: known.entry };
const knownError = removeOn(knownUsers, 42);
check('known id does not throw', knownError === null,
  knownError && knownError.message);
check('known id unregisters the blaxxun avatar', browser.calls.unregister === 1,
  browser.calls.unregister);
check('known id removes the root inline', browser.calls.removeRootNode === 1,
  browser.calls.removeRootNode);
check('known id disposes the import node', known.disposed.count === 1,
  known.disposed.count);
check('known id deletes the users entry', knownUsers[42] === undefined,
  Object.keys(knownUsers));

/* A member who never finished loading has no nodes but still must be dropped. */
browser = makeBrowser();
const loading = { loading: true };
const loadingUsers = { 43: loading };
const loadingError = removeOn(loadingUsers, 43);
check('a still-loading member is removed without nodes',
  loadingError === null && loadingUsers[43] === undefined
  && browser.calls.removeRootNode === 0, loadingError && loadingError.message);

/* A move-only entry has a transform but no inline and no import. */
browser = makeBrowser();
const moveOnly = { transform: { pos: [0, 0, 0] } };
const moveOnlyUsers = { 44: moveOnly };
const moveOnlyError = removeOn(moveOnlyUsers, 44);
check('a move-only entry is removed without nodes',
  moveOnlyError === null && moveOnlyUsers[44] === undefined
  && browser.calls.removeRootNode === 0, moveOnlyError && moveOnlyError.message);

/* ------------------------------------------------------------------ *
 * Repeated delete: duplicate or late AV:del delivery.
 * ------------------------------------------------------------------ */

browser = makeBrowser();
const twice = makeMember();
const twiceUsers = { 9: twice.entry };
const firstDelete = removeOn(twiceUsers, 9);
check('first delete cleans normally',
  firstDelete === null && twiceUsers[9] === undefined
  && browser.calls.removeRootNode === 1 && twice.disposed.count === 1,
  firstDelete && firstDelete.message);

const secondDelete = removeOn(twiceUsers, 9);
check('second delete does not throw', secondDelete === null,
  secondDelete && secondDelete.message);
check('second delete removes nothing again', browser.calls.removeRootNode === 1,
  browser.calls.removeRootNode);
check('second delete disposes nothing again', twice.disposed.count === 1,
  twice.disposed.count);
check('third delete is still harmless', removeOn(twiceUsers, 9) === null);

/* ------------------------------------------------------------------ *
 * The listener chain.
 *
 * This is why the guard matters beyond the one member. socket.io-client
 * dispatches through @socket.io/component-emitter, which walks its listener
 * array in a plain loop with no try/catch, so the first throw ends the walk.
 * ------------------------------------------------------------------ */

let Emitter = null;
try {
  Emitter = require(path.join(
    __dirname, '..', '..', '..',
    'spa', 'node_modules', '@socket.io', 'component-emitter')).Emitter;
} catch (error) {
  Emitter = null;
}

if (Emitter) {
  const emitter = new Emitter();
  const ran = [];
  const chainUsers = {};
  emitter.on('AV:del', function (event) {
    ran.push('onAvatarRemoved');
    onAvatarRemoved.call({ users: chainUsers, browser: 'world' }, event);
  });
  emitter.on('AV:del', function () { ran.push('laterListener'); });

  let emitError = null;
  try {
    emitter.emit('AV:del', { id: 'missing-id' });
  } catch (error) {
    emitError = error;
  }
  check('an unknown AV:del does not break the emit', emitError === null,
    emitError && emitError.message);
  check('a later AV:del listener still runs', ran.indexOf('laterListener') !== -1,
    ran);
} else {
  check('socket.io component-emitter is available for the chain check', false,
    'spa/node_modules/@socket.io/component-emitter not installed');
}

/* ------------------------------------------------------------------ *
 * The guard is in the component, not only in this file's copy.
 * ------------------------------------------------------------------ */

const componentSource = fs.readFileSync(COMPONENT, 'utf8');
const handler = componentSource.slice(
  componentSource.indexOf('    onAvatarRemoved(event): void {'),
  componentSource.indexOf('    onSharedEvent(event): void {'));
check('the component guards the id before reading it',
  /if\s*\(!this\.users\[id\]\)\s*\{\s*return;/.test(handler));
check('the component still deletes the entry',
  handler.indexOf('delete this.users[id];') !== -1);

/* ------------------------------------------------------------------ */

const failed = results.filter(function (result) { return !result.pass; });
process.stdout.write(
  `\n${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
