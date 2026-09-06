'use strict';

/*
 * The gravity gate.
 *
 * blaxxun's Browser.setGravity is a plain on/off switch. X_ITE carries gravity
 * as the numeric "Gravity" browser option in metres per second squared, so
 * bxx_auth.js turns the switch into a write of 0 or of the value the world was
 * loaded with. Four archived home templates depend on it - worlds/007, /008,
 * /009 and /00a - and they are the only content in the repository that touches
 * gravity at all.
 *
 * Two distinct implementations use it:
 *
 *   007  PROTO Televator. A ProximitySensor arms `ts.set_uptrigger`, which
 *        switches gravity off, binds the lift's own Viewpoint and starts the
 *        clock that slides the platform. When the clock stops, `ts.set_up`
 *        switches gravity back on.
 *   008  PROTO FizzEffect, the same Script verbatim in /009 and /00a. `s`
 *        answers `set_time` by binding an effect Viewpoint and starting its
 *        clocks; the clock's isActive drives `s.set_active`, which switches
 *        gravity off while it runs and back on when it ends.
 *
 * /009 and /00a add a second `set_active` for their elevator viewpoints, but
 * that one does not touch gravity and its gravity Script is byte-for-byte the
 * one in /008, so /008 stands for all three.
 *
 * The worlds are loaded into the SPA's own browser, so the patch stack under
 * test is the one a citizen gets. Nothing here is a home restoration: the gate
 * only asks that gravity can go off, that the movement happens, and that it
 * comes back.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/check-gravity.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { SCENE_ACCESS_SOURCE } = require('../lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'gravity');

/** X_ITE's own default, and what "gravity on" has to restore. */
const EARTH = 9.80665;

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

async function enterPlace(page, slug) {
  await page.evaluate(s => { window.location.hash = `#/place/${s}`; }, slug);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(800);
    const roots = await page.evaluate(() => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return -1;
      try { return X3D.getBrowser(c).currentScene.rootNodes.length; } catch (e) { return -1; }
    });
    if (roots > 0) return roots;
  }
  return -1;
}

const gravity = page => page.evaluate(() => {
  const c = document.querySelector('#world x3d-canvas');
  return X3D.getBrowser(c).getBrowserOption('Gravity');
});

const setGravity = (page, on) => page.evaluate(flag => {
  const c = document.querySelector('#world x3d-canvas');
  X3D.getBrowser(c).setGravity(flag);
}, on);

/*
 * Load one of the home templates into the browser the SPA already built, so
 * the world runs under the patch stack a citizen gets without needing a QA
 * member whose home uses that template.
 */
async function loadTemplate(page, template) {
  const url = `/assets/worlds/${template}/home.wrl`;
  await page.evaluate(u => {
    const c = document.querySelector('#world x3d-canvas');
    X3D.getBrowser(c).loadURL(new X3D.MFString(u), new X3D.MFString());
  }, url);
  /* Every template is called home.wrl, so the wait has to name the template
   * directory or it is satisfied by the world that is already up. */
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(800);
    const ready = await page.evaluate(u => {
      const c = document.querySelector('#world x3d-canvas');
      try {
        const s = X3D.getBrowser(c).currentScene;
        return s.rootNodes.length > 0 && String(s.worldURL).indexOf(u) > -1;
      } catch (e) { return false; }
    }, url);
    if (ready) return true;
  }
  return false;
}

/*
 * Send one event into a Script inside a PROTO body and sample gravity and the
 * transform it drives until the run is over. The Script is reached through
 * scene-access, because a PROTO body is not on the SAI facade.
 */
async function runEffect(page, spec) {
  await page.evaluate(SCENE_ACCESS_SOURCE);
  return page.evaluate(async cfg => {
    const api = window.__ctr;
    const scene = api.scene();
    /*
     * findByDef returns every node carrying that DEF - once per PROTO
     * instance - so the first one is the instance this run drives.
     *
     * A PROTO instance that publishes the eventIn itself is driven through the
     * instance, and its body is where the Transform that moves lives. The walk
     * over the whole scene does reach PROTO bodies, but these two worlds are
     * large enough to exhaust its budget, so the body is asked directly.
     */
    let script;
    let where = scene;
    if (cfg.proto) {
      script = api.findByDef(cfg.proto, scene)[0];
      where = script ? api.protoBody(script) : null;
    } else {
      script = api.findByDef(cfg.script, scene)[0];
    }
    const mover = where ? api.findByDef(cfg.mover, where)[0] : null;
    if (!script || !mover) return { error: `missing ${cfg.proto || cfg.script}/${cfg.mover}` };
    const browser = api.browser();
    const read = () => ({
      gravity: browser.getBrowserOption('Gravity'),
      at: api.readVec3(mover, 'translation'),
    });
    const samples = [read()];
    try {
      script[cfg.event] = cfg.value === 'time' ? Date.now() / 1000 : cfg.value;
    } catch (e) {
      return { error: `could not send ${cfg.event}: ${e.message}` };
    }
    for (let i = 0; i < cfg.samples; i += 1) {
      await new Promise(r => setTimeout(r, cfg.every));
      samples.push(read());
    }
    return { samples };
  }, spec);
}

