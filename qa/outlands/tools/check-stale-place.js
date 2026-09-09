'use strict';

/*
 * CTR_BETA_STALE_PLACE
 *
 * One property: a navigation that vue-router cancelled may not write
 * `appStore.data.place`.
 *
 * The proven failure is a no-wait Plaza/Outlands pair driven from a SECOND tab of
 * one member. The return to Outlands is the route the page is already on, so
 * vue-router refuses it as redundant - which cancels the Plaza navigation and runs
 * no guard for the return. The Plaza fetch then resolved into a store whose route,
 * socket room and loaded world were all Outlands.
 *
 * Everything that then broke is downstream of that one write, so this gate reads the
 * store first and the symptoms second:
 *
 *   store        appStore.data.place is Outlands, and names the room the socket is in
 *   name         Browser.myAvatarName is this presence's key, not the username
 *   url          Browser.myAvatarURL is the historical cybertown.com address
 *   anti-cheat   ne_game.wrl's own avatar-swap line does not fire while nobody shoots
 *   beam-out     a real Beamer hit still names this presence and still lands
 *
 * Nothing in the world file or in the Beamer is touched by the fix, so the last two
 * are here as the end-to-end consequence, not as the thing being fixed.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   DISPLAY=:1 node qa/outlands/tools/check-stale-place.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace, URL: BASE } = require('../../phase2/lib/beta-client');
const O = require('../lib/outlands-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2]
  || path.join(REPO, '..', '..', '..', 'artifacts', 'outlands-stale-place');

const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const SHOOTER = {
  user: process.env.CTR_QA_USER2 || 'outlandsqa2',
  pass: process.env.CTR_QA_PASS2 || 'testqa',
};

/* The address ne_game.wrl's set_team() compares against. */
const HISTORICAL_AVATAR = 'http://www.cybertown.com/places/ne_game/vrml/avatars/';

/* How long to watch for a beam-out nobody caused. The diagnostic saw 147 of them
 * in about two minutes, so a minute with none is a clear answer. */
const ANTICHEAT_WATCH_MS = Number(process.env.CTR_ANTICHEAT_WATCH_MS || 60000);

