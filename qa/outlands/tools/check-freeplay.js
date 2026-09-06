'use strict';

/*
 * CTR_OUTLANDS_FREEPLAY_GAMEPLAY
 *
 * The normal citizen's Outlands battle, proved with two authenticated clients
 * on opposite sides in one free-play room.
 *
 * Everything asserted here is read out of ne_game.wrl's own `battle` Script -
 * team, weapon, ammunition, beam-out, respawn - rather than out of the SPA, so
 * the gate cannot pass on a CTR reimplementation of the game. The two clients
 * only ever press keys and stand still; every effect on the far client has to
 * arrive through the historical room message path.
 *
 * The four historical messages are BeamerEvent, RepulsorEvent, AapdEvent and
 * BeamOutEvent, carried by the SharedEvent PROTO over CTR's socket "SE"
 * channel.
 *
 * Match mode and the Game Master are out of scope and are not touched.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/outlands/tools/check-freeplay.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const RED = { user: process.env.CTR_QA_USER || 'testqa', pass: process.env.CTR_QA_PASS || 'testqa', avatarId: 16, team: 1 };
const BLUE = { user: process.env.CTR_QA_USER2 || 'outlandsqa2', pass: process.env.CTR_QA_PASS2 || 'outlandsqa2', avatarId: 14, team: 2 };
const OUT_DIR = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'outlands-freeplay');

/* The world gives a beamed-out member three 12-second tries to get a score
 * confirmation before it respawns them anyway. Nothing here shortens that. */
const RESPAWN_LIMIT_MS = 50000;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/* Spawns are read out of the world file, so the gate cannot drift into being a
 * copy of the content it checks. */
function spawnPoints() {
  const zlib = require('zlib');
  const world = path.join(__dirname, '..', '..', '..', 'spa', 'assets', 'worlds', 'ne_game', 'vrml', 'ne_game.wrl');
  const raw = fs.readFileSync(world);
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('latin1');
  const read = name => {
    const m = text.match(new RegExp(`field\\s+MFVec3f\\s+${name}\\s*\\[([^\\]]*)\\]`));
    return m ? m[1].trim().split(',').map(t => t.trim().split(/\s+/).map(Number)) : null;
  };
  return { 1: read('red_view_pos'), 2: read('blue_view_pos') };
}

async function open(browser, spec, tag) {
  const page = await browser.newPage();
  page.on('pageerror', e => process.stdout.write(`      [${tag}] page error: ${e.message.slice(0, 160)}\n`));
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', spec.user);
  await page.fill('input[type="password"]', spec.pass);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  /* Wear the side, the way the historical entrance does: the file name is what
   * carries the team, so the row has to be written, not just the id. */
  await page.evaluate(async id => {
    const app = document.querySelector('#app').__vue__;
    const res = await app.$http.post('/member/update_avatar', { avatarId: id });
    app.$store.methods.setToken(res.data.token);
    const list = await app.$http.get('/avatar');
    Object.assign(app.$store.data.user.avatar, list.data.avatars.find(a => a.id === id));
  }, spec.avatarId);
  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  await page.waitForTimeout(22000);
  return page;
}

/* Stand a client somewhere so the two can face each other. Binding a viewpoint
 * is how the world moves a player - set_viewpoint() binds battle_view - so the
 * duel is set up the same way rather than by poking the camera behind the
 * world's back. It has to be a viewpoint of the gate's own: writing battle_view
 * while battle_view is already bound moves nothing. */
const stand = (page, pos, rot) => page.evaluate(([p, r]) => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const vp = b.currentScene.createNode('Viewpoint');
  vp.position = new X3D.SFVec3f(p[0], p[1], p[2]);
  vp.orientation = new X3D.SFRotation(r[0], r[1], r[2], r[3]);
  vp.jump = true;
  b.currentScene.addRootNode(vp);
  vp.set_bind = true;
}, [pos, rot]);

