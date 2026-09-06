'use strict';

/*
 * CTR_BLAXXUN_BROWSER_EVENT_DELIVERY
 *
 * One property, proved live: a browser event delivered to a world's Script
 * keeps its own values until that Script has read it.
 *
 * bxx_events.js used to build one BlaxxunBrowserEvent node per browser and
 * mutate it for every event. blaxxun could do that because it ran the
 * receiving Script inside the DOM handler. X_ITE 16 does not - writing a
 * Script eventIn queues the event and the Script reads the node it was handed
 * on a later tick - so a tapped key, whose keydown and keyup land in the same
 * tick, arrived at the Script as two keyups. In Outlands that is why a tapped
 * D never fired and a tapped W never changed weapon while holding either key
 * worked.
 *
 * Nothing here is asserted from the SPA. The order and the values are read out
 * of the delivery path itself, through an observer pushed onto the browser's
 * own event route list, and the gameplay effects are read out of ne_game.wrl's
 * `battle` Script. The observer is removed again before the run ends, and the
 * route count is checked before and after so this test cannot be the thing
 * that leaks.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/outlands/test/check-browser-events.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = { user: process.env.CTR_QA_USER || 'testqa', pass: process.env.CTR_QA_PASS || 'testqa', avatarId: 16 };
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'browser-events');

const CANVAS = '#world x3d-canvas';

const results = [];
const record = {};
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

const consoleLog = [];

async function open(browser) {
  const page = await browser.newPage();
  page.on('pageerror', e => consoleLog.push({ type: 'pageerror', text: e.message.slice(0, 300) }));
  page.on('console', m => {
    const type = m.type();
    if (type !== 'error' && type !== 'warning') return;
    consoleLog.push({ type, at: Date.now(), text: m.text().slice(0, 300) });
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
 * The probe.
 *
 * `observer` is a real entry on browser.browserEventRoutes_, so it is fed by
 * the same deliver() call the world's Script is fed by, in the same order. It
 * keeps two things: a snapshot taken at the instant of delivery, and the node
 * reference itself, so a later read can show whether the next event came back
 * and overwrote it.
 *
 * setNavigationMode is wrapped rather than polled because a tapped A asks for
 * PAN and then WALK inside one tick; no rendered frame is guaranteed to fall
 * between them, so sampling would miss the PAN that did arrive.
 */
const installProbe = page => page.evaluate(sel => {
  const b = X3D.getBrowser(document.querySelector(sel));
  window.__bxx = { snaps: [], refs: [], nav: [], routesAtInstall: (b.browserEventRoutes_ || []).length };

  const observer = {
    field: 'event_changed',
    eventIn: 'onEvent',
    node: {
      set onEvent(node) {
        window.__bxx.refs.push(node);
        window.__bxx.snaps.push({
          type: String(node.type),
          keyCode: Number(node.keyCode),
          button: Number(node.button),
          shiftKey: Number(node.shiftKey),
          returnValue: Number(node.returnValue),
        });
      },
    },
  };
  b.browserEventRoutes_ = (b.browserEventRoutes_ || []).concat([observer]);
  window.__bxxObserver = observer;

  const original = b.setNavigationMode.bind(b);
  b.setNavigationMode = function (mode) { window.__bxx.nav.push(String(mode)); return original(mode); };
  window.__bxxRestoreNav = () => { b.setNavigationMode = original; };
}, CANVAS);

const removeProbe = page => page.evaluate(sel => {
  const b = X3D.getBrowser(document.querySelector(sel));
  b.browserEventRoutes_ = (b.browserEventRoutes_ || []).filter(r => r !== window.__bxxObserver);
  if (window.__bxxRestoreNav) window.__bxxRestoreNav();
  return (b.browserEventRoutes_ || []).length;
}, CANVAS);

const probe = page => page.evaluate(() => ({
  snaps: window.__bxx.snaps.slice(),
  nav: window.__bxx.nav.slice(),
}));

