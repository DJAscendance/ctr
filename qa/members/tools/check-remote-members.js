'use strict';

/*
 * Shared remote members, proved OUTSIDE Outlands.
 *
 * Two generic fixes ride under every shared world, not just the battle:
 *
 *   - the LoadSensor path that loads another member's avatar model, and
 *   - the imported-node path that places and moves it.
 *
 * This gate holds them to the member-facing contract in the two busiest
 * ordinary worlds, the Plaza and the Mall:
 *
 *   - each client sees exactly one remote member, under the right name;
 *   - the remote member's model actually loaded (the Inline has content);
 *   - when the remote member walks, the observer sees them at the updated
 *     position, not at the world origin;
 *   - when they leave, the avatar is removed cleanly - no phantom at the
 *     origin or at their last position;
 *   - when they return, there is exactly one of them, not two.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/members/tools/check-remote-members.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const RED = { user: process.env.CTR_QA_USER || 'testqa', pass: process.env.CTR_QA_PASS || 'testqa' };
const BLUE = { user: process.env.CTR_QA_USER2 || 'outlandsqa2', pass: process.env.CTR_QA_PASS2 || 'outlandsqa2' };
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'members');

/* Three shared 3D places, because the LoadSensor and ImportedNode fixes are
 * shared code: a public world, a shop world, and a club world, which each
 * reach WorldBrowserPage down a different route. The club is place 837,
 * "QAFIX Club", the seeded club fixture. */
const WORLDS = [
  { name: 'Plaza', hash: '#/place/enter' },
  { name: 'Mall', hash: '#/place/mall' },
  { name: 'Shop', hash: '#/place/antiqueshop' },
  { name: 'Club', hash: '#/club/837' },
  { name: 'Outlands', hash: '#/place/outlands' },
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/* The SPA only builds a 3D world for a member whose `chatdefault` is 1; anyone
 * else is put in the 2D room list and `#world` stays empty. A QA account
 * seeded without it produces a null canvas and a confusing crash three
 * functions later, so it is checked here and reported as what it is. */
const in3d = page => page.evaluate(() => {
  const app = document.querySelector('#app').__vue__;
  return { view3d: !!app.$store.data.view3d, chatdefault: app.$store.data.user.chatdefault };
});

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

/* Go to a world and wait for it to actually be there. A fixed sleep is not
 * enough: these worlds are large, the QA renderer is software, and a slow box
 * turns a fixed wait into a null canvas and a confusing crash rather than a
 * failed check. */
async function enter(page, hash) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
  let ready = false;
  let roots = 0;
  for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => {
      const canvas = document.querySelector('#world x3d-canvas');
      if (!canvas || !window.X3D) return { canvas: false, roots: 0, placed: false };
      const b = X3D.getBrowser(canvas);
      if (!b || !b.currentScene) return { canvas: true, roots: 0, placed: false };
      const p = b.viewpointPosition;
      /* A scene that has rendered but not yet bound its viewpoint leaves the
       * camera on the floor at y 0. Reading positions then gives the world
       * origin for everybody, which reads as a bug and is not one. */
      return {
        canvas: true,
        roots: b.currentScene.rootNodes.length,
        placed: !!p && p.y !== 0,
      };
    });
    roots = seen.roots;
    if (seen.canvas && roots > 0 && seen.placed) ready = true;
  }
  /* Let the remote-member machinery catch up with the scene. */
  await page.waitForTimeout(9000);
  if (!ready) process.stdout.write(`      warning: ${hash} never produced a scene\n`);
  return { ready, roots };
}

/* What this client knows about the members around it: the compat registry
 * (which is what a ray answers with) and the page's own imported avatar
 * nodes (which is where positions are written). */
