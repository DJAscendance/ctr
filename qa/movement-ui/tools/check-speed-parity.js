'use strict';

/*
 * Does one dial setting mean one pace in every world?
 *
 * The sibling gate `qa/movement` measures how fast each world is. This one
 * measures whether they AGREE, which is the property the cross-world
 * normalisation exists to provide and the one a citizen actually notices.
 *
 * WHY IT WAS NEEDED. `NavigationInfo.speed` is authored per world with no
 * consistency - shop.wrl says 2.25, shopping.wrl says 1, enter.wrl and
 * carshowcase.wrl say 10, largeitems.wrl omits the field entirely. X_ITE
 * multiplies our factor by that term, so a bare dial multiplied the
 * discrepancy instead of removing it: the owner reported "2.5 in the car
 * showcase feels like 6, and 2.5 in the large item shop feels like 0.5", and
 * the first run of this gate's sibling measured exactly that - 17.48 against
 * 1.75 units/s, a tenfold gap at one dial setting.
 *
 * The reference is shop.wrl, chosen by the owner from real play. Every other
 * world is expected to land on the pace it walks at.
 *
 * Jail is deliberately NOT expected to match: it is pinned by
 * WORLD_SPEED_OVERRIDES at X_ITE's own default because the cell is too small
 * to use the dial at all, and that pin is exempt from normalisation. It is
 * walked anyway, as a check that the exemption still holds.
 *
 *   CTR_QA_URL=http://localhost:8001 DISPLAY=:0 \
 *     node qa/movement-ui/tools/check-speed-parity.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace } = require('../../phase2/lib/beta-client');

const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT = process.argv[2] || path.join('artifacts', 'movement-ui', 'parity');

const HOLD_MS = 2500;
const SETTLE_MS = 700;
const DIAL = Number(process.env.CTR_QA_DIAL || 2.5);

/* How far two worlds may differ and still count as "the same pace". Generous
 * on purpose: a walk is measured against real collision, so a world with a
 * wall or a step in the way legitimately covers less ground than open floor.
 * The defect this guards against was a factor of TEN. */
const TOLERANCE = 0.25;

const BOUNCE = { hash: '#/place/mall', world: 'shopping.wrl' };

const WORLDS = [
  { label: 'Antique Shop (REFERENCE)', hash: '#/place/antiqueshop', world: 'shop.wrl', reference: true },
  { label: 'Mall', hash: '#/place/mall', world: 'shopping.wrl', bounce: { hash: '#/place/enter', world: 'enter.wrl' } },
  { label: 'Large Item Shop', hash: '#/place/largeitemshop', world: 'largeitems.wrl' },
  { label: 'Car Showcase', hash: '#/place/cardealer', world: 'carshowcase.wrl' },
  { label: 'Plaza', hash: '#/place/enter', world: 'enter.wrl', bounce: BOUNCE },
  { label: 'Beach', hash: '#/place/beach', world: 'beach.wrl' },
  { label: 'Jail (pinned, exempt)', hash: '#/place/jail', world: 'jail.wrl', exempt: true },
];

/* The app's own ProximitySensor feed - the same source qa/movement measures
 * against. currentViewpoint.getPosition() returns nothing through X_ITE 16's
 * sealed SAI facade, which would make every reading silently vacuous. */
const position = page => page.evaluate(() => {
  const app = document.querySelector('#app').__vue__;
  const find = c => {
    if (c.$options.name === 'WorldBrowserPage') return c;
    for (const k of c.$children) { const r = find(k); if (r) return r; }
    return null;
  };
  const view = find(app);
  return view && Array.isArray(view.position) ? view.position.slice() : null;
});

/* What X_ITE will actually multiply: the bound NavigationInfo.speed times the
 * factor our provider answers with. Read straight out of the live engine, so
 * this is the product itself rather than a recomputation of it. */
const engineTerms = page => page.evaluate(() => {
  const canvas = document.querySelector('#world x3d-canvas');
  const b = X3D.getBrowser(canvas);
  let authored = null;
  try {
    const nav = b.getActiveNavigationInfo();
    authored = nav && nav._speed ? nav._speed.getValue() : null;
  } catch (e) { authored = null; }
  let factor = null;
  try {
    factor = X3D.bxx && X3D.bxx.speedMultiplierProvider
      ? X3D.bxx.speedMultiplierProvider(authored) : null;
  } catch (e) { factor = null; }
  return { authored, factor, product: (authored !== null && factor !== null) ? authored * factor : null };
});

