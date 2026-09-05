'use strict';

/*
 * Arrow-key navigation, collision and gravity, across world changes.
 *
 * This guards arrow_keys.js. That patch replaces WalkViewer's key handling, and
 * it now also unbinds its handlers in dispose() - which is what stopped it
 * retaining every world's viewer. The risk that change introduces is the exact
 * opposite of the leak: an unbind that is too eager would tear down the *live*
 * viewer's handlers and leave the member unable to move, and it would only show
 * up after a world change, because the first world has no earlier viewer to
 * dispose.
 *
 * So the check is deliberately not "do the arrow keys work". It is "do the
 * arrow keys still work after the third world", and it walks several worlds to
 * get there.
 *
 * Two other properties ride along, because they are what the movement is
 * supposed to respect:
 *
 *   collision - walking into a wall must stop the camera, not pass through it;
 *   gravity   - height must settle rather than drift or fall without end.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/navigation/tools/check-arrow-keys.js
 * Exits non-zero if movement stops working, or collision or gravity is lost.
 */

const { chromium } = require('playwright');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

/* Plaza is walked twice on purpose: the second visit is the one after a dispose. */
const PLAN = ['enter', 'mall', 'enter', 'fleamarket', 'enter'];

/* How far the camera must move for a key press to count as having done anything. */
const MIN_TRAVEL = 0.5;

/*
 * How much the same world's walk distance may vary between visits.
 *
 * This is the assertion that actually catches the bug. When the patch leaked
 * its handlers, every retained WalkViewer went on answering key events on the
 * shared canvas, so one ArrowUp drove several viewers at once and the camera
 * moved a multiple of the authored speed - more on each visit. Measured on the
 * Plaza, whose NavigationInfo declares `speed 10`, a 1.5 second press travelled
 * 20.9 then 42.9 then 63.7 units instead of the ~10.4 that speed calls for.
 *
 * Walk distance is therefore not checked against a fixed number, which would
 * bake in whatever the engine happens to do today. It is checked for being the
 * same on every visit, which is the property duplicate handlers destroy.
 */
const TRAVEL_TOLERANCE = 0.35;

/* Height change that would mean gravity stopped holding the camera on the floor. */
const MAX_FALL = 50;

/*
 * Worlds that are enclosed, and how far a long press may carry the camera.
 *
 * Collision cannot be asserted from distance alone, because an open world is
 * supposed to let the camera keep going - the Plaza covers about 60 units in
 * the six-second press below, and that is correct. It can only be asserted
 * where there is known to be a wall. The Mall's entrance hall is a few units
 * deep, so a camera that passes the limit here has walked through the wall.
 */
const ENCLOSED = { mall: 25 };

/*
 * X_ITE only delivers key events to a focused element, and the canvas is
 * created without a tab stop, so it cannot take focus on its own. Without this
 * the keys go to the document and nothing moves - which would look exactly like
 * the regression this tool exists to catch.
 */
const FOCUS_CANVAS = () => {
  const canvas = document.querySelector('#world x3d-canvas');
  if (!canvas) return false;
  canvas.setAttribute('tabindex', '0');
  canvas.focus();
  return document.activeElement === canvas;
};

/* bxx_auth.js defines viewpointPosition against the live viewpoint. */
const READ_POSITION = () => {
  const canvas = document.querySelector('#world x3d-canvas');
  if (!canvas) return null;
  try {
    const browser = X3D.getBrowser(canvas);
    const position = browser.viewpointPosition;
    if (!position) return null;
    return [position.x, position.y, position.z];
  } catch (error) {
    return null;
  }
};

const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/*
 * Reports which viewer the world bound.
 *
 * arrow_keys.js only replaces WalkViewer's key handling. A world whose
 * NavigationInfo declares no `type` gets the X3D default of EXAMINE, and its
 * arrow keys are legitimately not this patch's business - the flea market is
 * one such world. Asserting movement there would fail for a reason that has
 * nothing to do with the patch, so the viewer is read and non-walk worlds are
 * reported rather than judged. The class name is minified, so identity is
 * established by comparing against the viewer a known WALK world binds.
 */
const READ_VIEWER = () => {
  const canvas = document.querySelector('#world x3d-canvas');
  if (!canvas) return null;
  try {
    const viewer = X3D.getBrowser(canvas).getViewer();
    return viewer ? viewer.constructor.name : null;
  } catch (error) {
    return null;
  }
};

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
}