const reset = page => page.evaluate(() => {
  window.__bxx.snaps.length = 0;
  window.__bxx.refs.length = 0;
  window.__bxx.nav.length = 0;
});

/* What the delivered nodes say NOW, long after they were handed over. If the
 * pool were still one shared node these would all read alike. */
const refsNow = page => page.evaluate(() => window.__bxx.refs.map(n => ({
  type: String(n.type), keyCode: Number(n.keyCode), button: Number(n.button),
})));

const distinctRefs = page => page.evaluate(() => new Set(window.__bxx.refs).size);

/* How many times two events in a row were carried on the same node. Once the
 * pool recycles, a node seen early may come back later - that is the point of
 * a pool - but two events that are adjacent in the stream must never share
 * one, because the second would overwrite the first before it was read. */
const adjacentSharedNodes = page => page.evaluate(() => {
  const refs = window.__bxx.refs;
  let shared = 0;
  for (let i = 1; i < refs.length; i += 1) if (refs[i] === refs[i - 1]) shared += 1;
  return shared;
});

/* The queue is empty and nothing is still being paced out. */
const queueIdle = page => page.evaluate(sel => {
  const q = X3D.getBrowser(document.querySelector(sel)).blaxxunEventQueue_;
  return !q || (q.items_.length === 0 && q.pacing_ === false);
}, '#world x3d-canvas');

/* The pool's own books: how many event nodes exist, and how many are idle. */
const pool = page => page.evaluate(sel => {
  const p = X3D.getBrowser(document.querySelector(sel)).blaxxunEventPool_;
  return p ? { nodes: p.all_.length, free: p.free_.length } : null;
}, CANVAS);

const routeCount = page => page.evaluate(sel =>
  (X3D.getBrowser(document.querySelector(sel)).browserEventRoutes_ || []).length, CANVAS);

/* Read out of ne_game.wrl's own battle Script, not out of the SPA. */
const state = page => page.evaluate(sel => {
  const b = X3D.getBrowser(document.querySelector(sel));
  const battle = b.currentScene.getNamedNode('battle');
  const f = n => { const v = battle.getField(n); return v.getValue ? v.getValue() : v; };
  const type = String(f('type'));
  const ammo = { beamer: Number(f('b_ammo')), repulsor: Number(f('r_ammo')), aapd: Number(f('a_ammo')) };
  return { type, ammo, held: ammo[type], viewer: b.viewer_ || null };
}, CANVAS);

const focusCanvas = async page => {
  await page.evaluate(sel => {
    const c = document.querySelector(sel);
    if (c && c.focus) c.focus({ preventScroll: true });
  }, CANVAS);
  await page.waitForTimeout(300);
};

/* A real tap. Playwright's press() is keydown immediately followed by keyup,
 * which is the exact sequence the old shared node could not carry. */
const tap = async (page, key) => {
  await focusCanvas(page);
  await page.keyboard.press(key);
  await page.waitForTimeout(1500);
};

/* The number of DOM listeners actually attached to the 3D canvas, read from
 * the browser through CDP rather than counted by the code under test. */
