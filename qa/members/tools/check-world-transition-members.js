'use strict';

/*
 * CTR_REMOTE_MEMBER_WORLD_TRANSITION - the live half.
 *
 * WorldBrowserPage keeps one `users` entry per remote member, holding that
 * member's X_ITE nodes. The component outlives the world, so before the fix
 * the registry survived a place change: entries built in the Plaza came into
 * the Club still marked `loaded`, still pointing at Plaza's nodes. onAvatarAdded
 * skips a member that is already loaded, so the Club's AV:new for that member
 * built nothing and the member was never seen again.
 *
 * The failure is not symmetric. The client that leaves first never receives
 * the other's later AV:del - it has already left the room that would have
 * carried it - so the leave order decides which client is left holding the
 * stale entry. Both orders are run.
 *
 * Each scenario proves the same contract across one world change:
 *
 *   - both citizens see one another in the old world, and see one another move;
 *   - both reach the new world and join its room;
 *   - the member node in the new world is a NEW object, not the old one;
 *   - that node belongs to the scene that is current now;
 *   - no entry is left pointing at the previous scene;
 *   - exactly one entry and one avatar per remote member;
 *   - movement is observed both ways in the new world.
 *
 * Node identity is object identity: every avatar node is tagged the first time
 * it is seen, together with the scene that was current then. A node that comes
 * through the transition keeps its tag, which is exactly the defect.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/members/tools/check-world-transition-members.js \
 *     [scenario] [outDir]
 *
 *   scenario is one of: plaza-club-a, plaza-club-b, plaza-mall, mall-plaza,
 *   club-plaza, same-world, or all (the default).
 */

const fs = require('fs');
const path = require('path');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const RED = { user: process.env.CTR_QA_USER || 'testqa', pass: process.env.CTR_QA_PASS || 'testqa' };
const BLUE = { user: process.env.CTR_QA_USER2 || 'outlandsqa2', pass: process.env.CTR_QA_PASS2 || 'outlandsqa2' };

const WANTED = process.argv[2] || 'all';
const OUT_DIR = process.argv[3]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'members-transition');

const PLAZA = { name: 'Plaza', hash: '#/place/enter' };
const MALL = { name: 'Mall', hash: '#/place/mall' };
/* 837 is the seeded "QAFIX Club" fixture; a club reaches WorldBrowserPage by a
 * different route than a public place, which is why it is in here twice. */
const CLUB = { name: 'Club', hash: '#/club/837' };

const SCENARIOS = [
  { key: 'plaza-club-a', label: 'Plaza -> Club, A first', from: PLAZA, to: CLUB, first: 'A' },
  { key: 'plaza-club-b', label: 'Plaza -> Club, B first', from: PLAZA, to: CLUB, first: 'B' },
  { key: 'plaza-mall', label: 'Plaza -> Mall', from: PLAZA, to: MALL, first: 'A' },
  { key: 'mall-plaza', label: 'Mall -> Plaza', from: MALL, to: PLAZA, first: 'A' },
  { key: 'club-plaza', label: 'Club -> Plaza', from: CLUB, to: PLAZA, first: 'A' },
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

async function login(browser, spec, tag) {
  const page = await browser.newPage();
  page.on('pageerror', e => process.stdout.write(`      [${tag}] page error: ${e.message.slice(0, 160)}\n`));
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', spec.user);
  await page.fill('input[type="password"]', spec.pass);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  return page;
}

/* Go to a world and wait for it to actually be there - a scene with roots, and
 * a bound viewpoint, because a scene that has not bound one reports everybody
 * at the world origin and that reads as a bug it is not. */
async function enter(page, hash, settle) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => {
      const canvas = document.querySelector('#world x3d-canvas');
      if (!canvas || !window.X3D) return { ok: false };
      const b = X3D.getBrowser(canvas);
      if (!b || !b.currentScene) return { ok: false };
      const p = b.viewpointPosition;
      return { ok: b.currentScene.rootNodes.length > 0 && !!p && p.y !== 0 };
    });
    if (seen.ok) ready = true;
  }
  await page.waitForTimeout(settle === undefined ? 9000 : settle);
  if (!ready) process.stdout.write(`      warning: ${hash} never produced a scene\n`);
  return ready;
}

