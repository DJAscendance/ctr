'use strict';

/*
 * CTR_OUTLANDS_TEAM_AVATAR_BODIES
 *
 * The four Outlands team avatars are thin wrappers. Each is an EXTERNPROTO onto
 * "./m.wrl#Avatar" or "./f.wrl#Avatar" in its own catalogue directory and
 * carries nothing of its own but a texture and a weapon. If the shared body
 * file is missing the wrapper still parses and still reports a scene - it is
 * simply empty, and no other member can see the citizen.
 *
 * Loading the file on its own cannot settle it: the scene's only root is the
 * PROTO instance, and a PROTO's body is not reachable through the SAI field
 * interface. So this gate proves the body the way the game does.
 *
 * Two authenticated clients stand in one Outlands room. The observer casts the
 * game's own ray at the other citizen at three heights - head, chest and legs.
 * Since the narrow phase went in, computeRayHit only reports a hit when the ray
 * meets a real triangle, so three hits at three heights on a node the world
 * names after the other member is proof that the whole shared body arrived and
 * rendered. An empty wrapper cannot produce one.
 *
 * Each of the four is also photographed from the observer's screen.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/outlands/tools/check-team-avatar-bodies.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const OBSERVER = {
  user: process.env.CTR_QA_USER || 'testqa',
  pass: process.env.CTR_QA_PASS || 'testqa',
  avatarId: 16,
};
const SUBJECT = {
  user: process.env.CTR_QA_USER2 || 'outlandsqa2',
  pass: process.env.CTR_QA_PASS2 || 'outlandsqa2',
};
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'outlands-avatars');

/* The four catalogue rows the Outlands entrance offers, with the body each one
 * reaches for and the directory that body has to be in. */
const AVATARS = [
  { label: 'redm', id: 16, file: 'redm.wrl', body: 'm.wrl', team: 1 },
  { label: 'redf', id: 15, file: 'redf.wrl', body: 'f.wrl', team: 1 },
  { label: 'bluem', id: 14, file: 'bluem.wrl', body: 'm.wrl', team: 2 },
  { label: 'bluef', id: 13, file: 'bluef.wrl', body: 'f.wrl', team: 2 },
];

/* Head, chest and legs, as offsets from the other citizen's camera height. A
 * body that is only half there answers some of these and not the others. */
const HEIGHTS = [
  { label: 'head', drop: -0.3 },
  { label: 'chest', drop: 0.4 },
  { label: 'legs', drop: 1.1 },
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

async function open(browser, spec, avatarId, tag) {
  const page = await browser.newPage();
  page.on('pageerror', e => process.stdout.write(`      [${tag}] page error: ${e.message.slice(0, 120)}\n`));
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', spec.user);
  await page.fill('input[type="password"]', spec.pass);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  /* Wear the side the way the historical entrance does: the avatar file name
   * is what carries the team, so the row has to be written, not just the id. */
  await page.evaluate(async id => {
    const app = document.querySelector('#app').__vue__;
    const res = await app.$http.post('/member/update_avatar', { avatarId: id });
    app.$store.methods.setToken(res.data.token);
    const list = await app.$http.get('/avatar');
    Object.assign(app.$store.data.user.avatar, list.data.avatars.find(a => a.id === id));
  }, avatarId);
  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  await page.waitForTimeout(22000);
  return page;
}

const camera = page => page.evaluate(() => {
  const p = X3D.getBrowser(document.querySelector('#world x3d-canvas')).viewpointPosition;
  return [p.x, p.y, p.z];
});

/* Put a client somewhere. Binding a viewpoint is how the world itself moves a
 * player, and it only sets the shot up; nothing here casts anything. */
const stand = (page, pos, rot) => page.evaluate(([p, r]) => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const vp = b.currentScene.createNode('Viewpoint');
  vp.position = new X3D.SFVec3f(p[0], p[1], p[2]);
  vp.orientation = new X3D.SFRotation(r[0], r[1], r[2], r[3]);
  vp.jump = true;
  b.currentScene.addRootNode(vp);
  vp.set_bind = true;
}, [pos, rot]);