async function canvasListeners(page) {
  const client = await page.context().newCDPSession(page);
  try {
    const { result } = await client.send('Runtime.evaluate', { expression: `document.querySelector('${CANVAS}')` });
    const listeners = await client.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    const counts = {};
    for (const l of listeners.listeners) counts[l.type] = (counts[l.type] || 0) + 1;
    return { total: listeners.listeners.length, byType: counts };
  } finally {
    await client.detach();
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  let page;
  try {
    page = await open(browser);
    await installProbe(page);

    const opening = await state(page);
    record.opening = opening;
    check('the battle Script is live and holding the historical opening load',
      opening.type === 'beamer' && opening.ammo.beamer === 100, opening);
    if (opening.type !== 'beamer') throw new Error('world did not reach a usable state');

    const routesBefore = await routeCount(page);
    const listenersBefore = await canvasListeners(page);
    record.routesWithProbe = routesBefore;
    record.listenersBefore = listenersBefore;

    /* ---- 1. event value isolation, the full field matrix ---------------- */
    await focusCanvas(page);
    await reset(page);
    await page.evaluate(sel => {
      const c = document.querySelector(sel);
      const keyEvent = (type, code, shift) => {
        const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, shiftKey: !!shift });
        Object.defineProperty(e, 'keyCode', { get: () => code });
        return e;
      };
      /* Three events in one turn of the event loop, no frame between them. */
      c.dispatchEvent(keyEvent('keydown', 68, true));
      c.dispatchEvent(keyEvent('keyup', 87, false));
      c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 2 }));
    }, CANVAS);
    await page.waitForTimeout(1500);

    const iso = await probe(page);
    const isoNow = await refsNow(page);
    const isoDistinct = await distinctRefs(page);
    record.isolation = { atDelivery: iso.snaps, readBackLater: isoNow, distinctNodes: isoDistinct };

    check('three events delivered in one tick arrive as three events',
      iso.snaps.length === 3, iso.snaps.length);
    check('event order is preserved: keydown, keyup, mouseup',
      iso.snaps.map(s => s.type).join(',') === 'keydown,keyup,mouseup',
      iso.snaps.map(s => s.type));
    check('each event kept its own values at delivery',
      iso.snaps[0] && iso.snaps[0].keyCode === 68 && iso.snaps[0].shiftKey === 1
      && iso.snaps[1] && iso.snaps[1].keyCode === 87 && iso.snaps[1].shiftKey === 0
      && iso.snaps[2] && iso.snaps[2].button === 2,
      iso.snaps);
    check('each event still holds its own values after the later ones landed',
      isoNow.length === 3 && isoNow[0].type === 'keydown' && isoNow[0].keyCode === 68
      && isoNow[1].type === 'keyup' && isoNow[1].keyCode === 87
      && isoNow[2].type === 'mouseup' && isoNow[2].button === 2,
      isoNow);
    check('each event was carried on a node of its own', isoDistinct === 3, isoDistinct);
    check('returnValue starts at 1 - not cancelled - on every event',
      iso.snaps.every(s => s.returnValue === 1), iso.snaps.map(s => s.returnValue));

    /* ---- 2. the returnValue answer still reaches the browser ------------ */
    const cancelled = await page.evaluate(sel => {
      const b = X3D.getBrowser(document.querySelector(sel));
      const canceller = {
        field: 'event_changed', eventIn: 'onEvent',
        node: { set onEvent(node) { node.returnValue = 0; } },
      };
      b.browserEventRoutes_ = b.browserEventRoutes_.concat([canceller]);
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'keyCode', { get: () => 68 });
      document.querySelector(sel).dispatchEvent(e);
      b.browserEventRoutes_ = b.browserEventRoutes_.filter(r => r !== canceller);
      return e.defaultPrevented;
    }, CANVAS);
    record.returnValue = { cancelledKeyWasSwallowed: cancelled };
    check('a Script setting returnValue = 0 still swallows the key', cancelled === true, cancelled);

    /* ---- 3. D, tapped ---------------------------------------------------- */
    /* The isolation and returnValue probes above each dispatched a real
     * keydown 68, and the Script fires on the tick after it is handed the
     * event. Let those land before anything is counted. */
    await page.waitForTimeout(2000);
    await reset(page);
    const beforeD = await state(page);
    await tap(page, 'd');
    const afterD = await state(page);
    const dEvents = (await probe(page)).snaps;
    record.dTap = { before: beforeD, after: afterD, events: dEvents };
    check('a tapped D delivers keydown then keyup',
      dEvents.length === 2 && dEvents[0].type === 'keydown' && dEvents[1].type === 'keyup'
      && dEvents[0].keyCode === 68 && dEvents[1].keyCode === 68,
      dEvents);
    check('a tapped D fires the weapon exactly once',
      afterD.held === beforeD.held - 1,
      { weapon: beforeD.type, before: beforeD.held, after: afterD.held });

    /* ---- 4. W, tapped ---------------------------------------------------- */
    await reset(page);
    const beforeW = await state(page);
    await tap(page, 'w');
    const afterW = await state(page);
    const wEvents = (await probe(page)).snaps;
    record.wTap = { weaponBefore: beforeW.type, weaponAfter: afterW.type, events: wEvents };
    check('a tapped W delivers keydown then keyup',
      wEvents.length === 2 && wEvents[0].type === 'keydown' && wEvents[1].type === 'keyup'
      && wEvents[0].keyCode === 87 && wEvents[1].keyCode === 87,
      wEvents);
    check('a tapped W changes the weapon exactly once: beamer to repulsor',
      beforeW.type === 'beamer' && afterW.type === 'repulsor',
      { before: beforeW.type, after: afterW.type });

    /* ---- 5. A, tapped ---------------------------------------------------- */
    await reset(page);
    await tap(page, 'a');
    const aProbe = await probe(page);
    const afterA = await state(page);
    record.aTap = { events: aProbe.snaps, navigationModes: aProbe.nav, viewer: afterA.viewer };
    check('a tapped A delivers keydown then keyup',
      aProbe.snaps.length === 2 && aProbe.snaps[0].type === 'keydown'
      && aProbe.snaps[1].type === 'keyup' && aProbe.snaps[0].keyCode === 65,
      aProbe.snaps);
    check('a tapped A asks for PAN on the keydown and WALK on the keyup, in that order',
      aProbe.nav.join(',') === 'PAN,WALK', aProbe.nav);
    check('the world is left in WALK after a tapped A', afterA.viewer === 'WALK', afterA.viewer);

    /* ---- 6. text entry keeps the keyboard -------------------------------- */
    await reset(page);
    const beforeType = await state(page);
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.id = 'ctrFocusProbe';
      document.body.appendChild(i);
      i.focus();
    });
    await page.keyboard.type('dwa');
    await page.waitForTimeout(1200);
    const typedEvents = (await probe(page)).snaps;
    const afterType = await state(page);
    await page.evaluate(() => { const i = document.getElementById('ctrFocusProbe'); if (i) i.remove(); });
    record.textInput = { events: typedEvents.length, before: beforeType, after: afterType };
    check('typing in a text field delivers no browser event to the world',
      typedEvents.length === 0, typedEvents.length);
    check('typing "dwa" in a text field changes no weapon and spends no ammunition',
      afterType.type === beforeType.type && afterType.held === beforeType.held,
      { weapon: afterType.type, ammo: afterType.held });

    /* ---- 7. clicking the 3D screen gives the keyboard back ---------------- */
    await reset(page);
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.id = 'ctrFocusProbe2';
      document.body.appendChild(i);
      i.focus();
    });
    const canvasEl = await page.$(CANVAS);
    await canvasEl.click({ position: { x: 40, y: 40 } });
    await page.waitForTimeout(400);
    const focused = await page.evaluate(sel => {
      const ok = document.activeElement === document.querySelector(sel);
      const i = document.getElementById('ctrFocusProbe2');
      if (i) i.remove();
      return ok;
    }, CANVAS);
    await reset(page);
    const beforeReturn = await state(page);
    await page.keyboard.press('d');
    await page.waitForTimeout(1500);
    const afterReturn = await state(page);
    const returnEvents = (await probe(page)).snaps;
    record.canvasFocus = { focused, events: returnEvents.length, before: beforeReturn, after: afterReturn };
    check('clicking the 3D screen gives the keyboard back to the world', focused === true, focused);
    check('gameplay control returns after the click: D delivers and fires again',
      returnEvents.length === 2 && afterReturn.held === beforeReturn.held - 1,
      { events: returnEvents.map(e => e.type), weapon: beforeReturn.type,
        before: beforeReturn.held, after: afterReturn.held });

    /* ---- 8. retention: a hundred events -------------------------------- */
    await focusCanvas(page);
    await reset(page);
    const poolBefore = await pool(page);
    const sent = await page.evaluate(async sel => {
      const c = document.querySelector(sel);
      const frame = () => new Promise(r => requestAnimationFrame(() => r()));
      const expected = [];
      for (let i = 0; i < 100; i += 1) {
        const type = i % 2 === 0 ? 'keydown' : 'keyup';
        const code = 65 + (i % 26);
        const e = new KeyboardEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'keyCode', { get: () => code });
        c.dispatchEvent(e);
        expected.push({ type, keyCode: code });
        /* Two at a time, as a tapped key produces them, then a frame. */
        if (i % 2 === 1) await frame();
      }
      return expected;
    }, CANVAS);
    /* Paced delivery means a hundred events take a hundred pairs of frames.
     * Wait for the queue itself to say it is done rather than guessing. */
    for (let i = 0; i < 120 && !(await queueIdle(page)); i += 1) await page.waitForTimeout(500);
    await page.waitForTimeout(1000);

    const got = (await probe(page)).snaps;
    const shared = await adjacentSharedNodes(page);
    const poolAfter = await pool(page);
    const routesAfter = await routeCount(page);
    const listenersAfter = await canvasListeners(page);

    const orderOk = got.length === sent.length
      && sent.every((e, i) => got[i].type === e.type && got[i].keyCode === e.keyCode);

    record.retention = {
      sent: sent.length, delivered: got.length, orderOk, adjacentSharedNodes: shared,
      poolBefore, poolAfter, routesBefore, routesAfter,
      listenersBefore, listenersAfter,
    };
    check('a hundred events are all delivered, in order, with their own values',
      orderOk, { sent: sent.length, delivered: got.length,
        firstWrong: sent.findIndex((e, i) => !got[i] || got[i].keyCode !== e.keyCode) });
    check('no two events in a row shared an event node', shared === 0, shared);
    /* 256 is the patch's own ceiling. A hundred events dispatched two to a
     * frame outrun paced delivery and so build a real queue - that is the
     * point of the flood - but the pool stops well short of the cap and every
     * node it built comes back to it, which is what "no retained growth"
     * means here. */
    check('the event node pool stays bounded across a hundred events',
      poolAfter && poolAfter.nodes <= 256, poolAfter);
    check('every event node built for the hundred is idle again afterwards',
      poolAfter && poolAfter.free === poolAfter.nodes, poolAfter);
    check('a hundred events create no browser event ROUTE',
      routesAfter === routesBefore, { before: routesBefore, after: routesAfter });
    check('a hundred events create no DOM listener',
      listenersAfter.total === listenersBefore.total,
      { before: listenersBefore, after: listenersAfter });

    /* ---- 9. the probe leaves nothing behind ----------------------------- */
    const routesClean = await removeProbe(page);
    record.routesAfterProbeRemoved = routesClean;
    check('removing the probe leaves the world its single browser event route',
      routesClean === 1, routesClean);

    await page.screenshot({ path: path.join(OUT_DIR, 'outlands-events.png') });
  } finally {
    if (page) {
      try { await page.screenshot({ path: path.join(OUT_DIR, 'final.png') }); } catch (e) { /* gone */ }
    }
    await browser.close();
  }
}

main().then(() => {
  const failed = results.filter(r => !r.pass);
  const summary = {
    gate: 'CTR_BLAXXUN_BROWSER_EVENT_DELIVERY',
    at: new Date().toISOString(),
    passed: results.length - failed.length,
    total: results.length,
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    results,
    record,
    console: consoleLog,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'browser-events.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(`\n${summary.verdict}  ${summary.passed}/${summary.total}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}).catch(err => {
  process.stderr.write(`\nERROR ${err && err.stack ? err.stack : err}\n`);
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'browser-events.json'),
      JSON.stringify({ gate: 'CTR_BLAXXUN_BROWSER_EVENT_DELIVERY', verdict: 'ERROR', error: String(err && err.message || err), results, record, console: consoleLog }, null, 2));
  } catch (e) { /* nothing more to say */ }
  process.exit(2);
});