/*
 * What this client holds. Node and scene identity are object identity, kept in
 * a page-lived map: the map survives a hash change for the same reason the
 * component's `users` does, which is the whole point of the test.
 */
const probe = page => page.evaluate(() => {
  if (!window.__qaIds) {
    window.__qaIds = new WeakMap();
    window.__qaBornIn = new WeakMap();
    window.__qaSeq = 0;
  }
  const canvas = document.querySelector('#world x3d-canvas');
  const b = canvas && window.X3D ? X3D.getBrowser(canvas) : null;
  const idOf = (obj, prefix, sceneId) => {
    if (!obj || typeof obj !== 'object') return null;
    if (!window.__qaIds.has(obj)) {
      window.__qaSeq += 1;
      window.__qaIds.set(obj, `${prefix}${window.__qaSeq}`);
      if (sceneId !== undefined) window.__qaBornIn.set(obj, sceneId);
    }
    return window.__qaIds.get(obj);
  };
  const sceneId = b && b.currentScene ? idOf(b.currentScene, 'S') : null;
  const app = document.querySelector('#app').__vue__;
  const find = c => { if (c.users) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const comp = find(app);
  const registry = b && b.blaxxunAvatars_ ? Array.from(b.blaxxunAvatars_.values()) : [];
  let roots = [];
  try { roots = b && b.currentScene ? Array.from(b.currentScene.rootNodes) : []; } catch (e) { roots = []; }
  const users = [];
  for (const id of Object.keys(comp.users || {})) {
    const u = comp.users[id];
    let pos = null;
    try {
      if (u.import) {
        const f = u.import.getField('position');
        const v = typeof f.getValue === 'function' ? f.getValue() : f;
        if (v && typeof v.x === 'number') pos = [v.x, v.y, v.z];
      }
    } catch (e) { /* fall back to the transform the socket delivered */ }
    if (!pos && u.transform && u.transform.pos) pos = u.transform.pos.slice();
    const node = idOf(u.import, 'N', sceneId);
    const inline = idOf(u.inline, 'I', sceneId);
    /* Where the node was first seen. A node built in this world was born in
     * this scene; one that came through a transition was born in another. */
    const bornIn = u.import && window.__qaBornIn.has(u.import)
      ? window.__qaBornIn.get(u.import) : null;
    let attached = null;
    try { attached = u.inline ? roots.indexOf(u.inline) !== -1 : null; } catch (e) { attached = null; }
    users.push({
      id, node, inline, pos, bornIn,
      loaded: !!u.loaded,
      loading: !!u.loading,
      inCurrentScene: bornIn !== null ? bornIn === sceneId : null,
      attachedToCurrentScene: attached,
    });
  }
  return {
    place: app.$store.data.place
      ? { id: app.$store.data.place.id, slug: app.$store.data.place.slug } : null,
    scene: sceneId,
    roots: roots.length,
    registry,
    users,
  };
});

const camera = page => page.evaluate(() => {
  const p = X3D.getBrowser(document.querySelector('#world x3d-canvas')).viewpointPosition;
  return p ? [p.x, p.y, p.z] : null;
});

async function walk(page, ms) {
  await page.evaluate(() => {
    const canvas = document.querySelector('#world x3d-canvas');
    if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
  });
  await page.waitForTimeout(300);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(ms);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(3000);
}

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2);

