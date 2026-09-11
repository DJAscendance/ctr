/*
 * Phase 2 NavigationInfo world-rebind gate.
 *
 * Covers: the world change hands the incoming world its OWN NavigationInfo,
 * through the Blaxxun accessors the SPA publishes, at every instant the
 * incoming world's scene is the current one - not only once it has settled.
 *
 * The defect this guards: `browser.currentScene` is swapped as soon as the
 * incoming world's scene is set up, but the layer that owns the NavigationInfo
 * stack is only rebuilt on a later frame (282 ms on Plaza -> Mall here, 4.3 s
 * on a bare X_ITE 16.2 page given the same two worlds). A world's own Scripts
 * run inside that gap, so every Browser.getAvatarHeight() / getWalkSpeed() /
 * setWalkSpeed() call they make used to answer for the world the member had
 * just left. The Mall elevator is that shape of call.
 *
 * Everything here is read back out of the live runtime. Authored values are
 * quoted from the world files rather than sampled from a previous world, or
 * the gate would agree with the defect.
 */
const { launch, login, enterPlace } = require('../lib/beta-client');

/* Authored NavigationInfo values, read from the world files themselves:
 *   enter.wrl:2755      DEF nav, type [WALK ANY], visibilityLimit 150,
 *                       avatarSize [1 1.75 .9], speed 10
 *   shopping.wrl:2757   DEF nav, avatarSize [.25 1.75 .75], speed 1,
 *                       type WALK, visibilityLimit 140
 *   fleamarket.wrl:526  avatarSize [.25 1.75 .75], speed 3; no type and no
 *                       visibilityLimit, so the VRML97 default ["WALK","ANY"]
 *                       vrml_nav_default.js restores, and 0 (unlimited).
 */
const PLACES = {
  plaza: {
    name: 'Plaza', hash: '#/place/enter', world: 'enter.wrl',
    speed: 10, avatarSize: [1, 1.75, 0.9], visibilityLimit: 150, type: ['WALK', 'ANY'],
  },
  mall: {
    name: 'Mall', hash: '#/place/mall', world: 'shopping.wrl',
    speed: 1, avatarSize: [0.25, 1.75, 0.75], visibilityLimit: 140, type: ['WALK'],
  },
  fleamarket: {
    name: 'Fleamarket', hash: '#/place/fleamarket', world: 'fleamarket.wrl',
    speed: 3, avatarSize: [0.25, 1.75, 0.75], visibilityLimit: 0, type: ['WALK', 'ANY'],
  },
};

let pass = 0, fail = 0;
function check(ok, name, detail) {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

/* Floats out of X_ITE are single precision, so .9 comes back as 0.89999998. */
const near = (a, b) => Math.abs(a - b) < 1e-5;
const nearAll = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i]));

/*
 * What the Blaxxun surface says about the world that is current RIGHT NOW.
 *
 * Read through the browser's own patched accessors rather than through the
 * engine's bound node, because those accessors are what a historical world's
 * Script calls and what the defect changed the answer of.
 */
const READ = () => {
  const canvas = document.querySelector('#world x3d-canvas');
  if (!canvas) return null;
  const browser = X3D.getBrowser(canvas);
  const read = fn => { try { return fn(); } catch (error) { return 'ERR ' + error.message; } };
  return {
    world: ((browser.currentScene && browser.currentScene.worldURL) || '').split('/').pop(),
    speed: read(() => browser.getWalkSpeed()),
    avatarSize: read(() => [
      browser.getCollisionDistance(), browser.getAvatarHeight(), browser.getStepOverSize(),
    ]),
    visibilityLimit: read(() => browser.getVisibilityLimit()),
    type: read(() => Array.from(browser.getNavigationMode())),
  };
};

/* Every distinct reading taken while a world change is in flight. */
const SAMPLE = (READ_SRC, ms) => {
  window.__navSamples = [];
  const read = new Function('return (' + READ_SRC + ')()');
  const t0 = performance.now();
  const tick = () => {
    const r = read();
    if (r) {
      const key = JSON.stringify(r);
      if (key !== window.__navLast) { window.__navSamples.push(r); window.__navLast = key; }
    }
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
  };
  window.__navLast = null;
  tick();
};