/* The game's own cast, aimed at a point. Reports what it met. */
const rayAt = (page, target) => page.evaluate(t => {
  const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const s = b.viewpointPosition;
  const dir = new X3D.SFVec3f(t[0], t[1], t[2]).subtract(s).normalize().multiply(1000);
  const hit = b.computeRayHit(s, s.add(dir));
  if (!hit) return null;
  return {
    types: hit.hitPath.map(n => {
      const ty = n.getType();
      return typeof ty === 'string' ? ty : n.getNodeTypeName();
    }),
    nicknames: hit.hitPath.map(n => n.nickname).filter(Boolean),
    point: [hit.hitPoint.x, hit.hitPoint.y, hit.hitPoint.z].map(v => Number(v.toFixed(2))),
  };
}, target);

const teamOf = page => page.evaluate(() => {
  const scene = X3D.getBrowser(document.querySelector('#world x3d-canvas')).currentScene;
  return Number(scene.getNamedNode('battle').getField('team'));
});

/* Read the spawn table out of the world file, so the gate does not become a
 * copy of the content it checks. */
function spawnPoints() {
  const zlib = require('zlib');
  const world = path.join(__dirname, '..', '..', '..', 'spa', 'assets', 'worlds',
    'ne_game', 'vrml', 'ne_game.wrl');
  const raw = fs.readFileSync(world);
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('latin1');
  const m = text.match(/field\s+MFVec3f\s+red_view_pos\s*\[([^\]]*)\]/);
  return m[1].trim().split(',').map(t => t.trim().split(/\s+/).map(Number));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const spawns = spawnPoints();
  const browser = await launchBrowser();
  const record = {};

  /* The catalogue check is cheap and worth doing first: a body file that is not
   * beside its wrapper cannot possibly render. */
  const observer = await open(browser, OBSERVER, OBSERVER.avatarId, 'observer');
  for (const avatar of AVATARS) {
    const status = await observer.evaluate(async u => {
      const r = await fetch(u);
      return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
    }, `/assets/avatars/${avatar.id}/${avatar.body}`);
    check(`${avatar.label}: the shared body ${avatar.body} is beside it`,
      status.status === 200 && status.bytes > 10000, status);
  }

  for (const avatar of AVATARS) {
    const subject = await open(browser, SUBJECT, avatar.id, avatar.label);
    const team = await teamOf(subject);

    /* Stand them twelve metres apart on one piece of Red-side ground, so the
     * cast is short and the aim comes from read-back positions. */
    await stand(subject, [spawns[0][0], spawns[0][1], spawns[0][2] - 13], [0, 1, 0, Math.PI]);
    await subject.waitForTimeout(6000);
    const at = await camera(subject);
    await stand(observer, [at[0], at[1], at[2] + 12], [0, 1, 0, 0]);
    await observer.waitForTimeout(6000);

    const hits = {};
    for (const h of HEIGHTS) {
      const hit = await rayAt(observer, [at[0], at[1] - h.drop, at[2]]);
      hits[h.label] = hit;
    }
    const named = h => !!h && h.nicknames.indexOf(SUBJECT.user) > -1
      && h.types.indexOf('Avatar') > -1;
    const struck = HEIGHTS.filter(h => named(hits[h.label]));
    /* Three hits at three heights must be three different places on one body,
     * not the same plate answering every ray. */
    const ys = struck.map(h => hits[h.label].point[1]);
    const spread = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;

    const shot = path.join(OUT_DIR, `${avatar.label}.png`);
    await observer.screenshot({ path: shot });
    record[avatar.label] = { team, subjectAt: at, hits, struck: struck.map(h => h.label), spread, shot };

    check(`${avatar.label}: the citizen wears team ${avatar.team}`, team === avatar.team, team);
    check(`${avatar.label}: the observer's ray finds their body at head, chest and legs`,
      struck.length === HEIGHTS.length, record[avatar.label].struck);
    check(`${avatar.label}: the three hits are at three different heights`,
      spread > 0.3, { ys: ys.map(v => Number(v.toFixed(2))), spread: Number(spread.toFixed(2)) });
    await subject.close();
  }

  /* The two male avatars share one body and the two female avatars share the
   * other, so within a pair the body has to answer at the same heights. */
  const struckSame = (a, b) => record[a].struck.join() === record[b].struck.join();
  check('redm and bluem answer the same way', struckSame('redm', 'bluem'),
    { redm: record.redm.struck, bluem: record.bluem.struck });
  check('redf and bluef answer the same way', struckSame('redf', 'bluef'),
    { redf: record.redf.struck, bluef: record.bluef.struck });

  fs.writeFileSync(path.join(OUT_DIR, 'team-avatar-bodies.json'),
    JSON.stringify({ results, record }, null, 2));
  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
