'use strict';

/*
 * CTR_REMOTE_MEMBER_WORLD_TRANSITION
 *
 * One property, no browser: the remote-member registry does not survive a
 * world change, and a member re-announced in the new world gets a new node.
 *
 * WorldBrowserPage.users held one entry per remote member and was never
 * cleared when the place changed. onAvatarAdded skips any member that is
 * already `loading` or `loaded`, so a surviving world-A entry silently
 * swallowed world B's AV:new for that member: no node was built, and the
 * member kept pointing at a node belonging to a scene that had been replaced.
 *
 * clearRemoteMembers() is the fix. This test drives it with the shapes the
 * live rooms produce - a fully loaded member, a member still loading, a
 * move-only entry with no node yet, and a member whose node throws on the way
 * out - then runs the real onAvatarAdded guard over the result, so a
 * regression shows up as a blocked member, not just a wrong count.
 *
 * Usage:
 *   node qa/members/test/check-remote-member-world-change.js
 */

const {
  clearRemoteMembers,
  disposeRemoteMember,
} = require('../../../spa/src/libs/remote-members');

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
 * Stand-ins for the X_ITE side.
 * ------------------------------------------------------------------ */

let nodeSerial = 0;

/* An avatar node as onAvatarAdded stores it: the `import` half. */
function fakeAvatarNode(scene) {
  nodeSerial += 1;
  return {
    id: `N${nodeSerial}`,
    scene: scene,
    disposed: false,
    dispose: function () { this.disposed = true; },
  };
}

/* The `inline` half - what gets added to, and removed from, the scene. */
function fakeInline(scene) {
  nodeSerial += 1;
  const inline = { id: `I${nodeSerial}`, scene: scene };
  scene.rootNodes.push(inline);
  return inline;
}

function fakeScene(name) {
  return {
    name: name,
    rootNodes: [],
    removeRootNode: function (node) {
      const at = this.rootNodes.indexOf(node);
      if (at === -1) throw new Error(`not a root node of ${this.name}`);
      this.rootNodes.splice(at, 1);
    },
  };
}

function fakeBrowser(scene) {
  return {
    currentScene: scene,
    registered: new Map(),
    registerBlaxxunAvatar: function (inline, username) {
      this.registered.set(inline, username);
    },
    unregisterBlaxxunAvatar: function (inline) {
      this.registered.delete(inline);
    },
  };
}

/*
 * The member-add guard exactly as onAvatarAdded runs it. Returns the node it
 * built, or null when the guard refused - which is the defect under test.
 */
function runOnAvatarAdded(users, browser, event) {
  if (!users[event.id]) {
    users[event.id] = {};
  }
  if (!users[event.id].loading && !users[event.id].loaded) {
    users[event.id].loading = true;
    /* The real load is async; its resolution is what this stands in for. */
    const inline = fakeInline(browser.currentScene);
    const node = fakeAvatarNode(browser.currentScene);
    users[event.id].loading = false;
    users[event.id].loaded = true;
    users[event.id].inline = inline;
    users[event.id].import = node;
    browser.registerBlaxxunAvatar(inline, event.username);
    return node;
  }
  return null;
}

/* The move handler, for the entry shape it can leave behind on its own. */
function runOnAvatarMoved(users, event) {
  if (!users[event.id]) users[event.id] = {};
  if (!users[event.id].transform) users[event.id].transform = {};
  if (event.pos) users[event.id].transform.pos = event.pos;
  return users[event.id];
}

/* ------------------------------------------------------------------ *
 * 1. The proven defect: a loaded world-A member blocks world B.
 * ------------------------------------------------------------------ */

const plaza = fakeScene('plaza');
const plazaBrowser = fakeBrowser(plaza);
const users = {};

const nodeA = runOnAvatarAdded(users, plazaBrowser, { id: 42, username: 'qa2' });