/* Identity of the engine's own bound node, kept across world changes. */
const IDENTITY = () => {
  const browser = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
  const layer = browser.getActiveLayer && browser.getActiveLayer();
  const node = layer && layer.getNavigationInfo ? layer.getNavigationInfo() : null;
  window.__navSeen = window.__navSeen || [];
  let index = window.__navSeen.indexOf(node);
  if (index === -1) { index = window.__navSeen.push(node) - 1; }
  return '#' + index;
};

function checkValues(place, got, label) {
  check(near(got.speed, place.speed), `${label}: speed ${place.speed}`, JSON.stringify(got.speed));
  check(Array.isArray(got.avatarSize) && nearAll(got.avatarSize, place.avatarSize),
    `${label}: avatarSize ${JSON.stringify(place.avatarSize)}`, JSON.stringify(got.avatarSize));
  check(near(got.visibilityLimit, place.visibilityLimit),
    `${label}: visibilityLimit ${place.visibilityLimit}`, JSON.stringify(got.visibilityLimit));
  check(Array.isArray(got.type) && got.type.join(',') === place.type.join(','),
    `${label}: type ${JSON.stringify(place.type)}`, JSON.stringify(got.type));
}

/*
 * Drives one world change and judges every frame of it.
 *
 * The wait `enterPlace()` uses is satisfied inside the gap, so a gate that
 * reads once after it is a coin toss. This starts sampling before the
 * navigation and keeps sampling past it, then requires every reading whose
 * current world is the destination to already carry the destination's values.
 */
async function changeWorld(page, from, to) {
  await page.evaluate(([sampleSrc, readSrc, ms]) => {
    new Function('return (' + sampleSrc + ')')()(readSrc, ms);
  }, [SAMPLE.toString(), READ.toString(), 12000]);
  await enterPlace(page, to.hash, to.world);
  await page.waitForTimeout(4000);
  const samples = await page.evaluate(() => window.__navSamples);
  const arrived = samples.filter(s => s.world === to.world);
  const stale = arrived.filter(s => !(
    near(s.speed, to.speed) && Array.isArray(s.avatarSize) && nearAll(s.avatarSize, to.avatarSize)
  ));
  return { samples, arrived, stale, settled: samples[samples.length - 1] };
}

