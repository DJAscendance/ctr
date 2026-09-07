'use strict';

/*
 * CTR_ENTRY_POSITION
 *
 * Where a member's first position comes from when they walk into a world.
 *
 * joinPlace() used to follow the room join with an `AV` carrying
 * `{ detail: { pos, rot } }`. The server's AV handler guards on `msg.pos` and
 * a receiving client's onAvatarMoved reads `event.pos`, so nothing on either
 * side ever saw those fields: it updated no server state and moved no avatar.
 * The pos inside it came from `viewpointPosition`, which is the camera in the
 * bound Viewpoint's coordinates, not world space - in the Antique Shop that
 * reads Z = 25 where the citizen really stands at Z = 13.8.
 *
 * The emit is gone. This gate proves the entry position is still established,
 * and that it is established by the one path that was always doing the work:
 * the root ProximitySensor, which fires by itself after JOIN, sets
 * `this.position` in world space, and lets the watcher publish a flat
 * `{ pos }` the server and the other clients both understand.
 *
 * Nobody presses a key. Everything below is what a member gets for walking in
 * and standing still.
 *
 * Read off the wire, per world:
 *   - JOIN, and every AV the joining client sends, with timestamps;
 *   - the joining client's viewpoint reading and its world-space reading;
 *   - what the server stored (read back through a third client, because the
 *     JOIN reply hands a newcomer the server's own USERS snapshot);
 *   - what the watching client stored, and where it actually put the avatar.
 *
 * The Antique Shop is run twice, cold and then warm, because a warm cache
 * loads the avatar sooner and would expose a wrong position that a slow load
 * hides. The Plaza and the Mall are the controls: their Viewpoints sit at the
 * scene root, so viewpoint and world space agree there and any failure is
 * about the join path rather than about coordinates.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/members/tools/check-entry-position.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch: launchBrowser } = require('../../lib/browser');
const { SCENE_ACCESS_SOURCE } = require('../../final-gate/lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const A_SPEC = { user: process.env.CTR_QA_USER || 'testqa', pass: process.env.CTR_QA_PASS || 'testqa' };
const B_SPEC = { user: process.env.CTR_QA_USER2 || 'outlandsqa2', pass: process.env.CTR_QA_PASS2 || 'outlandsqa2' };
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'entry-position');

/* The Antique Shop first, twice: its Viewpoints live inside a PROTO instance
 * translated 0 0 -11.2, so it is the one world where a viewpoint-local
 * coordinate is telling apart from a world-space one by value alone. */
const RUNS = [
  { name: 'Antique Shop (cold)', hash: '#/place/antiqueshop', splitSpaces: true, server: true },
  { name: 'Antique Shop (warm)', hash: '#/place/antiqueshop', splitSpaces: true, server: false },
  { name: 'Plaza', hash: '#/place/enter', splitSpaces: false, server: false },
  { name: 'Mall', hash: '#/place/mall', splitSpaces: false, server: false },
];

/* The measured Antique Shop gap: viewpoint Z minus world Z. */
const SHOP_GAP = 11.2;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

const note = (name, detail) => {
  process.stdout.write(`NOTE  ${name}  ${JSON.stringify(detail)}\n`);
};

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2);

/* ------------------------------------------------------------------ *
 * Client setup.
 * ------------------------------------------------------------------ */

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

/*
 * Record the wire.
 *
 * The SocketManager is a singleton created once at app start, so one wrapper
 * installed here survives every world change. Outgoing frames are taken by
 * shadowing the socket's own `emit` - socket.io dispatches its internal events
 * through the Emitter prototype, so the wrapper only ever sees the page's own
 * traffic. Incoming frames come from `onAny`, which is additive and removes
 * nothing the page registered.
 */
async function installTap(page, tag) {
  await page.evaluate((clientTag) => {
    if (window.__ctrTap) return;
    const app = document.querySelector('#app').__vue__;
    const sock = app.$socket.socket;
    if (!sock) throw new Error('no socket to tap - the app has not connected');
    const copy = (value) => {
      try { return value === undefined ? null : JSON.parse(JSON.stringify(value)); }
      catch (e) { return { unserializable: String(value) }; }
    };
    const tap = { tag: clientTag, out: [], in: [] };
    window.__ctrTap = tap;
    const realEmit = sock.emit.bind(sock);
    sock.emit = function (event) {
      const args = Array.prototype.slice.call(arguments, 1);
      tap.out.push({ t: Date.now(), event, payload: copy(args[0]) });
      return realEmit.apply(null, [event].concat(args));
    };
    sock.onAny((event, payload) => {
      tap.in.push({ t: Date.now(), event, payload: copy(payload) });
    });
  }, tag);
}