check('world A: member is in the registry', !!users[42], Object.keys(users));
check('world A: member is loaded', users[42].loaded === true, users[42].loaded);
check('world A: member has a scene A node', !!nodeA && nodeA.scene === plaza,
  nodeA && nodeA.scene && nodeA.scene.name);
check('world A: node is a root node of scene A',
  plaza.rootNodes.indexOf(users[42].inline) !== -1, plaza.rootNodes.length);

/* Without the cleanup, this is what world B saw. Proves the guard is real. */
const club = fakeScene('club');
const clubBrowser = fakeBrowser(club);
const blocked = runOnAvatarAdded(users, clubBrowser,
  { id: 42, username: 'qa2' });
check('stale entry would block a new node (defect is real)', blocked === null,
  blocked && blocked.id);

/* ------------------------------------------------------------------ *
 * 2. The cleanup at the world-transition boundary.
 * ------------------------------------------------------------------ */

const staleInline = users[42].inline;
const summary = clearRemoteMembers(users, plazaBrowser);

check('cleanup reports the member it cleared', summary.cleared === 1, summary);
check('cleanup reports no failures', summary.failed === 0, summary);
check('registry is empty after the world change',
  Object.keys(users).length === 0, Object.keys(users));
check('old member is gone from the registry', users[42] === undefined,
  users[42]);
check('old node is disposed', nodeA.disposed === true, nodeA.disposed);
check('old inline is detached from scene A',
  plaza.rootNodes.indexOf(staleInline) === -1, plaza.rootNodes.length);
check('old avatar is unregistered from the browser',
  plazaBrowser.registered.has(staleInline) === false,
  plazaBrowser.registered.size);

/* ------------------------------------------------------------------ *
 * 3. World B builds a fresh node for the same member.
 * ------------------------------------------------------------------ */

const nodeB = runOnAvatarAdded(users, clubBrowser, { id: 42, username: 'qa2' });

check('world B: AV:new creates a member entry', !!users[42], Object.keys(users));
check('world B: member is loaded', users[42].loaded === true, users[42].loaded);
check('world B: a new node was built', !!nodeB, nodeB);
check('world B: node identity differs from world A',
  !!nodeB && nodeB.id !== nodeA.id, { a: nodeA.id, b: nodeB && nodeB.id });
check('world B: node belongs to the current scene',
  !!nodeB && nodeB.scene === club, nodeB && nodeB.scene && nodeB.scene.name);
check('world B: exactly one entry for the member',
  Object.keys(users).length === 1, Object.keys(users));
check('world B: exactly one root node for the member',
  club.rootNodes.length === 1, club.rootNodes.length);
check('no scene A node is left in scene B',
  club.rootNodes.every((node) => node.scene === club), club.rootNodes.length);
check('scene A holds no member nodes', plaza.rootNodes.length === 0,
  plaza.rootNodes.length);

/* ------------------------------------------------------------------ *
 * 4. The other entry shapes a live room produces.
 * ------------------------------------------------------------------ */

/* A member still loading when the world changed: no nodes on the entry yet. */
const loadingUsers = { 7: { loading: true } };
const loadingSummary = clearRemoteMembers(loadingUsers, plazaBrowser);
check('a still-loading member is cleared too',
  Object.keys(loadingUsers).length === 0 && loadingSummary.cleared === 1,
  loadingSummary);

/* A move-only entry: AV arrived before AV:new, so there is a transform and no
 * node. It must not survive either, or its stale position seeds world B. */
const moveUsers = {};
runOnAvatarMoved(moveUsers, { id: 9, pos: [1, 2, 3] });
check('a move-only entry has no node', moveUsers[9].inline === undefined,
  moveUsers[9]);
clearRemoteMembers(moveUsers, plazaBrowser);
check('a move-only entry is cleared', Object.keys(moveUsers).length === 0,
  Object.keys(moveUsers));

/* ------------------------------------------------------------------ *
 * 5. The cleanup always runs to the end.
 * ------------------------------------------------------------------ */

