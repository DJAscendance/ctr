'use strict';

/*
 * CTR_BETA_OUTLANDS_ENTRANCE
 *
 * The historical way in, and the way back out.
 *
 * check-freeplay.js proves the battle. This gate proves the screen in front of
 * it: that all four historical choices work and put a citizen on the side the
 * world itself then reports, that the Game Master is not one of them, that a
 * scheduled-match password is refused rather than quietly dropped, that a
 * citizen whose ordinary view is 2D still arrives in the 3D battle zone, and
 * that leaving Outlands gives them their own face back - across a page load.
 *
 * Nothing here writes an avatar row directly. Every choice is a click on the
 * entrance, and every claim about a side is read out of ne_game.wrl's own
 * `battle` Script.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   export CTR_QA_USER=testqa CTR_QA_PASS=testqa
 *   export CTR_QA_USER_2D=testqa2d CTR_QA_PASS_2D=testqa   # chatdefault = 0
 *   DISPLAY=:1 node qa/outlands/tools/check-entrance.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace, worldURL } = require('../../phase2/lib/beta-client');
const O = require('../lib/outlands-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2]
  || path.join(REPO, '..', '..', '..', 'artifacts', 'outlands-entrance');
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
/* A member whose `chatdefault` is 0: the SPA puts them in the 2D view. */
const USER_2D = process.env.CTR_QA_USER_2D || 'testqa2d';
const PASS_2D = process.env.CTR_QA_PASS_2D || PASS;
/* The avatar a citizen is put back into, and the one they must be given back. */
const ORDINARY = Number(process.env.CTR_QA_ORDINARY_AVATAR || 1);

/* Held so the failure path can close it. */
let openBrowser = null;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

const canvasCount = page => page.evaluate(
  () => document.querySelectorAll('#world x3d-canvas').length,
);

/* Put a citizen back at the Plaza in their own clothes, so the entrance is
 * genuinely shown the next time Outlands is asked for. */