async function enter(page, slug) {
  await page.evaluate(s => { window.location.hash = `#/place/${s}`; }, slug);
  let previous = -1;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await page.waitForTimeout(1200);
    const roots = await page.evaluate(() => {
      const canvas = document.querySelector('#world x3d-canvas');
      if (!canvas) return -1;
      const scene = X3D.getBrowser(canvas).currentScene;
      return scene ? scene.rootNodes.length : -1;
    });
    if (roots > 0 && roots === previous) return roots;
    previous = roots;
  }
  return previous;
}

/* Holds a key down for a while, the way a member does, then reads the camera. */
async function press(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(600);
  return page.evaluate(READ_POSITION);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

  const failures = [];
  const travelBySlug = new Map();
  /* The first world in the plan authors "WALK", so its viewer names the class. */
  let walkViewer = null;
  await login(page);

  for (let visit = 0; visit < PLAN.length; visit += 1) {
    const slug = PLAN[visit];
    const roots = await enter(page, slug);
    const viewer = await page.evaluate(READ_VIEWER);
    if (walkViewer === null) walkViewer = viewer;
    const focused = await page.evaluate(FOCUS_CANVAS);
    if (!focused) {
      failures.push(`${slug} (visit ${visit + 1}): canvas would not take focus`);
      continue;
    }

    const start = await page.evaluate(READ_POSITION);
    if (!start) {
      failures.push(`${slug} (visit ${visit + 1}): no viewpoint position available`);
      continue;
    }

    const forward = await press(page, 'ArrowUp', 1500);
    const travelled = distance(start, forward);

    const turned = await press(page, 'ArrowLeft', 800);
    const afterTurn = await press(page, 'ArrowUp', 1500);

    /*
     * Collision is tested by walking far longer than the room is wide. Without
     * it the camera keeps going; with it the camera stops somewhere inside. So
     * the assertion is not "it stopped" but "it did not travel absurdly far".
     */
    const longWalk = await press(page, 'ArrowUp', 6000);
    const roomTravel = distance(start, longWalk);

    const fall = Math.abs(longWalk[1] - start[1]);

    const walks = viewer === walkViewer;
    const line = `${slug.padEnd(12)} visit ${visit + 1}  roots=${String(roots).padStart(3)}` +
      `  viewer=${walks ? 'walk' : 'other'}` +
      `  travel=${travelled.toFixed(2)}  after-turn=${distance(turned, afterTurn).toFixed(2)}` +
      `  long-walk=${roomTravel.toFixed(2)}  height-change=${fall.toFixed(2)}`;
    process.stdout.write(`${line}\n`);

    if (!walks) continue;

    if (travelled < MIN_TRAVEL) {
      failures.push(`${slug} (visit ${visit + 1}): ArrowUp moved the camera ${travelled.toFixed(2)}` +
        `, expected at least ${MIN_TRAVEL}`);
    }
    if (fall > MAX_FALL) {
      failures.push(`${slug} (visit ${visit + 1}): height changed by ${fall.toFixed(2)};` +
        ' gravity is not holding the camera on the floor');
    }

    if (ENCLOSED[slug] !== undefined && roomTravel > ENCLOSED[slug]) {
      failures.push(`${slug} (visit ${visit + 1}): a long press carried the camera` +
        ` ${roomTravel.toFixed(2)} units in an enclosed world, past the` +
        ` ${ENCLOSED[slug]} unit limit; collision is not stopping it`);
    }

    const seen = travelBySlug.get(slug);
    if (seen === undefined) {
      travelBySlug.set(slug, travelled);
    } else if (Math.abs(travelled - seen) > seen * TRAVEL_TOLERANCE) {
      failures.push(`${slug} (visit ${visit + 1}): one ArrowUp press travelled` +
        ` ${travelled.toFixed(2)} but travelled ${seen.toFixed(2)} on the first visit;` +
        ' walk speed is changing across world loads, which means more than one' +
        ' WalkViewer is answering the key');
    }
  }

  await browser.close();

  if (failures.length) {
    process.stdout.write(`\nFAIL\n${failures.map(f => `  - ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('\nPASS: arrow keys still move the camera after every world change\n');
}

main();
