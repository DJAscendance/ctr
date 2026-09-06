'use strict';

/*
 * CTR_TEMPORARY_OUTLANDS_WORLD_ENTRY
 *
 * A migration-level gate, not an Outlands game gate.
 *
 * Outlands owns its own spawn. ne_game.wrl's `battle` Script decides a
 * member's side three seconds after the world starts and calls
 * `set_viewpoint()`, and until it does the member waits at `battle_view`'s
 * authored `position 0 -1000 0`. That parking spot is historical behaviour and
 * this gate does not ask for it to change.
 *
 * What the X_ITE 16.2.0 migration has to prove is narrower: a citizen who has
 * picked a side reaches one of that side's own historical spawns, at world
 * level, and a citizen who has not picked one never loads the world at all.
 * The bridge that does this lives in WorldBrowserPage.applyTemporaryOutlandsSpawn
 * and is temporary; full spawn ownership returns to the battle Script in the
 * dedicated Outlands restoration lane.
 *
 * The full historical spawn test - which requires the whole battle Script to
 * run - is preserved on the branch wip/outlands-xite16-full-restoration.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/outlands/tools/check-temp-entry.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'outlands');

/* The four public choices. The Game Master avatar is deliberately absent: it is
 * not a citizen choice and belongs to the Outlands restoration lane. Ids are the
 * catalogue rows 11-avatars.outlands.seed creates. */
const TEAM_AVATARS = [
  { id: 16, file: 'redm.wrl', team: 1, label: 'redm' },
  { id: 15, file: 'redf.wrl', team: 1, label: 'redf' },
  { id: 14, file: 'bluem.wrl', team: 2, label: 'bluem' },
  { id: 13, file: 'bluef.wrl', team: 2, label: 'bluef' },
];
const PLAIN_AVATAR = { id: 1, label: 'default' };

/* The parking spot, straight out of ne_game.wrl's battle_view Viewpoint. */
const PARKED_Y = -1000;
/* World level. Every historical team spawn sits between 1.7 and 6.1 metres. */
const WORLD_LEVEL_Y = -20;

const results = [];
const record = {};
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/* The spawn points are read out of the world file rather than written here, so
 * the gate cannot drift into being a copy of the content it is checking. */
function spawnPoints() {
  const zlib = require('zlib');
  const world = path.join(__dirname, '..', '..', '..', 'spa', 'assets', 'worlds',
    'ne_game', 'vrml', 'ne_game.wrl');
  const raw = fs.readFileSync(world);
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('latin1');
  const read = name => {
    const m = text.match(new RegExp(`field\\s+MFVec3f\\s+${name}\\s*\\[([^\\]]*)\\]`));
    if (!m) return null;
    return m[1].trim().split(',').map(triple => triple.trim().split(/\s+/).map(Number));
  };
  return { 1: read('red_view_pos'), 2: read('blue_view_pos') };
}

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
}

/* Wear an avatar exactly the way the entrance screen does: POST
 * update_avatar, store the returned token, and write the row into the store.
 * The file name is what carries the side, so a caller that only writes the id
 * leaves the member on their old side. */
async function wearAvatar(page, avatar) {
  return page.evaluate(async spec => {
    const app = document.querySelector('#app').__vue__;
    const store = app.$store;
    const res = await app.$http.post('/member/update_avatar', { avatarId: spec.id });
    store.methods.setToken(res.data.token);
    const list = await app.$http.get('/avatar');
    const row = list.data.avatars.find(a => a.id === spec.id);
    Object.assign(store.data.user.avatar, row || { id: spec.id });
    return { id: store.data.user.avatar.id, filename: store.data.user.avatar.filename };
  }, avatar);
}

async function goTo(page, hash) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
}

/* Wait until either the world has root nodes or the entrance screen is up. */
async function settle(page, attempts) {
  for (let attempt = 0; attempt < (attempts || 22); attempt += 1) {
    await page.waitForTimeout(900);
    const done = await page.evaluate(() => {
      if (document.body.innerText.indexOf('Select an avatar to enter Outlands') > -1) return true;
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return false;
      try { return X3D.getBrowser(c).currentScene.rootNodes.length > 0; } catch (e) { return false; }
    });
    if (done) break;
  }
}