async function backToOrdinary(page) {
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  await O.wearOrdinaryAvatar(page, ORDINARY);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  openBrowser = browser;
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const record = {};

  const page = await login(await browser.newContext(), USER, PASS);
  await backToOrdinary(page);

  /* ---------------------------------------------------------------------
   * 1. The screen itself
   * ------------------------------------------------------------------ */
  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  await page.waitForSelector('.oe-avatar:not([disabled])', { timeout: 60000 });
  const entrance = await O.entranceState(page);
  record.entrance = entrance;

  check('the historical entrance is what Outlands shows first', entrance.shown);
  check('it offers exactly four choices, all of them available',
    entrance.choices.length === 4 && entrance.choices.every(c => c.enabled), entrance.choices);
  check('two of them are Red and two are Blue',
    entrance.choices.filter(c => c.label === 'Join the Red Team').length === 2
    && entrance.choices.filter(c => c.label === 'Join the Blue Team').length === 2,
    entrance.choices.map(c => c.label));
  /* The Game Master avatar is seeded, because the five historical file names
   * have to line up with their directories, but it was never a citizen choice
   * and the Game Master lane is deferred. */
  const gm = await page.evaluate(() => ({
    labelled: Array.from(document.querySelectorAll('.oe-avatar'))
      .some(b => /game ?master|\bgm\b/i.test(b.getAttribute('aria-label') || '')),
    art: Array.from(document.querySelectorAll('.oe-avatar img'))
      .map(i => i.getAttribute('src')).filter(src => /gm\.jpg$/.test(src || '')).length,
  }));
  record.gm = gm;
  check('the Game Master is not offered as a choice',
    gm.labelled === false && gm.art === 0, gm);
  check('the battle zone is not loaded, and its pane is not on screen',
    entrance.outlandsWorldLoaded === false && entrance.worldPaneShown === false,
    { loaded: entrance.outlandsWorldLoaded, paneShown: entrance.worldPaneShown });
  check('there is no 2D Outlands room and no place chat in front of it',
    !entrance.selector2d3d && !entrance.chatPanel,
    { selector: entrance.selector2d3d, chat: entrance.chatPanel });
  check('the citizen can still leave: the jump gate is there', entrance.wayOut);
  check('the scheduled-match password box is shown, as it historically was',
    entrance.passwordBox);

  /* ---------------------------------------------------------------------
   * 2. A typed password is refused, not quietly dropped into free play
   * ------------------------------------------------------------------ */
  await page.fill('#outlands-pass', 'PASS1');
  await page.locator('.oe-avatar[aria-label="Join the Red Team"]').nth(0).click({ timeout: 30000 });
  await page.waitForTimeout(4000);
  const refused = await page.evaluate(() => ({
    notice: (document.querySelector('.oe-notice') || {}).textContent || '',
    worn: (() => {
      const a = document.querySelector('#app').__vue__.$store.data.user.avatar;
      return a && a.filename;
    })(),
  }));
  const afterPassword = await O.entranceState(page);
  record.password = { refused, afterPassword };
  check('a typed match password is refused with a notice',
    /not restored yet/i.test(refused.notice), refused.notice.trim());
  check('and it does not fall through into free play',
    afterPassword.outlandsWorldLoaded === false && afterPassword.shown === true,
    { loaded: afterPassword.outlandsWorldLoaded, entranceStillUp: afterPassword.shown });
  check('and it leaves the citizen in their own clothes',
    refused.worn !== 'redm.wrl', refused.worn);

  await page.fill('#outlands-pass', '');

  /* ---------------------------------------------------------------------
   * 3. Every one of the four choices, end to end
   * ------------------------------------------------------------------ */
  record.sides = {};
  for (const side of ['redm', 'redf', 'bluem', 'bluef']) {
    const spec = O.SIDES[side];
    await backToOrdinary(page);
    const before = await O.enterOutlandsThroughEntrance(page, side);
    const state = await O.state(page);
    const worn = await O.wornAvatar(page);
    const canvases = await canvasCount(page);
    const loaded = await worldURL(page);
    record.sides[side] = { before, state, worn, canvases, loaded };
    check(`${side}: the world was not loaded before the choice was made`,
      before.outlandsWorldLoaded === false && before.worldPaneShown === false,
      { loaded: before.outlandsWorldLoaded, paneShown: before.worldPaneShown });
    check(`${side}: the citizen is playing as ${side}.wrl, from its own directory`,
      !!worn.gameplayAvatar && worn.gameplayAvatar.filename === `${side}.wrl`
      && worn.gameplayAvatar.id === spec.avatarId,
      { gameplayAvatar: worn.gameplayAvatar, ownAvatarId: worn.id });
    check(`${side}: the battle zone loaded once the side was worn`,
      /ne_game\.wrl/.test(String(loaded)), loaded);
    check(`${side}: the world's own set_team put them on team ${spec.team}`,
      state.team === spec.team, state.team);
    check(`${side}: the browser answered with the historical avatar URL`,
      state.myAvatarURL === `http://www.cybertown.com/places/ne_game/vrml/avatars/${side}.wrl`,
      state.myAvatarURL);
    check(`${side}: one canvas, so the world was built once`, canvases === 1, canvases);
  }

  /* ---------------------------------------------------------------------
   * 4. Leaving gives the citizen their own face back, across a page load
   * ------------------------------------------------------------------ */
  await backToOrdinary(page);
  const ordinaryBefore = await O.wornAvatar(page);
  await O.enterOutlandsThroughEntrance(page, 'bluef');
  const inUniform = await O.wornAvatar(page);
  /*
   * A side is tab-local gameplay state: it is not written to the server and not
   * written to browser storage, so a reload simply does not have one. The
   * historical entrance is what a reloaded battle lands on, and the citizen is
   * their own avatar again before any of it - there is nothing to restore.
   */
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue__;
    return !!(app && app.$store.data.isUser && app.$store.data.user.avatar);
  }, undefined, { timeout: 60000 });
  const afterReload = await O.wornAvatar(page);
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  await page.waitForTimeout(4000);
  const restored = await O.wornAvatar(page);
  record.restore = { ordinaryBefore, inUniform, afterReload, restored };

  check('the citizen entered in their own clothes',
    ordinaryBefore.id === ORDINARY, ordinaryBefore);
  check('the entrance dressed them for a side',
    !!inUniform.gameplayAvatar && inUniform.gameplayAvatar.filename === 'bluef.wrl', inUniform);
  check('wearing a side never touched the citizen\'s own avatar',
    inUniform.id === ORDINARY, inUniform);
  check('a reload drops the side rather than carrying it over',
    afterReload.gameplayAvatar === null && afterReload.id === ORDINARY, afterReload);
  check('the first ordinary place has their own avatar',
    restored.id === ORDINARY && restored.filename === ordinaryBefore.filename, restored);
  check('and no side is left behind',
    restored.gameplayAvatar === null, restored.gameplayAvatar);

  await enterPlace(page, '#/place/enter', 'enter.wrl');
  await page.waitForTimeout(2000);
  const secondJoin = await O.wornAvatar(page);
  record.secondJoin = secondJoin;
  check('a second ordinary join changes nothing further',
    secondJoin.id === ORDINARY && secondJoin.gameplayAvatar === null, secondJoin);

  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  await page.waitForSelector('.oe-avatar:not([disabled])', { timeout: 60000 });
  const again = await O.entranceState(page);
  record.again = again;
  check('returning to Outlands shows the historical entrance again',
    again.shown && again.outlandsWorldLoaded === false, again.shown);

  /* ---------------------------------------------------------------------
   * 5. A citizen whose ordinary view is 2D
   * ------------------------------------------------------------------ */
  const flat = await login(await browser.newContext(), USER_2D, PASS_2D);
  await enterPlace2d(flat);
  const flatBefore = await O.wornAvatar(flat);
  record.flatBefore = flatBefore;
  check('this citizen\'s ordinary view really is 2D', flatBefore.view3d === false, flatBefore);

  await flat.evaluate(() => { window.location.hash = '#/place/outlands'; });
  await flat.waitForSelector('.oe-avatar:not([disabled])', { timeout: 60000 });
  const flatEntrance = await O.entranceState(flat);
  record.flatEntrance = flatEntrance;
  check('a 2D citizen is shown the same entrance, not a 2D Outlands room',
    flatEntrance.shown && flatEntrance.outlandsWorldLoaded === false, flatEntrance.shown);

  await flat.locator('.oe-avatar[aria-label="Join the Red Team"]').nth(0).click({ timeout: 30000 });
  await flat.waitForFunction(() => {
    const c = document.querySelector('#world x3d-canvas');
    if (!c) return false;
    try {
      const b = X3D.getBrowser(c);
      const url = b && b.currentScene && b.currentScene.worldURL;
      return !!url && url.indexOf('ne_game.wrl') !== -1
        && !!b.currentScene.rootNodes && !!b.currentScene.rootNodes.length;
    } catch (e) { return false; }
  }, undefined, { timeout: 120000 });
  await O.waitForBattleTeam(flat);
  const flatIn = await O.wornAvatar(flat);
  const flatState = await O.state(flat);
  const flatShown = await O.entranceState(flat);
  const flatCanvases = await canvasCount(flat);
  record.flatIn = { flatIn, flatState, flatShown, flatCanvases };
  check('choosing a side moves them into the 3D battle zone',
    flatIn.view3d === true && flatShown.worldPaneShown === true,
    { view3d: flatIn.view3d, worldPane: flatShown.worldPaneShown });
  check('there is no second, 2D Outlands to be in', flatShown.shown === false, flatShown.shown);
  check('the world was still built exactly once', flatCanvases === 1, flatCanvases);
  check('and the world put them on a real side', flatState.team === O.SIDES.redm.team,
    flatState.team);

  await page.screenshot({ path: path.join(OUT_DIR, 'entrance.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'entrance.json'), JSON.stringify({ results, record }, null, 2));

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => {
  process.stdout.write(`FATAL ${e && e.stack ? e.stack : e}\n`);
  /* A failed gate closes its own browser, so the next run does not inherit
   * this one's presences as ghost citizens. */
  if (openBrowser) { try { await openBrowser.close(); } catch (x) { /* already gone */ } }
  process.exit(1);
});

/* The 2D citizen never loads a world, so enterPlace()'s worldURL wait would
 * never settle for them. Their arrival is the 2D pane being the one on screen. */
async function enterPlace2d(page) {
  await page.evaluate(() => { window.location.hash = '#/place/enter'; });
  await page.waitForFunction(() => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue__;
    return !!(app && app.$store.data.isUser && app.$store.data.user.avatar
      && app.$store.data.place && app.$store.data.place.slug === 'enter');
  }, undefined, { timeout: 60000 });
}