let openBrowser = null;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${
    detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/* The store, the room and the world, read together so they can be compared. */
const placeState = page => page.evaluate(() => {
  const app = document.querySelector('#app').__vue__;
  const find = c => {
    if (c.remoteMembers !== undefined) return c;
    for (const k of c.$children) { const r = find(k); if (r) return r; }
    return null;
  };
  const view = find(app);
  const place = app.$store.data.place || {};
  const canvas = document.querySelector('#world x3d-canvas');
  let worldURL = null;
  try {
    const b = canvas ? X3D.getBrowser(canvas) : null;
    worldURL = b && b.currentScene && b.currentScene.worldURL;
  } catch (e) { /* being replaced */ }
  return {
    placeSlug: place.slug || null,
    placeName: place.name || null,
    placeId: place.id === undefined ? null : place.id,
    routeHash: window.location.hash,
    socketRoom: view && view.$socket ? view.$socket.currentRoom : null,
    presenceKey: view && view.$socket
      ? `${app.$store.data.user.id}:${view.$socket.presenceId}` : null,
    username: app.$store.data.user.username || null,
    worldURL,
    canvases: document.querySelectorAll('#world x3d-canvas').length,
  };
});

/* Watch the world's own beam-out flag with nobody shooting at it. */
async function watchAntiCheat(page, ms) {
  const started = Date.now();
  let triggers = 0;
  let maxY = -Infinity;
  let previous = false;
  let samples = 0;
  while (Date.now() - started < ms) {
    let s = null;
    try { s = await O.state(page); } catch (e) { /* world mid-swap */ }
    if (s) {
      samples += 1;
      if (s.isBeamed && !previous) triggers += 1;
      previous = s.isBeamed;
      if (s.camera[1] > maxY) maxY = s.camera[1];
    }
    await page.waitForTimeout(2000);
  }
  return { triggers, maxY: maxY === -Infinity ? null : Number(maxY.toFixed(2)), samples };
}

/** Both halves of the identity a stale place used to break, plus the store behind them. */
async function identity(page) {
  const place = await placeState(page);
  const world = await O.state(page);
  return {
    place,
    myAvatarName: world.myAvatarName,
    myAvatarURL: world.myAvatarURL,
    team: world.team,
    isBeamed: world.isBeamed,
  };
}

function assertIdentity(label, snap) {
  check(`${label}: the store holds Outlands`, snap.place.placeSlug === 'outlands', {
    slug: snap.place.placeSlug, name: snap.place.placeName, hash: snap.place.routeHash,
  });
  check(`${label}: the store names the room the socket is in`,
    snap.place.placeId !== null && String(snap.place.placeId) === String(snap.place.socketRoom),
    { place: snap.place.placeId, room: snap.place.socketRoom });
  check(`${label}: the loaded world is ne_game.wrl`,
    String(snap.place.worldURL).indexOf('ne_game.wrl') > -1, snap.place.worldURL);
  check(`${label}: Browser.myAvatarName is this presence's key`,
    snap.myAvatarName === snap.place.presenceKey,
    { got: snap.myAvatarName, want: snap.place.presenceKey, username: snap.place.username });
  check(`${label}: Browser.myAvatarName is NOT the username`,
    snap.myAvatarName !== snap.place.username, snap.myAvatarName);
  check(`${label}: Browser.myAvatarURL is the historical address`,
    String(snap.myAvatarURL).indexOf(HISTORICAL_AVATAR) === 0, snap.myAvatarURL);
  check(`${label}: no Plaza-derived avatar URL`,
    String(snap.myAvatarURL).indexOf('/assets/avatars/') === -1, snap.myAvatarURL);
}

/* Two SEPARATE navigations with no settling time. Setting the hash twice inside one
 * task is a no-op - the second value is the one the page already had - so the pair
 * has to reach the router twice or the gate measures nothing. */
const fastPair = page => page.evaluate(() => new Promise(resolve => {
  window.location.hash = '#/place/enter';
  requestAnimationFrame(() => {
    window.location.hash = '#/place/outlands';
    resolve();
  });
}));

/** Puts the tab back in the battle, whichever of the two screens the burst left it on. */
async function backIntoBattle(page, side) {
  const entrance = await O.entranceState(page);
  if (entrance.shown) {
    await O.enterOutlandsThroughEntrance(page, side);
  } else {
    await O.waitForBattleTeam(page);
  }
  await page.waitForTimeout(6000);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const record = {};
  const browser = await launch();
  openBrowser = browser;
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);

  /* ---- THE SECOND-TAB SETUP -------------------------------------------- */
  /* One member, two tabs. The diagnostic proved the failure needs BOTH the rapid
   * navigation and the second tab, so both are here. */
  const ctxA = await browser.newContext();
  const tabA = await login(ctxA, USER, PASS);
  await O.wearOrdinaryAvatar(tabA);
  await O.enterOutlandsThroughEntrance(tabA, 'redm');

  /* No entrance for this tab: the account is already wearing the side tab A chose,
   * so the second presence walks straight in. One member, one avatar, two tabs -
   * which is half of what the failure needed. */
  /* Opened straight onto Outlands, never by way of the Plaza: the two tabs share
   * one account, and a Plaza join hands the ordinary avatar back - which would
   * strip the side off the tab already standing in the battle zone. */
  const tabB = await ctxA.newPage();
  await tabB.goto(`${BASE}/#/place/outlands`, { waitUntil: 'networkidle', timeout: 60000 });
  await tabB.waitForFunction(() => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue__;
    return !!(app && app.$store.data.isUser);
  }, undefined, { timeout: 60000 });
  await enterPlace(tabB, '#/place/outlands', 'ne_game.wrl');
  await O.waitForBattleTeam(tabB);
  await tabB.waitForTimeout(8000);

  const ctxS = await browser.newContext();
  const shooter = await login(ctxS, SHOOTER.user, SHOOTER.pass);
  await O.wearOrdinaryAvatar(shooter);
  await O.enterOutlandsThroughEntrance(shooter, 'bluem');

  const settled = await identity(tabB);
  record.settled = settled;
  assertIdentity('settled', settled);
  check('the two tabs are two presences',
    (await O.presenceView(tabA)).self !== settled.place.presenceKey,
    { a: (await O.presenceView(tabA)).self, b: settled.place.presenceKey });

  /* ---- ONE FAST PLAZA/OUTLANDS PAIR ------------------------------------ */
  await fastPair(tabB);
  await tabB.waitForTimeout(25000);
  const afterPairPlace = await placeState(tabB);
  record.afterPair = afterPairPlace;
  /* The pair may settle on the entrance or in the world - that race is the
   * product's, not this gate's. What may never happen is the store naming a place
   * this tab is not in. */
  check('one fast pair: the store never holds The Plaza',
    afterPairPlace.placeSlug === 'outlands',
    { slug: afterPairPlace.placeSlug, name: afterPairPlace.placeName,
      hash: afterPairPlace.routeHash, world: afterPairPlace.worldURL });
  check('one fast pair: the store still names the socket room',
    String(afterPairPlace.placeId) === String(afterPairPlace.socketRoom),
    { place: afterPairPlace.placeId, room: afterPairPlace.socketRoom });

  await backIntoBattle(tabB, 'redm');
  const afterPair = await identity(tabB);
  record.afterPairIdentity = afterPair;
  assertIdentity('after one fast pair', afterPair);

  /* ---- SEVEN RAPID NAVIGATIONS ----------------------------------------- */
  for (let i = 0; i < 3; i += 1) {
    await fastPair(tabB);
    await tabB.waitForTimeout(1500);
  }
  await tabB.evaluate(() => { window.location.hash = '#/place/outlands'; });
  await tabB.waitForTimeout(25000);
  const afterSevenPlace = await placeState(tabB);
  record.afterSeven = afterSevenPlace;
  check('seven navigations: the store never holds The Plaza',
    afterSevenPlace.placeSlug === 'outlands',
    { slug: afterSevenPlace.placeSlug, name: afterSevenPlace.placeName,
      hash: afterSevenPlace.routeHash, world: afterSevenPlace.worldURL });
  check('seven navigations: one canvas', afterSevenPlace.canvases === 1,
    afterSevenPlace.canvases);

  await backIntoBattle(tabB, 'redm');
  const afterSeven = await identity(tabB);
  record.afterSevenIdentity = afterSeven;
  assertIdentity('after seven navigations', afterSeven);

  /* ---- THE ANTI-CHEAT LINE MUST STAY QUIET ----------------------------- */
  /* `if (Browser.myAvatarURL != avatar && avatar != '') { beamOut_changed = t; }`
   * is the world's own line. With a stale place it fired on every tick. Nobody
   * shoots during this window, so any trigger at all is that line. */
  const quiet = await watchAntiCheat(tabB, ANTICHEAT_WATCH_MS);
  record.antiCheat = quiet;
  check('no beam-out fires while nobody is shooting', quiet.triggers === 0, quiet);
  check('the camera was never flung out of the world',
    quiet.maxY !== null && quiet.maxY < 100, quiet.maxY);

  /* ---- A REAL HIT STILL LANDS ------------------------------------------ */
  const spawns = O.spawnPoints(REPO);
  const target = await O.presenceView(tabB);
  await O.stand(tabA, [spawns[1][1][0], spawns[1][1][1], spawns[1][1][2]], [0, 1, 0, 0]);
  await tabA.waitForTimeout(3000);
  await O.selectWeapon(shooter, 'beamer');

  let aim = null;
  for (let attempt = 0; attempt < 3 && !(aim && aim.nicknames.indexOf(target.self) > -1);
    attempt += 1) {
    await O.stand(tabB, [spawns[1][0][0], spawns[1][0][1], spawns[1][0][2] - 13],
      [0, 1, 0, Math.PI]);
    await tabB.waitForTimeout(5000);
    const at = await O.camera(tabB);
    await O.stand(shooter, [at[0], at[1], at[2] + 12], [0, 1, 0, 0]);
    await shooter.waitForTimeout(5000);
    for (const drop of [0.4, 0, 0.8, 0.2]) {
      await O.aimAt(shooter, await O.camera(tabB), drop);
      await shooter.waitForTimeout(1500);
      aim = await O.fireRay(shooter);
      if (aim && aim.nicknames.indexOf(target.self) > -1) break;
    }
  }
  check('the ray names the navigated tab, and only it',
    !!aim && aim.nicknames.length === 1 && aim.nicknames[0] === target.self,
    { found: aim && aim.nicknames, want: target.self });

  await O.tapMessages(tabB);
  const beforeShot = await identity(tabB);
  record.beforeShot = beforeShot;
  check('immediately before the shot the store is still Outlands',
    beforeShot.place.placeSlug === 'outlands', beforeShot.place.placeSlug);
  check('immediately before the shot the wire identity matches myAvatarName',
    beforeShot.myAvatarName === target.self,
    { name: beforeShot.myAvatarName, wire: target.self });

  await O.press(shooter, 'd');
  await tabB.waitForTimeout(2500);
  const shot = await O.state(tabB);
  record.shot = { isBeamed: shot.isBeamed, messages: await O.messages(tabB) };
  check('the navigated tab is beamed out by a real hit', shot.isBeamed, shot.isBeamed);
  const untouched = await O.state(tabA);
  check('the other tab of the same member is untouched', !untouched.isBeamed,
    untouched.isBeamed);

  /* ---- LEAVING STILL WORKS --------------------------------------------- */
  await enterPlace(tabB, '#/place/enter', 'enter.wrl');
  await tabB.waitForTimeout(3000);
  const left = await placeState(tabB);
  record.left = left;
  check('leaving writes the place actually landed in', left.placeSlug === 'enter',
    { slug: left.placeSlug, world: left.worldURL });

  fs.writeFileSync(path.join(OUT_DIR, 'stale-place.json'),
    `${JSON.stringify({ results, record }, null, 1)}\n`);
  await browser.close();

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(async e => {
  process.stdout.write(`FATAL ${e && e.stack ? e.stack : e}\n`);
  if (openBrowser) { try { await openBrowser.close(); } catch (x) { /* already gone */ } }
  process.exit(1);
});