/* Everything the report needs about where the member actually ended up. */
async function readState(page) {
  return page.evaluate(() => {
    const worldDiv = document.querySelector('#world');
    /* The historical entrance's own instruction to the citizen, taken from
     * ne_game/enter.tmpl. It is the line the screen exists to deliver, so it
     * identifies the entrance without depending on any styling. */
    const entrance = document.body.innerText
      .indexOf('Select an avatar to enter Outlands') > -1;
    const canvas = document.querySelector('#world x3d-canvas');
    const out = {
      entranceVisible: entrance,
      worldDivHidden: !worldDiv || worldDiv.style.display === 'none',
      target: window.ctrTemporaryOutlandsSpawn || null,
      worldURL: null,
      cameraPosition: null,
      activeViewpoint: null,
      navigationInfo: null,
      gravity: null,
      hudNodes: 0,
      rootNodes: 0,
    };
    if (!canvas) return out;
    const b = X3D.getBrowser(canvas);
    try { out.worldURL = String(b.currentScene.worldURL); } catch (e) { /* no scene */ }
    try { out.gravity = b.getBrowserOption('Gravity'); } catch (e) { /* no option */ }
    try {
      const p = b.viewpointPosition;
      out.cameraPosition = [p.x, p.y, p.z];
    } catch (e) { /* no viewpoint */ }
    /* Reported, not asserted on. X_ITE 16 keeps a bound Viewpoint's own fields
     * under underscore names on the live node, and the world rebinds its
     * `battle_view` after the bridge has placed the citizen, so the active
     * node is expected to be the world's, not the bridge's. What matters is
     * where the camera ends up, and getUserPosition above is that. */
    try {
      const vp = b.getActiveViewpoint();
      const pos = vp._position;
      const off = vp._positionOffset;
      out.activeViewpoint = {
        description: String(vp._description || ''),
        position: pos ? [pos.x, pos.y, pos.z] : null,
        offset: off ? [off.x, off.y, off.z] : null,
      };
    } catch (e) { /* no viewpoint */ }
    try {
      const scene = b.currentScene;
      out.rootNodes = scene.rootNodes.length;
      const nav = scene.rootNodes.filter(n => n && n.getNodeTypeName
        && n.getNodeTypeName() === 'NavigationInfo');
      if (nav.length) {
        out.navigationInfo = {
          count: nav.length,
          type: Array.from(nav[0].type),
          speed: nav[0].speed,
          avatarSize: Array.from(nav[0].avatarSize),
        };
      }
      const walk = node => {
        if (!node || typeof node.getNodeTypeName !== 'function') return;
        if (node.getNodeTypeName() === 'HUD') out.hudNodes += 1;
      };
      scene.rootNodes.forEach(walk);
    } catch (e) { /* no scene */ }
    return out;
  });
}

/* Enter Outlands the way a citizen does: through the city map, then the place.
 * The historical teamTimer runs three seconds after the world starts, so the
 * reading is taken after it, which also proves the bridge survives it. */
async function enterOutlands(page) {
  await goTo(page, '#/citymap');
  await page.waitForTimeout(1500);
  await goTo(page, '#/place/outlands');
  await settle(page);
  await page.waitForTimeout(6000);
  return readState(page);
}