async function freshEnter(page, w) {
  /* Re-requesting the hash the citizen is already on is a no-op in this
   * router, so the target has to be reached from somewhere else or X_ITE
   * never calls replaceWorld() and the avatar keeps the previous spawn. */
  const bounce = w.bounce || BOUNCE;
  await enterPlace(page, bounce.hash, bounce.world);
  await page.waitForTimeout(400);
  await enterPlace(page, w.hash, w.world);
  await page.waitForTimeout(900);
}

async function walk(page, w) {
  await freshEnter(page, w);
  await page.evaluate(v => {
    document.querySelector('#app').__vue__.$store.methods.setMovementSpeedMultiplier(v);
  }, DIAL);
  await page.evaluate(() => {
    const c = document.querySelector('#world x3d-canvas');
    if (c) c.focus();
  });
  const terms = await engineTerms(page);
  const before = await position(page);
  if (!before) return { label: w.label, error: 'no position' };
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(SETTLE_MS);
  const after = await position(page);
  const dx = after[0] - before[0];
  const dz = after[2] - before[2];
  const dist = Math.sqrt(dx * dx + dz * dz);
  return {
    label: w.label,
    world: w.world,
    reference: !!w.reference,
    exempt: !!w.exempt,
    authored: terms.authored,
    factor: terms.factor,
    product: terms.product,
    unitsPerSecond: dist / (HOLD_MS / 1000),
    dy: after[1] - before[1],
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  process.stdout.write(`renderer: ${browser.ctrRenderer}\ndial:     x${DIAL}\n\n`);
  const ctx = await browser.newContext();
  const page = await login(ctx, USER, PASS);
  await page.evaluate(() => {
    document.querySelector('#app').__vue__.$store.methods.setView3d(true);
  });
  await enterPlace(page, BOUNCE.hash, BOUNCE.world);

  const rows = [];
  for (const w of WORLDS) {
    try {
      rows.push(await walk(page, w));
    } catch (error) {
      rows.push({ label: w.label, world: w.world, exempt: !!w.exempt, error: error.message });
    }
    const r = rows[rows.length - 1];
    process.stdout.write(r.error
      ? `  ${r.label.padEnd(26)} FAILED: ${r.error}\n`
      : `  ${r.label.padEnd(26)} authored=${String(r.authored).padEnd(5)} `
        + `factor=${r.factor.toFixed(3).padEnd(7)} product=${r.product.toFixed(3).padEnd(7)} `
        + `walked=${r.unitsPerSecond.toFixed(3)} u/s\n`);
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'parity.json'), JSON.stringify(rows, null, 2));

  /* ---- the assertions ---- */
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok });
    process.stdout.write(`\n  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  process.stdout.write('\n');

  const graded = rows.filter(r => !r.error && !r.exempt);
  const reference = graded.find(r => r.reference);

  check('every world was walked', rows.every(r => !r.error),
    rows.filter(r => r.error).map(r => r.label).join(','));
  check('the reference world was reached', !!reference);

  if (reference) {
    /* The engine PRODUCT is the exact statement of the property: it is what
     * X_ITE multiplies by, free of collision noise. */
    const want = reference.product;
    for (const r of graded) {
      check(`${r.label}: engine pace matches the reference`,
        Math.abs(r.product - want) < 1e-6, `${r.product.toFixed(3)} vs ${want.toFixed(3)}`);
    }
    /* And the walked distance as corroboration, with room for real geometry. */
    for (const r of graded) {
      const ratio = r.unitsPerSecond / reference.unitsPerSecond;
      check(`${r.label}: walked pace is within ${TOLERANCE * 100}% of the reference`,
        Math.abs(ratio - 1) <= TOLERANCE, `${r.unitsPerSecond.toFixed(2)} u/s, ratio ${ratio.toFixed(2)}`);
    }
  }

  const jail = rows.find(r => r.exempt && !r.error);
  if (jail) {
    check('the pinned world is still exempt from normalisation',
      Math.abs(jail.factor - 1) < 1e-6, `factor ${jail.factor}`);
  }

  const failed = checks.filter(c => !c.ok);
  process.stdout.write(`\n\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  process.stdout.write(`wrote ${path.join(OUT, 'parity.json')}\n`);
  if (failed.length) {
    failed.forEach(f => process.stdout.write(`  - ${f.name}\n`));
    process.exit(1);
  }
  process.stdout.write('SPEED_PARITY_GATE_PASS\n');
}

main().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
