'use strict';

/*
 * CTR_OUTLANDS_SHARED_EVENT_LOOKUP
 *
 * One property, proved live: a Script can find a named SharedEvent inside a
 * BlaxxunZone the way blaxxun Contact let it, and the node it gets back is the
 * real event rather than a fallback.
 *
 * ne_game.wrl's turret Script does this, once per turret:
 *
 *   lockName = new SFString('turret_lock_' + id);
 *   for (i = 0; i < shared.events.length; i++)
 *     if (shared.events[i].getName() == lockName) { lock = shared.events[i]; }
 *   Browser.addRoute(self, 'lock_turret', lock, 'set_string');
 *
 * Contact answered getName() with the node's DEF name. X_ITE answers with the
 * *field's* name, which is empty for an MFNode element, so the loop matched
 * nothing, `lock` kept its declared `Group {}` default and the route failed
 * with "Bad ROUTE specification". bxx_node_name.js restores the Contact
 * answer for anonymous SFNodes only.
 *
 * The lookup is run here exactly as the world runs it - same SFString
 * comparison, same `shared.events[i]` path through MFNode's proxy - so the
 * test fails if the compatibility layer is removed, and not merely if some
 * other reader of the scene changes.
 *
 * The DEF name is the key, not the SharedEvent's `name` field: ne_game.wrl
 * DEFs `turret_lock_0` but names it "turretlock_0". Both are asserted, so a
 * future "fix" that normalises one to the other is caught.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/outlands/test/check-shared-event-lookup.js [outDir]
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
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'shared-event-lookup');

/* The zone, and the two events the first turret asks it for. */
const ZONE = 'SharedZone';
const TURRET = 0;
const LOCK_DEF = `turret_lock_${TURRET}`;
const MOTION_DEF = `turret_motion_${TURRET}`;
/* The `name` field values, which are deliberately not the DEF names. */
const LOCK_NAME_FIELD = `turretlock_${TURRET}`;
/* A DEF no SharedEvent carries, for the negative lookup. */
const ABSENT_DEF = 'turret_lock_99';

const results = [];
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
 * Everything below runs in the page, because the lookup is only meaningful
 * against live field objects. It returns readings, not verdicts; the verdicts
 * are asserted here so a failure names the property rather than a line of
 * injected source.
 */
