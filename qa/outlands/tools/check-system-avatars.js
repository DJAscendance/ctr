'use strict';

/*
 * CTR_BETA_OUTLANDS_SYSTEM_AVATARS
 *
 * The Outlands avatars are system gameplay resources, not citizen avatars.
 *
 * check-entrance.js proves the four choices work. This gate proves the other
 * half of the same rule: that no citizen can reach any of the five anywhere
 * else, and that using one in Outlands never changes the avatar they own.
 *
 * What is proved, in a real browser, as a real logged-in citizen:
 *
 *   - GET /avatar, the ordinary library, returns none of the five;
 *   - the ordinary avatar picker UI shows none of the five;
 *   - POST /member/update_avatar, the persistent avatar-change path, refuses
 *     all five ids -- including when called directly, with the UI bypassed;
 *   - an ordinary public avatar is still listed, still selectable, and still
 *     persists;
 *   - the citizen's permanent avatar is unchanged before, during and after a
 *     visit to Outlands.
 *
 * The permanent value is read back from the SERVER (`GET /member/session`
 * refreshes the token from the database) rather than from the page's own
 * store, so the page cannot tell this gate what it wants to hear.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   export CTR_QA_USER=testqa CTR_QA_PASS=testqa
 *   DISPLAY=:1 node qa/outlands/tools/check-system-avatars.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace } = require('../../phase2/lib/beta-client');
const O = require('../lib/outlands-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2]
  || path.join(REPO, '..', '..', '..', 'artifacts', 'outlands-system-avatars');
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
/* The avatar the citizen owns for the length of this gate. */
const ORDINARY = Number(process.env.CTR_QA_ORDINARY_AVATAR || 1);

/* The five system avatars, and the four that are playable. */
const SYSTEM_FILES = ['gm.wrl', 'bluef.wrl', 'bluem.wrl', 'redf.wrl', 'redm.wrl'];
const SYSTEM_IDS = [12, 13, 14, 15, 16];

