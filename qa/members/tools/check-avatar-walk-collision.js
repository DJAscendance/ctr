'use strict';

/*
 * CTR_REMOTE_AVATAR_WALK_COLLISION - two citizens on one spawn must both be
 * able to walk.
 *
 * A remote member used to go into the scene as a bare root Inline. X_ITE's
 * WALK viewer collides the local camera against every solid thing in the
 * scene, so the other citizen was one: two members standing on the same entry
 * viewpoint stood inside one another and neither could walk forward. In the
 * Plaza a 2500 ms ArrowUp moved the camera 0.000 with a peer on the spot and
 * 17.4 without one. The Plaza picks one of four viewpoints at random so it
 * happened about a quarter of the time; the Mall and the Club have no
 * RandomEntry script at all, so there it happened every time.
 *
 * The member is now built inside a Collision node with `collide` FALSE. That
 * takes the member out of the local collision test and nothing else, which is
 * the whole of what this gate has to prove:
 *
 *   - the world is still solid, both a real wall and a freshly added body, so
 *     collision has not been turned off globally;
 *   - two citizens on one spawn can both walk forward, in the Plaza where the
 *     spawn is forced, and in the Mall and the Club where it is shared anyway;
 *   - each still sees the other move, and sees them where they really are;
 *   - a member who leaves takes their wrapper and their Inline out of the
 *     scene, leaving no empty wrapper behind;
 *   - a world change does the same for every member at once.
 *
 * Beamer, Repulsor and AAPD targeting through the wrapper is not repeated
 * here: qa/outlands/tools/check-freeplay.js already fires all three down the
 * normal gameplay path and asserts the shot names the other citizen.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/members/tools/check-avatar-walk-collision.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const RED = { user: process.env.CTR_QA_USER || 'testqa', pass: process.env.CTR_QA_PASS || 'testqa' };
const BLUE = {
  user: process.env.CTR_QA_USER2 || 'outlandsqa2',
  pass: process.env.CTR_QA_PASS2 || 'outlandsqa2',
};

const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'avatar-walk-collision');

/* The same threshold the other movement gates use. */
const MOVED = 0.5;
/* How far a citizen covers in one 2500 ms ArrowUp with nothing in the way.
 * The Plaza is open and fast; the Mall and the Club are slower rooms. */
const WALK_MS = 2500;

const PLAZA = { name: 'Plaza', hash: '#/place/enter' };
const MALL = { name: 'Mall', hash: '#/place/mall' };
const CLUB = { name: 'Club', hash: '#/club/837' };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2);
/* Ground distance is what movement is measured in, but "on the same spawn"
 * has to include height: a citizen who has been dropped two metres by gravity
 * is not standing inside the other one, and would not be blocked by them. */
const dist3 = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

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

/* Wait for a world that has actually arrived: root nodes, and a viewpoint that
 * has bound, because an unbound scene reports everybody at the origin. */
async function enter(page, hash, settle) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
    await page.waitForTimeout(1500);
    ready = await page.evaluate(() => {
      const canvas = document.querySelector('#world x3d-canvas');
      if (!canvas || !window.X3D) return false;
      const b = X3D.getBrowser(canvas);
      if (!b || !b.currentScene) return false;
      const p = b.viewpointPosition;
      return b.currentScene.rootNodes.length > 0 && !!p && p.y !== 0;
    });
  }
  await page.waitForTimeout(settle === undefined ? 9000 : settle);
  return ready;
}

/*
 * Setting the hash to the world the client is already in does nothing: the
 * router sees no change, the world is not reloaded, and the camera stays
 * wherever it was left. A test that needs a citizen back on the world's own
 * spawn has to leave the world first.
 */
async function reenter(page, hash) {
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForTimeout(4000);
  return enter(page, hash);
}

const camera = page => page.evaluate(() => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const p = b.viewpointPosition;
  const o = b.viewpointOrientation;
  return {
    pos: p ? [p.x, p.y, p.z] : null,
    ori: o ? [o.x, o.y, o.z, o.angle] : null,
  };
});

/* What this client holds for the other members in the room, and what of it is
 * actually attached to the scene it is looking at. */
