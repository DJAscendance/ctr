'use strict';

/*
 * CTR_BETA_OUTLANDS_FREEPLAY
 *
 * The ordinary citizen's Outlands battle, proved with two authenticated Beta
 * citizens on opposite sides in one free-play room, on a real GPU.
 *
 * Everything asserted here is read out of ne_game.wrl's own `battle` Script -
 * team, weapon, ammunition, beam-out, respawn - rather than out of the SPA, so
 * the gate cannot pass on a CTR reimplementation of the game. The two clients
 * only ever click the entrance, stand still and press keys; every effect on the
 * far client arrives through the historical room message path.
 *
 * What is Beta-specific, and is the point of this phase: the citizen a shot
 * names is a PRESENCE, `memberId:presenceId`, not a username. The Beamer's wire
 * value is asserted to carry the target's presence key.
 *
 * Match mode, the Game Master, turrets and the score service are out of scope
 * and are not touched.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   DISPLAY=:1 node qa/outlands/tools/check-freeplay.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login } = require('../../phase2/lib/beta-client');
const O = require('../lib/outlands-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2]
  || path.join(REPO, '..', '..', '..', 'artifacts', 'outlands-freeplay');

const RED = {
  user: process.env.CTR_QA_USER || 'testqa',
  pass: process.env.CTR_QA_PASS || 'testqa',
  side: 'redm', team: 1,
};
const BLUE = {
  user: process.env.CTR_QA_USER2 || 'outlandsqa2',
  pass: process.env.CTR_QA_PASS2 || 'testqa',
  side: 'bluem', team: 2,
};

/* Held so the failure path can close it - see the catch at the bottom. */
let openBrowser = null;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