/* The state the repulsor writes on the client it lands on. The push is a
 * ROUTE from rep_interp through to battle_view.set_position, so this is the
 * world moving the target, not the gate moving it. */
const pushState = page => page.evaluate(() => {
  const scene = X3D.getBrowser(document.querySelector('#world x3d-canvas')).currentScene;
  const clock = scene.getNamedNode('rep_clock');
  const view = scene.getNamedNode('battle_view');
  const keys = Array.from(scene.getNamedNode('rep_interp').getField('keyValue'))
    .map(v => [v.x, v.y, v.z]);
  return {
    startTime: Number(clock.startTime),
    keyValue: keys,
    battleView: [view.position.x, view.position.y, view.position.z],
  };
});

/* Where the world has decided the member should stand. This is battle_view,
 * the Viewpoint that set_viewpoint() moves on entry and on every respawn, and
 * it is the world's own answer rather than whatever the gate last bound. */
const worldSpawn = page => page.evaluate(() => {
  const view = X3D.getBrowser(document.querySelector('#world x3d-canvas'))
    .currentScene.getNamedNode('battle_view');
  const p = view.position;
  return [p.x, p.y, p.z];
});

const camera = page => page.evaluate(() => {
  const p = X3D.getBrowser(document.querySelector('#world x3d-canvas')).viewpointPosition;
  return [p.x, p.y, p.z];
});

/* A tap on the room message channel, so a failure says whether the message left
 * the shooter, arrived at the target, or was refused by the target's own
 * Script - three quite different faults that look identical from the outside. */
const tapMessages = page => page.evaluate(() => {
  window.__ctrSharedEvents = { sent: [], received: [] };
  const app = document.querySelector('#app').__vue__;
  const find = c => { if (c.users) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const socket = find(app).$socket;
  const emit = socket.emit.bind(socket);
  socket.emit = function (name, payload) {
    if (name === 'SE') window.__ctrSharedEvents.sent.push(payload);
    return emit(name, payload);
  };
  socket.on('SE', e => window.__ctrSharedEvents.received.push(e));
});

const messages = page => page.evaluate(() => window.__ctrSharedEvents || { sent: [], received: [] });

const state = page => page.evaluate(() => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const battle = b.currentScene.getNamedNode('battle');
  const f = n => { const v = battle.getField(n); return v.getValue ? v.getValue() : v; };
  const p = b.viewpointPosition;
  let message = null;
  try { message = Array.from(b.currentScene.getNamedNode('message').getField('string')).map(String); } catch (e) { /* none */ }
  let weapon = null;
  try { weapon = Array.from(b.currentScene.getNamedNode('weapon').getField('url')).map(String); } catch (e) { /* none */ }
  return {
    team: Number(f('team')),
    type: String(f('type')),
    ammo: { beamer: Number(f('b_ammo')), repulsor: Number(f('r_ammo')), aapd: Number(f('a_ammo')) },
    isBeamed: String(f('isBeamed')) === 'true',
    fireDisable: String(f('fire_disable')) === 'true',
    message,
    weapon,
    camera: [p.x, p.y, p.z],
    gravity: b.getGravity(),
    eventMask: b.eventMask,
    browserEventRoutes: (b.browserEventRoutes_ || []).length,
    knownAvatars: b.blaxxunAvatarCount(),
  };
});

/* What the shooter's own ray reports, which is the whole of hit detection. The
 * winning shape is described too, so a miss says what got in the way. */
const rayAt = (page, target) => page.evaluate(t => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const s = b.viewpointPosition;
  const dir = new X3D.SFVec3f(t[0], t[1], t[2]).subtract(s).normalize().multiply(1000);
  const hit = b.computeRayHit(s, s.add(dir));
  if (!hit) return null;
  const last = hit.hitPath[hit.hitPath.length - 1];
  let geometry = null;
  try { geometry = String(last.getField('geometry')).slice(0, 40); } catch (e) { geometry = null; }
  return {
    types: hit.hitPath.map(n => { const ty = n.getType(); return typeof ty === 'string' ? ty : n.getNodeTypeName(); }),
    nicknames: hit.hitPath.map(n => n.nickname).filter(Boolean),
    point: [hit.hitPoint.x, hit.hitPoint.y, hit.hitPoint.z].map(v => Number(v.toFixed(2))),
    from: [s.x, s.y, s.z].map(v => Number(v.toFixed(2))),
    geometry,
  };
}, target);

