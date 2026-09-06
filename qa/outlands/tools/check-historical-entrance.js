'use strict';

/*
 * CTR_OUTLANDS_HISTORICAL_ENTRANCE
 *
 * Outlands was never reached through the ordinary Cybertown place screen.
 * `place?plc=ne_game` served ne_game/index.tmpl, whose "place" frame was
 * ne_game/enter.tmpl: the Outlands banner, the introductory fiction, four
 * special avatars, one optional scheduled-match password box and the full
 * instructions. There was no 2D Outlands room, no 2D/3D choice and no place
 * chat panel beneath it, and the 3D world only loaded once an avatar had been
 * chosen.
 *
 * This gate guards that structure. It is a page gate, not a game gate: where
 * the citizen lands once they have a side is proven by check-temp-entry.js,
 * and Outlands gameplay - weapons, scoring, matches, beam-out enforcement and
 * the Game Master - is deferred to the Outlands restoration lane.
 *
 * The expected wording and art below are read from the recovered capture of
 * enter.tmpl's rendered output in the OUTLANDS-ENTRY-0 evidence bundle.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/outlands/tools/check-historical-entrance.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'outlands');

/* An avatar carrying no side, so the entrance is what the member is shown. */
const PLAIN_AVATAR = { id: 1, label: 'default' };

/* The four public choices, in the order and grouping enter.tmpl gave them:
 * the Red pair in the left table cell, the Blue pair in the right. The Game
 * Master avatar is deliberately absent - it was never a citizen choice. */
const CHOICES = [
  { art: 'redm.jpg', alt: 'Join the Red Team' },
  { art: 'redf.jpg', alt: 'Join the Red Team' },
  { art: 'bluem.jpg', alt: 'Join the Blue Team' },
  { art: 'bluef.jpg', alt: 'Join the Blue Team' },
];

/* The section headings enter.tmpl set in cyan, in their historical order. */
const SECTIONS = [
  'Instructions',
  'Entering The Zone',
  'Controls',
  'Scoring',
  'Beam-out Weapons',
  'Ammunition',
  'Bases',
  'Beamer Cannons',
];

/* Historical copy that must survive verbatim. */
const PASSWORD_LABEL =
  'If you have a scheduled match, enter your password here and select an avatar to enter';
const BEAM_OUT_WARNING = 'Changing your avatar will cause you to beam out.';
const CONTROLS = [
  'key fires your weapon',
  'key allows you to pan your view, and aim up hills',
  'key will change your weapon',
];
const SCORING = [
  'Scoring is team based.',
  'Each beam-out will score one point for your team.',
  'During Free Play periods, team score will keep accumulating.',
];
const WEAPONS = ['Beamer', 'Repulsor', 'AaPD2000'];

const results = [];
const record = {};
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
}

/* Wear an avatar the way the entrance does: POST update_avatar, store the
 * returned token, and write the row into the store. The file name is what
 * carries the side. */
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

/* Go to Outlands and wait for the entrance to settle. */
async function openEntrance(page) {
  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(700);
    const up = await page.evaluate(() => document.body.innerText
      .indexOf('Select an avatar to enter Outlands') > -1);
    if (up) break;
  }
  await page.waitForTimeout(1200);
}