const resetTap = page => page.evaluate(() => {
  if (window.__ctrTap) { window.__ctrTap.out = []; window.__ctrTap.in = []; }
});

const readTap = page => page.evaluate(() => (window.__ctrTap
  ? { out: window.__ctrTap.out, in: window.__ctrTap.in }
  : { out: [], in: [] }));

const socketId = page => page.evaluate(() => {
  const app = document.querySelector('#app').__vue__;
  return app.$socket.socket.id;
});

/* Enter a world and wait until it is really there. No key is ever pressed. */
async function enter(page, hash) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => {
      const canvas = document.querySelector('#world x3d-canvas');
      if (!canvas || !window.X3D) return { canvas: false, roots: 0, placed: false };
      const b = X3D.getBrowser(canvas);
      if (!b || !b.currentScene) return { canvas: true, roots: 0, placed: false };
      const p = b.viewpointPosition;
      return {
        canvas: true,
        roots: b.currentScene.rootNodes.length,
        placed: !!p && p.y !== 0,
      };
    });
    if (seen.canvas && seen.roots > 0 && seen.placed) ready = true;
  }
  await page.waitForTimeout(9000);
  return ready;
}

const leave = async (page) => {
  await page.evaluate(() => { window.location.hash = '#/citymap'; });
  await page.waitForTimeout(6000);
};

/*
 * The two coordinate readings, side by side.
 *
 * `viewpoint` is browser.viewpointPosition - the camera in the bound
 * Viewpoint's own space, which is what the deleted emit used to send.
 * `world` is the component's `position`, fed by the root ProximitySensor,
 * which is what the live watcher sends. The sensor is checked to still be a
 * root node, because world space is only true while it is one.
 */