/* One client walks; the other must see them move, and see them where they are. */
async function proveMovement(label, mover, watcher, moverName, record) {
  const before = (await probe(watcher)).users[0];
  await walk(mover, 2500);
  const at = await camera(mover);
  const after = (await probe(watcher)).users[0];
  record.push({ moverName, before: before && before.pos, at, after: after && after.pos });
  check(`${label}: ${moverName} moving is seen by the other`,
    !!before && !!before.pos && !!after && !!after.pos
    && dist(after.pos, before.pos) > 0.5,
    { before: before && before.pos, after: after && after.pos });
  check(`${label}: ${moverName} is seen where they actually are`,
    !!after && !!after.pos && !!at && dist(after.pos, at) < 3
    && dist(after.pos, [0, 0, 0]) > 0.5,
    { seen: after && after.pos, actual: at });
}

/* The shape every client must have in a world it has just built. */
function checkFreshWorld(label, tag, state, otherName, expectPlace, oldNodes) {
  check(`${label}: ${tag} is in ${expectPlace.name}`,
    !!state.place && state.roots > 0,
    { place: state.place, roots: state.roots });
  check(`${label}: ${tag} received a fresh member list`,
    state.registry.length === 1 && state.registry[0] === otherName,
    state.registry);
  check(`${label}: ${tag} has exactly one entry for the member`,
    state.users.length === 1, state.users.map(u => u.id));
  const u = state.users[0];
  check(`${label}: ${tag}'s remote member is loaded`, !!u && u.loaded === true, u);
  check(`${label}: ${tag}'s node is a new node, not the one from before`,
    !!u && !!u.node && oldNodes.indexOf(u.node) === -1,
    { now: u && u.node, before: oldNodes });
  check(`${label}: ${tag}'s node belongs to the current scene`,
    !!u && u.inCurrentScene === true,
    { bornIn: u && u.bornIn, scene: state.scene });
  const stale = state.users.filter(x => x.inCurrentScene === false);
  check(`${label}: ${tag} holds no node from a previous scene`,
    stale.length === 0, stale);
  check(`${label}: ${tag} has no duplicate remote member`,
    new Set(state.users.map(x => x.id)).size === state.users.length
    && state.registry.length === new Set(state.registry).size,
    { users: state.users.map(x => x.id), registry: state.registry });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const record = {};
  const a = await login(browser, RED, 'A');
  const b = await login(browser, BLUE, 'B');

  const chosen = WANTED === 'all'
    ? SCENARIOS.map(s => s.key).concat(['same-world'])
    : [WANTED];

  for (const scenario of SCENARIOS.filter(s => chosen.indexOf(s.key) !== -1)) {
    const { label, from, to } = scenario;
    process.stdout.write(`\n--- ${label} ---\n`);
    const kept = { moves: [] };
    record[scenario.key] = kept;

    /* Both into the old world, and prove they are really in it together. */
    await enter(a, from.hash);
    await enter(b, from.hash);
    await a.waitForTimeout(6000);

    const aBefore = await probe(a);
    const bBefore = await probe(b);
    kept.before = { a: aBefore, b: bBefore };
    check(`${label}: both citizens are in ${from.name}`,
      aBefore.roots > 0 && bBefore.roots > 0 && !!aBefore.place && !!bBefore.place,
      { a: aBefore.place, b: bBefore.place });
    check(`${label}: both citizens see each other in ${from.name}`,
      aBefore.registry.length === 1 && aBefore.registry[0] === BLUE.user
      && bBefore.registry.length === 1 && bBefore.registry[0] === RED.user,
      { a: aBefore.registry, b: bBefore.registry });

    await proveMovement(`${label} (${from.name})`, b, a, 'B', kept.moves);
    await proveMovement(`${label} (${from.name})`, a, b, 'A', kept.moves);

    /* The nodes that must not come through the transition. */
    const afterMove = { a: await probe(a), b: await probe(b) };
    const oldNodes = {
      a: afterMove.a.users.map(u => u.node).filter(Boolean),
      b: afterMove.b.users.map(u => u.node).filter(Boolean),
    };
    kept.oldNodes = oldNodes;
    check(`${label}: node identity was recorded before the transition`,
      oldNodes.a.length === 1 && oldNodes.b.length === 1, oldNodes);

    /* The transition, in the order under test. */
    const firstPage = scenario.first === 'A' ? a : b;
    const secondPage = scenario.first === 'A' ? b : a;
    await enter(firstPage, to.hash);
    await enter(secondPage, to.hash);
    await a.waitForTimeout(8000);

    const aAfter = await probe(a);
    const bAfter = await probe(b);
    kept.after = { a: aAfter, b: bAfter };
    check(`${label}: both joined the ${to.name} room`,
      !!aAfter.place && !!bAfter.place && aAfter.place.id === bAfter.place.id,
      { a: aAfter.place, b: bAfter.place });
    check(`${label}: the scene was replaced for both`,
      aAfter.scene !== aBefore.scene && bAfter.scene !== bBefore.scene,
      { a: [aBefore.scene, aAfter.scene], b: [bBefore.scene, bAfter.scene] });

    checkFreshWorld(label, 'A', aAfter, BLUE.user, to, oldNodes.a);
    checkFreshWorld(label, 'B', bAfter, RED.user, to, oldNodes.b);

    await proveMovement(`${label} (${to.name})`, b, a, 'B', kept.moves);
    await proveMovement(`${label} (${to.name})`, a, b, 'A', kept.moves);
  }

  /* Same-world leave and rejoin: the transition fix must not touch it. */
  if (chosen.indexOf('same-world') !== -1) {
    for (const world of [PLAZA, CLUB]) {
      const label = `same-world (${world.name})`;
      process.stdout.write(`\n--- ${label} ---\n`);
      const kept = {};
      record[`same-world-${world.name}`] = kept;

      await enter(a, world.hash);
      await enter(b, world.hash);
      await a.waitForTimeout(6000);
      const together = await probe(a);
      kept.together = together;
      check(`${label}: A sees B`,
        together.registry.length === 1 && together.users.length === 1,
        { registry: together.registry, users: together.users.length });

      /* An ordinary move must not disturb the registry. */
      await proveMovement(label, b, a, 'B', kept.moves = []);
      const moved = await probe(a);
      check(`${label}: an ordinary move keeps exactly one entry`,
        moved.users.length === 1 && moved.users[0].loaded === true
        && moved.users[0].inCurrentScene === true, moved.users);
      check(`${label}: an ordinary move does not replace the node`,
        moved.users[0].node === together.users[0].node,
        { before: together.users[0].node, after: moved.users[0].node });

      await b.evaluate(() => { window.location.hash = '#/citymap'; });
      await a.waitForTimeout(9000);
      const gone = await probe(a);
      kept.gone = gone;
      check(`${label}: B leaving removes B from A`,
        gone.registry.length === 0 && gone.users.length === 0,
        { registry: gone.registry, users: gone.users.length });

      await enter(b, world.hash);
      await a.waitForTimeout(8000);
      const back = await probe(a);
      kept.back = back;
      check(`${label}: B rejoining gives A exactly one B`,
        back.registry.length === 1 && back.registry[0] === BLUE.user
        && back.users.length === 1 && back.users[0].loaded === true,
        { registry: back.registry, users: back.users });
      check(`${label}: the rejoined B is a new node in the current scene`,
        back.users[0].node !== together.users[0].node
        && back.users[0].inCurrentScene === true,
        { before: together.users[0].node, after: back.users[0].node });
    }
  }

  await a.screenshot({ path: path.join(OUT_DIR, `transition-a-${WANTED}.png`) });
  await b.screenshot({ path: path.join(OUT_DIR, `transition-b-${WANTED}.png`) });
  fs.writeFileSync(path.join(OUT_DIR, `transition-${WANTED}.json`),
    JSON.stringify({ results, record }, null, 2));
  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