let openBrowser = null;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/** The avatar the SERVER says the citizen owns, read back through the API. */
const permanentAvatar = page => page.evaluate(async () => {
  const app = document.querySelector('#app').__vue__;
  const res = await app.$http.get('/member/session');
  const payload = JSON.parse(atob(res.data.token.split('.')[1]));
  return { id: Number(payload.avatar.id), filename: payload.avatar.filename };
});

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  openBrowser = browser;
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const record = {};

  const page = await login(await browser.newContext(), USER, PASS);
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  await O.wearOrdinaryAvatar(page, ORDINARY);

  /* ---------------------------------------------------------------------
   * 1. The ordinary avatar library
   * ------------------------------------------------------------------ */
  const library = await page.evaluate(async () => {
    const app = document.querySelector('#app').__vue__;
    const res = await app.$http.get('/avatar');
    return (res.data.avatars || []).map(a => ({ id: Number(a.id), filename: a.filename }));
  });
  record.library = library;
  const leaked = library.filter(a => SYSTEM_FILES.indexOf(a.filename) > -1);
  check('the ordinary avatar library returns no Outlands system avatar',
    leaked.length === 0, { found: leaked, libraryTotal: library.length });
  check('and it still returns ordinary public avatars',
    library.some(a => Number(a.id) === ORDINARY), library.length);

  /* ---------------------------------------------------------------------
   * 2. The ordinary avatar picker, on screen
   * ------------------------------------------------------------------ */
  /*
   * Driven the way a citizen drives it: the menu's information screen, then
   * its "Avatar Library" link. Nothing is opened by poking a component.
   */
  await page.locator('a.menuLink[style*="top: 78px"]').click({ timeout: 30000 });
  await page.locator('a:has-text("Avatar Library")').click({ timeout: 30000 });
  await page.waitForSelector('img[src^="/assets/avatars/"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const picker = await page.evaluate(files => {
    const images = Array.from(document.querySelectorAll('img'))
      .map(img => img.getAttribute('src') || '')
      .filter(src => src.indexOf('/assets/avatars/') === 0);
    return {
      shown: images.length,
      system: images.filter(
        src => files.some(f => src.indexOf(f.replace(/\.wrl$/, '.jpg')) > -1),
      ),
    };
  }, SYSTEM_FILES);
  record.picker = picker;
  await page.screenshot({ path: path.join(OUT_DIR, 'avatar-picker.png') });
  check('the ordinary avatar picker shows no Outlands system avatar',
    picker.system.length === 0, picker);
  check('and the picker is really showing avatars, so the check is not vacuous',
    picker.shown > 0, picker.shown);
  /* Put the screen back, so the rest of the gate is not run behind a modal.
   * Closed by its own X button, which is what a citizen would press. */
  await page.locator('.modal-root button.btn-ui-inline', { hasText: 'X' }).first()
    .click({ timeout: 30000 });
  await page.waitForSelector('.modal-root', { state: 'detached', timeout: 30000 });

  /* ---------------------------------------------------------------------
   * 3. The persistent avatar-change path, called directly
   * ------------------------------------------------------------------ */
  const before = await permanentAvatar(page);
  record.permanentBefore = before;
  const attempts = await page.evaluate(async ids => {
    const app = document.querySelector('#app').__vue__;
    const out = [];
    for (const id of ids) {
      try {
        await app.$http.post('/member/update_avatar', { avatarId: id });
        out.push({ id, accepted: true });
      } catch (e) {
        out.push({ id, accepted: false, status: e.response && e.response.status });
      }
    }
    return out;
  }, SYSTEM_IDS);
  record.directWrites = attempts;
  const rejected = attempts.filter(a => !a.accepted).length;
  check('all five system ids are refused by the persistent avatar-change path',
    rejected === SYSTEM_IDS.length, attempts);
  const afterAttempts = await permanentAvatar(page);
  check('and none of them was persisted',
    afterAttempts.id === before.id, { before, after: afterAttempts });

  /* An ordinary public avatar still works through the same path. */
  const ordinaryWrite = await page.evaluate(async id => {
    const app = document.querySelector('#app').__vue__;
    try {
      await app.$http.post('/member/update_avatar', { avatarId: id });
      return { accepted: true };
    } catch (e) {
      return { accepted: false, status: e.response && e.response.status };
    }
  }, ORDINARY);
  check('an ordinary public avatar is still accepted by the same path',
    ordinaryWrite.accepted, ordinaryWrite);

  /* ---------------------------------------------------------------------
   * 4. Outlands use is temporary
   * ------------------------------------------------------------------ */
  const permanentBeforeEntry = await permanentAvatar(page);
  record.permanentBeforeEntry = permanentBeforeEntry;

  await O.enterOutlandsThroughEntrance(page, 'bluef');

  const worn = await O.wornAvatar(page);
  record.wornInOutlands = worn;
  check('the citizen is playing as a team avatar inside Outlands',
    !!worn.gameplayAvatar && SYSTEM_FILES.indexOf(worn.gameplayAvatar.filename) > -1, worn);
  check('and a team avatar is never the avatar they own',
    SYSTEM_FILES.indexOf(worn.filename) === -1, worn.filename);

  const permanentDuring = await permanentAvatar(page);
  record.permanentDuring = permanentDuring;
  check('their permanent avatar is unchanged while they are in Outlands',
    permanentDuring.id === permanentBeforeEntry.id
    && permanentDuring.filename === permanentBeforeEntry.filename,
    { beforeEntry: permanentBeforeEntry, during: permanentDuring });
  check('and it is not a system avatar',
    SYSTEM_IDS.indexOf(permanentDuring.id) === -1, permanentDuring);

  await page.screenshot({ path: path.join(OUT_DIR, 'in-outlands.png') });

  /* Leaving. */
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  const permanentAfter = await permanentAvatar(page);
  record.permanentAfter = permanentAfter;
  check('their permanent avatar is unchanged after they leave',
    permanentAfter.id === permanentBeforeEntry.id
    && permanentAfter.filename === permanentBeforeEntry.filename,
    { beforeEntry: permanentBeforeEntry, after: permanentAfter });

  const wornAfter = await O.wornAvatar(page);
  record.wornAfter = wornAfter;
  check('and the avatar on screen is their own again',
    Number(wornAfter.id) === permanentBeforeEntry.id
    && wornAfter.gameplayAvatar === null, wornAfter);

  await page.screenshot({ path: path.join(OUT_DIR, 'after-outlands.png') });
  fs.writeFileSync(
    path.join(OUT_DIR, 'system-avatars.json'), JSON.stringify({ results, record }, null, 2),
  );

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => {
  process.stdout.write(`FATAL ${e && e.stack ? e.stack : e}\n`);
  if (openBrowser) { try { await openBrowser.close(); } catch (x) { /* already gone */ } }
  process.exit(1);
});