const readings = page => page.evaluate(() => {
  const canvas = document.querySelector('#world x3d-canvas');
  const browser = X3D.getBrowser(canvas);
  const app = document.querySelector('#app').__vue__;
  const find = c => { if (c.users) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const comp = find(app);
  let viewpoint = null;
  try {
    const p = browser.viewpointPosition;
    if (p) viewpoint = [p.x, p.y, p.z];
  } catch (e) { viewpoint = null; }
  const sensor = comp && comp.proximitySensor;
  const sensorIsRoot = !!sensor && browser.currentScene.rootNodes.indexOf(sensor) >= 0;
  return {
    viewpoint,
    world: comp && comp.position ? comp.position.slice() : null,
    sensorIsRoot,
  };
});

/*
 * What the watching client stored for a member, and where it actually put them.
 *
 * The stored half is the last AV the page accepted. The rendered half is the
 * engine's own answer, and it has to be read out of the avatar's Inline scene:
 * the Avatar PROTO takes set_position as an eventIn and publishes no matching
 * readable field, so getField('position') on the imported node answers nothing
 * at all. Inside the Inline the body hangs off a Transform DEF'd
 * WalkingAvatar, and that Transform's translation is what set_position drives.
 *
 * Every named Transform carrying a translation is reported alongside it. An
 * avatar that renames WalkingAvatar makes this read null and fails the check
 * loudly, with the names it did find, rather than quietly comparing the
 * message against itself.
 */
const viewOf = (page, id) => page.evaluate((memberId) => {
  const api = window.__ctr;
  const app = document.querySelector('#app').__vue__;
  const find = c => { if (c.users) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const comp = find(app);
  const u = comp && comp.users ? comp.users[memberId] : null;
  if (!u) return null;
  let rendered = null;
  let inlineLoaded = null;
  const named = [];
  try {
    const scene = u.inline ? api.inlineScene(u.inline) : null;
    inlineLoaded = !!(scene && scene.rootNodes && scene.rootNodes.length > 0);
    if (scene) {
      api.walk(scene, (node) => {
        if (api.typeName(node) !== 'Transform') return;
        const def = api.defName(node);
        if (!def) return;
        const translation = api.readVec3(node, 'translation');
        if (translation && (translation[0] || translation[2])) named.push({ def, translation });
        if (def === 'WalkingAvatar') rendered = translation;
      }, 20000);
    }
  } catch (e) { rendered = null; }
  return {
    stored: u.transform && u.transform.pos ? u.transform.pos.slice() : null,
    storedRot: u.transform && u.transform.rot ? u.transform.rot.slice() : null,
    rendered,
    named: named.slice(0, 8),
    loaded: !!u.loaded,
    inlineLoaded,
  };
}, id);

/* ------------------------------------------------------------------ *
 * The run.
 * ------------------------------------------------------------------ */

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const record = {};

  const a = await login(browser, A_SPEC, 'A');
  const b = await login(browser, B_SPEC, 'B');
  await installTap(a, 'A');
  await installTap(b, 'B');
  /* Only the watching client needs to read into scenes. */
  await a.evaluate(SCENE_ACCESS_SOURCE);
  const bId = await socketId(b);
  const aId = await socketId(a);

  for (const run of RUNS) {
    process.stdout.write(`\n--- ${run.name} ---\n`);

    /* A is already in the world; B walks in after. */
    await leave(b);
    await enter(a, run.hash);
    await resetTap(a);
    await resetTap(b);

    await enter(b, run.hash);
    await a.waitForTimeout(6000);

    const bTap = await readTap(b);
    const aTap = await readTap(a);
    const bWhere = await readings(b);
    const aSeesB = await viewOf(a, bId);

    const join = bTap.out.filter(f => f.event === 'JOIN');
    const av = bTap.out.filter(f => f.event === 'AV');
    const nested = av.filter(f => f.payload && f.payload.detail !== undefined);
    const firstPos = av.find(f => f.payload && f.payload.pos !== undefined);
    const firstRot = av.find(f => f.payload && f.payload.rot !== undefined);
    const relayed = aTap.in.filter(f => f.event === 'AV' && f.payload && f.payload.id === bId);
    const relayedNested = relayed.filter(f => f.payload.detail !== undefined);

    const entry = {
      join: join.map(f => ({ t: f.t, payload: { room: f.payload && f.payload.room } })),
      av: av.map(f => ({ t: f.t, payload: f.payload })).slice(0, 12),
      viewpoint: bWhere.viewpoint,
      world: bWhere.world,
      sensorIsRoot: bWhere.sensorIsRoot,
      aSeesB,
      window: join.length && firstPos ? firstPos.t - join[0].t : null,
    };
    record[run.name] = entry;

    /* -- the wire ------------------------------------------------- */
    check(`${run.name}: B joins the room exactly once`, join.length === 1, join.length);
    check(`${run.name}: B sends no nested initial AV`, nested.length === 0,
      nested.map(f => f.payload));
    check(`${run.name}: no nested AV reaches A either`, relayedNested.length === 0,
      relayedNested.map(f => f.payload));
    check(`${run.name}: B's first useful AV carries a top-level pos`,
      !!firstPos && Array.isArray(firstPos.payload.pos)
      && firstPos.payload.detail === undefined, firstPos && firstPos.payload);
    check(`${run.name}: B sends a top-level rot as well`,
      !!firstRot && Array.isArray(firstRot.payload.rot)
      && firstRot.payload.detail === undefined, firstRot && firstRot.payload);
    check(`${run.name}: the first position arrives on its own, no key press`,
      entry.window !== null && entry.window >= 0 && entry.window < 60000,
      { join: join[0] && join[0].t, firstPos: firstPos && firstPos.t, window: entry.window });

    /* -- the coordinate space -------------------------------------- */
    check(`${run.name}: the sensor is still a scene root node`, bWhere.sensorIsRoot);
    check(`${run.name}: the first position is B's world-space reading`,
      !!firstPos && !!bWhere.world && dist(firstPos.payload.pos, bWhere.world) < 1,
      { sent: firstPos && firstPos.payload.pos, world: bWhere.world });
    check(`${run.name}: B is not published at the world origin`,
      !!firstPos && dist(firstPos.payload.pos, [0, 0, 0]) > 0.5,
      firstPos && firstPos.payload.pos);

    if (run.splitSpaces) {
      const gap = bWhere.viewpoint && bWhere.world
        ? bWhere.viewpoint[2] - bWhere.world[2] : null;
      note(`${run.name}: viewpoint vs world`, { viewpoint: bWhere.viewpoint, world: bWhere.world, gapZ: gap });
      check(`${run.name}: the two coordinate spaces really do differ here`,
        gap !== null && Math.abs(gap - SHOP_GAP) < 1, gap);
      check(`${run.name}: no viewpoint-local Z is published`,
        !!firstPos && !!bWhere.viewpoint
        && Math.abs(firstPos.payload.pos[2] - bWhere.viewpoint[2]) > 1,
        { sent: firstPos && firstPos.payload.pos, viewpoint: bWhere.viewpoint });
      check(`${run.name}: no AV B sent carries the viewpoint-local Z`,
        av.every(f => !f.payload || !Array.isArray(f.payload.pos)
          || Math.abs(f.payload.pos[2] - bWhere.viewpoint[2]) > 1),
        av.filter(f => f.payload && Array.isArray(f.payload.pos)
          && Math.abs(f.payload.pos[2] - bWhere.viewpoint[2]) <= 1).map(f => f.payload));
    }

    /* -- what A ended up with -------------------------------------- */
    check(`${run.name}: A has B`, !!aSeesB && aSeesB.loaded === true, aSeesB);
    check(`${run.name}: A's model for B loaded`,
      !!aSeesB && aSeesB.inlineLoaded !== false, aSeesB && aSeesB.inlineLoaded);
    check(`${run.name}: A stored B's world-space position`,
      !!aSeesB && !!aSeesB.stored && !!bWhere.world
      && dist(aSeesB.stored, bWhere.world) < 1,
      { stored: aSeesB && aSeesB.stored, world: bWhere.world });
    check(`${run.name}: A placed B's avatar at that position`,
      !!aSeesB && !!aSeesB.rendered && !!bWhere.world
      && dist(aSeesB.rendered, bWhere.world) < 1,
      { rendered: aSeesB && aSeesB.rendered, world: bWhere.world,
        named: aSeesB && aSeesB.named });
    check(`${run.name}: A did not leave B at the origin`,
      !!aSeesB && !!aSeesB.rendered && dist(aSeesB.rendered, [0, 0, 0]) > 0.5,
      aSeesB && aSeesB.rendered);

    note(`${run.name}: JOIN to first position, ms`, entry.window);

    /* -- what the server stored ------------------------------------ *
     * There is no admin read for USERS, but the JOIN reply is one: the
     * server hands a newcomer an AV frame per member straight out of that
     * map. A third client is opened to collect it. */
    if (run.server) {
      const c = await login(browser, A_SPEC, 'C');
      await installTap(c, 'C');
      await resetTap(c);
      await enter(c, run.hash);
      await c.waitForTimeout(4000);
      const cTap = await readTap(c);
      const snapshot = cTap.in.find(f => f.event === 'AV' && f.payload && f.payload.id === bId);
      record[run.name].serverSnapshot = snapshot ? snapshot.payload : null;
      note(`${run.name}: server USERS[B]`, snapshot ? snapshot.payload : null);
      check(`${run.name}: the server stored a position for B`,
        !!snapshot && Array.isArray(snapshot.payload.pos), snapshot && snapshot.payload);
      check(`${run.name}: the server's position for B is world space`,
        !!snapshot && Array.isArray(snapshot.payload.pos) && !!bWhere.world
        && dist(snapshot.payload.pos, bWhere.world) < 1,
        { server: snapshot && snapshot.payload.pos, world: bWhere.world });
      check(`${run.name}: the server holds no viewpoint-local Z for B`,
        !!snapshot && Array.isArray(snapshot.payload.pos) && !!bWhere.viewpoint
        && Math.abs(snapshot.payload.pos[2] - bWhere.viewpoint[2]) > 1,
        { server: snapshot && snapshot.payload.pos, viewpoint: bWhere.viewpoint });
      await c.close();
    }

    await b.screenshot({ path: path.join(OUT_DIR, `${run.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-b.png`) });
    await a.screenshot({ path: path.join(OUT_DIR, `${run.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-a.png`) });
  }

  record.ids = { a: aId, b: bId };
  fs.writeFileSync(path.join(OUT_DIR, 'entry-position.json'),
    JSON.stringify({ results, record }, null, 2));
  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  process.stdout.write(`report: ${path.join(OUT_DIR, 'entry-position.json')}\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