/* Everything the gate needs about the entrance as rendered. */
async function readEntrance(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const imgs = Array.from(document.querySelectorAll('img'));
    const src = el => (el.getAttribute('src') || '');
    const avatarButtons = Array.from(document.querySelectorAll('.oe-avatar'));
    const pass = document.querySelector('#outlands-pass');
    const label = pass && document.querySelector('label[for="outlands-pass"]');
    return {
      text,
      /* Every choice, with the art it draws, whether that art actually
       * decoded, and the accessible name the control carries. */
      choices: avatarButtons.map(btn => {
        const img = btn.querySelector('img');
        return {
          art: img ? src(img).split('/').pop() : null,
          loaded: !!(img && img.naturalWidth > 0),
          label: btn.getAttribute('aria-label'),
          disabled: btn.disabled,
        };
      }),
      banner: (() => {
        const b = imgs.find(i => src(i).indexOf('/ne_game/html/outlands.jpg') > -1);
        return b ? { present: true, loaded: b.naturalWidth > 0 } : { present: false };
      })(),
      /* The recovered instruction art. */
      controlsArt: (() => {
        const c = imgs.find(i => src(i).indexOf('controls_notxt.jpg') > -1);
        return c ? { present: true, loaded: c.naturalWidth > 0 } : { present: false };
      })(),
      turretArt: (() => {
        const t = imgs.find(i => src(i).indexOf('turret_noman.jpg') > -1);
        return t ? { present: true, loaded: t.naturalWidth > 0 } : { present: false };
      })(),
      ammoArt: ['beamer.jpg', 'repulsor.jpg', 'aapd.jpg'].map(name => {
        const a = imgs.find(i => src(i).indexOf(`/ne_game/html/${name}`) > -1);
        return { name, present: !!a, loaded: !!(a && a.naturalWidth > 0) };
      }),
      passwordField: !!pass,
      passwordLabel: label ? label.textContent.replace(/\s+/g, ' ').trim() : null,
      /* The normal place chrome that must not be here. */
      modeSelector: imgs.some(i => src(i).indexOf('b2dchat.gif') > -1
        || src(i).indexOf('b3dchat.gif') > -1),
      placeChat: !!document.querySelector('.bg-chat'),
      /*
       * Whether the Outlands world is mounted. The <x3d-canvas> element is
       * created once and then stays in the DOM for the life of the app, so its
       * presence proves nothing; replaceWorld(null) leaves the browser holding
       * the page URL instead of a world file. The #world container is also
       * hidden by v-show while the entrance has the screen.
       */
      worldLoaded: (() => {
        const c = document.querySelector('#world x3d-canvas');
        if (!c) return false;
        try {
          const url = X3D.getBrowser(c).currentScene.worldURL;
          return !!url && url.indexOf('ne_game') > -1;
        } catch (e) { return false; }
      })(),
      worldDivHidden: (() => {
        const d = document.querySelector('#world');
        return !d || d.style.display === 'none';
      })(),
      /* The control panel's Outlands art must lead back here. */
      outlandsButtonHref: (() => {
        const i = imgs.find(img => src(img).indexOf('outlandico') > -1);
        const a = i && i.closest('a');
        return a ? a.getAttribute('href') : null;
      })(),
    };
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await login(page);

  await wearAvatar(page, PLAIN_AVATAR);
  await openEntrance(page);
  const view = await readEntrance(page);
  record.entrance = Object.assign({}, view, { text: undefined });

  /* --- the entrance replaces the ordinary place screen --- */
  check('the historical entrance is shown instead of the place screen',
    view.text.indexOf('Select an avatar to enter Outlands') > -1);
  check('the ordinary 2D/3D selector is not offered', !view.modeSelector);
  check('the ordinary 2D place chat is not shown', !view.placeChat);
  check('no selection: ne_game.wrl is not loaded', !view.worldLoaded);
  check('no selection: the 3D world container is hidden', view.worldDivHidden);

  /* --- the four historical choices, drawn with the recovered art --- */
  check('four avatar choices are offered', view.choices.length === 4,
    view.choices.length);
  CHOICES.forEach((want, i) => {
    const got = view.choices[i];
    check(`choice ${i + 1} is ${want.art}`, !!got && got.art === want.art,
      got && got.art);
    check(`choice ${i + 1} draws the recovered art`, !!got && got.loaded);
    check(`choice ${i + 1} carries its historical label`,
      !!got && got.label === want.alt, got && got.label);
    check(`choice ${i + 1} can be taken`, !!got && !got.disabled);
  });
  check('the Game Master avatar is not offered',
    view.text.toLowerCase().indexOf('game master') === -1
    && !view.choices.some(c => (c.art || '').indexOf('gm') === 0));

  /* --- the recovered art around the instructions --- */
  check('the Outlands banner is drawn', view.banner.present && view.banner.loaded);
  check('the controls art is drawn', view.controlsArt.present && view.controlsArt.loaded);
  check('the beamer cannon art is drawn', view.turretArt.present && view.turretArt.loaded);
  view.ammoArt.forEach(a => {
    check(`the ${a.name} ammunition art is drawn`, a.present && a.loaded);
  });

  /* --- the instructions themselves --- */
  SECTIONS.forEach(section => {
    check(`the "${section}" section is present`, view.text.indexOf(section) > -1);
  });
  check('the beam-out warning is restored', view.text.indexOf(BEAM_OUT_WARNING) > -1);
  CONTROLS.forEach(line => {
    check(`the controls copy keeps "${line}"`, view.text.indexOf(line) > -1);
  });
  SCORING.forEach(line => {
    check(`the scoring copy keeps "${line}"`, view.text.indexOf(line) > -1);
  });
  WEAPONS.forEach(name => {
    check(`the ${name} is listed under Beam-out Weapons`, view.text.indexOf(name) > -1);
  });

  /* --- the scheduled-match password field --- */
  check('the password field is shown', view.passwordField);
  check('the password field keeps its historical label',
    view.passwordLabel === PASSWORD_LABEL, view.passwordLabel);

  /* --- the weapon information panel replaces the old popup --- */
  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a'))
      .find(a => a.textContent.trim() === 'Beamer');
    if (link) link.click();
  });
  await page.waitForTimeout(600);
  const arm = await page.evaluate(() => {
    const box = document.querySelector('.oe-info__box');
    const img = box && box.querySelector('img');
    return {
      open: !!box,
      text: box ? box.innerText : null,
      artLoaded: !!(img && img.naturalWidth > 0),
    };
  });
  record.weaponPanel = arm;
  check('the Beamer information opens in a panel', arm.open);
  check('the Beamer information keeps its recovered copy',
    !!arm.text && arm.text.indexOf('beamed') > -1 && arm.text.indexOf('BEAMER') > -1);
  check('the Beamer information draws its recovered art', arm.artLoaded);
  await page.screenshot({ path: path.join(OUT_DIR, 'entrance-weapon-panel.png') });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.oe-info__box button'))
      .find(b => b.textContent.trim() === 'Close');
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(OUT_DIR, 'entrance-full.png'), fullPage: true });
  await page.screenshot({ path: path.join(OUT_DIR, 'entrance-top.png') });

  /* --- a typed password must not quietly become free play --- */
  await page.fill('#outlands-pass', 'notarealmatch');
  await page.evaluate(() => {
    const btn = document.querySelectorAll('.oe-avatar')[0];
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);
  const afterPass = await page.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    const notice = document.querySelector('.oe-notice');
    return {
      notice: notice ? notice.textContent.replace(/\s+/g, ' ').trim() : null,
      avatar: app.$store.data.user.avatar.filename,
      worldLoaded: (() => {
        const c = document.querySelector('#world x3d-canvas');
        if (!c) return false;
        try {
          const url = X3D.getBrowser(c).currentScene.worldURL;
          return !!url && url.indexOf('ne_game') > -1;
        } catch (e) { return false; }
      })(),
      entranceStillUp: document.body.innerText
        .indexOf('Select an avatar to enter Outlands') > -1,
    };
  });
  record.password = afterPass;
  check('a typed password is refused with a notice', !!afterPass.notice, afterPass.notice);
  check('a typed password does not enter free play', !afterPass.worldLoaded);
  check('a typed password does not change the worn avatar',
    afterPass.avatar !== 'redm.wrl', afterPass.avatar);
  check('a typed password leaves the entrance up', afterPass.entranceStillUp);
  await page.screenshot({ path: path.join(OUT_DIR, 'entrance-password-refused.png') });

  /* --- clearing it enters free play --- */
  await page.fill('#outlands-pass', '');
  await page.evaluate(() => {
    const btn = document.querySelectorAll('.oe-avatar')[0];
    if (btn) btn.click();
  });
  for (let attempt = 0; attempt < 22; attempt += 1) {
    await page.waitForTimeout(900);
    const done = await page.evaluate(() => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return false;
      try { return X3D.getBrowser(c).currentScene.rootNodes.length > 0; } catch (e) { return false; }
    });
    if (done) break;
  }
  const entered = await page.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    const c = document.querySelector('#world x3d-canvas');
    let url = null;
    try { url = X3D.getBrowser(c).currentScene.worldURL; } catch (e) { url = null; }
    const imgs = Array.from(document.querySelectorAll('img'));
    return {
      avatar: app.$store.data.user.avatar.filename,
      worldURL: url,
      /* Chat comes back around the running world; Blaxxun Contact showed it
       * beside the scene, and only the 2D place screen was removed. */
      placeChat: !!document.querySelector('.bg-chat'),
      modeSelector: imgs.some(i => (i.getAttribute('src') || '').indexOf('b2dchat.gif') > -1),
      entranceStillUp: document.body.innerText
        .indexOf('Select an avatar to enter Outlands') > -1,
    };
  });
  record.entered = entered;
  check('an empty password enters free play', entered.avatar === 'redm.wrl', entered.avatar);
  check('the Outlands world is loaded',
    !!entered.worldURL && entered.worldURL.indexOf('ne_game') > -1, entered.worldURL);
  check('the entrance is replaced by the world', !entered.entranceStillUp);
  check('chat returns around the active 3D world', entered.placeChat);
  check('the 2D/3D selector returns once in the world', entered.modeSelector);
  await page.screenshot({ path: path.join(OUT_DIR, 'entrance-world-after-entry.png') });

  /* --- the control panel's Outlands art leads back to the entrance --- */
  check('the control panel Outlands button links to the Outlands place',
    entered.worldURL !== null && (view.outlandsButtonHref || '').indexOf('/place/outlands') > -1,
    view.outlandsButtonHref);

  /*
   * A member whose default is 2D. Outlands had no 2D room and no 2D/3D choice,
   * and there is no components/place/outlands/main2d.vue for the 2D branch to
   * import, so a member set to 2D must still be taken into the 3D battle zone.
   * They are wearing a side already from the step above.
   */
  await page.evaluate(() => { window.location.hash = '#/place/enter'; });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    document.querySelector('#app').__vue__.$store.methods.setView3d(false);
  });
  await page.waitForTimeout(6000);
  const wasTwoD = await page.evaluate(() => ({
    view3d: document.querySelector('#app').__vue__.$store.data.view3d,
    avatar: document.querySelector('#app').__vue__.$store.data.user.avatar.filename,
  }));
  check('the member is set to 2D before entering', wasTwoD.view3d === false, wasTwoD);
  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(900);
    const done = await page.evaluate(() => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return false;
      try {
        const url = X3D.getBrowser(c).currentScene.worldURL;
        return !!url && url.indexOf('ne_game') > -1;
      } catch (e) { return false; }
    });
    if (done) break;
  }
  const twoD = await page.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    const c = document.querySelector('#world x3d-canvas');
    let url = null;
    let camera = null;
    try {
      const b = X3D.getBrowser(c);
      url = b.currentScene.worldURL;
      const p = b.viewpointPosition;
      camera = p ? [p.x, p.y, p.z] : null;
    } catch (e) { url = null; }
    const d = document.querySelector('#world');
    return {
      view3d: app.$store.data.view3d,
      worldURL: url,
      camera,
      worldDivShown: !!d && d.style.display !== 'none',
    };
  });
  record.twoDDefault = twoD;
  check('a 2D member is moved to 3D for Outlands', twoD.view3d === true);
  check('a 2D member still loads the Outlands world',
    !!twoD.worldURL && twoD.worldURL.indexOf('ne_game') > -1, twoD.worldURL);
  check('a 2D member is shown the 3D world', twoD.worldDivShown);
  check('a 2D member lands at world level',
    !!twoD.camera && twoD.camera[1] > -20, twoD.camera);
  await page.screenshot({ path: path.join(OUT_DIR, 'entrance-2d-member-in-world.png') });

  /* Leave the QA account as it was found, wearing the ordinary avatar. */
  await wearAvatar(page, PLAIN_AVATAR);

  fs.writeFileSync(path.join(OUT_DIR, 'historical-entrance.json'),
    JSON.stringify({ record, consoleErrors, results }, null, 2));
  await browser.close();

  const failed = results.filter(r => !r.pass).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('ERROR', err); process.exit(2); });