const probe = (page, args) => page.evaluate(a => {
  const out = { errors: [] };
  const fail = (where, e) => { out.errors.push(`${where}: ${e.message}`); };

  const browser = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const scene = browser.currentScene;
  const zone = scene.getNamedNode(a.zone);

  out.zoneType = zone.getNodeTypeName();
  out.eventCount = zone.events.length;

  /* The world's own lookup, run verbatim. SFString comes from
   * allow_sf_string.js, the same object the Script sandbox sees. */
  const lookup = defName => {
    const wanted = new SFString(defName);
    const hits = [];
    for (let i = 0; i < zone.events.length; i += 1) {
      if (zone.events[i].getName() == wanted) hits.push(zone.events[i]);
    }
    return hits;
  };

  const describe = node => {
    const d = {};
    try { d.getName = node.getName(); } catch (e) { d.getName = null; }
    try { d.getNodeName = node.getNodeName(); } catch (e) { d.getNodeName = null; }
    try { d.type = node.getNodeTypeName(); } catch (e) { d.type = null; }
    try { d.nameField = String(node.name); } catch (e) { d.nameField = null; }
    try {
      const f = node.getField('set_string');
      d.setStringType = f.getTypeName();
      d.setStringIsEventIn = f.getAccessType() === X3D.X3DConstants.inputOnly;
    } catch (e) { d.setStringType = null; d.setStringIsEventIn = null; }
    return d;
  };

  try {
    const lockHits = lookup(a.lockDef);
    out.lockHitCount = lockHits.length;
    out.lock = lockHits.length ? describe(lockHits[0]) : null;
    /* Identity: the looked-up node must be the DEF'd node itself. */
    if (lockHits.length) {
      const named = scene.getNamedNode(a.lockDef);
      out.lockIsNamedNode = lockHits[0].equals ? lockHits[0].equals(named) : (lockHits[0] === named);
    }
    out.motionHitCount = lookup(a.motionDef).length;
  } catch (e) { fail('lookup', e); }

  try {
    const absent = lookup(a.absentDef);
    out.absentHitCount = absent.length;
    /* Historical failure behaviour: the Script's variable is untouched, so a
     * caller that started from the declared Group default still holds it. */
    let fallback = null;
    for (let i = 0; i < zone.events.length; i += 1) {
      if (zone.events[i].getName() == new SFString(a.absentDef)) fallback = zone.events[i];
    }
    out.absentFallback = fallback === null;
  } catch (e) { fail('negative', e); }

  /* Every event answers its own DEF name, and nothing answers "". */
  try {
    const names = [];
    for (let i = 0; i < zone.events.length; i += 1) {
      const e = zone.events[i];
      names.push({ getName: e.getName(), getNodeName: e.getNodeName() });
    }
    out.names = names;
    out.namesAgree = names.every(n => n.getName === n.getNodeName && n.getName.length > 0);
  } catch (e) { fail('names', e); }

  /* A field that has a name of its own must keep it, or X_ITE loses the
   * Script sandbox bindings it builds from those names. */
  try {
    out.namedFieldName = zone.getField('events').getName();
    out.namedSFNodeFieldName = zone.getField('beamToViewpoint').getName();
  } catch (e) { fail('namedField', e); }

  /*
   * The real route shape: an SFString eventOut into lock.set_string, built
   * through the same Browser.addRoute the turret Script calls. The shim in
   * bxx_auth.js returns nothing for a node-to-node route, so the route object
   * is not the reading - the scene's own route count is, before and after.
   */
  try {
    const lock = scene.getNamedNode(a.lockDef);
    const source = scene.getNamedNode(a.motionDef);
    out.routesBefore = scene.routes.length;
    browser.addRoute(source, 'string_changed', lock, 'set_string');
    out.routesAfter = scene.routes.length;
    browser.deleteRoute(source, 'string_changed', lock, 'set_string');
    out.routesRemoved = scene.routes.length;
    out.routeThrew = false;
  } catch (e) { out.routeThrew = true; fail('route', e); }

  return out;
}, args);

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  let page;
  try {
    page = await open(browser);
    const r = await probe(page, {
      zone: ZONE,
      lockDef: LOCK_DEF,
      motionDef: MOTION_DEF,
      absentDef: ABSENT_DEF,
    });

    check('probe ran without error', r.errors.length === 0, r.errors);
    check('SharedZone is a BlaxxunZone', r.zoneType === 'BlaxxunZone', r.zoneType);
    check('zone carries its shared events', r.eventCount === 24, r.eventCount);

    /* Shared event identity */
    check('lookup returns exactly one node', r.lockHitCount === 1, r.lockHitCount);
    check('lookup returns the intended DEF', r.lock && r.lock.getNodeName === LOCK_DEF, r.lock && r.lock.getNodeName);
    check('lookup returns the DEF node itself', r.lockIsNamedNode === true, r.lockIsNamedNode);
    check('looked-up node is a SharedEvent', r.lock && r.lock.type === 'SharedEvent', r.lock && r.lock.type);
    check('looked-up node is not the Group default', !!r.lock && r.lock.type !== 'Group', r.lock && r.lock.type);
    check('set_string exists on it', !!(r.lock && r.lock.setStringType), r.lock && r.lock.setStringType);
    check('set_string is an SFString', r.lock && r.lock.setStringType === 'SFString', r.lock && r.lock.setStringType);
    check('set_string is an eventIn', r.lock && r.lock.setStringIsEventIn === true, r.lock && r.lock.setStringIsEventIn);
    check('motion event resolves too', r.motionHitCount === 1, r.motionHitCount);

    /* getName contract - DEF name, not the `name` field */
    check('getName answers the DEF name', r.lock && r.lock.getName === LOCK_DEF, r.lock && r.lock.getName);
    check('getName is not the name field', r.lock && r.lock.getName !== LOCK_NAME_FIELD, r.lock && r.lock.nameField);
    check('name field left unchanged', r.lock && r.lock.nameField === LOCK_NAME_FIELD, r.lock && r.lock.nameField);
    check('every event answers its own DEF name', r.namesAgree === true, r.namesAgree);
    check('named field keeps its field name', r.namedFieldName === 'events', r.namedFieldName);
    check('named SFNode field keeps its field name', r.namedSFNodeFieldName === 'beamToViewpoint', r.namedSFNodeFieldName);

    /* Negative lookup */
    check('absent name matches nothing', r.absentHitCount === 0, r.absentHitCount);
    check('absent name returns no substitute node', r.absentFallback === true, r.absentFallback);

    /* Turret lock route */
    check('lock route is accepted without error', r.routeThrew === false, r.routeThrew);
    check('lock route is added to the scene', r.routesAfter === r.routesBefore + 1,
      { before: r.routesBefore, after: r.routesAfter });
    check('lock route is removed again', r.routesRemoved === r.routesBefore,
      { after: r.routesAfter, removed: r.routesRemoved });

    const badRoutes = consoleLog.filter(e => /Bad ROUTE/i.test(e.text));
    check('no Bad ROUTE errors during world load', badRoutes.length === 0, badRoutes.length);

    fs.writeFileSync(path.join(OUT_DIR, 'shared-event-lookup.json'),
      JSON.stringify({ results, readings: r, console: consoleLog }, null, 2));
    if (page) await page.screenshot({ path: path.join(OUT_DIR, 'outlands.png') });
  } finally {
    await browser.close();
  }

  const passed = results.filter(x => x.pass).length;
  process.stdout.write(`\n${passed}/${results.length} PASS\n`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
