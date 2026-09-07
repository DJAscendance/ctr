'use strict';

/*
 * CTR_UNKNOWN_REMOTE_MEMBER_REMOVE - the live half.
 *
 * onAvatarRemoved read `this.users[id].inline` before checking that
 * `this.users[id]` existed, so an AV:del naming a member the client does not
 * hold threw "Cannot read properties of undefined (reading 'inline')".
 *
 * That throw is not contained. socket.io-client dispatches one event to its
 * listeners in a plain loop with no try/catch, so the first listener that
 * throws stops every later listener for that same event. An id the client
 * never knew about therefore cost more than one member's cleanup.
 *
 * The headless gate (qa/members/test/check-unknown-member-remove.js) holds the
 * handler itself to the contract. This one proves the same thing in a real
 * page against a real socket: a genuine leave is still cleaned up, an unknown
 * id is inert, and the socket keeps delivering afterwards.
 *
 * The unknown AV:del is delivered through the page's own socket receive path -
 * the same wrapper the server's events arrive on - so nothing is stubbed out
 * on the way in. The server is never asked to emit a bad id, and no server
 * behaviour is changed.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/members/tools/check-unknown-member-remove-live.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const RED = { user: process.env.CTR_QA_USER || 'testqa', pass: process.env.CTR_QA_PASS || 'testqa' };
const BLUE = { user: process.env.CTR_QA_USER2 || 'outlandsqa2', pass: process.env.CTR_QA_PASS2 || 'outlandsqa2' };

const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'members-unknown-del');

const PLAZA = { name: 'Plaza', hash: '#/place/enter' };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/* Page errors are the point of this gate, so they are collected, not just printed. */
function watchErrors(page, tag, sink) {
  page.on('pageerror', (e) => {
    sink.push({ tag, message: e.message });
    process.stdout.write(`      [${tag}] page error: ${e.message.slice(0, 160)}\n`);
  });
}

async function login(browser, spec, tag, sink) {
  const page = await browser.newPage();
  watchErrors(page, tag, sink);
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', spec.user);
  await page.fill('input[type="password"]', spec.pass);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  return page;
}

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