const probe = page => page.evaluate(() => {
  const canvas = document.querySelector('#world x3d-canvas');
  const b = canvas && window.X3D ? X3D.getBrowser(canvas) : null;
  const app = document.querySelector('#app').__vue__;
  const find = c => { if (c.users) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const comp = find(app);
  let roots = [];
  try { roots = b && b.currentScene ? Array.from(b.currentScene.rootNodes) : []; } catch (e) { roots = []; }
  const wrappers = roots.filter(n => { try { return n.getNodeTypeName() === 'Collision'; } catch (e) { return false; } });
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
    } catch (e) { /* fall back to what the socket delivered */ }
    if (!pos && u.transform && u.transform.pos) pos = u.transform.pos.slice();
    users.push({
      id,
      pos,
      loaded: !!u.loaded,
      hasCollision: !!u.collision,
      /* The wrapper is what is attached; the Inline hangs below it and must
       * not also be a root node of its own. */
      wrapperAttached: u.collision ? roots.indexOf(u.collision) !== -1 : null,
      inlineIsRoot: u.inline ? roots.indexOf(u.inline) !== -1 : null,
      collideOff: u.collision ? u.collision.collide === false : null,
    });
  }
  return {
    scene: !!(b && b.currentScene),
    roots: roots.length,
    collisionRoots: wrappers.length,
    registry: b && b.blaxxunAvatars_ ? Array.from(b.blaxxunAvatars_.values()) : [],
    users,
  };
});

async function walk(page, ms) {
  await page.evaluate(() => {
    const canvas = document.querySelector('#world x3d-canvas');
    if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
  });
  await page.waitForTimeout(300);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(ms === undefined ? WALK_MS : ms);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2500);
}

/* Put a client on an exact spot facing an exact way, the way beamTo does. */
async function placeAt(page, pos, ori) {
  await page.evaluate(([p, o]) => {
    const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    const vp = b.currentScene.createNode('Viewpoint');
    b.currentScene.addRootNode(vp);
    vp.position = new X3D.SFVec3f(p[0], p[1], p[2]);
    vp.orientation = new X3D.SFRotation(o[0], o[1], o[2], o[3]);
    vp.set_bind = true;
    vp.addFieldCallback({}, 'isBound', value => {
      if (!value) { b.currentScene.removeRootNode(vp); vp.dispose(); }
    });
  }, [pos, ori]);
  await page.waitForTimeout(3000);
}

/* ---- the world must still be solid ---- */

/*
 * A real wall. The citizen is walked in one direction in six-second stretches
 * and each stretch is measured on its own. An open room is crossed in the
 * first few; a bounded one eventually produces a stretch that covers nothing,
 * and that stretch is the wall. The Plaza is large, so how many stretches it
 * takes is not fixed - what is asserted is that the citizen moves at all, and
 * that the world does in the end stop them.
 */
async function worldWallControl(page, label) {
  const legs = [];
  let blocked = false;
  let position = (await camera(page)).pos;
  for (let leg = 0; leg < 8 && !blocked; leg += 1) {
    await walk(page, 6000);
    const next = (await camera(page)).pos;
    const moved = dist(position, next);
    legs.push({ leg, from: position, to: next, moved: +moved.toFixed(3) });
    blocked = moved < MOVED;
    position = next;
  }
  check(`${label}: the citizen travels across an empty room`,
    legs.length > 0 && legs[0].moved > MOVED, legs[0]);
  check(`${label}: a world wall still stops WALK`, blocked,
    { legs: legs.map(l => l.moved), stoppedAt: position });
}

/*
 * A body the gate builds itself, put in the citizen's path twice: bare, which
 * is how a remote member used to be attached, and then inside the same
 * Collision { collide FALSE } wrapper a member is built inside now. The bare
 * one must block and the wrapped one must not. This is what separates "remote
 * members are no longer solid" from "collision has been turned off".
 */
async function bodyControl(page, label) {
  const { pos, ori } = await camera(page);

  const built = await page.evaluate(([p, o]) => {
    const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    const scene = b.currentScene;
    /* Three metres along the way the citizen is actually facing, not along a
     * world axis: a spawn viewpoint is rarely square to the world. */
    const forward = new X3D.SFRotation(o[0], o[1], o[2], o[3]).multVec(new X3D.SFVec3f(0, 0, -1));
    const at = [p[0] + forward.x * 4, p[1] + forward.y * 4, p[2] + forward.z * 4];
    const body = () => {
      const t = scene.createNode('Transform');
      const shape = scene.createNode('Shape');
      const box = scene.createNode('Box');
      /* Far enough ahead that the citizen starts outside it - a box the
       * camera is already inside proves nothing - and wider than a citizen
       * can travel in one leg, so a blocked walk cannot be a walk that slid
       * round the end. */
      box.size = new X3D.SFVec3f(60, 8, 4);
      shape.geometry = box;
      shape.appearance = scene.createNode('Appearance');
      shape.appearance.material = scene.createNode('Material');
      t.children = [shape];
      t.translation = new X3D.SFVec3f(at[0], at[1], at[2]);
      /* Turned to face the citizen. An axis-aligned box this wide would reach
       * back around the camera whenever "forward" is not a world axis, and a
       * citizen already inside a box is not stopped by it. */
      t.rotation = new X3D.SFRotation(o[0], o[1], o[2], o[3]);
      return t;
    };
    const bare = body();
    scene.addRootNode(bare);
    window.__wc = { bare, body, at };
    return { at };
  }, [pos, ori]);

  await page.waitForTimeout(2000);
  await placeAt(page, pos, ori);
  const b1 = (await camera(page)).pos;
  await walk(page);
  const a1 = (await camera(page)).pos;
  const bare = dist(b1, a1);

  await page.evaluate(() => {
    const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    const scene = b.currentScene;
    scene.removeRootNode(window.__wc.bare);
    const wrapped = window.__wc.body();
    const col = scene.createNode('Collision');
    col.collide = false;
    col.children = [wrapped];
    scene.addRootNode(col);
    window.__wc.col = col;
  });
  await page.waitForTimeout(2000);
  await placeAt(page, pos, ori);
  const b2 = (await camera(page)).pos;
  await walk(page);
  const a2 = (await camera(page)).pos;
  const wrapped = dist(b2, a2);
  check(`${label}: the same body inside collide FALSE does not block WALK`, wrapped > MOVED,
    { from: b2, to: a2, moved: +wrapped.toFixed(3) });
  /* Judged against the free walk rather than against zero: a citizen who meets
   * a surface at an angle slides a little way along it before stopping. */
  check(`${label}: a bare solid body blocks WALK`, bare < wrapped / 4,
    { at: built.at, bare: +bare.toFixed(3), free: +wrapped.toFixed(3) });

  await page.evaluate(() => {
    const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    b.currentScene.removeRootNode(window.__wc.col);
    delete window.__wc;
  });
  await page.waitForTimeout(1000);
}

