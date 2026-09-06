'use strict';

/*
 * CTR_OUTLANDS_WEAPON_ROUTE
 *
 * One property, proved live: the dynamic ROUTE ne_game.wrl's `battle` Script
 * builds and tears down as a member changes weapon is created, carries its
 * event, and is removed again on X_ITE 16.
 *
 * The route is
 *
 *   we_clock.fraction_changed -> we_scale.set_fraction
 *
 * a TimeSensor SFFloat eventOut into a PositionInterpolator SFFloat eventIn.
 * ne_game.wrl also declares it statically, then set_weapon() deletes it for the
 * AAPD and adds it back for the repulsor, so the route's presence is a direct
 * reading of the weapon the Script believes it is holding.
 *
 * Delivery is not read from the route object. The clock is pulsed and
 * we_scale.value_changed is watched: a PositionInterpolator only emits
 * value_changed when it has been handed a set_fraction, so the callback firing
 * is the event arriving and the callback staying silent is the route being
 * gone. Both states are demanded, in the order the world produces them.
 *
 * Every route call the world makes is recorded through a wrapper on the
 * prototype that owns addRoute, so a "Bad ROUTE specification" can be
 * attributed to its own call site rather than counted out of the console. The
 * wrapper is removed again before the run ends.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/outlands/test/check-weapon-routes.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = {
  user: process.env.CTR_QA_USER || 'testqa',
  pass: process.env.CTR_QA_PASS || 'testqa',
  avatarId: 16,
};
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'weapon-routes');

const CANVAS = '#world x3d-canvas';

/* The route under test, named once. */
const ROUTE = { from: 'we_clock', fromField: 'fraction_changed', to: 'we_scale', toField: 'set_fraction' };

const results = [];
const record = {};
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

const consoleLog = [];

async function open(browser) {
  const page = await browser.newPage();
  page.on('pageerror', e => consoleLog.push({ type: 'pageerror', text: e.message.slice(0, 400) }));
  page.on('console', m => {
    const type = m.type();
    if (type !== 'error' && type !== 'warning') return;
    consoleLog.push({ type, at: Date.now(), text: m.text().slice(0, 400) });
  });
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER.user);
  await page.fill('input[type="password"]', USER.pass);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  await page.evaluate(async id => {
    const app = document.querySelector('#app').__vue__;
    const res = await app.$http.post('/member/update_avatar', { avatarId: id });
    app.$store.methods.setToken(res.data.token);
    const list = await app.$http.get('/avatar');
    Object.assign(app.$store.data.user.avatar, list.data.avatars.find(a => a.id === id));
  }, USER.avatarId);
  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  await page.waitForTimeout(22000);
  return page;
}

/*
 * The recorder.
 *
 * addRoute is not declared on X3DBrowser; a class further along the browser's
 * prototype chain owns it, and bxx_auth.js already shims that same prototype.
 * The wrapper goes on top of whatever is installed, so it sees exactly the
 * calls the world makes, and each entry names its endpoints - a failure can
 * then be read back against its own call site instead of a bare console line.
 */
const installRecorder = page => page.evaluate(sel => {
  const b = X3D.getBrowser(document.querySelector(sel));
  let proto = Object.getPrototypeOf(b);
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'addRoute')) {
    proto = Object.getPrototypeOf(proto);
  }
  window.__wr = { calls: [], proto };

  const causes = err => {
    const out = [];
    for (let e = err, n = 0; e && n < 6; e = e.cause, n += 1) out.push(String(e.message));
    return out;
  };
  const name = node => {
    if (!node) return String(node);
    try { if (typeof node.getVersion === 'function' && typeof node.getNodeTypeName !== 'function') return 'BROWSER'; } catch (e) { /* not the browser */ }
    try { return `${node.getNodeTypeName()}/${node.getNodeName ? node.getNodeName() : ''}`; } catch (e) { return 'unknown'; }
  };

  window.__wrRestore = ['addRoute', 'deleteRoute'].map(fn => {
    const original = proto[fn];
    proto[fn] = function (fromNode, fromField, toNode, toField) {
      const call = { fn, from: name(fromNode), fromField: String(fromField), to: name(toNode), toField: String(toField) };
      try {
        const route = original.apply(this, arguments);
        call.ok = true;
        window.__wr.calls.push(call);
        return route;
      } catch (e) {
        call.ok = false;
        call.error = causes(e);
        window.__wr.calls.push(call);
        throw e;
      }
    };
    return () => { proto[fn] = original; };
  });
}, CANVAS);

const removeRecorder = page => page.evaluate(() => {
  (window.__wrRestore || []).forEach(undo => undo());
  window.__wrRestore = null;
  return true;
});

const drainCalls = page => page.evaluate(() => {
  const calls = window.__wr.calls.slice();
  window.__wr.calls.length = 0;
  return calls;
});

/* Is the route in the scene's own route table? Asked of X_ITE, not of a count
 * this test keeps. */
const routeExists = page => page.evaluate(({ sel, r }) => {
  const scene = X3D.getBrowser(document.querySelector(sel)).currentScene;
  try {
    return !!scene.getRoute(scene.getNamedNode(r.from), r.fromField, scene.getNamedNode(r.to), r.toField);
  } catch (e) {
    return false;
  }
}, { sel: CANVAS, r: ROUTE });

/*
 * Pulse the clock and report whether the interpolator answered.
 *
 * we_clock is `loop FALSE` with a 0.1s cycle, so setting startTime runs it once
 * - the same thing ne_game.wrl's own fire path does. value_changed can only be
 * emitted after a set_fraction arrives, so this reads the route end to end.
 */
