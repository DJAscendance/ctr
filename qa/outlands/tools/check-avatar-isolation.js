'use strict';

/*
 * CTR_BETA_OUTLANDS_AVATAR_ISOLATION
 *
 * An Outlands team avatar is temporary gameplay state. It must never become
 * the citizen's identity.
 *
 * check-system-avatars.js proves nobody can reach the five system rows through
 * an ordinary path. This gate proves the other half: that playing as one does
 * not leak out of Outlands - not into the authentication token, not into
 * durable browser storage, not into another tab, and not into a normal place.
 *
 * It exists because two QA runs of the same build disagreed. One navigated in a
 * way that happened to refresh `/member/session` first and saw the citizen's own
 * avatar; the other navigated straight to the Plaza and saw a team avatar. Both
 * observations were true, so both navigations are driven here, and neither may
 * be the one that passes.
 *
 * What is proved, in a real browser, as a real logged-in citizen:
 *
 *   - the POST that takes a side answers with gameplay data and no token;
 *   - `localStorage["token"]` is byte-for-byte the same before a side is taken,
 *     while the battle is running, and after leaving;
 *   - no other localStorage key appears either, so no token was merely moved;
 *   - Sequence A - take a side, refresh `/member/session`, navigate - lands in
 *     the Plaza wearing the citizen's own avatar;
 *   - Sequence B - take a side and navigate straight to the Plaza with NO
 *     session refresh - lands in exactly the same state;
 *   - browser Back out of Outlands does too;
 *   - a reload inside Outlands returns to the entrance with no side worn;
 *   - a second tab that was already in the Plaza is untouched;
 *   - a tab opened DURING the battle is the citizen, in their own avatar;
 *   - `member.avatar_id` never moves, read back from the server.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   export CTR_QA_USER=testqa CTR_QA_PASS=testqa
 *   DISPLAY=:1 node qa/outlands/tools/check-avatar-isolation.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace, URL } = require('../../phase2/lib/beta-client');
const O = require('../lib/outlands-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2]
  || path.join(REPO, '..', '..', '..', 'artifacts', 'outlands-avatar-isolation');
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
/* The avatar the citizen owns for the length of this gate. */
const ORDINARY = Number(process.env.CTR_QA_ORDINARY_AVATAR || 1);
/* The side taken in every sequence below. Blue, so a red result is visible. */
const SIDE = process.env.CTR_QA_OUTLANDS_SIDE || 'bluef';

let openBrowser = null;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(
    `${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`,
  );
}

/** Every key in localStorage, and the token exactly as stored. */
const storage = page => page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
  return { keys: keys.sort(), token: localStorage.getItem('token') };
});

/** The avatar the SERVER says the citizen owns, read back through the API. */
const permanentAvatar = page => page.evaluate(async () => {
  const app = document.querySelector('#app').__vue_app__.config.globalProperties;
  const res = await app.$http.get('/member/session');
  const payload = JSON.parse(atob(res.data.token.split('.')[1]));
  return { id: Number(payload.avatar.id), filename: payload.avatar.filename };
});

/**
 * What the page is drawing the local citizen as: the avatar the world was told
 * about, and the avatar row the store holds for them.
 *
 * `myAvatarURL` is the authoritative answer - it is the string a historical
 * world reads - so a page that kept a team avatar anywhere the world can see
 * cannot hide it here.
 */
const rendered = page => page.evaluate(() => {
  const app = document.querySelector('#app').__vue_app__.config.globalProperties;
  const own = app.$store.data.user && app.$store.data.user.avatar;
  let myAvatarURL = null;
  try {
    myAvatarURL = X3D.getBrowser(document.querySelector('#world x3d-canvas')).myAvatarURL;
  } catch (e) { /* no world yet */ }
  return {
    place: app.$store.data.place && app.$store.data.place.slug,
    storeAvatarId: own && Number(own.id),
    storeAvatarFile: own && own.filename,
    gameplayAvatar: app.$store.data.outlandsAvatar || null,
    myAvatarURL,
  };
});

