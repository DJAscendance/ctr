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
const { launch: launchBrowser } = require('../../lib/browser');

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

/* Console errors and warnings, kept per client. The audio question - the
 * non-finite AudioParam complaints seen while firing - can only be classified
 * from what the page actually says, so the gate keeps them all. */
const consoleLog = [];

async function open(browser, spec, tag) {
  const page = await browser.newPage();
  page.on('pageerror', e => process.stdout.write(`      [${tag}] page error: ${e.message.slice(0, 160)}\n`));
  page.on('console', m => {
    const type = m.type();
    if (type !== 'error' && type !== 'warning') return;
    consoleLog.push({ tag, type, at: Date.now(), text: m.text().slice(0, 300) });
  });
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
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const vp = b.viewpointPosition;
  const vo = b.viewpointOrientation;
  return {
    startTime: Number(clock.startTime),
    keyValue: keys,
    battleView: [view.position.x, view.position.y, view.position.z],
    battleViewOrientation: [view.orientation.x, view.orientation.y, view.orientation.z, view.orientation.angle],
    camera: [vp.x, vp.y, vp.z].map(v => Number(v.toFixed(3))),
    cameraOrientation: [vo.x, vo.y, vo.z, vo.angle].map(v => Number(v.toFixed(4))),
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

/* The exact ray fire() casts - from the camera, 1000 m along the view, plus
 * the Script's own `offset`, which this world declares as 0 0 0. Used only to
 * VERIFY an aim before the key is pressed; the D press does the real work. */
const fireRay = page => page.evaluate(() => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const s = b.viewpointPosition;
  const end = s.add(b.viewpointOrientation.multVec(new X3D.SFVec3f(0, 0, -1000)));
  const hit = b.computeRayHit(s, end);
  if (!hit) return null;
  return {
    types: hit.hitPath.map(n => { const ty = n.getType(); return typeof ty === 'string' ? ty : n.getNodeTypeName(); }),
    nicknames: hit.hitPath.map(n => n.nickname).filter(Boolean),
    point: [hit.hitPoint.x, hit.hitPoint.y, hit.hitPoint.z].map(v => Number(v.toFixed(2))),
    from: [s.x, s.y, s.z].map(v => Number(v.toFixed(2))),
  };
});

/* Turn the shooter to face a point, derived from read-back positions rather
 * than from keyboard walking. Binding a viewpoint is the supported QA setup -
 * it is how the world itself moves a player - and it only sets up the shot;
 * nothing here casts, sends or receives anything. */
const aimAt = (page, target, dropY) => page.evaluate(([t, drop]) => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const s = b.viewpointPosition;
  const d = [t[0] - s.x, (t[1] - drop) - s.y, t[2] - s.z];
  const yaw = Math.atan2(-d[0], -d[2]);
  const pitch = Math.atan2(d[1], Math.sqrt(d[0] * d[0] + d[2] * d[2]));
  const rot = new X3D.SFRotation(0, 1, 0, yaw).multiply(new X3D.SFRotation(1, 0, 0, pitch));
  const vp = b.currentScene.createNode('Viewpoint');
  vp.position = new X3D.SFVec3f(s.x, s.y, s.z);
  vp.orientation = rot;
  vp.jump = true;
  b.currentScene.addRootNode(vp);
  vp.set_bind = true;
}, [target, dropY || 0]);

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
  const browser = await launchBrowser();
  const record = {};

  const red = await open(browser, RED, 'red');
  let blue = await open(browser, BLUE, 'blue');
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

  /* A, live: the world Script asks for PAN while the key is held and WALK on
   * release. The compat layer records the requested mode on the browser
   * (viewer_); X_ITE's own walking behaviour is not replaced, which is a
   * documented limit, so what is asserted is the delivered contract: both
   * transitions arrive and the mode ends on WALK. */
  await red.evaluate(() => {
    const canvas = document.querySelector('#world x3d-canvas');
    if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
  });
  await red.waitForTimeout(300);
  await red.keyboard.down('a');
  await red.waitForTimeout(600);
  const modeHeld = await red.evaluate(() =>
    X3D.getBrowser(document.querySelector('#world x3d-canvas')).viewer_ || null);
  await red.keyboard.up('a');
  await red.waitForTimeout(600);
  const modeReleased = await red.evaluate(() =>
    X3D.getBrowser(document.querySelector('#world x3d-canvas')).viewer_ || null);
  record.aKey = { held: modeHeld, released: modeReleased };
  check('holding A engages PAN', modeHeld === 'PAN', modeHeld);
  check('releasing A returns to WALK', modeReleased === 'WALK', modeReleased);
  const afterAKey = await state(red);
  check('the A key leaves the weapon and ammunition alone',
    afterAKey.ammo.beamer === ammoBeforeTyping && afterAKey.type === w3.type,
    { ammo: afterAKey.ammo.beamer, weapon: afterAKey.type });

  /* Stand the two on the same ground, twelve metres apart, Red looking at
   * Blue, then derive the aim from both READ-BACK camera positions and verify
   * it against the exact ray fire() will cast. Done again before every shot,
   * because a respawn takes the beamed citizen back to their own side and a
   * Repulsor push moves them. Nothing here fakes a hit: the aim loop only
   * turns the shooter, and the D press does all the work. */
  async function faceOff() {
    await stand(blue, [spawns[1][0][0], spawns[1][0][1], spawns[1][0][2] - 13], [0, 1, 0, Math.PI]);
    await blue.waitForTimeout(5000);
    const at = await camera(blue);
    await stand(red, [at[0], at[1], at[2] + 12], [0, 1, 0, 0]);
    await red.waitForTimeout(5000);
    let aim = null;
    for (const drop of [0.4, 0, 0.8, 0.2]) {
      const target = await camera(blue);
      await aimAt(red, target, drop);
      await red.waitForTimeout(1500);
      aim = await fireRay(red);
      if (aim && aim.nicknames.indexOf(BLUE.user) > -1) break;
    }
    return { blue: await camera(blue), red: await camera(red), aim };
  }

  /* Wire counters, so each shot is judged on its own delta. */
  const wire = async name => {
    const s = (await messages(red)).sent.filter(m => m.name === name);
    const r = (await messages(blue)).received.filter(m => m.name === name);
    return { sent: s.length, received: r.length, lastSent: s[s.length - 1] || null, lastReceived: r[r.length - 1] || null };
  };
  const aimHits = setup => !!setup.aim && setup.aim.nicknames.indexOf(BLUE.user) > -1;

  record.duel = await faceOff();
  check('the shooter\'s own fire ray finds a person, not just a model',
    !!record.duel.aim && record.duel.aim.types.indexOf('Avatar') > -1,
    record.duel.aim && record.duel.aim.types);
  check('the person the fire ray finds is the other citizen',
    aimHits(record.duel), record.duel.aim && record.duel.aim.nicknames);

  /* REPULSOR, two clients, three deterministic shots. The target is pushed by
   * the world on its own client; nothing here moves it. */
  await selectWeapon(red, 'repulsor');
  check('the shooter is holding the Repulsor', (await state(red)).type === 'repulsor');
  const repulsorShots = [];
  for (let shot = 0; shot < 3; shot += 1) {
    const setup = shot === 0 ? record.duel : await faceOff();
    const before = await pushState(blue);
    const w0 = await wire('RepulsorEvent');
    const ammo0 = (await state(red)).ammo.repulsor;
    await press(red, 'd');
    await blue.waitForTimeout(2500);
    const after = await pushState(blue);
    const w1 = await wire('RepulsorEvent');
    const ammo1 = (await state(red)).ammo.repulsor;
    repulsorShots.push({
      aimOk: aimHits(setup),
      costs: ammo1 === ammo0 - 1,
      sent: w1.sent > w0.sent,
      received: w1.received > w0.received,
      reached: after.startTime > before.startTime,
      pushed: after.keyValue.length === 2
        && (Math.abs(after.keyValue[0][0] - after.keyValue[1][0]) > 0.5
          || Math.abs(after.keyValue[0][2] - after.keyValue[1][2]) > 0.5),
      keyValue: after.keyValue,
      payload: w1.lastReceived,
      /* Section 9 evidence: where the target stood, what the wire carried,
       * and where the world's own push put them. */
      targetStartPosition: before.camera,
      targetStartOrientation: before.cameraOrientation,
      targetFinalPosition: after.battleView,
      targetFinalOrientation: after.battleViewOrientation,
      targetStartBattleView: before.battleView,
      /* The push is a ROUTE from rep_interp into battle_view, the world's own
       * Viewpoint. Two things prove the world did it, and neither depends on
       * where the target happened to be pushed from:
       *   - the world's interpolator was loaded with a real displacement, and
       *     its first key is the target's own standing position;
       *   - battle_view was driven to that interpolator's last key.
       * A plain "the position changed" test would be wrong here, because a
       * repeat shot from the same setup pushes the target to the same place
       * it was pushed to last time. */
      pushedFromTarget: Math.abs(after.keyValue[0][0] - before.camera[0]) < 0.1
        && Math.abs(after.keyValue[0][2] - before.camera[2]) < 0.1,
      moved: Math.abs(after.battleView[0] - after.keyValue[1][0]) < 0.01
        && Math.abs(after.battleView[1] - after.keyValue[1][1]) < 0.01
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
  check('the Repulsor message arrives at the other client (3/3)',
    rN('received') === 3, repulsorShots.map(s => s.received));
  check('the Repulsor reaches the other citizen\'s Script (3/3)',
    rN('reached') === 3, repulsorShots.map(s => s.reached));
  check('the Repulsor pushes the other citizen (3/3)',
    rN('pushed') === 3, repulsorShots.map(s => s.keyValue));
  check('the push starts from where the citizen is standing (3/3)',
    rN('pushedFromTarget') === 3, repulsorShots.map(s => ({ standing: s.targetStartPosition, key0: s.keyValue[0] })));
  check('the world drives the citizen to its own push endpoint (3/3)',
    rN('moved') === 3, repulsorShots.map(s => ({ to: s.targetFinalPosition, key1: s.keyValue[1] })));

  /* BEAMER, two clients, three deterministic shots, each with the full
   * beam-out and respawn cycle. */
  await selectWeapon(red, 'beamer');
  check('the shooter is holding the Beamer', (await state(red)).type === 'beamer');
  const beamerShots = [];
  let beforeShot = null;
  let firstRespawn = null;
  for (let shot = 0; shot < 3; shot += 1) {
    const setup = await faceOff();
    const s0 = { red: await state(red), blue: await state(blue) };
    if (shot === 0) beforeShot = s0;
    const w0 = await wire('BeamerEvent');
    await press(red, 'd');
    await blue.waitForTimeout(2500);
    const s1 = { red: await state(red), blue: await state(blue) };
    const w1 = await wire('BeamerEvent');
    const respawn = s1.blue.isBeamed
      ? await waitForRespawn(blue)
      : { respawned: false, waitedMs: 0, state: s1.blue };
    if (shot === 0) firstRespawn = respawn;
    beamerShots.push({
      aimOk: aimHits(setup),
      costs: s1.red.ammo.beamer === s0.red.ammo.beamer - 1,
      sent: w1.sent > w0.sent,
      named: !!w1.lastSent && String(w1.lastSent.value).indexOf(BLUE.user) > -1,
      received: w1.received > w0.received,
      beamed: s1.blue.isBeamed,
      cannotFire: s1.blue.fireDisable,
      told: !!s1.blue.message && s1.blue.message.indexOf('BEAMED OUT') > -1,
      shooterSafe: !s1.red.isBeamed,
      comesBack: respawn.respawned,
      waitedMs: respawn.waitedMs,
    });
  }
  record.beamerShots = beamerShots;
  const bN = k => beamerShots.filter(s => s[k]).length;
  check('the Beamer aim is deterministic (3/3)', bN('aimOk') === 3, beamerShots.map(s => s.aimOk));
  check('D fires: the shot costs the shooter a round (3/3)', bN('costs') === 3, beamerShots.map(s => s.costs));
  check('the Beamer is sent as a room message (3/3)', bN('sent') === 3, beamerShots.map(s => s.sent));
  check('the Beamer message names its target (3/3)', bN('named') === 3, beamerShots.map(s => s.named));
  check('the Beamer message arrives at the other client (3/3)',
    bN('received') === 3, beamerShots.map(s => s.received));
  check('the Beamer beams the other citizen out (3/3)', bN('beamed') === 3, beamerShots.map(s => s.beamed));
  check('a beamed citizen cannot fire back (3/3)', bN('cannotFire') === 3, beamerShots.map(s => s.cannotFire));
  check('the beamed citizen is told so (3/3)', bN('told') === 3, beamerShots.map(s => s.told));
  check('the shooter is never beamed out by their own shot (3/3)',
    bN('shooterSafe') === 3, beamerShots.map(s => s.shooterSafe));
  check('a beamed citizen comes back every time (3/3)',
    bN('comesBack') === 3, beamerShots.map(s => s.waitedMs));

  /* RESPAWN details, from the first full cycle. */
  record.respawn = firstRespawn;
  check('the citizen comes back on their own side',
    firstRespawn.state && firstRespawn.state.team === BLUE.team,
    firstRespawn.state && firstRespawn.state.team);
  check('respawn restores the full ammunition load',
    firstRespawn.state && firstRespawn.state.ammo.beamer === 100
    && firstRespawn.state.ammo.repulsor === 7 && firstRespawn.state.ammo.aapd === 4,
    firstRespawn.state && firstRespawn.state.ammo);
  check('respawn restores the Beamer',
    firstRespawn.state && firstRespawn.state.type === 'beamer',
    firstRespawn.state && firstRespawn.state.type);
  check('respawn restores normal gravity',
    firstRespawn.state && firstRespawn.state.gravity === true,
    firstRespawn.state && firstRespawn.state.gravity);
  check('respawn clears the beam-out message',
    firstRespawn.state && (!firstRespawn.state.message
      || firstRespawn.state.message.join('').indexOf('BEAMED OUT') === -1),
    firstRespawn.state && firstRespawn.state.message);
  const respawnSpawn = await worldSpawn(blue);
  record.respawnSpawn = respawnSpawn;
  check('the citizen comes back at one of their side\'s spawns',
    !!spawns[BLUE.team] && spawns[BLUE.team].some(p =>
      Math.abs(p[0] - respawnSpawn[0]) < 0.01 && Math.abs(p[2] - respawnSpawn[2]) < 0.01),
    { battleView: respawnSpawn.map(v => Number(v.toFixed(3))), spawns: spawns[BLUE.team] });

  /*
   * AAPD, two clients, three deterministic impacts.
   *
   * The historical receive_aapd carried a one-character defect, present and
   * byte-identical in every recovered copy back to June 2000:
   *
   *   if(dist < 10){ if(team == teamSent || lastBeamTime + 10 < t){return;} ... }
   *
   * lastBeamTime is written only at respawn, under the world's own comment
   * "set lastBeamTime disable beam out", and receive_beamer uses the same
   * expression as the CONDITION for beaming (you can be beamed only when the
   * ten-second respawn window is over). The `<` here inverted that: a clean
   * citizen could never be beamed by an AAPD, only one who had just
   * respawned - the exact opposite of the entrance copy, which promises the
   * cloud "forces anyone inside the perimeter to beam out". The runtime copy
   * now carries `>`: same team or the ten-second respawn window protects,
   * anyone else inside ten metres beams out, exactly the Beamer's rule.
   *
   * Every faceOff below leaves more than ten seconds between the target's
   * respawn and the shot, plus an explicit cushion, so the spawn-protection
   * window is over when the round lands.
   */
  await selectWeapon(red, 'aapd');
  check('the shooter is holding the AAPD', (await state(red)).type === 'aapd');
  const aapdShots = [];
  for (let shot = 0; shot < 3; shot += 1) {
    const setup = await faceOff();
    await blue.waitForTimeout(5000);
    const cloud0 = await cloudState(blue);
    const w0 = await wire('AapdEvent');
    const a0 = { red: await state(red), blue: await state(blue) };
    await press(red, 'd');
    await blue.waitForTimeout(3000);
    const cloud1 = await cloudState(blue);
    const w1 = await wire('AapdEvent');
    const a1 = { red: await state(red), blue: await state(blue) };
    const respawn = a1.blue.isBeamed
      ? await waitForRespawn(blue)
      : { respawned: false, waitedMs: 0, state: a1.blue };
    aapdShots.push({
      aimOk: aimHits(setup),
      costs: a1.red.ammo.aapd === a0.red.ammo.aapd - 1,
      sent: w1.sent > w0.sent,
      received: w1.received > w0.received,
      cloudReached: cloud1.startTime > cloud0.startTime,
      lands: !!w1.lastReceived
        && Math.abs(cloud1.at[0] - w1.lastReceived.value.x) < 0.01
        && Math.abs(cloud1.at[2] - w1.lastReceived.value.z) < 0.01,
      beamed: a1.blue.isBeamed,
      shooterSafe: !a1.red.isBeamed,
      comesBack: respawn.respawned,
      cloudAt: cloud1.at.map(v => Number(v.toFixed(2))),
      /* Section 7 evidence: the measured distance from the round's landing
       * point to where the target was standing when it landed. */
      targetAt: a0.blue.camera.map(v => Number(v.toFixed(2))),
      distanceToTarget: Number(Math.sqrt(
        (cloud1.at[0] - a0.blue.camera[0]) ** 2
        + (cloud1.at[1] - a0.blue.camera[1]) ** 2
        + (cloud1.at[2] - a0.blue.camera[2]) ** 2).toFixed(2)),
    });
    aapdShots[aapdShots.length - 1].inside10 = aapdShots[aapdShots.length - 1].distanceToTarget < 10;
  }
  record.aapdShots = aapdShots;
  const aN = k => aapdShots.filter(s => s[k]).length;
  check('the AAPD aim is deterministic (3/3)', aN('aimOk') === 3, aapdShots.map(s => s.aimOk));
  check('firing the AAPD costs a round (3/3)', aN('costs') === 3, aapdShots.map(s => s.costs));
  check('the AAPD is sent as a room message (3/3)', aN('sent') === 3, aapdShots.map(s => s.sent));
  check('the AAPD message arrives at the other client (3/3)',
    aN('received') === 3, aapdShots.map(s => s.received));
  check('the AAPD cloud reaches the other client (3/3)',
    aN('cloudReached') === 3, aapdShots.map(s => s.cloudReached));
  check('the AAPD cloud lands where the round landed (3/3)', aN('lands') === 3, aapdShots.map(s => s.cloudAt));
  check('every AAPD round measured lands inside ten metres of the enemy (3/3)',
    aN('inside10') === 3, aapdShots.map(s => s.distanceToTarget));
  check('the AAPD beams out an enemy inside ten metres (3/3)',
    aN('beamed') === 3, aapdShots.map(s => s.beamed));
  check('the AAPD does not beam out the citizen who fired it (3/3)',
    aN('shooterSafe') === 3, aapdShots.map(s => s.shooterSafe));
  check('an AAPD-beamed citizen comes back every time (3/3)',
    aN('comesBack') === 3, aapdShots.map(s => s.comesBack));

  /* An AAPD landing more than ten metres from the enemy: the round is real,
   * the cloud arrives, and nobody beams out. The shooter turns round and puts
   * the burst into the ground behind them. */
  const outside = await (async () => {
    await faceOff();
    let aim = null;
    for (const spec of [[30, 1.6], [15, 3], [8, 3]]) {
      const own = await camera(red);
      await aimAt(red, [own[0], own[1] - spec[1], own[2] + spec[0]], 0);
      await red.waitForTimeout(1200);
      aim = await fireRay(red);
      if (aim && aim.nicknames.length === 0) break;
    }
    await blue.waitForTimeout(4000);
    const bluePos = await camera(blue);
    const cloud0 = await cloudState(blue);
    const w0 = await wire('AapdEvent');
    await press(red, 'd');
    await blue.waitForTimeout(3000);
    const cloud1 = await cloudState(blue);
    const w1 = await wire('AapdEvent');
    const b1 = await state(blue);
    const dist = aim
      ? Math.sqrt((aim.point[0] - bluePos[0]) ** 2 + (aim.point[2] - bluePos[2]) ** 2)
      : null;
    return {
      aimPoint: aim && aim.point,
      distanceToTarget: dist === null ? null : Number(dist.toFixed(1)),
      arrived: w1.received > w0.received,
      cloudReached: cloud1.startTime > cloud0.startTime,
      beamed: b1.isBeamed,
    };
  })();
  record.aapdOutside = outside;
  check('an AAPD landing over ten metres away arrives but beams nobody',
    outside.arrived && outside.cloudReached
    && outside.distanceToTarget !== null && outside.distanceToTarget > 10 && !outside.beamed,
    outside);

  /* REAL AMMO PICKUP, live, with a normal citizen and no QA restock.
   *
   * ne_game.wrl places three Ammo dispensers inside each base. The Red base is
   * the Transform at 0 0 -407, so the world positions are
   *   aapd     -4.364 2 -436.66
   *   repulsor  5.952 2 -437.2
   *   beamer  -11.32 2 -433.29
   * Each Ammo holds a ProximitySensor of size 2 2 2, so a citizen has to get
   * within a metre of the dispenser on every axis. The sensor's enterTime
   * ROUTEs to the PROTO's own ammo_script, which sends type_changed into the
   * battle Script's set_ammo eventIn over the route the PROTO's initialize()
   * adds. Nothing below writes set_ammo, and nothing below writes an ammo
   * field; the only thing the gate does is stand the citizen there. The
   * Repulsor is used because the three Repulsor shots above already spent
   * rounds and the AAPD state is needed intact by the friendly-fire test. */
  const pickup = await (async () => {
    const AMMO_REPULSOR = [5.952, 2, -437.2];
    const before = await state(red);
    /* Negative control: five metres away is outside the 2 2 2 sensor. */
    await stand(red, [AMMO_REPULSOR[0], AMMO_REPULSOR[1], AMMO_REPULSOR[2] + 5], [0, 1, 0, 0]);
    await red.waitForTimeout(4000);
    const nearby = await state(red);
    /* Now walk the citizen onto the dispenser. */
    await stand(red, AMMO_REPULSOR, [0, 1, 0, 0]);
    await red.waitForTimeout(5000);
    const after = await state(red);
    return {
      dispenser: AMMO_REPULSOR,
      standingAt: after.camera,
      startedBelowFull: before.ammo.repulsor < 7,
      ammoBefore: before.ammo.repulsor,
      ammoOutsideSensor: nearby.ammo.repulsor,
      ammoAfter: after.ammo.repulsor,
      restoredToHistorical: after.ammo.repulsor === 7,
      qaSetAmmoCalls: 0,
      otherAmmoUntouched: after.ammo.beamer === before.ammo.beamer
        && after.ammo.aapd === before.ammo.aapd,
    };
  })();
  record.ammoPickup = pickup;
  check('the citizen reaches the ammunition dispenser under strength',
    pickup.startedBelowFull, { was: pickup.ammoBefore, full: 7 });
  check('standing clear of the dispenser reloads nothing',
    pickup.ammoOutsideSensor === pickup.ammoBefore, pickup.ammoOutsideSensor);
  check('the world\'s own ammunition dispenser reloads the citizen to the historical load',
    pickup.restoredToHistorical && pickup.qaSetAmmoCalls === 0, pickup);
  check('the dispenser reloads only the weapon it carries',
    pickup.otherAmmoUntouched, { after: (await state(red)).ammo });

  /* FRIENDLY FIRE. The second citizen re-enters wearing the red side (the
   * team is carried by the avatar file), and the same shots must do nothing
   * to a teammate. */
  await blue.close();
  blue = await open(browser, { user: BLUE.user, pass: BLUE.pass, avatarId: RED.avatarId, team: RED.team }, 'ally');
  await tapMessages(blue);
  const allyEntry = await state(blue);
  check('the second citizen re-enters wearing the red side', allyEntry.team === RED.team, allyEntry.team);

  await selectWeapon(red, 'beamer');
  const ffSetup = await faceOff();
  const ffW0 = await wire('BeamerEvent');
  await press(red, 'd');
  await blue.waitForTimeout(2500);
  const ffW1 = await wire('BeamerEvent');
  const ffBlue = await state(blue);
  record.friendlyBeamer = {
    aimOk: aimHits(ffSetup), sent: ffW1.sent > ffW0.sent,
    received: ffW1.received > ffW0.received, beamed: ffBlue.isBeamed,
  };
  check('a Beamer shot at a teammate is sent but beams nobody',
    record.friendlyBeamer.aimOk && record.friendlyBeamer.sent
    && record.friendlyBeamer.received && !record.friendlyBeamer.beamed,
    record.friendlyBeamer);

  await selectWeapon(red, 'aapd');
  /* The shooter has spent all four AAPD rounds (three impacts and the wide
   * shot) and has not respawned. Restock through the Script's own set_ammo
   * eventIn - the event the world's ammo dispensers route into - so the
   * friendly burst is fired with the world's ammunition, not with a QA
   * override of the fire path. */
  await red.evaluate(() => {
    const battle = X3D.getBrowser(document.querySelector('#world x3d-canvas'))
      .currentScene.getNamedNode('battle');
    battle.set_ammo = 'aapd';
  });
  const ffaSetup = await faceOff();
  await blue.waitForTimeout(4000);
  const ffaW0 = await wire('AapdEvent');
  const ffaCloud0 = await cloudState(blue);
  await press(red, 'd');
  await blue.waitForTimeout(3000);
  const ffaW1 = await wire('AapdEvent');
  const ffaCloud1 = await cloudState(blue);
  const ffaBlue = await state(blue);
  const ffaAt = ffaSetup.blue;
  record.friendlyAapd = {
    aimOk: aimHits(ffaSetup), arrived: ffaW1.received > ffaW0.received,
    cloudReached: ffaCloud1.startTime > ffaCloud0.startTime, beamed: ffaBlue.isBeamed,
    /* Section 7 evidence: the burst has to land inside ten metres, or it
     * proves nothing about the same-team rule. */
    targetAt: ffaAt.map(v => Number(v.toFixed(2))),
    cloudAt: ffaCloud1.at.map(v => Number(v.toFixed(2))),
    distanceToTarget: Number(Math.sqrt(
      (ffaCloud1.at[0] - ffaAt[0]) ** 2
      + (ffaCloud1.at[1] - ffaAt[1]) ** 2
      + (ffaCloud1.at[2] - ffaAt[2]) ** 2).toFixed(2)),
  };
  check('an AAPD burst beside a teammate beams nobody',
    record.friendlyAapd.arrived && record.friendlyAapd.cloudReached
    && record.friendlyAapd.distanceToTarget < 10 && !record.friendlyAapd.beamed,
    record.friendlyAapd);

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
  /* Group the console traffic, so one repeated warning does not read as many. */
  const consoleSummary = {};
  for (const e of consoleLog) {
    const key = e.text.replace(/[-+]?[0-9]*\.?[0-9]+/g, 'N').slice(0, 160);
    consoleSummary[key] = (consoleSummary[key] || 0) + 1;
  }
  record.console = { total: consoleLog.length, byMessage: consoleSummary };
  record.audioConsole = consoleLog.filter(e => /audio|AudioParam|non-finite|gain|panner/i.test(e.text));
  fs.writeFileSync(path.join(OUT_DIR, 'console.json'), JSON.stringify(consoleLog, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'freeplay.json'), JSON.stringify({ results, record }, null, 2));

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