function summarise(run) {
  if (run.error) return { error: run.error };
  const gravities = run.samples.map(s => s.gravity);
  const points = run.samples.map(s => s.at).filter(Boolean);
  let moved = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.abs(points[i][0] - points[0][0])
      + Math.abs(points[i][1] - points[0][1])
      + Math.abs(points[i][2] - points[0][2]);
    if (d > moved) moved = d;
  }
  /* The trigger is a ProximitySensor the member is standing in, so it can arm
   * again while the run is still being sampled. What the gate asks is that
   * gravity comes back at some point after it went off, not that the last
   * sample happens to fall in a quiet moment. */
  const firstOff = gravities.indexOf(0);
  return {
    turnedOff: firstOff > -1,
    restored: firstOff > -1 && gravities.slice(firstOff).some(g => g === EARTH),
    moved,
    gravities,
    points,
    readPositions: points.length,
  };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await login(page);

  /* The switch itself, in a world that never touches gravity. */
  const roots = await enterPlace(page, 'enter');
  check('the Plaza loads', roots > 0, roots);
  const defaultG = await gravity(page);
  check('gravity defaults to earth gravity', defaultG === EARTH, defaultG);
  await setGravity(page, false);
  const offG = await gravity(page);
  check('setGravity(false) switches gravity off', offG === 0, offG);
  await setGravity(page, true);
  const onG = await gravity(page);
  check('setGravity(true) restores earth gravity', onG === EARTH, onG);
  record.plaza = { defaultG, offG, onG };

  /* Gravity must not leak. Leave a world with it off and the next world has to
   * start at its own value, not the one the last world was left in. */
  await setGravity(page, false);
  await enterPlace(page, 'fleamarket');
  const afterMove = await gravity(page);
  check('gravity does not leak from one world into the next',
    afterMove === EARTH, afterMove);
  record.leak = { leftAt: 0, arrivedAt: afterMove };

  /* One representative run of each implementation that uses the switch. */
  const templates = [
    {
      template: '007',
      what: 'the Televator lift',
      script: 'ts', mover: 't', event: 'set_uptrigger', value: true,
      samples: 14, every: 250,
    },
  ];

  for (const spec of templates) {
    const loaded = await loadTemplate(page, spec.template);
    check(`${spec.template}: the home template loads`, loaded);
    if (!loaded) continue;
    const before = await gravity(page);
    check(`${spec.template}: the template starts under normal gravity`,
      before === EARTH, before);
    const summary = summarise(await runEffect(page, spec));
    record[spec.template] = { before, summary, what: spec.what };
    if (summary.error) {
      check(`${spec.template}: ${spec.what} can be driven`, false, summary.error);
      continue;
    }
    check(`${spec.template}: ${spec.what} switches gravity off`, summary.turnedOff);
    check(`${spec.template}: ${spec.what} moves`, summary.moved > 0.01, summary.moved);
    check(`${spec.template}: gravity is back on afterwards`, summary.restored,
      summary.gravities[summary.gravities.length - 1]);
    await page.screenshot({ path: path.join(OUT_DIR, `${spec.template}.png`) });
  }

  /*
   * The other implementation, /008's FizzEffect, cannot be driven end to end
   * and the reason is not gravity.
   *
   * Its only trigger is `ROUTE bottleN.effectTime_changed TO effect.set_time`,
   * and the bottle Script wires that route in its own set_up() with
   * `Browser.addRoute(trigger, 'touchTime', Browser.getScript(), 'make_drink')`.
   * `Browser.getScript()` is a blaxxun method X_ITE has never implemented, so
   * set_up throws, the bottles are never wired, and effect.set_time is never
   * sent. The same call appears in /009, /00a and worlds/bank/vrml/tvrcTemp.wrl.
   *
   * This is not an X_ITE 16 regression - 15.1.12 does not implement it either -
   * so it is reported here rather than gating the migration. It belongs to a
   * blaxxun Browser compatibility lane.
   *
   * What can still be checked is that the world's own gravity Script is
   * present and resolves, which is what the templates share.
   */
  const fizz = await loadTemplate(page, '008');
  check('008: the home template loads', fizz);
  if (fizz) {
    await page.evaluate(SCENE_ACCESS_SOURCE);
    const found = await page.evaluate(() => {
      const api = window.__ctr;
      const effect = api.findByDef('effect', api.scene())[0];
      const body = effect ? api.protoBody(effect) : null;
      return {
        effect: !!effect,
        type: effect ? api.typeName(effect) : null,
        body: !!body,
      };
    });
    record['008'] = found;
    check('008: the FizzEffect gravity Script resolves',
      found.effect && found.type === 'FizzEffect' && found.body, found);
    console.log('  note 008/009/00a: FizzEffect cannot be triggered because the '
      + 'bottle Script calls Browser.getScript(), which X_ITE does not implement. '
      + 'Not an X_ITE 16 regression; see also worlds/bank/vrml/tvrcTemp.wrl.');
  }

  /* Leaving the template behind must leave normal gravity behind too. */
  await enterPlace(page, 'enter');
  const finalG = await gravity(page);
  check('leaving the home templates restores normal gravity', finalG === EARTH, finalG);
  record.final = finalG;

  fs.writeFileSync(path.join(OUT_DIR, 'gravity.json'),
    JSON.stringify({ record, results }, null, 2));
  await browser.close();

  const failed = results.filter(r => !r.pass).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('ERROR', err); process.exit(2); });