/** True when nothing about this page names an Outlands system avatar. */
function noSystemAvatar(view) {
  const system = /gm\.wrl|bluef\.wrl|bluem\.wrl|redf\.wrl|redm\.wrl/;
  if (view.gameplayAvatar) return false;
  if (system.test(String(view.storeAvatarFile))) return false;
  if (view.myAvatarURL && system.test(view.myAvatarURL)) return false;
  return true;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  openBrowser = browser;
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const record = {};

  /* One context for tab A and tab B, so they share localStorage the way two
   * tabs of one browser really do. A leak between them is the point. */
  const context = await browser.newContext();
  const page = await login(context, USER, PASS);
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  await O.wearOrdinaryAvatar(page, ORDINARY);

  /* ---------------------------------------------------------------------
   * 1. The token, before anything Outlands has happened
   * ------------------------------------------------------------------ */
  const before = await storage(page);
  const ownAvatar = await permanentAvatar(page);
  record.before = { keys: before.keys, avatar: ownAvatar };
  check('the citizen starts on their own avatar', ownAvatar.id === ORDINARY, ownAvatar);

  /* ---------------------------------------------------------------------
   * 2. Taking a side
   * ------------------------------------------------------------------ */
  const postAnswer = await page.evaluate(async id => {
    const app = document.querySelector('#app').__vue_app__.config.globalProperties;
    const res = await app.$http.post('/avatar/outlands', { avatarId: id });
    return { keys: Object.keys(res.data).sort(), avatarKeys: Object.keys(res.data.avatar).sort() };
  }, O.SIDES[SIDE].avatarId);
  record.post = postAnswer;
  check('the Outlands POST answers with gameplay data and no token',
    postAnswer.keys.indexOf('token') === -1, postAnswer.keys);
  check('the answer carries only the fields the runtime reads',
    JSON.stringify(postAnswer.avatarKeys) === JSON.stringify(['directory', 'filename', 'id', 'team']),
    postAnswer.avatarKeys);

  /* ---------------------------------------------------------------------
   * 3. Sequence B, the one that failed: a side, then straight to the Plaza
   *    with NO session refresh in between.
   * ------------------------------------------------------------------ */
  await O.enterOutlandsThroughEntrance(page, SIDE);
  const during = await storage(page);
  const inBattle = await rendered(page);
  record.during = { keys: during.keys, view: inBattle };
  check('the authentication token is untouched while the battle runs',
    during.token === before.token);
  check('no new durable key appeared to carry one instead',
    JSON.stringify(during.keys) === JSON.stringify(before.keys), during.keys);
  check('the world was told the side that was chosen',
    !!inBattle.myAvatarURL && inBattle.myAvatarURL.indexOf(`${SIDE}.wrl`) !== -1,
    inBattle.myAvatarURL);
  check('the citizen still owns their own avatar in the store',
    Number(inBattle.storeAvatarId) === ORDINARY, inBattle.storeAvatarId);
  const duringPermanent = await permanentAvatar(page);
  check('member.avatar_id is unchanged during the battle',
    duringPermanent.id === ownAvatar.id, duringPermanent);

  /* Straight to the Plaza. Nothing is refreshed first on purpose. */
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  const seqB = await rendered(page);
  const afterB = await storage(page);
  record.sequenceB = { view: seqB, keys: afterB.keys };
  check('B: the Plaza renders no system avatar without a session refresh',
    noSystemAvatar(seqB), seqB);
  check('B: the citizen is back in their own avatar', Number(seqB.storeAvatarId) === ORDINARY);
  check('B: the authentication token is still the original', afterB.token === before.token);

  /* ---------------------------------------------------------------------
   * 4. Sequence A, the one that passed: a side, a session refresh, then the
   *    Plaza. It must still pass.
   * ------------------------------------------------------------------ */
  await O.enterOutlandsThroughEntrance(page, SIDE);
  await permanentAvatar(page); /* the /member/session call the passing run made */
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  const seqA = await rendered(page);
  const afterA = await storage(page);
  record.sequenceA = { view: seqA, keys: afterA.keys };
  check('A: the Plaza renders no system avatar after a session refresh',
    noSystemAvatar(seqA), seqA);
  check('A: the authentication token is still the original', afterA.token === before.token);

  /* ---------------------------------------------------------------------
   * 5. Browser Back out of a battle
   * ------------------------------------------------------------------ */
  await O.enterOutlandsThroughEntrance(page, SIDE);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const app = document.querySelector('#app').__vue_app__.config.globalProperties;
    return !!app && app.$store.data.place && app.$store.data.place.slug !== 'outlands';
  }, undefined, { timeout: 60000 });
  const back = await rendered(page);
  const afterBack = await storage(page);
  record.back = { view: back, keys: afterBack.keys };
  check('Back leaves no system avatar behind', noSystemAvatar(back), back);
  check('Back leaves the authentication token alone', afterBack.token === before.token);

  /* ---------------------------------------------------------------------
   * 6. A hard reload inside a battle
   * ------------------------------------------------------------------ */
  await O.enterOutlandsThroughEntrance(page, SIDE);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.oe-avatar:not([disabled])', { timeout: 60000 });
  const reloaded = await rendered(page);
  const afterReload = await storage(page);
  record.reload = { view: reloaded, keys: afterReload.keys, entrance: true };
  check('a reload returns to the entrance with no side worn',
    noSystemAvatar(reloaded), reloaded);
  check('a reload leaves the authentication token alone',
    afterReload.token === before.token);

  /* ---------------------------------------------------------------------
   * 7. Two tabs of one account: B is in the Plaza while A plays
   * ------------------------------------------------------------------ */
  const tabB = await context.newPage();
  await tabB.goto(`${URL}/#/place/enter`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await tabB.waitForFunction(() => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__.config.globalProperties;
    return !!(app && app.$store.data.isUser && app.$store.data.user.avatar);
  }, undefined, { timeout: 60000 });
  const tabBBefore = await rendered(tabB);

  await O.enterOutlandsThroughEntrance(page, SIDE);
  const tabBDuring = await rendered(tabB);
  const tabBStorage = await storage(tabB);
  record.secondTab = { before: tabBBefore, during: tabBDuring };
  check('the second tab keeps its own place', tabBDuring.place === tabBBefore.place);
  check('the second tab keeps the citizen\'s own avatar', noSystemAvatar(tabBDuring), tabBDuring);
  check('the second tab still holds the original token', tabBStorage.token === before.token);

  /* ---------------------------------------------------------------------
   * 8. A tab opened DURING the battle
   * ------------------------------------------------------------------ */
  const tabC = await context.newPage();
  await tabC.goto(`${URL}/#/place/enter`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await tabC.waitForFunction(() => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__.config.globalProperties;
    return !!(app && app.$store.data.isUser && app.$store.data.user.avatar);
  }, undefined, { timeout: 60000 });
  const tabCView = await rendered(tabC);
  record.newTab = tabCView;
  check('a tab opened mid-battle is the citizen, not a soldier',
    noSystemAvatar(tabCView), tabCView);
  check('a tab opened mid-battle wears the citizen\'s own avatar',
    Number(tabCView.storeAvatarId) === ORDINARY, tabCView.storeAvatarId);

  /* ---------------------------------------------------------------------
   * 9. The permanent avatar, last of all
   * ------------------------------------------------------------------ */
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  const finalAvatar = await permanentAvatar(page);
  const finalStorage = await storage(page);
  record.after = { avatar: finalAvatar, keys: finalStorage.keys };
  check('member.avatar_id is unchanged after everything',
    finalAvatar.id === ownAvatar.id, finalAvatar);
  check('the authentication token is byte-for-byte the one we logged in with',
    finalStorage.token === before.token);
  check('no durable key was left behind',
    JSON.stringify(finalStorage.keys) === JSON.stringify(before.keys), finalStorage.keys);

  const passed = results.filter(r => r.pass).length;
  record.results = results;
  record.summary = { passed, total: results.length };
  fs.writeFileSync(
    path.join(OUT_DIR, 'avatar-isolation.json'), `${JSON.stringify(record, null, 2)}\n`,
  );
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  openBrowser = null;
  process.exit(passed === results.length ? 0 : 1);
})().catch(async error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  if (openBrowser) await openBrowser.close().catch(() => undefined);
  process.exit(2);
});