const pulse = page => page.evaluate(async ({ sel, r }) => {
  const scene = X3D.getBrowser(document.querySelector(sel)).currentScene;
  const clock = scene.getNamedNode(r.from);
  const scale = scene.getNamedNode(r.to);
  const out = scale.getField('value_changed');

  let arrived = 0;
  const key = 'ctr-weapon-route-probe';
  out.addFieldCallback(key, () => { arrived += 1; });
  try {
    clock.startTime = Date.now() / 1000;
    await new Promise(resolve => setTimeout(resolve, 1200));
  } finally {
    out.removeFieldCallback(key);
  }
  return arrived;
}, { sel: CANVAS, r: ROUTE });

const weapon = page => page.evaluate(sel => {
  const battle = X3D.getBrowser(document.querySelector(sel)).currentScene.getNamedNode('battle');
  const field = battle.getField('type');
  return String(field.getValue ? field.getValue() : field).replace(/^"|"$/g, '');
}, CANVAS);

const tapW = async page => {
  await page.evaluate(sel => {
    const c = document.querySelector(sel);
    if (c && c.focus) c.focus({ preventScroll: true });
  }, CANVAS);
  await page.waitForTimeout(300);
  await page.keyboard.press('w');
  await page.waitForTimeout(2500);
};

/* Only the calls that are this route, so a turret's or an avatar's route
 * cannot pass or fail the weapon path on its behalf. */
const weaponCalls = calls => calls.filter(c =>
  c.fromField === ROUTE.fromField && c.toField === ROUTE.toField
  && /we_clock$/.test(c.from) && /we_scale$/.test(c.to));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  let page;
  try {
    page = await open(browser);
    await installRecorder(page);

    const opening = await weapon(page);
    record.opening = opening;
    check('the battle Script is live and holding the historical opening weapon',
      opening === 'beamer', opening);
    if (opening !== 'beamer') throw new Error('world did not reach a usable state');

    check('the weapon route is declared in the scene before any weapon change',
      await routeExists(page), ROUTE);
    check('the route carries fraction_changed to set_fraction on the opening weapon',
      (await pulse(page)) > 0);

    await drainCalls(page);

    /* ---- the historical cycle, one tap at a time ------------------------ */
    const expected = ['repulsor', 'aapd', 'beamer'];
    const cycle = [];
    for (const want of expected) {
      await tapW(page);
      const got = await weapon(page);
      const calls = weaponCalls(await drainCalls(page));
      const exists = await routeExists(page);
      const delivered = await pulse(page);
      cycle.push({ want, got, calls, routeInScene: exists, valueChangedEvents: delivered });

      check(`W changes the weapon to ${want}`, got === want, got);
      check(`no Bad ROUTE specification on the weapon route while selecting ${want}`,
        calls.every(c => c.ok), calls.filter(c => !c.ok));

      if (want === 'repulsor') {
        check('selecting the repulsor adds the weapon route',
          calls.some(c => c.fn === 'addRoute' && c.ok), calls);
        check('the weapon route is in the scene while the repulsor is held', exists);
        check('fraction_changed reaches set_fraction while the repulsor is held',
          delivered > 0, delivered);
      }
      if (want === 'aapd') {
        check('selecting the AAPD removes the weapon route',
          calls.some(c => c.fn === 'deleteRoute'), calls);
        check('the weapon route is gone from the scene while the AAPD is held', !exists);
        check('fraction_changed no longer reaches set_fraction once the route is removed',
          delivered === 0, delivered);
      }
    }
    record.cycle = cycle;

    /* Back to the repulsor: the route must be rebuildable after a removal. */
    await tapW(page);
    const again = await weapon(page);
    const againCalls = weaponCalls(await drainCalls(page));
    const againExists = await routeExists(page);
    const againDelivered = await pulse(page);
    record.rebuilt = { weapon: again, calls: againCalls, routeInScene: againExists, valueChangedEvents: againDelivered };

    check('W returns to the repulsor after a full cycle', again === 'repulsor', again);
    check('the weapon route is rebuilt after having been removed',
      againExists && againCalls.some(c => c.fn === 'addRoute' && c.ok), record.rebuilt);
    check('the rebuilt route carries fraction_changed to set_fraction',
      againDelivered > 0, againDelivered);

    /* ---- the console, read once at the end ----------------------------- */
    const badRoute = consoleLog.filter(l => /Bad ROUTE/i.test(l.text));
    record.badRouteConsoleCount = badRoute.length;
    record.badRouteConsoleSample = badRoute.slice(0, 2);
    const failedWeaponCalls = cycle.concat([record.rebuilt])
      .reduce((all, step) => all.concat(step.calls.filter(c => !c.ok)), []);
    check('no weapon-route call failed anywhere in the cycle',
      failedWeaponCalls.length === 0, failedWeaponCalls);

    check('the recorder is removed again', await removeRecorder(page));

    await page.screenshot({ path: path.join(OUT_DIR, 'weapon-routes.png') });
  } finally {
    if (page) {
      try { await removeRecorder(page); } catch (e) { /* page already gone */ }
    }
    await browser.close();
  }

  record.results = results;
  record.console = consoleLog;
  fs.writeFileSync(path.join(OUT_DIR, 'weapon-routes.json'), `${JSON.stringify(record, null, 2)}\n`);

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  process.stdout.write(`report: ${path.join(OUT_DIR, 'weapon-routes.json')}\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => {
  process.stderr.write(`${e.stack}\n`);
  process.exit(1);
});