/* Cycle W until the wanted weapon is held. Counting presses is fragile once
 * the tests are reordered, and the world is the thing that knows. */
async function selectWeapon(page, want) {
  for (let i = 0; i < 4; i += 1) {
    if ((await state(page)).type === want) return true;
    await press(page, 'w');
  }
  return (await state(page)).type === want;
}

/* Press a gameplay key at the 3D screen. Focus rather than a click: a click is
 * a drag of zero length as far as the navigator is concerned, and over a dozen
 * key presses it walks the shooter's aim off the target. The click is what the
 * focus contract is about and is tested on its own below. */
const press = async (page, key) => {
  await page.evaluate(() => {
    const canvas = document.querySelector('#world x3d-canvas');
    if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
  });
  await page.waitForTimeout(300);
  await page.keyboard.press(key);
  await page.waitForTimeout(1200);
};

/* The state the AAPD's cloud writes on the client it reaches. */
const cloudState = page => page.evaluate(() => {
  const scene = X3D.getBrowser(document.querySelector('#world x3d-canvas')).currentScene;
  const t = scene.getNamedNode('aapd_trans').translation;
  return {
    startTime: Number(scene.getNamedNode('aapd_clock').startTime),
    at: [t.x, t.y, t.z],
  };
});

/* Waits for a beamed-out member to come back. */
async function waitForRespawn(page) {
  const started = Date.now();
  while (Date.now() - started < RESPAWN_LIMIT_MS) {
    await page.waitForTimeout(2000);
    const s = await state(page);
    if (!s.isBeamed) return { respawned: true, waitedMs: Date.now() - started, state: s };
  }
  return { respawned: false, waitedMs: Date.now() - started, state: await state(page) };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const spawns = spawnPoints();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const record = {};

  const red = await open(browser, RED, 'red');
  const blue = await open(browser, BLUE, 'blue');
  await red.waitForTimeout(4000);

  await tapMessages(red);
  await tapMessages(blue);

  let a = await state(red);
  let b = await state(blue);
  record.afterEntry = { red: a, blue: b };

  check('red citizen is on the Red team', a.team === RED.team, a.team);
  check('blue citizen is on the Blue team', b.team === BLUE.team, b.team);
  check('both clients are in one free-play zone', a.knownAvatars === 1 && b.knownAvatars === 1,
    { red: a.knownAvatars, blue: b.knownAvatars });
  check('the browser event route is delivered, not just accepted',
    a.browserEventRoutes === 1 && a.eventMask === ((1 << 4) | (1 << 5) | (1 << 6)),
    { routes: a.browserEventRoutes, mask: a.eventMask });
  check('the opening weapon is the Beamer', a.type === 'beamer', a.type);
  check('the opening ammunition is the historical load',
    a.ammo.beamer === 100 && a.ammo.repulsor === 7 && a.ammo.aapd === 4, a.ammo);

  /* W: the historical weapon order. */
  await press(red, 'w');
  const w1 = await state(red);
  await press(red, 'w');
  const w2 = await state(red);
  await press(red, 'w');
  const w3 = await state(red);
  record.weaponCycle = [w1.type, w2.type, w3.type];
  check('W changes weapon: beamer to repulsor', w1.type === 'repulsor', w1.type);
  check('W changes weapon: repulsor to AAPD', w2.type === 'aapd', w2.type);
  check('W changes weapon: AAPD back to beamer', w3.type === 'beamer', w3.type);
  check('the weapon model follows the weapon',
    w3.weapon && w3.weapon.join('').indexOf('beamer.wrl') > -1, w3.weapon);

  /* Keyboard focus safety: a member typing must not fire. */
  const ammoBeforeTyping = (await state(red)).ammo.beamer;
  await red.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'ctrFocusProbe';
    document.body.appendChild(input);
    input.focus();
  });
  await red.keyboard.type('dwa');
  await red.waitForTimeout(1000);
  const typed = await state(red);
  await red.evaluate(() => { const i = document.getElementById('ctrFocusProbe'); if (i) i.remove(); });
  /* "Click on the 3D screen to restore keyboard control." */
  await red.evaluate(() => {
    const i = document.createElement('input');
    i.id = 'ctrFocusProbe2';
    document.body.appendChild(i);
    i.focus();
  });
  const canvasEl = await red.$('#world x3d-canvas');
  await canvasEl.click({ position: { x: 40, y: 40 } });
  await red.waitForTimeout(400);
  const focusedWorld = await red.evaluate(() => {
    const ok = document.activeElement === document.querySelector('#world x3d-canvas');
    const i = document.getElementById('ctrFocusProbe2');
    if (i) i.remove();
    return ok;
  });
  check('clicking the 3D screen gives the keyboard back to the world', focusedWorld, focusedWorld);

  check('typing in a text field does not fire the weapon',
    typed.ammo.beamer === ammoBeforeTyping && typed.type === w3.type,
    { before: ammoBeforeTyping, after: typed.ammo.beamer, weapon: typed.type });

  /* Stand the two on the same ground, twelve metres apart, Red looking at Blue.
   * Identity rotation faces -Z. Done again after each beam-out, because a
   * respawn takes the beamed citizen back to their own side of the map. */
  async function faceOff() {
    await stand(blue, [spawns[1][0][0], spawns[1][0][1], spawns[1][0][2] - 13], [0, 1, 0, Math.PI]);
    await blue.waitForTimeout(6000);
    const at = await camera(blue);
    await stand(red, [at[0], at[1], at[2] + 12], [0, 1, 0, 0]);
    await red.waitForTimeout(6000);
    return { blue: at, red: await camera(red) };
  }
  record.duelPositions = await faceOff();
  const bluePos = record.duelPositions.blue;

  const ray = await rayAt(red, bluePos);
  record.ray = ray;
  check('the shooter\'s ray finds a person, not just a model',
    !!ray && ray.types.indexOf('Avatar') > -1, ray && ray.types);
  check('the person the ray finds is the other citizen',
    !!ray && ray.nicknames.indexOf(BLUE.user) > -1, ray && ray.nicknames);

  /* REPULSOR, two clients. The target is pushed by the world on its own
   * client; nothing here moves it. */
  const repulsorBefore = await pushState(blue);
  await selectWeapon(red, 'repulsor');
  const redRepulsor = await state(red);
  check('the shooter is holding the Repulsor', redRepulsor.type === 'repulsor', redRepulsor.type);
  await press(red, 'd');
  await blue.waitForTimeout(2500);
  const repulsorAfter = await pushState(blue);
  const redAfterRepulsor = await state(red);
  record.repulsor = { before: repulsorBefore, after: repulsorAfter };
  check('firing the Repulsor costs a round',
    redAfterRepulsor.ammo.repulsor === redRepulsor.ammo.repulsor - 1,
    { before: redRepulsor.ammo.repulsor, after: redAfterRepulsor.ammo.repulsor });
  const repulsorWire = {
    sent: (await messages(red)).sent.filter(m => m.name === 'RepulsorEvent'),
    received: (await messages(blue)).received.filter(m => m.name === 'RepulsorEvent'),
  };
  record.repulsorWire = repulsorWire;
  check('the Repulsor is sent as a room message', repulsorWire.sent.length > 0, repulsorWire.sent);
  check('the Repulsor message arrives at the other client',
    repulsorWire.received.length > 0, repulsorWire.received);
  check('the Repulsor reaches the other client',
    repulsorAfter.startTime > repulsorBefore.startTime,
    { before: repulsorBefore.startTime, after: repulsorAfter.startTime });
  check('the Repulsor pushes the other citizen',
    repulsorAfter.keyValue.length === 2
    && (Math.abs(repulsorAfter.keyValue[0][0] - repulsorAfter.keyValue[1][0]) > 0.5
      || Math.abs(repulsorAfter.keyValue[0][2] - repulsorAfter.keyValue[1][2]) > 0.5),
    repulsorAfter.keyValue);

  /* BEAMER, two clients. Back round the weapon cycle first: the Repulsor test
   * left the shooter holding the Repulsor. */
  await selectWeapon(red, 'beamer');
  record.beamerPositions = await faceOff();
  const beforeShot = { red: await state(red), blue: await state(blue) };
  check('the shooter is holding the Beamer', beforeShot.red.type === 'beamer', beforeShot.red.type);
  await press(red, 'd');
  await blue.waitForTimeout(2500);
  const afterShot = { red: await state(red), blue: await state(blue) };
  record.beamer = { beforeShot, afterShot };
  check('D fires: the shot costs the shooter a round',
    afterShot.red.ammo.beamer === beforeShot.red.ammo.beamer - 1,
    { before: beforeShot.red.ammo.beamer, after: afterShot.red.ammo.beamer });
  const beamerWire = {
    sent: (await messages(red)).sent.filter(m => m.name === 'BeamerEvent'),
    received: (await messages(blue)).received.filter(m => m.name === 'BeamerEvent'),
  };
  record.beamerWire = beamerWire;
  check('the Beamer is sent as a room message naming its target',
    beamerWire.sent.length > 0 && String(beamerWire.sent[0].value).indexOf(BLUE.user) > -1,
    beamerWire.sent);
  check('the Beamer message arrives at the other client', beamerWire.received.length > 0, beamerWire.received);
  check('the Beamer beams the other citizen out', afterShot.blue.isBeamed, afterShot.blue.isBeamed);
  check('a beamed citizen cannot fire back', afterShot.blue.fireDisable, afterShot.blue.fireDisable);
  check('the beamed citizen is told so',
    !!afterShot.blue.message && afterShot.blue.message.indexOf('BEAMED OUT') > -1,
    afterShot.blue.message);
  check('the shooter is not beamed out by their own shot', !afterShot.red.isBeamed, afterShot.red.isBeamed);

  /* RESPAWN. */
  const respawn = await waitForRespawn(blue);
  record.respawn = respawn;
  check('a beamed citizen comes back', afterShot.blue.isBeamed && respawn.respawned,
    { wasBeamed: afterShot.blue.isBeamed, waitedMs: respawn.waitedMs });
  check('the citizen comes back on their own side', respawn.state.team === BLUE.team, respawn.state.team);
  const respawnSpawn = await worldSpawn(blue);
  record.respawnSpawn = respawnSpawn;
  check('the citizen comes back at one of their side\'s spawns',
    !!spawns[BLUE.team] && spawns[BLUE.team].some(p =>
      Math.abs(p[0] - respawnSpawn[0]) < 0.01 && Math.abs(p[2] - respawnSpawn[2]) < 0.01),
    { battleView: respawnSpawn.map(v => Number(v.toFixed(3))), spawns: spawns[BLUE.team] });
  check('respawn restores the full ammunition load',
    respawn.state.ammo.beamer === 100 && respawn.state.ammo.repulsor === 7 && respawn.state.ammo.aapd === 4,
    respawn.state.ammo);
  check('respawn restores the Beamer', respawn.state.type === 'beamer', respawn.state.type);
  check('respawn restores normal gravity', respawn.state.gravity === true, respawn.state.gravity);
  check('respawn clears the beam-out message',
    !respawn.state.message || respawn.state.message.join('').indexOf('BEAMED OUT') === -1,
    respawn.state.message);

  /* AAPD, two clients. Its cloud beams out anyone of the other side within
   * ten metres of where the round landed, so the target has to be back on
   * their feet and back in front of the shooter first. */
  await selectWeapon(red, 'aapd');
  record.aapdPositions = await faceOff();
  const cloudBefore = await cloudState(blue);
  const redAapd = await state(red);
  check('the shooter is holding the AAPD', redAapd.type === 'aapd', redAapd.type);
  await press(red, 'd');
  await blue.waitForTimeout(3000);
  const cloudAfter = await cloudState(blue);
  const blueAfterAapd = await state(blue);
  const redAfterAapd = await state(red);
  record.aapdCloud = { before: cloudBefore, after: cloudAfter };
  record.aapd = { red: redAfterAapd, blue: blueAfterAapd };
  check('firing the AAPD costs a round',
    redAfterAapd.ammo.aapd === redAapd.ammo.aapd - 1,
    { before: redAapd.ammo.aapd, after: redAfterAapd.ammo.aapd });
  const aapdWire = {
    sent: (await messages(red)).sent.filter(m => m.name === 'AapdEvent'),
    received: (await messages(blue)).received.filter(m => m.name === 'AapdEvent'),
  };
  record.aapdWire = aapdWire;
  check('the AAPD is sent as a room message', aapdWire.sent.length > 0, aapdWire.sent);
  check('the AAPD message arrives at the other client', aapdWire.received.length > 0, aapdWire.received);
  check('the AAPD cloud reaches the other client',
    cloudAfter.startTime > cloudBefore.startTime,
    { before: cloudBefore.startTime, after: cloudAfter.startTime });
  check('the AAPD cloud lands where the round landed',
    !!aapdWire.received.length
    && Math.abs(cloudAfter.at[0] - aapdWire.received[0].value.x) < 0.01
    && Math.abs(cloudAfter.at[2] - aapdWire.received[0].value.z) < 0.01,
    { cloud: cloudAfter.at.map(v => Number(v.toFixed(2))), message: aapdWire.received[0] });
  /*
   * The AAPD's beam-out is NOT asserted, and that is a finding rather than a
   * gap. receive_aapd reads
   *
   *   if(dist < 10){ if(team == teamSent || lastBeamTime + 10 < t){return;} ... }
   *
   * so a citizen is immune unless they were beamed out within the last ten
   * seconds - the opposite polarity to receive_beamer, where the same test
   * guards against being beamed twice. On the historical Script as recovered,
   * a citizen who has been playing cleanly cannot be beamed out by an AAPD at
   * all. Nothing here corrects that: it is the world's own logic, and changing
   * it is a content decision, not a compatibility one.
   */
  check('the AAPD leaves a citizen who was not recently beamed alone, as the Script says',
    !blueAfterAapd.isBeamed, blueAfterAapd.isBeamed);
  check('the AAPD does not beam out the citizen who fired it',
    !redAfterAapd.isBeamed, redAfterAapd.isBeamed);

  /* Listener discipline across the beam-out and respawn. */
  const afterRespawn = { red: await state(red), blue: await state(blue) };
  record.listeners = { before: beforeShot, after: afterRespawn };
  check('the browser event route does not multiply over a beam-out',
    afterRespawn.red.browserEventRoutes === beforeShot.red.browserEventRoutes
    && afterRespawn.blue.browserEventRoutes === beforeShot.blue.browserEventRoutes,
    { red: afterRespawn.red.browserEventRoutes, blue: afterRespawn.blue.browserEventRoutes });
  check('neither client has gained a phantom citizen',
    afterRespawn.red.knownAvatars === 1 && afterRespawn.blue.knownAvatars === 1,
    { red: afterRespawn.red.knownAvatars, blue: afterRespawn.blue.knownAvatars });

  await red.screenshot({ path: path.join(OUT_DIR, 'red.png') });
  await blue.screenshot({ path: path.join(OUT_DIR, 'blue.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'freeplay.json'), JSON.stringify({ results, record }, null, 2));

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