/* ---- two citizens on one spawn ---- */

async function sameSpawn(world, red, blue, record) {
  const label = world.name;

  /* Both citizens arrive fresh, so each is on the world's own spawn and not
   * wherever an earlier check left them. */
  const okA = await reenter(red, world.hash);
  const okB = await reenter(blue, world.hash);
  check(`${label}: both citizens reach the world`, okA && okB, { A: okA, B: okB });

  const seenA = await probe(red);
  const seenB = await probe(blue);
  check(`${label}: each citizen sees the other`,
    seenA.users.length === 1 && seenB.users.length === 1,
    { A: seenA.users.length, B: seenB.users.length });
  check(`${label}: the other citizen is inside a collide FALSE wrapper`,
    seenA.users.every(u => u.hasCollision && u.collideOff === true && u.wrapperAttached === true)
    && seenB.users.every(u => u.hasCollision && u.collideOff === true && u.wrapperAttached === true),
    { A: seenA.users, B: seenB.users });
  check(`${label}: no member Inline is left as a root node of its own`,
    seenA.users.every(u => u.inlineIsRoot === false) && seenB.users.every(u => u.inlineIsRoot === false),
    { A: seenA.users.map(u => u.inlineIsRoot), B: seenB.users.map(u => u.inlineIsRoot) });

  /*
   * The Mall and the Club share their spawn on their own; the Plaza picks one
   * of four at random, so it is forced. Either way the gate walks only after
   * the gap has been measured at zero, so nothing here rests on luck.
   */
  const natural = { A: (await camera(red)).pos, B: (await camera(blue)).pos };
  const naturalGap = dist3(natural.A, natural.B);
  /* Both are put on the spot, not just one onto the other: a citizen bound to
   * a viewpoint is still dropped to the floor by gravity, and only a citizen
   * who has settled is where the gate thinks they are. */
  const spot = await camera(red);
  await placeAt(red, spot.pos, spot.ori);
  await placeAt(blue, spot.pos, spot.ori);
  await red.waitForTimeout(4000);

  const A0 = await camera(red);
  const B0 = await camera(blue);
  const gap = dist3(A0.pos, B0.pos);
  check(`${label}: both citizens stand on one spawn`, gap < 0.5,
    { natural: { A: natural.A, B: natural.B, gap: +naturalGap.toFixed(3) }, A: A0.pos, B: B0.pos, gap: +gap.toFixed(4) });

  /* Each sees the other arrive on that spot before anybody walks. */
  const beforeA = (await probe(red)).users[0];
  const beforeB = (await probe(blue)).users[0];

  await walk(red);
  const A1 = (await camera(red)).pos;
  const movedA = dist(A0.pos, A1);
  check(`${label}: A walks forward with B on the same spot`, movedA > MOVED,
    { from: A0.pos, to: A1, moved: +movedA.toFixed(3) });

  /* B is still where A started, so B's own walk is the same test again. */
  const B1start = (await camera(blue)).pos;
  await walk(blue);
  const B1 = (await camera(blue)).pos;
  const movedB = dist(B1start, B1);
  check(`${label}: B walks forward from the shared spot`, movedB > MOVED,
    { from: B1start, to: B1, moved: +movedB.toFixed(3) });

  /* Movement sync: each must see the other move, and see them where they are. */
  await red.waitForTimeout(2500);
  await blue.waitForTimeout(2500);
  const afterA = (await probe(blue)).users[0];
  const afterB = (await probe(red)).users[0];
  check(`${label}: B sees A move`,
    !!beforeA && !!afterA && !!afterA.pos && dist(afterA.pos, beforeB && beforeB.pos ? beforeB.pos : A0.pos) > MOVED,
    { was: beforeB && beforeB.pos, now: afterA.pos });
  check(`${label}: B sees A where A really is`,
    !!afterA && !!afterA.pos && dist(afterA.pos, A1) < 3,
    { seen: afterA && afterA.pos, actual: A1 });
  check(`${label}: A sees B where B really is`,
    !!afterB && !!afterB.pos && dist(afterB.pos, B1) < 3,
    { seen: afterB && afterB.pos, actual: B1 });

  record.push({
    world: label,
    naturalGap: +naturalGap.toFixed(3),
    gap: +gap.toFixed(4),
    A: { from: A0.pos, to: A1, moved: +movedA.toFixed(3) },
    B: { from: B1start, to: B1, moved: +movedB.toFixed(3) },
  });
}