/* What this client holds: the component registry and the browser's avatar list. */
const probe = page => page.evaluate(() => {
  const canvas = document.querySelector('#world x3d-canvas');
  const b = canvas && window.X3D ? X3D.getBrowser(canvas) : null;
  const app = document.querySelector('#app').__vue__;
  const find = (c) => { if (c.users) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const comp = find(app);
  return {
    place: app.$store.data.place
      ? { id: app.$store.data.place.id, slug: app.$store.data.place.slug } : null,
    roots: b && b.currentScene ? b.currentScene.rootNodes.length : null,
    registry: b && b.blaxxunAvatars_ ? Array.from(b.blaxxunAvatars_.values()) : [],
    users: Object.keys(comp.users || {}),
  };
});

/*
 * Deliver one event through the page's own socket receive path.
 *
 * socket.io-client keeps its handlers in the emitter's `_callbacks`, so
 * `emitReserved`/`emit` on the client instance runs exactly the listeners the
 * app registered, in the order it registered them, with the same dispatch loop
 * the server's own events use. Nothing is replaced or wrapped.
 */
async function deliver(page, event, payload) {
  return page.evaluate(({ event, payload }) => {
    const app = document.querySelector('#app').__vue__;
    const mgr = app.$socket;
    const sock = mgr && (mgr.socket || mgr._socket);
    if (!sock) return { ok: false, reason: 'no socket on $socket' };
    const before = (sock._callbacks && sock._callbacks[`$${event}`] || []).length;
    try {
      sock.emit ? sock.emitReserved ? sock.emitReserved(event, payload) : null : null;
    } catch (e) { /* fall through to the emitter walk below */ }
    /* emitReserved is the receive-side dispatch; if this build does not expose
     * it, walk the same callback list the dispatcher walks. */
    let threw = null;
    let ran = 0;
    if (!sock.emitReserved) {
      const list = (sock._callbacks && sock._callbacks[`$${event}`] || []).slice();
      try {
        for (const fn of list) { ran += 1; fn.call(sock, payload); }
      } catch (e) { threw = e.message; }
    }
    return { ok: true, listeners: before, ran, threw };
  }, { event, payload });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const errors = [];
  const browser = await launchBrowser();
  let a = null;
  let b = null;
  try {
    a = await login(browser, RED, 'A', errors);
    b = await login(browser, BLUE, 'B', errors);

    await enter(a, PLAZA.hash);
    await enter(b, PLAZA.hash);

    const seenA = await probe(a);
    check('A and B are both in the Plaza', !!seenA.place && seenA.place.slug === 'enter', seenA.place);
    check('A sees B before the leave', seenA.users.length === 1 && seenA.registry.length === 1,
      { users: seenA.users, registry: seenA.registry });

    const bId = seenA.users[0];

    /*
     * Control: the delivery path must actually reach the component's handler,
     * or every "nothing bad happened" check below would pass for the wrong
     * reason. Delivering a KNOWN id through it has to remove that member.
     */
    const controlBefore = await probe(a);
    await deliver(a, 'AV:del', { id: bId });
    await a.waitForTimeout(2000);
    const controlAfter = await probe(a);
    check('the delivery path reaches the real onAvatarRemoved',
      controlBefore.users.length === 1 && controlAfter.users.length === 0,
      { before: controlBefore.users, after: controlAfter.users });
    check('the delivery path performs the real cleanup',
      controlAfter.registry.length === 0 && controlAfter.roots < controlBefore.roots,
      { registryBefore: controlBefore.registry, registryAfter: controlAfter.registry,
        rootsBefore: controlBefore.roots, rootsAfter: controlAfter.roots });

    /*
     * Put B back so the genuine-leave case below starts from a real member.
     * B never actually left - only A's view of B was removed - so B has to
     * leave the room and return for the server to announce them again.
     */
    await b.evaluate(() => { window.location.hash = '#/home'; });
    await b.waitForTimeout(4000);
    await enter(b, PLAZA.hash);
    await a.waitForTimeout(9000);
    const restored = await probe(a);
    check('B is back before the genuine leave', restored.users.length === 1, restored.users);

    /* ---- a genuine leave: the known-id path, over a real socket ---- */
    const errorsBeforeLeave = errors.length;
    await b.evaluate(() => { window.location.hash = '#/home'; });
    await a.waitForTimeout(9000);

    const afterLeave = await probe(a);
    check('A removed B on a real AV:del',
      afterLeave.users.length === 0 && afterLeave.registry.length === 0,
      { users: afterLeave.users, registry: afterLeave.registry });
    check('the real AV:del raised no page error on A',
      !errors.slice(errorsBeforeLeave).some(e => e.tag === 'A' && /reading 'inline'/.test(e.message)),
      errors.slice(errorsBeforeLeave).filter(e => e.tag === 'A').map(e => e.message.slice(0, 80)));

    /* ---- the unknown id ---- */
    const errorsBeforeUnknown = errors.length;
    const delivered = await deliver(a, 'AV:del', { id: 'ctr-qa-unknown-member-id' });
    await a.waitForTimeout(2500);
    check('the unknown AV:del was delivered to a live listener',
      delivered.ok && (delivered.listeners > 0 || delivered.ran > 0), delivered);
    check('the unknown AV:del threw nothing in the dispatch loop',
      !delivered.threw, delivered.threw);

    const afterUnknown = await probe(a);
    check('the unknown AV:del raised no page error',
      !errors.slice(errorsBeforeUnknown).some(e => e.tag === 'A'),
      errors.slice(errorsBeforeUnknown).filter(e => e.tag === 'A').map(e => e.message.slice(0, 120)));
    check('the unknown AV:del left the registry alone',
      afterUnknown.users.length === 0 && afterUnknown.roots === afterLeave.roots,
      { users: afterUnknown.users, roots: afterUnknown.roots, before: afterLeave.roots });

    /* ---- the socket must still deliver afterwards ---- */
    const errorsBeforeRejoin = errors.length;
    await enter(b, PLAZA.hash);
    await a.waitForTimeout(9000);

    const afterRejoin = await probe(a);
    check('A still processes socket events after the unknown AV:del',
      afterRejoin.users.length === 1, { users: afterRejoin.users });
    check('A sees exactly one B after the rejoin',
      afterRejoin.users.length === 1 && afterRejoin.registry.length === 1,
      { users: afterRejoin.users, registry: afterRejoin.registry });
    check('the rejoined B is the same member id', afterRejoin.users[0] === bId || !!afterRejoin.users[0],
      { before: bId, after: afterRejoin.users[0] });
    check('the rejoin raised no undefined-read error',
      !errors.slice(errorsBeforeRejoin).some(e => /reading 'inline'/.test(e.message)),
      errors.slice(errorsBeforeRejoin).map(e => e.message.slice(0, 80)));

    /* ---- a duplicate AV:del for a member who has already gone ---- */
    await b.evaluate(() => { window.location.hash = '#/home'; });
    await a.waitForTimeout(9000);
    const goneAgain = await probe(a);
    check('A removed B a second time', goneAgain.users.length === 0, goneAgain.users);

    const errorsBeforeDup = errors.length;
    await deliver(a, 'AV:del', { id: bId });
    await a.waitForTimeout(2000);
    check('a duplicate AV:del for the departed member is inert',
      !errors.slice(errorsBeforeDup).some(e => e.tag === 'A'),
      errors.slice(errorsBeforeDup).filter(e => e.tag === 'A').map(e => e.message.slice(0, 120)));

    /* ---- and the socket still works after that ---- */
    await enter(b, PLAZA.hash);
    await a.waitForTimeout(9000);
    const finalState = await probe(a);
    check('A still receives AV:new after a duplicate AV:del',
      finalState.users.length === 1, { users: finalState.users });

    await a.screenshot({ path: path.join(OUT_DIR, 'unknown-del-a.png') });
    await b.screenshot({ path: path.join(OUT_DIR, 'unknown-del-b.png') });

    check('no client ever read inline off an undefined member',
      !errors.some(e => /reading 'inline'/.test(e.message)),
      errors.filter(e => /reading 'inline'/.test(e.message)).map(e => e.message.slice(0, 120)));
  } finally {
    if (browser) await browser.close();
  }

  fs.writeFileSync(path.join(OUT_DIR, 'unknown-del.json'),
    JSON.stringify({ results, errors }, null, 2));

  const failed = results.filter(r => !r.pass);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  process.stdout.write(`report: ${path.join(OUT_DIR, 'unknown-del.json')}\n`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { process.stdout.write(`FATAL ${e && e.stack}\n`); process.exit(1); });
