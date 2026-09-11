'use strict';
/*
 * The store must describe the place the citizen actually landed in.
 *
 * `router.beforeEach` in `spa/src/main.ts` fetches the place for the route it is asked
 * about, and that fetch can outlive its own navigation. vue-router never tells an
 * in-flight `.then` that its navigation is gone, so before the fix an answer for a place
 * the citizen never reached could land on top of the place they were standing in. The two
 * ways a navigation is lost:
 *
 *   SUPERSEDED     - a later navigation starts, and the earlier one is cancelled.
 *   DUPLICATE ABORT - the citizen asks again for the route the app is still on.
 *                     vue-router refuses it as redundant, but cancels the in-flight
 *                     navigation first, and runs NO guard for the duplicate - so nothing
 *                     re-fetches the place they are standing in either.
 *
 * The deterministic proof of both races, including a negative control that shows the OLD
 * design corrupting the store, is `spa/tests/navigation-place.test.ts`. THIS gate is the
 * live half: it drives the same races through the real app on a real GPU and asserts the
 * thing a citizen would actually notice - that after the dust settles the route, the place
 * store, the loaded world and the socket room all name ONE place.
 *
 * Every assertion is about STATE, never about the console. The defect is silent: a wrong
 * place in the store logs nothing at all, which is exactly what made it survive so long.
 *
 * Ordinary places only. The broken contract is generic and so is this gate.
 */
const { launch, login, enterPlace, URL } = require('../lib/beta-client');

const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

/*
 * The places this gate drives. Ordinary ones, and the world file each resolves to is read
 * from the API rather than written down here: a place names its own world in the database
 * (the Mall's is `shopping.wrl`, not `mall.wrl`), and a gate that hard-codes those would
 * fail on a fixture change instead of on the contract it is supposed to guard.
 */
const PLAZA = { slug: 'enter' };
const MALL = { slug: 'mall' };
const FLEA = { slug: 'fleamarket' };

/** Fills in `world` and `id` for a place from the API the SPA itself calls. */
async function describe(page, place) {
  const data = await page.evaluate(async slug => {
    const response = await fetch(`/api/place/${slug}`, {
      headers: { Authorization: `Bearer ${window.localStorage.getItem('token')}` },
    });
    const body = await response.json();
    return { id: body.place.id, file: body.place.world_filename };
  }, place.slug);
  place.id = data.id;
  // `world_filename` may carry a directory, e.g. "vrml/shopping.wrl". The scene's
  // worldURL ends with the whole thing, so only the file name is needed to match it.
  place.world = data.file.split('/').pop();
  return place;
}

let pass = 0;
let fail = 0;

function check(ok, label, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label}${detail ? `   ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${detail ? `   ${detail}` : ''}`);
  }
}

/*
 * Everything that is supposed to name the same place, read out of the live app in one
 * evaluate so the four readings describe one moment rather than four.
 */
const READ = () => {
  const app = document.querySelector('#app').__vue__;
  const store = app.$store;
  const place = (store && store.data && store.data.place) || null;
  const canvas = document.querySelector('#world x3d-canvas');
  let worldURL = null;
  if (canvas) {
    try {
      const browser = X3D.getBrowser(canvas);
      worldURL = (browser && browser.currentScene && browser.currentScene.worldURL) || null;
    } catch (e) { worldURL = null; }
  }
  let room = null;
  try { room = app.$socket ? app.$socket.currentRoom : null; } catch (e) { room = null; }
  return {
    hash: window.location.hash,
    placeId: place ? place.id : null,
    placeSlug: place ? place.slug : null,
    placeName: place ? place.name : null,
    worldURL,
    room,
    canvases: document.querySelectorAll('#world x3d-canvas').length,
  };
};

/* Asks for a route without waiting for it to land - which is what makes a race a race. */
function ask(page, slug) {
  return page.evaluate(s => { window.location.hash = `#/place/${s}`; }, slug);
}

function settle(page, ms) {
  return page.waitForTimeout(ms);
}

/*
 * The whole contract in one assertion: route, store, loaded world and socket room must
 * all name `expected`.
 */
function checkConsistent(state, expected, label) {
  const detail = JSON.stringify({
    hash: state.hash, store: state.placeSlug, world: state.worldURL, room: state.room,
  });
  check(state.hash === `#/place/${expected.slug}`, `${label}: route is ${expected.slug}`, detail);
  check(state.placeSlug === expected.slug, `${label}: store is ${expected.slug}`);
  check(
    !!state.worldURL && state.worldURL.indexOf(expected.world) !== -1,
    `${label}: loaded world is ${expected.world}`,
  );
  check(String(state.room) === String(state.placeId),
    `${label}: socket room matches the stored place id`,
    `room=${state.room} placeId=${state.placeId}`);
  check(state.canvases === 1, `${label}: exactly one x3d-canvas`);
}

async function run() {
  const browser = await launch();
  console.log(`renderer: ${browser.ctrRenderer}`);
  console.log(`url:      ${URL}`);
  const context = await browser.newContext();
  const page = await login(context, USER, PASS);

  try {
    for (const place of [PLAZA, MALL, FLEA]) {
      await describe(page, place);
      console.log(`place ${place.slug}: id=${place.id} world=${place.world}`);
    }

    console.log('\n1. AN ORDINARY ARRIVAL AGREES WITH ITSELF');
    await enterPlace(page, `#/place/${PLAZA.slug}`, PLAZA.world);
    await settle(page, 1500);
    checkConsistent(await page.evaluate(READ), PLAZA, 'plaza');

    console.log('\n2. DUPLICATE ABORT - ask for the Mall, then come straight back');
    /*
     * The return is the route the app is still on, so vue-router refuses it as redundant
     * and cancels the Mall navigation. The Mall fetch then resolves with nothing left to
     * receive it. Before the fix this is exactly where the Mall landed in the store while
     * the citizen was still standing in the Plaza.
     */
    await ask(page, MALL.slug);
    await ask(page, PLAZA.slug);
    await settle(page, 6000);
    checkConsistent(await page.evaluate(READ), PLAZA, 'after duplicate abort');

    console.log('\n3. SUPERSESSION - a third place supersedes the second');
    await enterPlace(page, `#/place/${PLAZA.slug}`, PLAZA.world);
    await settle(page, 1500);
    await ask(page, MALL.slug);
    await ask(page, FLEA.slug);
    await enterPlace(page, `#/place/${FLEA.slug}`, FLEA.world);
    await settle(page, 3000);
    checkConsistent(await page.evaluate(READ), FLEA, 'after supersession');

    console.log('\n4. RAPID NAVIGATION ENDS WHERE IT LANDED');
    for (const slug of [PLAZA.slug, MALL.slug, PLAZA.slug, FLEA.slug, MALL.slug]) {
      await ask(page, slug);
    }
    await ask(page, PLAZA.slug);
    await enterPlace(page, `#/place/${PLAZA.slug}`, PLAZA.world);
    await settle(page, 6000);
    checkConsistent(await page.evaluate(READ), PLAZA, 'after rapid navigation');

    console.log('\n5. AN ORDINARY TOUR STILL WORKS');
    for (const place of [MALL, FLEA, PLAZA]) {
      await enterPlace(page, `#/place/${place.slug}`, place.world);
      await settle(page, 2000);
      checkConsistent(await page.evaluate(READ), place, `tour ${place.slug}`);
    }

  } finally {
    await browser.close();
  }

  console.log(`\n${pass}/${pass + fail} ${fail === 0 ? 'passed' : 'PASSED, ' + fail + ' FAILED'}`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('GATE ERROR', e); process.exit(1); });