/* ---- what leaving leaves behind ---- */

async function leaveCleanup(red, blue, record) {
  const before = await probe(red);
  /* B goes somewhere with no 3D world at all, so this is a leave and not a
   * world change on B's side. */
  await blue.evaluate(() => { window.location.hash = '#/'; });
  await red.waitForTimeout(12000);
  const after = await probe(red);
  check('a citizen who leaves is removed from the registry', after.users.length === before.users.length - 1,
    { before: before.users.length, after: after.users.length });
  check('the departed citizen leaves no collision wrapper behind',
    after.collisionRoots === before.collisionRoots - 1,
    { before: before.collisionRoots, after: after.collisionRoots });
  check('the departed citizen leaves no entry in the blaxxun registry',
    after.registry.length === before.registry.length - 1,
    { before: before.registry, after: after.registry });
  check('removing the member removes root nodes, it does not add any',
    after.roots < before.roots, { before: before.roots, after: after.roots });
  record.push({ step: 'leave', before, after });
}

async function transitionCleanup(red, blue, record) {
  await enter(blue, PLAZA.hash);
  await enter(red, PLAZA.hash);
  const inPlaza = await probe(red);
  check('Plaza -> Mall: the two citizens are together in the Plaza first',
    inPlaza.users.length === 1 && inPlaza.collisionRoots === 1, inPlaza.users.length);

  await enter(red, MALL.hash);
  await enter(blue, MALL.hash);
  await red.waitForTimeout(6000);
  const inMall = await probe(red);
  check('Plaza -> Mall: exactly one member, rebuilt in the new world',
    inMall.users.length === 1 && inMall.users[0].loaded, inMall.users);
  check('Plaza -> Mall: exactly one collision wrapper in the new scene',
    inMall.collisionRoots === 1, inMall.collisionRoots);
  check('Plaza -> Mall: the new wrapper is attached and still collide FALSE',
    inMall.users.every(u => u.wrapperAttached === true && u.collideOff === true), inMall.users);
  check('Plaza -> Mall: no stale Inline left as a root node',
    inMall.users.every(u => u.inlineIsRoot === false), inMall.users.map(u => u.inlineIsRoot));
  check('Plaza -> Mall: the blaxxun registry holds one member, not two',
    inMall.registry.length === 1, inMall.registry);
  record.push({ step: 'transition', inPlaza, inMall });
}

/* ---- run ---- */

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const record = [];
  let red = null;
  let blue = null;
  try {
    red = await login(browser, RED, 'A');

    /* The world controls run first, and with nobody else in the room: the
     * second citizen is not logged in yet, so a control that fails means
     * collision is broken rather than that a member was standing there. */
    await enter(red, PLAZA.hash);
    await worldWallControl(red, 'Plaza');
    await reenter(red, PLAZA.hash);
    await bodyControl(red, 'Plaza');

    blue = await login(browser, BLUE, 'B');

    await sameSpawn(PLAZA, red, blue, record);
    await sameSpawn(MALL, red, blue, record);
    await sameSpawn(CLUB, red, blue, record);

    await leaveCleanup(red, blue, record);
    await transitionCleanup(red, blue, record);
  } finally {
    const failed = results.filter(r => !r.pass).length;
    fs.writeFileSync(path.join(OUT_DIR, 'walk-collision.json'),
      `${JSON.stringify({ base: BASE, results, record }, null, 2)}\n`);
    process.stdout.write(`\n${results.length - failed}/${results.length} PASS\n`);
    await browser.close();
    process.exitCode = failed ? 1 : 0;
  }
})().catch(error => {
  process.stdout.write(`gate crashed: ${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