function onTeamSpawn(spawns, team, position) {
  const points = spawns[team] || [];
  return points.some(p => Math.abs(p[0] - position[0]) < 3 && Math.abs(p[2] - position[2]) < 3);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const spawns = spawnPoints();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await login(page);

  check('the world file still declares both teams\' spawn points',
    !!(spawns[1] && spawns[1].length === 4 && spawns[2] && spawns[2].length === 4));

  /* No selection. The entrance screen must stay up and the world must not load. */
  await wearAvatar(page, PLAIN_AVATAR);
  const none = await enterOutlands(page);
  record.noSelection = none;
  check('no selection: the entrance screen stays visible', none.entranceVisible);
  check('no selection: ne_game.wrl is not loaded',
    !none.worldURL || none.worldURL.indexOf('ne_game') === -1, none.worldURL);
  check('no selection: the member is not sent to the parking spot',
    !none.cameraPosition || none.cameraPosition[1] > WORLD_LEVEL_Y,
    none.cameraPosition);

  /* Each of the four public choices. */
  for (const avatar of TEAM_AVATARS) {
    const worn = await wearAvatar(page, avatar);
    const state = await enterOutlands(page);
    record[avatar.label] = { worn, state };

    check(`${avatar.label}: wears the team avatar`,
      worn.filename === avatar.file, worn);
    check(`${avatar.label}: ne_game.wrl is loaded`,
      !!state.worldURL && state.worldURL.indexOf('ne_game') > -1, state.worldURL);
    check(`${avatar.label}: the bridge resolves team ${avatar.team}`,
      state.target && state.target.team === avatar.team, state.target);
    check(`${avatar.label}: the target is a historical spawn of that team`,
      state.target && onTeamSpawn(spawns, avatar.team, state.target.position),
      state.target && state.target.position);
    check(`${avatar.label}: the camera reaches that team's spawn`,
      state.cameraPosition && onTeamSpawn(spawns, avatar.team, state.cameraPosition),
      state.cameraPosition);
    check(`${avatar.label}: the camera is at world level`,
      state.cameraPosition && state.cameraPosition[1] > WORLD_LEVEL_Y
        && state.cameraPosition[1] > PARKED_Y + 100,
      state.cameraPosition && state.cameraPosition[1]);
    /* The citizen must stand where the bridge put them, not where the old
     * parking state left them. The world's own set_viewpoint rebinds
     * battle_view afterwards with `jump FALSE`, which by design keeps the
     * camera still, so the bridge's target is what survives. */
    check(`${avatar.label}: the citizen stands where the bridge put them`,
      state.cameraPosition && state.target
        && Math.abs(state.cameraPosition[0] - state.target.position[0]) < 0.5
        && Math.abs(state.cameraPosition[2] - state.target.position[2]) < 0.5
        && Math.abs(state.cameraPosition[1] - state.target.position[1]) < 1,
      { camera: state.cameraPosition, target: state.target && state.target.position });
    check(`${avatar.label}: gravity is on`, state.gravity > 0, state.gravity);
    check(`${avatar.label}: the world's own NavigationInfo is in charge`,
      state.navigationInfo && state.navigationInfo.count === 1, state.navigationInfo);
  }

  /* Leave and return. The side persists, and the member must not carry a stale
   * camera offset back in with them. */
  await goTo(page, '#/place/enter');
  await settle(page);
  await page.waitForTimeout(3000);
  const back = await enterOutlands(page);
  record.leaveAndReturn = back;
  const lastTeam = TEAM_AVATARS[TEAM_AVATARS.length - 1].team;
  check('leave and return: the member reaches their team spawn again',
    back.cameraPosition && onTeamSpawn(spawns, lastTeam, back.cameraPosition),
    back.cameraPosition);
  check('leave and return: the camera is at world level',
    back.cameraPosition && back.cameraPosition[1] > WORLD_LEVEL_Y,
    back.cameraPosition && back.cameraPosition[1]);
  check('leave and return: no stale camera offset is carried in',
    back.cameraPosition && back.target
      && Math.abs(back.cameraPosition[0] - back.target.position[0]) < 0.5
      && Math.abs(back.cameraPosition[2] - back.target.position[2]) < 0.5
      && Math.abs(back.cameraPosition[1] - back.target.position[1]) < 1,
    { camera: back.cameraPosition, target: back.target && back.target.position });

  /* The HUD only has to resolve. Its historical behaviour is out of scope. */
  check('the Outlands HUD node resolves', back.hudNodes > 0, back.hudNodes);

  await page.screenshot({ path: path.join(OUT_DIR, 'outlands-temp-entry.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'temp-entry.json'),
    JSON.stringify({ spawns, record, consoleErrors, results }, null, 2));
  await browser.close();

  const failed = results.filter(r => !r.pass).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('ERROR', err); process.exit(2); });