const remotes = page => page.evaluate(() => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const reg = b.blaxxunAvatars_ ? Array.from(b.blaxxunAvatars_.values()) : [];
  const app = document.querySelector('#app').__vue__;
  const find = c => { if (c.users) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const comp = find(app);
  const users = [];
  for (const id of Object.keys(comp.users || {})) {
    const u = comp.users[id];
    let pos = null;
    let inlineLoaded = null;
    try {
      if (u.import) {
        const f = u.import.getField('position');
        const v = typeof f.getValue === 'function' ? f.getValue() : f;
        if (v && typeof v.x === 'number') pos = [v.x, v.y, v.z];
      }
    } catch (e) { /* fall back to the transform the socket delivered */ }
    if (!pos && u.transform && u.transform.pos) pos = u.transform.pos.slice();
    try {
      if (u.inline) {
        for (const s of Object.getOwnPropertySymbols(u.inline)) {
          const conc = u.inline[s];
          if (conc && typeof conc.getInternalScene === 'function') {
            const inner = conc.getInternalScene();
            inlineLoaded = !!(inner && inner.rootNodes && inner.rootNodes.length > 0);
            break;
          }
        }
      }
    } catch (e) { inlineLoaded = null; }
    users.push({ loaded: !!u.loaded, pos, inlineLoaded });
  }
  return { registry: reg, users };
});

const camera = page => page.evaluate(() => {
  const p = X3D.getBrowser(document.querySelector('#world x3d-canvas')).viewpointPosition;
  return [p.x, p.y, p.z];
});

/* Walk the member forward with the keyboard, the way a person moves. */
async function walk(page, ms) {
  await page.evaluate(() => {
    const canvas = document.querySelector('#world x3d-canvas');
    if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
  });
  await page.waitForTimeout(300);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(ms);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2500);
}

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2);

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const record = {};

  const red = await login(browser, RED, 'red');
  const blue = await login(browser, BLUE, 'blue');

  for (const [tag, page] of [['red', red], ['blue', blue]]) {
    const mode = await in3d(page);
    check(`${tag}: the citizen is in the 3D view`, mode.view3d, mode);
  }

  for (const world of WORLDS) {
    await enter(red, world.hash);
    await enter(blue, world.hash);
    await red.waitForTimeout(6000);

    const seenByRed = await remotes(red);
    const seenByBlue = await remotes(blue);
    record[world.name] = { seenByRed, seenByBlue };

    check(`${world.name}: each client sees exactly one remote member`,
      seenByRed.registry.length === 1 && seenByBlue.registry.length === 1,
      { red: seenByRed.registry, blue: seenByBlue.registry });
    check(`${world.name}: the remote member carries the right name`,
      seenByRed.registry[0] === BLUE.user && seenByBlue.registry[0] === RED.user,
      { red: seenByRed.registry, blue: seenByBlue.registry });
    check(`${world.name}: the remote member's model loaded (LoadSensor path)`,
      seenByRed.users.length === 1 && seenByRed.users[0].loaded === true
      && seenByRed.users[0].inlineLoaded !== false,
      seenByRed.users);

    /* Position: the second member walks; the first must see them where they
     * actually are, and not at the world origin. */
    const before = seenByRed.users[0] && seenByRed.users[0].pos;
    await walk(blue, 2500);
    const blueAt = await camera(blue);
    const after = (await remotes(red)).users[0];
    record[world.name].movement = { before, blueAt, after };
    check(`${world.name}: the observer sees the remote member at their real position`,
      !!after && !!after.pos && dist(after.pos, blueAt) < 3 && dist(after.pos, [0, 0, 0]) > 0.5,
      { seen: after && after.pos, actual: blueAt });
    check(`${world.name}: the movement was observed, not a stale entry`,
      !!before && !!after && !!after.pos && dist(after.pos, before) > 0.5,
      { before, after: after && after.pos });

    /* Leave: no phantom may remain. */
    await blue.evaluate(() => { window.location.hash = '#/citymap'; });
    await red.waitForTimeout(8000);
    const gone = await remotes(red);
    record[world.name].afterLeave = gone;
    check(`${world.name}: a member who leaves is removed cleanly`,
      gone.registry.length === 0 && gone.users.length === 0,
      { registry: gone.registry, users: gone.users.length });

    /* Rejoin: exactly one, never two. */
    await enter(blue, world.hash);
    await red.waitForTimeout(6000);
    const back = await remotes(red);
    record[world.name].afterRejoin = back;
    check(`${world.name}: a member who returns appears exactly once`,
      back.registry.length === 1 && back.users.length === 1 && back.registry[0] === BLUE.user,
      { registry: back.registry, users: back.users.length });
  }

  await red.screenshot({ path: path.join(OUT_DIR, 'members-red.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'members.json'), JSON.stringify({ results, record }, null, 2));
  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
