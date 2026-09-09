'use strict';

/*
 * CTR_BETA_OUTLANDS_LIFECYCLE
 *
 * What happens around the battle rather than inside it: two presences of ONE
 * member, the room state they share, leaving, returning, rapid navigation, and
 * what the world gives back when it is replaced.
 *
 * The combat itself is qa/outlands/tools/check-freeplay.js. This gate exists
 * because the defects it looks for are invisible from a single tab: a ghost
 * citizen, a target binding into a scene that no longer exists, a gameplay
 * timer still running in the next world, or a shot that beams the wrong tab of
 * the same account.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   DISPLAY=:1 node qa/outlands/tools/check-lifecycle.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace, URL: BASE } = require('../../phase2/lib/beta-client');
const O = require('../lib/outlands-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2]
  || path.join(REPO, '..', '..', '..', 'artifacts', 'outlands-lifecycle');

const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const SHOOTER = { user: process.env.CTR_QA_USER2 || 'outlandsqa2', pass: process.env.CTR_QA_PASS2 || 'testqa' };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/* Everything the page is still holding onto, read from the live component. */
const retention = page => page.evaluate(() => {
  const app = document.querySelector('#app').__vue__;
  const find = c => { if (c.$options.name === 'WorldBrowserPage') return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const view = find(app);
  const canvas = document.querySelector('#world x3d-canvas');
  const b = canvas ? X3D.getBrowser(canvas) : null;
  let worldURL = null;
  try { worldURL = b && b.currentScene && b.currentScene.worldURL; } catch (e) { /* replaced */ }
  return {
    worldURL,
    canvases: document.querySelectorAll('#world x3d-canvas').length,
    renderedCitizens: Object.keys(view.users).length,
    remoteCitizens: view.remoteMembers ? view.remoteMembers.listRemoteMembers().length : null,
    boundNodes: view.remoteMembers
      ? view.remoteMembers.listRemoteMembers().filter(m => !!view.remoteMembers.getRemoteNode(m.key)).length
      : null,
    /* The browser-level state a blaxxun world claims in initialize(). */
    browserEventRoutes: b ? (b.browserEventRoutes_ || []).length : null,
    eventMask: b ? b.eventMask : null,
    blaxxunAvatars: b && typeof b.blaxxunAvatarCount === 'function' ? b.blaxxunAvatarCount() : null,
    /* Socket listener counts, per event, so growth is attributable. */
    socketListeners: (() => {
      const s = view.$socket && view.$socket.socket;
      if (!s || !s._callbacks) return null;
      const out = {};
      Object.keys(s._callbacks).forEach(k => { out[k.replace(/^\$/, '')] = s._callbacks[k].length; });
      return out;
    })(),
    pendingWorldLoad: view.loadGeneration,
    unexpectedAbort: window.ctrUnexpectedWorldLoadAbort || null,
  };
});

const gameplayLive = page => page.evaluate(() => {
  /* Is any Outlands Script still able to change gameplay state? The battle
   * Script belongs to the scene, so after a world change the named node must
   * simply not be there. */
  const c = document.querySelector('#world x3d-canvas');
  if (!c) return { battleNode: false };
  try {
    const b = X3D.getBrowser(c);
    let node = null;
    try { node = b.currentScene.getNamedNode('battle'); } catch (e) { node = null; }
    return { battleNode: !!node, worldURL: b.currentScene && b.currentScene.worldURL };
  } catch (e) { return { battleNode: false }; }
});

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const record = { renderer: browser.ctrRenderer };

  /* ---- TWO PRESENCES OF ONE MEMBER ------------------------------------ */
  const ctx = await browser.newContext();
  const tabA = await login(ctx, USER, PASS);
  await O.wearOrdinaryAvatar(tabA);
  await O.enterOutlandsThroughEntrance(tabA, 'redm');

  /*
   * A second tab of the SAME account. It shares the session but gets its own
   * presenceId, which is exactly the case a username could never tell apart.
   *
   * It is opened straight onto Outlands rather than by way of the Plaza. A
   * Plaza join is what hands a citizen their ordinary avatar back, and the two
   * tabs share one account - so routing this one through the Plaza would strip
   * the side off the tab that is already standing in the battle zone.
   */
  const tabB = await ctx.newPage();
  await tabB.goto(`${BASE}/#/place/outlands`, { waitUntil: 'networkidle', timeout: 60000 });
  await tabB.waitForFunction(() => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue__;
    return !!(app && app.$store.data.isUser);
  }, undefined, { timeout: 60000 });
  /*
   * No entrance for this tab: the two tabs are one account, and the account is
   * already wearing the side the first tab chose. That is precisely the case
   * this gate exists for - one member, one username, one avatar, two presences.
   */
  await enterPlace(tabB, '#/place/outlands', 'ne_game.wrl');
  await O.waitForBattleTeam(tabB);
  await tabB.waitForTimeout(8000);

  const shooterCtx = await browser.newContext();
  const shooter = await login(shooterCtx, SHOOTER.user, SHOOTER.pass);
  await O.wearOrdinaryAvatar(shooter);
  await O.enterOutlandsThroughEntrance(shooter, 'bluem');
  await O.tapMessages(shooter);
  await shooter.waitForTimeout(8000);

  const viewA = await O.presenceView(tabA);
  const viewB = await O.presenceView(tabB);
  const viewS = await O.presenceView(shooter);
  record.presences = { tabA: viewA, tabB: viewB, shooter: viewS };

  check('two tabs of one member are two different presences',
    viewA.self !== viewB.self, { a: viewA.self, b: viewB.self });
  check('they carry the same member id and the same username',
    viewA.self.split(':')[0] === viewB.self.split(':')[0]
    && viewS.remote.filter(m => m.username === USER).length === 2,
    { a: viewA.self, b: viewB.self, seen: viewS.remote });
  check('the shooter sees them as two citizens with two rendered nodes',
    viewS.remote.length === 2 && viewS.remote.every(m => m.hasNode)
    && viewS.rendered.length === 2, viewS.remote);
  const shooterState = await O.state(shooter);
  check('the shooter holds two blaxxun avatar registrations, one per presence',
    shooterState.knownAvatars === 2, shooterState.knownAvatars);

  /* Fire at tab A only. The wire value has to name tab A's presence, and only
   * tab A may be beamed out. */
  const spawns = O.spawnPoints(REPO);
  await O.stand(tabA, [spawns[1][0][0], spawns[1][0][1], spawns[1][0][2] - 13], [0, 1, 0, Math.PI]);
  /* Tab B stands well clear, so nothing about the shot can reach it by
   * proximity - only by name. */
  await O.stand(tabB, [spawns[1][3][0], spawns[1][3][1], spawns[1][3][2]], [0, 1, 0, 0]);
  await tabA.waitForTimeout(6000);
  const targetAt = await O.camera(tabA);
  await O.stand(shooter, [targetAt[0], targetAt[1], targetAt[2] + 12], [0, 1, 0, 0]);
  await shooter.waitForTimeout(5000);
  await O.selectWeapon(shooter, 'beamer');
  let aim = null;
  for (const drop of [0.4, 0, 0.8, 0.2]) {
    await O.aimAt(shooter, await O.camera(tabA), drop);
    await shooter.waitForTimeout(1500);
    aim = await O.fireRay(shooter);
    if (aim && aim.nicknames.indexOf(viewA.self) > -1) break;
  }
  record.multiPresenceAim = aim;
  check('the ray names exactly one of the two tabs',
    !!aim && aim.nicknames.indexOf(viewA.self) > -1 && aim.nicknames.indexOf(viewB.self) === -1,
    { found: aim && aim.nicknames, wanted: viewA.self, other: viewB.self });

  const beforeA = await O.state(tabA);
  const beforeB = await O.state(tabB);
  await O.press(shooter, 'd');
  await tabA.waitForTimeout(3000);
  const afterA = await O.state(tabA);
  const afterB = await O.state(tabB);
  const sent = (await O.messages(shooter)).sent.filter(m => m.name === 'BeamerEvent');
  const lastWire = sent.length ? String(sent[sent.length - 1].value) : null;
  record.multiPresenceShot = { lastWire, beforeA, afterA, beforeB, afterB };
  check('the shot goes out naming that tab\'s presence key',
    lastWire === `2${viewA.self}`, { wire: lastWire, want: `2${viewA.self}` });
  check('the tab that was hit is beamed out', afterA.isBeamed && !beforeA.isBeamed,
    { before: beforeA.isBeamed, after: afterA.isBeamed });
  check('the OTHER tab of the same member is untouched',
    !afterB.isBeamed && afterB.ammo.beamer === beforeB.ammo.beamer,
    { before: beforeB.isBeamed, after: afterB.isBeamed });

  /* ---- ROOM STATE ------------------------------------------------------ */
  const rooms = { a: viewA.room, b: viewB.room, s: viewS.room };
  record.rooms = rooms;
  check('all three presences are in one logical room',
    `${rooms.a}` === `${rooms.b}` && `${rooms.b}` === `${rooms.s}`, rooms);
  check('nobody is holding a citizen who is not there',
    viewA.remote.length === 2 && viewB.remote.length === 2 && viewS.remote.length === 2,
    { a: viewA.remote.length, b: viewB.remote.length, s: viewS.remote.length });
  check('every remote citizen has reported a real position',
    viewS.remote.every(m => m.placed), viewS.remote);

  await O.waitForRespawn(tabA);

  /* ---- LEAVE ----------------------------------------------------------- */
  const beforeLeave = await retention(shooter);
  await enterPlace(tabB, '#/place/enter', 'enter.wrl');
  await tabB.waitForTimeout(6000);
  await shooter.waitForTimeout(4000);
  const afterLeave = await O.presenceView(shooter);
  const leftRetention = await retention(shooter);
  record.leave = { beforeLeave, afterLeave, leftRetention };
  check('a citizen who leaves Outlands is dropped by everyone still in it',
    afterLeave.remote.length === 1 && afterLeave.remote[0].key === viewA.self,
    afterLeave.remote);
  check('their rendered avatar goes with them',
    afterLeave.rendered.length === 1, afterLeave.rendered);
  check('so does their target binding',
    leftRetention.boundNodes === 1 && leftRetention.blaxxunAvatars === 1,
    { bound: leftRetention.boundNodes, registered: leftRetention.blaxxunAvatars });

  /* The citizen who left is out of the battle entirely. */
  const leaverWorld = await gameplayLive(tabB);
  const leaverRetention = await retention(tabB);
  record.leaver = { leaverWorld, leaverRetention };
  check('the citizen who left is in the new world, with no battle Script left',
    leaverWorld.battleNode === false
    && String(leaverWorld.worldURL).indexOf('enter.wrl') > -1, leaverWorld);
  check('and the outgoing world gave the browser its event state back',
    leaverRetention.browserEventRoutes === 0 && leaverRetention.eventMask === 0,
    { routes: leaverRetention.browserEventRoutes, mask: leaverRetention.eventMask });
  check('they hold no Outlands citizens any more',
    leaverRetention.renderedCitizens === 0 && leaverRetention.boundNodes === 0
    && leaverRetention.blaxxunAvatars === 0, leaverRetention);
  check('and one canvas, as always', leaverRetention.canvases === 1, leaverRetention.canvases);

  /* ---- RETURN ---------------------------------------------------------- */
  await O.wearOrdinaryAvatar(tabB);
  await O.enterOutlandsThroughEntrance(tabB, 'redf');
  await tabB.waitForTimeout(8000);
  await shooter.waitForTimeout(4000);
  const returnedB = await O.presenceView(tabB);
  const seesReturn = await O.presenceView(shooter);
  const shooterAfterReturn = await O.state(shooter);
  const returnedState = await O.state(tabB);
  record.return = { returnedB, seesReturn, returnedState };
  check('a returning citizen appears exactly once',
    seesReturn.remote.length === 2 && seesReturn.rendered.length === 2
    && new Set(seesReturn.remote.map(m => m.key)).size === 2, seesReturn.remote);
  check('and only once in the blaxxun registry',
    shooterAfterReturn.knownAvatars === 2, shooterAfterReturn.knownAvatars);
  check('they come back on the side they chose this time', returnedState.team === 1, returnedState.team);
  check('with a full historical load and the Beamer in hand',
    returnedState.type === 'beamer' && returnedState.ammo.beamer === 100
    && returnedState.ammo.repulsor === 7 && returnedState.ammo.aapd === 4, returnedState.ammo);
  check('the returning citizen\'s browser event state is the new world\'s own',
    returnedState.browserEventRoutes === 1
    && returnedState.eventMask === ((1 << 4) | (1 << 5) | (1 << 6)),
    { routes: returnedState.browserEventRoutes, mask: returnedState.eventMask });

  /* ---- RAPID NAVIGATION ------------------------------------------------ */
  /*
   * Leaving Outlands gives the citizen their ordinary avatar back, so every
   * return goes through the entrance again - which is the historical flow, and
   * is what makes this the real Plaza/Outlands/Plaza/Outlands cycle rather than
   * a shortcut around the entrance.
   */
  const before = await retention(tabB);
  for (let i = 0; i < 3; i += 1) {
    await enterPlace(tabB, '#/place/enter', 'enter.wrl');
    await O.enterOutlandsThroughEntrance(tabB, i % 2 ? 'redf' : 'redm');
  }
  /*
   * Now one transition with no wait at all between the two hash changes. It
   * lands on the entrance, because the Plaza join has already handed the
   * ordinary avatar back - a 2D screen over a torn-down world, which is the
   * shape that used to strand a world-load promise.
   */
  /*
   * Two SEPARATE navigations with no settling time between them. The pair has
   * to reach the router twice: setting the hash twice inside one task is a
   * no-op, because the second value is the one the page already had, and a
   * gate written that way measures nothing at all.
   */
  await tabB.evaluate(() => new Promise(resolve => {
    window.location.hash = '#/place/enter';
    requestAnimationFrame(() => {
      window.location.hash = '#/place/outlands';
      resolve();
    });
  }));
  await tabB.waitForTimeout(25000);
  const rapidEntrance = await O.entranceState(tabB);
  const afterRapidPair = await retention(tabB);
  record.rapidPair = { rapidEntrance, afterRapidPair };
  /*
   * Either answer is correct here, and which one comes out is a race the gate
   * must not pretend to own: the Plaza join hands the ordinary avatar back, so
   * if that lands first the pair settles on the ENTRANCE, and if the Outlands
   * run reads the store first it settles in the WORLD. What must be true in
   * both cases is that the page holds exactly one of them, cleanly.
   */
  const settledInWorld = rapidEntrance.outlandsWorldLoaded && !rapidEntrance.shown;
  const settledOnEntrance = rapidEntrance.shown && !rapidEntrance.outlandsWorldLoaded;
  check('a no-wait Plaza/Outlands pair settles on Outlands, and on one of its two screens',
    settledInWorld !== settledOnEntrance,
    { entrance: rapidEntrance.shown, world: rapidEntrance.outlandsWorldLoaded });
  check('with one canvas and no stranded world load',
    afterRapidPair.canvases === 1 && afterRapidPair.unexpectedAbort === null,
    { canvases: afterRapidPair.canvases, abort: afterRapidPair.unexpectedAbort });
  check('the browser event state matches the screen it settled on, with nothing left over',
    settledInWorld
      ? (afterRapidPair.browserEventRoutes === 1 && afterRapidPair.eventMask === 112)
      : (afterRapidPair.browserEventRoutes === 0 && afterRapidPair.eventMask === 0
        && afterRapidPair.renderedCitizens === 0 && afterRapidPair.blaxxunAvatars === 0),
    { settledInWorld, routes: afterRapidPair.browserEventRoutes, mask: afterRapidPair.eventMask,
      rendered: afterRapidPair.renderedCitizens, registered: afterRapidPair.blaxxunAvatars });

  /* Back into the battle zone, whichever screen the pair left us on. */
  if (settledOnEntrance) {
    await O.enterOutlandsThroughEntrance(tabB, 'redm');
  } else {
    await O.waitForBattleTeam(tabB);
  }
  await tabB.waitForTimeout(6000);
  const afterRapid = await retention(tabB);
  const rapidState = await O.state(tabB);
  record.rapid = { before, afterRapid, rapidState };
  check('rapid Plaza/Outlands navigation settles on Outlands',
    String(afterRapid.worldURL).indexOf('ne_game.wrl') > -1, afterRapid.worldURL);
  check('with one canvas', afterRapid.canvases === 1, afterRapid.canvases);
  check('no world load was aborted by anything this page did not start',
    afterRapid.unexpectedAbort === null, afterRapid.unexpectedAbort);
  check('the browser event route did not multiply over seven transitions',
    afterRapid.browserEventRoutes === 1, afterRapid.browserEventRoutes);
  check('the socket listener counts did not grow',
    JSON.stringify(afterRapid.socketListeners) === JSON.stringify(before.socketListeners),
    { before: before.socketListeners, after: afterRapid.socketListeners });
  check('the battle Script is alive again and holds a valid team',
    rapidState.team === 1 && rapidState.type === 'beamer', { team: rapidState.team, type: rapidState.type });
  await shooter.waitForTimeout(6000);
  const seesRapid = await O.presenceView(shooter);
  check('nobody watching gained a ghost citizen',
    seesRapid.remote.length === 2 && seesRapid.rendered.length === 2, seesRapid.remote);

  /* ---- GAMEPLAY TIMERS DO NOT SURVIVE THE WORLD ------------------------ */
  /* Beam the citizen out and leave WHILE the respawn timer is running. The
   * timers belong to the scene, so the next world must not inherit them. */
  const tabBNow = await O.presenceView(tabB);
  /* The other tab of the same account has been standing on this spot since the
   * multi-presence shot. Park it at a different red spawn, or the shooter's ray
   * finds it first and this section proves nothing about the tab it aimed at. */
  await O.stand(tabA, [spawns[1][1][0], spawns[1][1][1], spawns[1][1][2]], [0, 1, 0, 0]);
  await tabA.waitForTimeout(3000);
  await O.stand(tabB, [spawns[1][0][0], spawns[1][0][1], spawns[1][0][2] - 13], [0, 1, 0, Math.PI]);
  await tabB.waitForTimeout(6000);
  const at = await O.camera(tabB);
  await O.stand(shooter, [at[0], at[1], at[2] + 12], [0, 1, 0, 0]);
  await shooter.waitForTimeout(5000);
  await O.selectWeapon(shooter, 'beamer');
  let midAim = null;
  for (const drop of [0.4, 0, 0.8, 0.2]) {
    await O.aimAt(shooter, await O.camera(tabB), drop);
    await shooter.waitForTimeout(1500);
    midAim = await O.fireRay(shooter);
    if (midAim && midAim.nicknames.indexOf(tabBNow.self) > -1) break;
  }
  check('the shooter has the returning tab, and only it, in the ray',
    !!midAim && midAim.nicknames.length === 1 && midAim.nicknames[0] === tabBNow.self,
    { found: midAim && midAim.nicknames, want: tabBNow.self });
  await O.press(shooter, 'd');
  await tabB.waitForTimeout(2500);
  const beamedMidFlight = await O.state(tabB);
  record.midFlight = { aim: midAim, beamed: beamedMidFlight.isBeamed, gravity: beamedMidFlight.gravity };
  check('the citizen is beamed out, with the world holding them', beamedMidFlight.isBeamed,
    beamedMidFlight.isBeamed);
  await enterPlace(tabB, '#/place/enter', 'enter.wrl');
  await tabB.waitForTimeout(3000);
  const midLeave = await retention(tabB);
  const midWorld = await gameplayLive(tabB);
  /* The beam-out turned gravity off and NONE on. The next world has to be
   * normal: gravity is a browser property, so it is reset per world load. */
  const gravityNow = await tabB.evaluate(sel => X3D.getBrowser(document.querySelector(sel)).getGravity(), O.CANVAS);
  record.midLeave = { midLeave, midWorld, gravityNow };
  check('leaving mid beam-out leaves no battle Script behind', midWorld.battleNode === false, midWorld);
  check('and no gameplay timer can still change anything',
    midLeave.browserEventRoutes === 0 && midLeave.eventMask === 0, midLeave);
  check('the next world starts under normal gravity, not the beam-out\'s', gravityNow === true, gravityNow);
  /* Wait past the full historical respawn window and prove nothing fires. */
  await tabB.waitForTimeout(40000);
  const settled = await retention(tabB);
  const settledWorld = await gameplayLive(tabB);
  record.settled = { settled, settledWorld };
  check('after the whole respawn window has passed, still nothing from the old world',
    settledWorld.battleNode === false && settled.browserEventRoutes === 0
    && settled.eventMask === 0 && settled.canvases === 1
    && String(settled.worldURL).indexOf('enter.wrl') > -1, settled);

  await shooter.screenshot({ path: path.join(OUT_DIR, 'shooter.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'lifecycle.json'), JSON.stringify({ results, record }, null, 2));

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
