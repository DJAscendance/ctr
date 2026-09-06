'use strict';

/*
 * The Outlands spawn gate.
 *
 * Outlands parks a member with no team at y = -1000 and leaves them there. That
 * is the historical behaviour, not a fault: ne_game.wrl's `battle_view`
 * Viewpoint sits at 0 -1000 0, it is the first Viewpoint in the file so it is
 * what the browser binds, and `set_team` only moves the member once it has
 * worked out which side they are on.
 *
 * It works that out from the avatar they are wearing. The historical entry page
 * (ne_game/enter3D.tmpl) mapped the side the member picked to one of five
 * avatar URLs and published it as the `vrmlmyavatar` client parameter, which
 * Contact reported back as Browser.myAvatarURL:
 *
 *   redm.wrl / redf.wrl   -> team 1, the Red Team
 *   bluem.wrl / bluef.wrl -> team 2, the Blue Team
 *   gm.wrl                -> team 3, the Game Master
 *
 * So this gate is about the identity contract, not about the geometry. It
 * checks that CTR publishes an avatar identity at all, that wearing each team
 * avatar produces the spawn the historical file assigns to that team, and that
 * a member wearing an ordinary avatar still lands where a teamless member has
 * always landed rather than somewhere new.
 *
 * The spawn points are read out of the world file rather than written here, so
 * the gate cannot drift into being a copy of the content it is checking.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/outlands/tools/check-spawn.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'outlands');

/* avatar id -> the team ne_game.wrl assigns it. Ids are the catalogue rows
 * 11-avatars.outlands.seed creates; the file names are what the world matches. */
const TEAM_AVATARS = [
  { id: 16, file: 'redm.wrl', team: 1, label: 'Red Team (male)' },
  { id: 15, file: 'redf.wrl', team: 1, label: 'Red Team (female)' },
  { id: 14, file: 'bluem.wrl', team: 2, label: 'Blue Team (male)' },
  { id: 13, file: 'bluef.wrl', team: 2, label: 'Blue Team (female)' },
  { id: 12, file: 'gm.wrl', team: 3, label: 'Game Master' },
];
const PLAIN_AVATAR = { id: 1, file: 'default.wrl', label: 'default' };

/* The parking spot, straight out of ne_game.wrl's battle_view Viewpoint. */
const PARKED_Y = -1000;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/* The four spawn points each team uses, read from the world file. */
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

/* Wear an avatar exactly the way AvatarModal does: POST update_avatar, then
 * store the token it returns. The avatar row travels inside the JWT, so a
 * caller that skips the token keeps wearing the old avatar. */
async function wearAvatar(page, avatarId) {
  return page.evaluate(async id => {
    const app = document.querySelector('#app').__vue__;
    const store = app.$store;
    const res = await app.$http.post('/member/update_avatar', { avatarId: id });
    store.data.user.avatar.id = id;
    store.methods.setToken(res.data.token);
    return { ok: true, avatar: store.data.user.avatar };
  }, avatarId);
}

/* Enter Outlands and report where the member ends up once set_team has run.
 * set_team fires on teamTimer deactivating three seconds after the world
 * starts, so the reading has to be taken well after that. */
async function enterOutlands(page) {
  await page.evaluate(() => { window.location.hash = '#/citymap'; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  for (let attempt = 0; attempt < 22; attempt += 1) {
    await page.waitForTimeout(900);
    const roots = await page.evaluate(() => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return -1;
      try { return X3D.getBrowser(c).currentScene.rootNodes.length; } catch (e) { return -1; }
    });
    if (roots > 0) break;
  }
  /* three seconds for teamTimer, then room for the bind to settle */
  await page.waitForTimeout(8000);
  return page.evaluate(() => {
    const c = document.querySelector('#world x3d-canvas');
    if (!c) return { error: 'no canvas' };
    const b = X3D.getBrowser(c);
    const p = b.viewpointPosition;
    return { avatarURL: b.myAvatarURL, position: [p.x, p.y, p.z] };
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const spawns = spawnPoints();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await login(page);

  check('the world file still declares both teams\' spawn points',
    !!(spawns[1] && spawns[1].length === 4 && spawns[2] && spawns[2].length === 4));

  const observed = {};

  for (const avatar of TEAM_AVATARS) {
    const status = await wearAvatar(page, avatar.id);
    const state = await enterOutlands(page);
    observed[avatar.file] = { status, state };

    check(`${avatar.label}: CTR publishes an avatar identity`,
      typeof state.avatarURL === 'string' && state.avatarURL.endsWith(avatar.file),
      state.avatarURL);

    if (avatar.team === 3) {
      /* The Game Master is placed at a fixed overlook, not a team spawn. */
      check(`${avatar.label}: is lifted off the parking spot`,
        state.position && state.position[1] > PARKED_Y + 100, state.position);
      continue;
    }

    const points = spawns[avatar.team] || [];
    const matched = points.some(p =>
      Math.abs(p[0] - state.position[0]) < 2
      && Math.abs(p[2] - state.position[2]) < 2);
    check(`${avatar.label}: spawns on one of team ${avatar.team}'s four points`,
      matched, { at: state.position, expected: points });
    check(`${avatar.label}: is no longer under the map`,
      state.position[1] > PARKED_Y + 100, state.position[1]);
  }

  /* A member in an ordinary avatar has no side, and the historical file parks
   * them. That must still happen, and must not silently become a spawn. */
  await wearAvatar(page, PLAIN_AVATAR.id);
  const plain = await enterOutlands(page);
  observed[PLAIN_AVATAR.file] = { state: plain };
  check('an ordinary avatar still yields no team',
    plain.position && plain.position[1] < PARKED_Y + 100, plain.position);

  await page.screenshot({ path: path.join(OUT_DIR, 'outlands-spawn.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'spawn.json'),
    JSON.stringify({ spawns, observed, results }, null, 2));
  await browser.close();

  const failed = results.filter(r => !r.pass).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('ERROR', err); process.exit(2); });