const consoleLog = [];
function watch(page, tag) {
  page.on('pageerror', e => consoleLog.push({ tag, type: 'pageerror', text: e.message.slice(0, 300) }));
  page.on('console', m => {
    const type = m.type();
    if (type !== 'error' && type !== 'warning') return;
    consoleLog.push({ tag, type, text: m.text().slice(0, 300) });
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const spawns = O.spawnPoints(REPO);
  const browser = await launch();
  /* A gate that dies mid-run must not leave its citizens standing in the room:
   * the next run would see them as ghosts and fail for the wrong reason. */
  openBrowser = browser;
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const record = { renderer: browser.ctrRenderer };

  /* ---- ENTRANCE ------------------------------------------------------- */
  const red = await login(await browser.newContext(), RED.user, RED.pass);
  watch(red, 'red');
  await O.wearOrdinaryAvatar(red);
  const entrance = await O.enterOutlandsThroughEntrance(red, RED.side);
  record.entrance = entrance;
  check('the historical Outlands entrance stands in front of the world', entrance.shown);
  check('it offers exactly the four team avatars, all available',
    entrance.choices.length === 4 && entrance.choices.every(c => c.enabled), entrance.choices);
  check('the two red choices and the two blue choices are labelled as such',
    entrance.choices.filter(c => c.label === 'Join the Red Team').length === 2
    && entrance.choices.filter(c => c.label === 'Join the Blue Team').length === 2,
    entrance.choices.map(c => c.label));
  check('the battle zone is not loaded, and not on screen, until a side is chosen',
    entrance.outlandsWorldLoaded === false && entrance.worldPaneShown === false,
    { loaded: entrance.outlandsWorldLoaded, paneShown: entrance.worldPaneShown });
  check('Outlands offers no 2D room and no place chat in front of the entrance',
    !entrance.selector2d3d && !entrance.chatPanel,
    { selector: entrance.selector2d3d, chat: entrance.chatPanel });
  check('the citizen is not trapped: the jump gate is still there', entrance.wayOut);

  const blue = await login(await browser.newContext(), BLUE.user, BLUE.pass);
  watch(blue, 'blue');
  await O.wearOrdinaryAvatar(blue);
  await O.enterOutlandsThroughEntrance(blue, BLUE.side);
  await red.waitForTimeout(8000);

  await O.tapMessages(red);
  await O.tapMessages(blue);

  let a = await O.state(red);
  let b = await O.state(blue);
  record.afterEntry = { red: a, blue: b };
  const redView = await O.presenceView(red);
  const blueView = await O.presenceView(blue);
  record.presence = { red: redView, blue: blueView };

  check('the red citizen is on team 1', a.team === RED.team, a.team);
  check('the blue citizen is on team 2', b.team === BLUE.team, b.team);
  check('each citizen sees exactly one other citizen',
    redView.remote.length === 1 && blueView.remote.length === 1,
    { red: redView.remote, blue: blueView.remote });
  check('each of them is rendered and bound to a target node',
    redView.remote.every(m => m.hasNode) && blueView.remote.every(m => m.hasNode),
    { red: redView.remote, blue: blueView.remote });
  check('both clients hold exactly one blaxxun avatar registration',
    a.knownAvatars === 1 && b.knownAvatars === 1,
    { red: a.knownAvatars, blue: b.knownAvatars });
  check('one canvas each', redView.canvases === 1 && blueView.canvases === 1,
    { red: redView.canvases, blue: blueView.canvases });

  /* ---- REMOTE IDENTITY ------------------------------------------------ */
  check('the browser names each citizen by their presence key, not their username',
    a.myAvatarName === redView.self && b.myAvatarName === blueView.self
    && a.myAvatarName !== RED.user && b.myAvatarName !== BLUE.user,
    { red: a.myAvatarName, redSelf: redView.self, blue: b.myAvatarName, blueSelf: blueView.self });
  check('each sees the other under that same presence key',
    redView.remote[0] && redView.remote[0].key === blueView.self
    && blueView.remote[0] && blueView.remote[0].key === redView.self,
    { redSeesBlueAs: redView.remote[0] && redView.remote[0].key, blueSelf: blueView.self });
  check('the world reads the historical avatar URL, which is what set_team matches',
    /cybertown\.com\/places\/ne_game\/vrml\/avatars\/redm\.wrl$/.test(a.myAvatarURL)
    && /bluem\.wrl$/.test(b.myAvatarURL), { red: a.myAvatarURL, blue: b.myAvatarURL });

  /* ---- WORLD ENTRY ---------------------------------------------------- */
  const redSpawn = await O.worldSpawn(red);
  const blueSpawn = await O.worldSpawn(blue);
  record.spawns = { red: redSpawn, blue: blueSpawn, table: spawns };
  const atOwnSpawn = (side, at) => spawns[side].some(p =>
    Math.abs(p[0] - at[0]) < 0.01 && Math.abs(p[2] - at[2]) < 0.01);
  check('the world put the red citizen at one of the red spawns',
    atOwnSpawn(1, redSpawn), { at: redSpawn.map(v => +v.toFixed(3)), spawns: spawns[1] });
  check('the world put the blue citizen at one of the blue spawns',
    atOwnSpawn(2, blueSpawn), { at: blueSpawn.map(v => +v.toFixed(3)), spawns: spawns[2] });

  /* ---- BROWSER EVENT STATE MACHINE ------------------------------------ */
  check('the browser event route is delivered, not merely accepted',
    a.browserEventRoutes === 1 && a.eventMask === ((1 << 4) | (1 << 5) | (1 << 6)),
    { routes: a.browserEventRoutes, mask: a.eventMask });
  check('the opening weapon is the Beamer', a.type === 'beamer', a.type);
  check('the opening ammunition is the historical load',
    a.ammo.beamer === 100 && a.ammo.repulsor === 7 && a.ammo.aapd === 4, a.ammo);
  check('gravity and WALK are the world defaults on entry', a.gravity === true, a.gravity);

  /* ---- W: WEAPON SELECTION -------------------------------------------- */
  await O.press(red, 'w');
  const w1 = await O.state(red);
  await O.press(red, 'w');
  const w2 = await O.state(red);
  await O.press(red, 'w');
  const w3 = await O.state(red);
  record.weaponCycle = [w1.type, w2.type, w3.type];
  check('W changes weapon: Beamer to Repulsor', w1.type === 'repulsor', w1.type);
  check('W changes weapon: Repulsor to AAPD', w2.type === 'aapd', w2.type);
  check('W changes weapon: AAPD back to Beamer', w3.type === 'beamer', w3.type);
  check('one press is one change, not two',
    record.weaponCycle.join(',') === 'repulsor,aapd,beamer', record.weaponCycle);
  check('the weapon model follows the weapon',
    !!w3.weapon && w3.weapon.join('').indexOf('beamer.wrl') > -1, w3.weapon);

  /* Typing must never fire, and clicking the screen gives the keyboard back. */
  const ammoBeforeTyping = (await O.state(red)).ammo.beamer;
  await red.evaluate(() => {
    const i = document.createElement('input');
    i.id = 'ctrFocusProbe';
    document.body.appendChild(i);
    i.focus();
  });
  await red.keyboard.type('dwa');
  await red.waitForTimeout(1000);
  const typed = await O.state(red);
  await red.evaluate(() => { const i = document.getElementById('ctrFocusProbe'); if (i) i.remove(); });
  check('typing in a text field neither fires nor changes weapon',
    typed.ammo.beamer === ammoBeforeTyping && typed.type === w3.type,
    { before: ammoBeforeTyping, after: typed.ammo.beamer, weapon: typed.type });

  await red.evaluate(() => {
    const i = document.createElement('input');
    i.id = 'ctrFocusProbe2';
    document.body.appendChild(i);
    i.focus();
  });
  await (await red.$(O.CANVAS)).click({ position: { x: 40, y: 40 } });
  await red.waitForTimeout(400);
  const focused = await red.evaluate(sel => {
    const ok = document.activeElement === document.querySelector(sel);
    const i = document.getElementById('ctrFocusProbe2');
    if (i) i.remove();
    return ok;
  }, O.CANVAS);
  check('clicking the 3D screen gives the keyboard back to the world', focused);

  /* ---- A: PAN --------------------------------------------------------- */
  await red.evaluate(sel => {
    const c = document.querySelector(sel);
    if (c && c.focus) c.focus({ preventScroll: true });
  }, O.CANVAS);
  await red.waitForTimeout(300);
  await red.keyboard.down('a');
  await red.waitForTimeout(600);
  const held = await red.evaluate(sel => X3D.getBrowser(document.querySelector(sel)).viewer_ || null, O.CANVAS);
  await red.keyboard.up('a');
  await red.waitForTimeout(600);
  const released = await red.evaluate(sel => X3D.getBrowser(document.querySelector(sel)).viewer_ || null, O.CANVAS);
  record.aKey = { held, released };
  check('holding A engages PAN', held === 'PAN', held);
  check('releasing A returns to WALK', released === 'WALK', released);

  /* ---- THE DUEL ------------------------------------------------------- */
  const blueKey = blueView.self;
  const aimHits = setup => !!setup.aim && setup.aim.nicknames.indexOf(blueKey) > -1;

  async function faceOff() {
    await O.stand(blue, [spawns[1][0][0], spawns[1][0][1], spawns[1][0][2] - 13], [0, 1, 0, Math.PI]);
    await blue.waitForTimeout(5000);
    const at = await O.camera(blue);
    await O.stand(red, [at[0], at[1], at[2] + 12], [0, 1, 0, 0]);
    await red.waitForTimeout(5000);
    let aim = null;
    for (const drop of [0.4, 0, 0.8, 0.2]) {
      const target = await O.camera(blue);
      await O.aimAt(red, target, drop);
      await red.waitForTimeout(1500);
      aim = await O.fireRay(red);
      if (aim && aim.nicknames.indexOf(blueKey) > -1) break;
    }
    return { blue: await O.camera(blue), red: await O.camera(red), aim };
  }

  const wire = async name => {
    const s = (await O.messages(red)).sent.filter(m => m.name === name);
    const r = (await O.messages(blue)).received.filter(m => m.name === name);
    return { sent: s.length, received: r.length, lastSent: s[s.length - 1] || null, lastReceived: r[r.length - 1] || null };
  };

  record.duel = await faceOff();
  check('the shooter\'s own fire ray finds a person, not just a model',
    !!record.duel.aim && record.duel.aim.types.indexOf('Avatar') > -1,
    record.duel.aim && record.duel.aim.types);
  check('the person the ray finds is the other citizen, named by presence key',
    aimHits(record.duel), { found: record.duel.aim && record.duel.aim.nicknames, want: blueKey });

  /* NEGATIVE CONTROL: aim at the ground and no citizen may be named. */
  const groundAim = await (async () => {
    const own = await O.camera(red);
    await O.aimAt(red, [own[0], own[1] - 3, own[2] + 25], 0);
    await red.waitForTimeout(1200);
    return O.fireRay(red);
  })();
  record.groundAim = groundAim;
  check('NEGATIVE CONTROL: world geometry resolves to no citizen',
    !!groundAim && groundAim.nicknames.length === 0, groundAim && groundAim.nicknames);

  /* ---- REPULSOR ------------------------------------------------------- */
  await O.selectWeapon(red, 'repulsor');
  check('the shooter is holding the Repulsor', (await O.state(red)).type === 'repulsor');
  const repulsorShots = [];
  for (let shot = 0; shot < 3; shot += 1) {
    const setup = await faceOff();
    const before = await O.pushState(blue);
    const w0 = await wire('RepulsorEvent');
    const ammo0 = (await O.state(red)).ammo.repulsor;
    await O.press(red, 'd');
    await blue.waitForTimeout(2500);
    const after = await O.pushState(blue);
    const w1 = await wire('RepulsorEvent');
    const ammo1 = (await O.state(red)).ammo.repulsor;
    repulsorShots.push({
      aimOk: aimHits(setup),
      costs: ammo1 === ammo0 - 1,
      sent: w1.sent > w0.sent,
      received: w1.received > w0.received,
      reached: after.startTime > before.startTime,
      keyValue: after.keyValue,
      pushedFromTarget: after.keyValue.length === 2
        && Math.abs(after.keyValue[0][0] - before.camera[0]) < 0.1
        && Math.abs(after.keyValue[0][2] - before.camera[2]) < 0.1,
      moved: after.keyValue.length === 2
        && Math.abs(after.battleView[0] - after.keyValue[1][0]) < 0.01
        && Math.abs(after.battleView[2] - after.keyValue[1][2]) < 0.01
        && (Math.abs(after.keyValue[1][0] - after.keyValue[0][0]) > 0.5
          || Math.abs(after.keyValue[1][2] - after.keyValue[0][2]) > 0.5),
    });
  }
  record.repulsorShots = repulsorShots;
  const rN = k => repulsorShots.filter(s => s[k]).length;
  check('the Repulsor aim is deterministic (3/3)', rN('aimOk') === 3, repulsorShots.map(s => s.aimOk));
  check('firing the Repulsor costs a round (3/3)', rN('costs') === 3, repulsorShots.map(s => s.costs));
  check('the Repulsor is sent as a room message (3/3)', rN('sent') === 3, repulsorShots.map(s => s.sent));
  check('it arrives at the other client (3/3)', rN('received') === 3, repulsorShots.map(s => s.received));
  check('it reaches the other citizen\'s own Script (3/3)', rN('reached') === 3, repulsorShots.map(s => s.reached));
  check('the push starts from where that citizen is standing (3/3)',
    rN('pushedFromTarget') === 3, repulsorShots.map(s => s.keyValue));
  check('the world drives them to its own push endpoint (3/3)',
    rN('moved') === 3, repulsorShots.map(s => s.keyValue));

  /* Remote position sync survives the push: the shooter must see the target
   * move, through the ordinary presence path and nothing else. */
  await red.waitForTimeout(3000);
  const afterPush = await O.presenceView(red);
  const pushedTo = await O.camera(blue);
  record.pushSync = { seenBy: afterPush.remote, targetAt: pushedTo };
  check('the shooter still sees exactly one citizen after the push',
    afterPush.remote.length === 1 && afterPush.remote[0].key === blueKey
    && afterPush.remote[0].placed, afterPush.remote);

  /* ---- BEAMER, BEAM-OUT AND RESPAWN ----------------------------------- */
  await O.selectWeapon(red, 'beamer');
  check('the shooter is holding the Beamer', (await O.state(red)).type === 'beamer');
  const beamerShots = [];
  let firstRespawn = null;
  let beforeShot = null;
  for (let shot = 0; shot < 3; shot += 1) {
    const setup = await faceOff();
    const s0 = { red: await O.state(red), blue: await O.state(blue) };
    if (shot === 0) beforeShot = s0;
    const w0 = await wire('BeamerEvent');
    await O.press(red, 'd');
    await blue.waitForTimeout(2500);
    const s1 = { red: await O.state(red), blue: await O.state(blue) };
    const w1 = await wire('BeamerEvent');
    const respawn = s1.blue.isBeamed ? await O.waitForRespawn(blue)
      : { respawned: false, waitedMs: 0, state: s1.blue };
    if (shot === 0) firstRespawn = respawn;
    beamerShots.push({
      aimOk: aimHits(setup),
      costs: s1.red.ammo.beamer === s0.red.ammo.beamer - 1,
      sent: w1.sent > w0.sent,
      /* THE PHASE 3 ASSERTION: the wire names a presence, not a username. */
      namesPresence: !!w1.lastSent && String(w1.lastSent.value) === `${RED.team}${blueKey}`,
      neverNamesUsername: !!w1.lastSent && String(w1.lastSent.value).indexOf(BLUE.user) === -1,
      received: w1.received > w0.received,
      beamed: s1.blue.isBeamed,
      cannotFire: s1.blue.fireDisable,
      told: !!s1.blue.message && s1.blue.message.indexOf('BEAMED OUT') > -1,
      shooterSafe: !s1.red.isBeamed,
      comesBack: respawn.respawned,
      waitedMs: respawn.waitedMs,
      wireValue: w1.lastSent && String(w1.lastSent.value),
    });
  }
  record.beamerShots = beamerShots;
  const bN = k => beamerShots.filter(s => s[k]).length;
  check('the Beamer aim is deterministic (3/3)', bN('aimOk') === 3, beamerShots.map(s => s.aimOk));
  check('D fires: the shot costs a round (3/3)', bN('costs') === 3, beamerShots.map(s => s.costs));
  check('the Beamer is sent as a room message (3/3)', bN('sent') === 3, beamerShots.map(s => s.sent));
  check('the message names the target PRESENCE (3/3)', bN('namesPresence') === 3,
    beamerShots.map(s => s.wireValue));
  check('the message never carries a username (3/3)', bN('neverNamesUsername') === 3,
    beamerShots.map(s => s.wireValue));
  check('it arrives at the other client (3/3)', bN('received') === 3, beamerShots.map(s => s.received));
  check('the Beamer beams the other citizen out (3/3)', bN('beamed') === 3, beamerShots.map(s => s.beamed));
  check('a beamed citizen cannot fire back (3/3)', bN('cannotFire') === 3, beamerShots.map(s => s.cannotFire));
  check('the beamed citizen is told so (3/3)', bN('told') === 3, beamerShots.map(s => s.told));
  check('the shooter is never beamed by their own shot (3/3)',
    bN('shooterSafe') === 3, beamerShots.map(s => s.shooterSafe));
  check('a beamed citizen comes back every time (3/3)',
    bN('comesBack') === 3, beamerShots.map(s => s.waitedMs));

  record.respawn = firstRespawn;
  const rs = firstRespawn && firstRespawn.state;
  check('the citizen comes back on their own side', !!rs && rs.team === BLUE.team, rs && rs.team);
  check('respawn restores the full historical load',
    !!rs && rs.ammo.beamer === 100 && rs.ammo.repulsor === 7 && rs.ammo.aapd === 4, rs && rs.ammo);
  check('respawn restores the Beamer', !!rs && rs.type === 'beamer', rs && rs.type);
  check('respawn restores normal gravity', !!rs && rs.gravity === true, rs && rs.gravity);
  check('respawn clears the beam-out message',
    !!rs && (!rs.message || rs.message.join('').indexOf('BEAMED OUT') === -1), rs && rs.message);
  check('the respawn wait is the historical one, not a shortened QA one',
    !!firstRespawn && firstRespawn.waitedMs > 24000, firstRespawn && firstRespawn.waitedMs);
  const respawnSpawn = await O.worldSpawn(blue);
  record.respawnSpawn = respawnSpawn;
  check('the citizen comes back at one of their own side\'s spawns',
    atOwnSpawn(2, respawnSpawn),
    { at: respawnSpawn.map(v => +v.toFixed(3)), spawns: spawns[2] });
  const afterRespawnView = await O.presenceView(red);
  check('the shooter sees them return once, not twice',
    afterRespawnView.remote.length === 1 && afterRespawnView.rendered.length === 1,
    { remote: afterRespawnView.remote, rendered: afterRespawnView.rendered });

  /* ---- AAPD ----------------------------------------------------------- */
  await O.selectWeapon(red, 'aapd');
  check('the shooter is holding the AAPD', (await O.state(red)).type === 'aapd');
  const aapdShots = [];
  for (let shot = 0; shot < 3; shot += 1) {
    const setup = await faceOff();
    /* The world protects a citizen for ten seconds after a respawn, so the
     * round must land outside that window - the same rule the Beamer uses. */
    await blue.waitForTimeout(6000);
    const cloud0 = await O.cloudState(blue);
    const w0 = await wire('AapdEvent');
    const a0 = { red: await O.state(red), blue: await O.state(blue) };
    await O.press(red, 'd');
    await blue.waitForTimeout(3000);
    const cloud1 = await O.cloudState(blue);
    const w1 = await wire('AapdEvent');
    const a1 = { red: await O.state(red), blue: await O.state(blue) };
    const respawn = a1.blue.isBeamed ? await O.waitForRespawn(blue)
      : { respawned: false, waitedMs: 0, state: a1.blue };
    const dist = Math.sqrt(
      (cloud1.at[0] - a0.blue.camera[0]) ** 2
      + (cloud1.at[1] - a0.blue.camera[1]) ** 2
      + (cloud1.at[2] - a0.blue.camera[2]) ** 2);
    aapdShots.push({
      aimOk: aimHits(setup),
      costs: a1.red.ammo.aapd === a0.red.ammo.aapd - 1,
      sent: w1.sent > w0.sent,
      received: w1.received > w0.received,
      cloudReached: cloud1.startTime > cloud0.startTime,
      lands: !!w1.lastReceived
        && Math.abs(cloud1.at[0] - w1.lastReceived.value.x) < 0.01
        && Math.abs(cloud1.at[2] - w1.lastReceived.value.z) < 0.01,
      inside10: dist < 10,
      distanceToTarget: +dist.toFixed(2),
      beamed: a1.blue.isBeamed,
      shooterSafe: !a1.red.isBeamed,
      comesBack: respawn.respawned,
    });
  }
  record.aapdShots = aapdShots;
  const aN = k => aapdShots.filter(s => s[k]).length;
  check('the AAPD aim is deterministic (3/3)', aN('aimOk') === 3, aapdShots.map(s => s.aimOk));
  check('firing the AAPD costs a round (3/3)', aN('costs') === 3, aapdShots.map(s => s.costs));
  check('the AAPD is sent as a room message (3/3)', aN('sent') === 3, aapdShots.map(s => s.sent));
  check('it arrives at the other client (3/3)', aN('received') === 3, aapdShots.map(s => s.received));
  check('the gas cloud reaches the other client (3/3)', aN('cloudReached') === 3, aapdShots.map(s => s.cloudReached));
  check('the cloud lands where the round landed (3/3)', aN('lands') === 3, aapdShots.map(s => s.distanceToTarget));
  check('every measured round lands inside ten metres of the enemy (3/3)',
    aN('inside10') === 3, aapdShots.map(s => s.distanceToTarget));
  check('the AAPD beams out an enemy inside ten metres (3/3)', aN('beamed') === 3, aapdShots.map(s => s.beamed));
  check('the AAPD never beams the citizen who fired it (3/3)', aN('shooterSafe') === 3, aapdShots.map(s => s.shooterSafe));
  check('an AAPD-beamed citizen comes back every time (3/3)', aN('comesBack') === 3, aapdShots.map(s => s.comesBack));

  /* An AAPD landing beyond ten metres: real round, cloud arrives, nobody out. */
  const outside = await (async () => {
    await faceOff();
    await blue.waitForTimeout(6000);
    let aim = null;
    for (const spec of [[30, 1.6], [15, 3], [8, 3]]) {
      const own = await O.camera(red);
      await O.aimAt(red, [own[0], own[1] - spec[1], own[2] + spec[0]], 0);
      await red.waitForTimeout(1200);
      aim = await O.fireRay(red);
      if (aim && aim.nicknames.length === 0) break;
    }
    const bluePos = await O.camera(blue);
    const cloud0 = await O.cloudState(blue);
    const w0 = await wire('AapdEvent');
    await O.press(red, 'd');
    await blue.waitForTimeout(3000);
    const cloud1 = await O.cloudState(blue);
    const w1 = await wire('AapdEvent');
    const b1 = await O.state(blue);
    const dist = aim ? Math.sqrt((aim.point[0] - bluePos[0]) ** 2 + (aim.point[2] - bluePos[2]) ** 2) : null;
    return {
      distanceToTarget: dist === null ? null : +dist.toFixed(1),
      arrived: w1.received > w0.received,
      cloudReached: cloud1.startTime > cloud0.startTime,
      beamed: b1.isBeamed,
    };
  })();
  record.aapdOutside = outside;
  check('an AAPD landing over ten metres away arrives but beams nobody',
    outside.arrived && outside.cloudReached && outside.distanceToTarget !== null
    && outside.distanceToTarget > 10 && !outside.beamed, outside);

  /* ---- AMMO PICKUP, real proximity, no QA restock --------------------- */
  const pickup = await (async () => {
    /* ne_game.wrl puts three Ammo dispensers in each base; the Red base is the
     * Transform at 0 0 -407, so the Repulsor dispenser stands at
     * 5.952 2 -437.2. Each Ammo holds a ProximitySensor of size 2 2 2. */
    const DISPENSER = [5.952, 2, -437.2];
    const before = await O.state(red);
    await O.stand(red, [DISPENSER[0], DISPENSER[1], DISPENSER[2] + 5], [0, 1, 0, 0]);
    await red.waitForTimeout(4000);
    const outsideSensor = await O.state(red);
    await O.stand(red, DISPENSER, [0, 1, 0, 0]);
    await red.waitForTimeout(5000);
    const after = await O.state(red);
    return {
      startedBelowFull: before.ammo.repulsor < 7,
      ammoBefore: before.ammo.repulsor,
      ammoOutsideSensor: outsideSensor.ammo.repulsor,
      ammoAfter: after.ammo.repulsor,
      restored: after.ammo.repulsor === 7,
      otherAmmoUntouched: after.ammo.beamer === before.ammo.beamer
        && after.ammo.aapd === before.ammo.aapd,
      standingAt: after.camera.map(v => +v.toFixed(2)),
    };
  })();
  record.ammoPickup = pickup;
  check('the citizen reaches the dispenser under strength', pickup.startedBelowFull,
    { was: pickup.ammoBefore, full: 7 });
  check('standing five metres clear of it reloads nothing',
    pickup.ammoOutsideSensor === pickup.ammoBefore, pickup.ammoOutsideSensor);
  check('the world\'s own dispenser reloads the historical amount', pickup.restored, pickup);
  check('it reloads only the weapon it carries', pickup.otherAmmoUntouched, pickup);

  /* ---- FRIENDLY FIRE --------------------------------------------------- */
  await blue.close();
  const ally = await login(await browser.newContext(), BLUE.user, BLUE.pass);
  watch(ally, 'ally');
  await O.wearOrdinaryAvatar(ally);
  await O.enterOutlandsThroughEntrance(ally, 'redf');
  await O.tapMessages(ally);
  await red.waitForTimeout(6000);
  const allyView = await O.presenceView(ally);
  const allyKey = allyView.self;
  const allyState = await O.state(ally);
  check('the second citizen re-enters wearing the red side', allyState.team === RED.team, allyState.team);

  const wireAlly = async name => {
    const s = (await O.messages(red)).sent.filter(m => m.name === name);
    const r = (await O.messages(ally)).received.filter(m => m.name === name);
    return { sent: s.length, received: r.length, lastSent: s[s.length - 1] || null };
  };
  async function faceOffAlly() {
    await O.stand(ally, [spawns[1][0][0], spawns[1][0][1], spawns[1][0][2] - 13], [0, 1, 0, Math.PI]);
    await ally.waitForTimeout(5000);
    const at = await O.camera(ally);
    await O.stand(red, [at[0], at[1], at[2] + 12], [0, 1, 0, 0]);
    await red.waitForTimeout(5000);
    let aim = null;
    for (const drop of [0.4, 0, 0.8, 0.2]) {
      await O.aimAt(red, await O.camera(ally), drop);
      await red.waitForTimeout(1500);
      aim = await O.fireRay(red);
      if (aim && aim.nicknames.indexOf(allyKey) > -1) break;
    }
    return { aim, at: await O.camera(ally) };
  }

  await O.selectWeapon(red, 'beamer');
  const ff = await faceOffAlly();
  const ffW0 = await wireAlly('BeamerEvent');
  await O.press(red, 'd');
  await ally.waitForTimeout(2500);
  const ffW1 = await wireAlly('BeamerEvent');
  const ffAlly = await O.state(ally);
  record.friendlyBeamer = {
    aimOk: !!ff.aim && ff.aim.nicknames.indexOf(allyKey) > -1,
    sent: ffW1.sent > ffW0.sent, received: ffW1.received > ffW0.received,
    beamed: ffAlly.isBeamed, wireValue: ffW1.lastSent && String(ffW1.lastSent.value),
  };
  check('a Beamer shot at a teammate is sent and delivered but beams nobody',
    record.friendlyBeamer.aimOk && record.friendlyBeamer.sent
    && record.friendlyBeamer.received && !record.friendlyBeamer.beamed, record.friendlyBeamer);

  await O.selectWeapon(red, 'aapd');
  /* The shooter has spent their AAPD rounds. Restock through the Script's own
   * set_ammo eventIn - the event the world's dispensers route into - not
   * through a QA override of the fire path. */
  await red.evaluate(sel => {
    X3D.getBrowser(document.querySelector(sel)).currentScene.getNamedNode('battle').set_ammo = 'aapd';
  }, O.CANVAS);
  const ffa = await faceOffAlly();
  await ally.waitForTimeout(6000);
  const ffaW0 = await wireAlly('AapdEvent');
  const ffaCloud0 = await O.cloudState(ally);
  await O.press(red, 'd');
  await ally.waitForTimeout(3000);
  const ffaW1 = await wireAlly('AapdEvent');
  const ffaCloud1 = await O.cloudState(ally);
  const ffaAlly = await O.state(ally);
  const ffaDist = Math.sqrt(
    (ffaCloud1.at[0] - ffa.at[0]) ** 2 + (ffaCloud1.at[1] - ffa.at[1]) ** 2
    + (ffaCloud1.at[2] - ffa.at[2]) ** 2);
  record.friendlyAapd = {
    arrived: ffaW1.received > ffaW0.received,
    cloudReached: ffaCloud1.startTime > ffaCloud0.startTime,
    distanceToTarget: +ffaDist.toFixed(2),
    beamed: ffaAlly.isBeamed,
  };
  check('an AAPD burst inside ten metres of a teammate beams nobody',
    record.friendlyAapd.arrived && record.friendlyAapd.cloudReached
    && record.friendlyAapd.distanceToTarget < 10 && !record.friendlyAapd.beamed,
    record.friendlyAapd);

  /* ---- LISTENER DISCIPLINE ACROSS THE WHOLE SESSION -------------------- */
  const endRed = await O.state(red);
  const endView = await O.presenceView(red);
  record.end = { red: endRed, view: endView, before: beforeShot && beforeShot.red };
  check('the browser event route never multiplied',
    endRed.browserEventRoutes === 1, endRed.browserEventRoutes);
  check('the event mask is still the world\'s own',
    endRed.eventMask === ((1 << 4) | (1 << 5) | (1 << 6)), endRed.eventMask);
  check('no phantom citizen was gained',
    endRed.knownAvatars === 1 && endView.remote.length === 1 && endView.rendered.length === 1,
    { known: endRed.knownAvatars, remote: endView.remote.length, rendered: endView.rendered.length });

  await red.screenshot({ path: path.join(OUT_DIR, 'red.png') });
  await ally.screenshot({ path: path.join(OUT_DIR, 'ally.png') });

  const summary = {};
  for (const e of consoleLog) {
    const key = `${e.type} ${e.text.replace(/[-+]?[0-9]*\.?[0-9]+/g, 'N').slice(0, 140)}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  record.console = { total: consoleLog.length, byMessage: summary };
  fs.writeFileSync(path.join(OUT_DIR, 'console.json'), JSON.stringify(consoleLog, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'freeplay.json'), JSON.stringify({ results, record }, null, 2));

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => {
  console.error('FATAL', e);
  if (openBrowser) { try { await openBrowser.close(); } catch (x) { /* already gone */ } }
  process.exit(1);
});