/* A node whose scene is already gone throws on the way out. The rest of the
 * room must still be cleared, or world A members stay and block world B. */
const angry = fakeScene('angry');
const angryBrowser = fakeBrowser(angry);
const mixed = {};
runOnAvatarAdded(mixed, angryBrowser, { id: 1, username: 'one' });
runOnAvatarAdded(mixed, angryBrowser, { id: 2, username: 'two' });
const third = runOnAvatarAdded(mixed, angryBrowser, { id: 3, username: 'three' });
mixed[2].import.dispose = function () { throw new Error('scene is gone'); };

const mixedSummary = clearRemoteMembers(mixed, angryBrowser);
check('a throwing member does not stop the clear',
  Object.keys(mixed).length === 0, Object.keys(mixed));
check('every member is counted as cleared', mixedSummary.cleared === 3,
  mixedSummary);
check('the throwing member is reported', mixedSummary.failed === 1,
  mixedSummary);
check('members after the throwing one are still disposed',
  third.disposed === true, third.disposed);

/* A missing browser - the first place load, and every 2D place. */
const noBrowser = { 5: { loaded: true, import: fakeAvatarNode(null) } };
let threw = false;
try {
  clearRemoteMembers(noBrowser, null);
} catch (error) {
  threw = true;
}
check('cleanup survives a missing browser', !threw && Object.keys(noBrowser).length === 0,
  { threw: threw, left: Object.keys(noBrowser) });

/* An empty registry - every first load, and every place with nobody in it. */
const empty = {};
check('an empty registry clears to nothing',
  clearRemoteMembers(empty, plazaBrowser).cleared === 0, empty);
check('a missing registry is tolerated',
  clearRemoteMembers(null, plazaBrowser).cleared === 0, 'null');

/* ------------------------------------------------------------------ *
 * 6. Same-world lifecycle is untouched.
 * ------------------------------------------------------------------ */

/* Inside one world, a member who leaves and comes back is handled by
 * onAvatarRemoved / onAvatarAdded, not by this cleanup. Its per-member half
 * has to behave the same way, or the transition fix breaks normal removal. */
const room = fakeScene('room');
const roomBrowser = fakeBrowser(room);
const roomUsers = {};
const first = runOnAvatarAdded(roomUsers, roomBrowser, { id: 8, username: 'b' });

/* B leaves: the single-member path, as onAvatarRemoved runs it. */
disposeRemoteMember(roomUsers[8], roomBrowser);
delete roomUsers[8];
check('same-world leave removes exactly that member',
  Object.keys(roomUsers).length === 0 && room.rootNodes.length === 0,
  room.rootNodes.length);
check('same-world leave disposes that member node', first.disposed === true,
  first.disposed);

/* B rejoins: exactly one entry, exactly one node, and it is a new one. */
const second = runOnAvatarAdded(roomUsers, roomBrowser, { id: 8, username: 'b' });
check('same-world rejoin creates exactly one entry',
  Object.keys(roomUsers).length === 1, Object.keys(roomUsers));
check('same-world rejoin creates exactly one node', room.rootNodes.length === 1,
  room.rootNodes.length);
check('same-world rejoin node is a new node', second.id !== first.id,
  { first: first.id, second: second.id });

/* An ordinary move in the same world must not clear anything. */
runOnAvatarMoved(roomUsers, { id: 8, pos: [4, 0, 4] });
check('an ordinary move keeps the member loaded',
  roomUsers[8] && roomUsers[8].loaded === true && room.rootNodes.length === 1,
  roomUsers[8]);

/* A second AV:new for a member already in this world is still a no-op. */
const again = runOnAvatarAdded(roomUsers, roomBrowser, { id: 8, username: 'b' });
check('a same-world duplicate AV:new builds nothing new',
  again === null && room.rootNodes.length === 1, room.rootNodes.length);

/* ------------------------------------------------------------------ */

const failed = results.filter((result) => !result.pass);
process.stdout.write(
  `\n${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