(async () => {
  const browser = await launch();
  console.log('renderer:', browser.ctrRenderer);
  const context = await browser.newContext();
  const page = await login(context, process.env.CTR_QA_USER || 'testqa',
    process.env.CTR_QA_PASS || 'testqa');
  page.on('pageerror', e => console.log('  pageerror:', e.message));

  console.log('\n1. EACH WORLD USES ITS OWN AUTHORED NAVIGATIONINFO');
  const identities = {};
  for (const key of ['plaza', 'mall', 'fleamarket']) {
    const place = PLACES[key];
    await enterPlace(page, place.hash, place.world);
    await page.waitForTimeout(3000);
    checkValues(place, await page.evaluate(READ), place.name);
    identities[key] = await page.evaluate(IDENTITY);
  }

  console.log('\n2. OBJECT IDENTITY CHANGES WITH THE WORLD');
  check(identities.plaza !== identities.mall, 'Plaza and Mall are different NavigationInfo objects',
    `${identities.plaza} vs ${identities.mall}`);
  check(identities.mall !== identities.fleamarket,
    'Mall and Fleamarket are different NavigationInfo objects',
    `${identities.mall} vs ${identities.fleamarket}`);

  console.log('\n3. PLAZA -> MALL: NO FRAME OF THE MALL ANSWERS FOR THE PLAZA');
  await enterPlace(page, PLACES.plaza.hash, PLACES.plaza.world);
  await page.waitForTimeout(3000);
  let run = await changeWorld(page, PLACES.plaza, PLACES.mall);
  check(run.arrived.length > 0, 'the Mall was sampled while current', `${run.arrived.length}`);
  check(run.stale.length === 0, 'every Mall frame carries the Mall NavigationInfo',
    `${run.stale.length} stale of ${run.arrived.length}: ${JSON.stringify(run.stale[0] || null)}`);
  checkValues(PLACES.mall, await page.evaluate(READ), 'Mall settled');
  const mallId = await page.evaluate(IDENTITY);

  console.log('\n4. MALL -> PLAZA: THE RETURN GETS ITS OWN NODE BACK');
  run = await changeWorld(page, PLACES.mall, PLACES.plaza);
  check(run.arrived.length > 0, 'the Plaza was sampled while current', `${run.arrived.length}`);
  check(run.stale.length === 0, 'every Plaza frame carries the Plaza NavigationInfo',
    `${run.stale.length} stale of ${run.arrived.length}: ${JSON.stringify(run.stale[0] || null)}`);
  checkValues(PLACES.plaza, await page.evaluate(READ), 'Plaza return');
  const backId = await page.evaluate(IDENTITY);
  check(backId !== mallId, 'the Mall node is not still active after the return',
    `${backId} vs ${mallId}`);

  console.log('\n5. A THIRD WORLD, SO THE CORRECTION IS NOT PLACE-SPECIFIC');
  run = await changeWorld(page, PLACES.plaza, PLACES.fleamarket);
  check(run.stale.length === 0, 'every Fleamarket frame carries the Fleamarket NavigationInfo',
    `${run.stale.length} stale of ${run.arrived.length}: ${JSON.stringify(run.stale[0] || null)}`);
  checkValues(PLACES.fleamarket, await page.evaluate(READ), 'Fleamarket');

  console.log('\n6. RELOAD IN THE SECOND WORLD');
  await page.evaluate(h => { window.location.hash = h; }, PLACES.mall.hash);
  await enterPlace(page, PLACES.mall.hash, PLACES.mall.world);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(want => {
    const c = document.querySelector('#world x3d-canvas');
    if (!c) return false;
    try {
      const b = X3D.getBrowser(c);
      const url = b && b.currentScene && b.currentScene.worldURL;
      return !!url && url.indexOf(want) !== -1;
    } catch (e) { return false; }
  }, PLACES.mall.world, { timeout: 90000 });
  await page.waitForTimeout(4000);
  checkValues(PLACES.mall, await page.evaluate(READ), 'Mall after reload');

  console.log('\n7. THE BLAXXUN SETTERS WRITE TO THE CURRENT WORLD');
  await enterPlace(page, PLACES.plaza.hash, PLACES.plaza.world);
  await page.waitForTimeout(3000);
  /* Written the moment the destination becomes current, which is inside the
   * gap. On the outgoing world's node these writes are simply lost. */
  await page.evaluate(([src, want]) => {
    const read = new Function('return (' + src + ')')();
    window.__wrote = null;
    const tick = () => {
      const r = read();
      if (r && r.world === want) {
        const browser = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
        try { browser.setWalkSpeed(7.25); browser.setVisibilityLimit(321); window.__wrote = r.world; }
        catch (error) { window.__wrote = 'ERR ' + error.message; }
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }, [READ.toString(), PLACES.mall.world]);
  await enterPlace(page, PLACES.mall.hash, PLACES.mall.world);
  await page.waitForTimeout(4000);
  const wrote = await page.evaluate(() => window.__wrote);
  check(wrote === PLACES.mall.world, 'the setters ran while the Mall was current', String(wrote));
  const after = await page.evaluate(READ);
  check(near(after.speed, 7.25), 'setWalkSpeed reached the Mall NavigationInfo',
    JSON.stringify(after.speed));
  check(near(after.visibilityLimit, 321), 'setVisibilityLimit reached the Mall NavigationInfo',
    JSON.stringify(after.visibilityLimit));

  console.log(`\n${pass}/${pass + fail} PASS`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(error => { console.error('GATE ERROR', error); process.exit(2); });
