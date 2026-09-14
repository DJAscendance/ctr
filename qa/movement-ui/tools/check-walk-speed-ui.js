'use strict';

/*
 * Runtime gate for where the walk-speed control lives and how it opens.
 *
 * The control used to sit permanently in the legacy right-hand rail. It now
 * opens from the "Walk Speed" entry this application splices into X_ITE's own
 * world context menu, through X_ITE 16's supported ContextMenu.setUserMenu
 * extension point. This gate proves that placement against a live world on a
 * real GPU rather than against the source text: every assertion below reads
 * the rendered DOM, the X_ITE shadow root, localStorage or the live speed
 * provider, so a change that only looks right in the diff cannot pass it.
 *
 * The right-click is dispatched through Playwright's mouse, not a synthetic
 * DOM event, so what is being proved is the real pointer path.
 *
 *   CTR_QA_URL=http://localhost:8001 DISPLAY=:0 \
 *     node qa/movement-ui/tools/check-walk-speed-ui.js
 */

const { launch, login, enterPlace } = require('../../phase2/lib/beta-client');

const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

const results = [];
let page = null;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

/* ---------- probes that run inside the page ---------- */

/* X_ITE renders its menu into the canvas element's open shadow root, as
 * `ul.context-menu-root`. A sibling `div.context-menu-layer` shares the
 * x_ite-private-menu class, so the root class is the one to match on. */
const menuItems = () => page.evaluate(() => {
  const c = document.querySelector('#world x3d-canvas');
  if (!c || !c.shadowRoot) return null;
  const ul = c.shadowRoot.querySelector('.context-menu-root');
  if (!ul) return null;
  return Array.from(ul.querySelectorAll('li'))
    .map(li => (li.textContent || '').trim()).filter(Boolean);
});

const clickMenuItem = label => page.evaluate(want => {
  const c = document.querySelector('#world x3d-canvas');
  if (!c || !c.shadowRoot) return false;
  const li = Array.from(c.shadowRoot.querySelectorAll('.context-menu-root li'))
    .find(n => new RegExp(want, 'i').test(n.textContent || ''));
  if (!li) return false;
  li.click();
  return true;
}, label);

/* "Visible" means laid out, not merely present: the panel is v-show'd, so its
 * inputs stay in the DOM while it is closed and a presence test would pass
 * against a control no citizen can see.
 *
 * Measured by client rect rather than offsetParent. offsetParent is ALWAYS
 * null for a position:fixed element, and the panel is fixed on purpose (see
 * WalkSpeedPanel.vue), so an offsetParent test reports an open panel as
 * hidden. The rect collapses to 0x0 under v-show's display:none, which is the
 * state actually being asked about. */
const panelState = () => page.evaluate(() => {
  const panel = document.querySelector('.cls-walk-speed-panel');
  const slider = document.querySelector('#movement-speed');
  const number = document.querySelector('#movement-speed-number');
  const readout = document.querySelector('.cls-walk-speed-readout');
  const shown = el => !!el && el.getBoundingClientRect().width > 0
    && el.getBoundingClientRect().height > 0;
  const visible = shown(panel);
  const world = document.querySelector('#world');
  const store = document.querySelector('#app').__vue__.$store;
  return {
    exists: !!panel,
    visible,
    slider: slider ? slider.value : null,
    number: number ? number.value : null,
    readout: readout ? readout.textContent.trim() : null,
    store: store.data.movementSpeedMultiplier,
    stored: localStorage.getItem('movementSpeedMultiplier'),
    effective: (window.X3D && X3D.bxx && X3D.bxx.speedMultiplierProvider)
      ? X3D.bxx.speedMultiplierProvider() : null,
    /* Position is judged against the world box, not the viewport: the rule is
     * that the panel stays inside the 3D window. */
    inWorld: (() => {
      if (!visible || !world) return null;
      const p = panel.getBoundingClientRect();
      const w = world.getBoundingClientRect();
      return p.left >= w.left - 1 && p.top >= w.top - 1
        && p.right <= w.right + 1 && p.bottom <= w.bottom + 1;
    })(),
    coversWorld: (() => {
      if (!visible || !world) return null;
      const p = panel.getBoundingClientRect();
      const w = world.getBoundingClientRect();
      return (p.width * p.height) / (w.width * w.height) > 0.5;
    })(),
  };
});

/* Whether any walk-speed control is on screen OUTSIDE the 3D window - the
 * defect this gate exists for. */
const sidebarSpeedVisible = () => page.evaluate(() => {
  const world = document.querySelector('#world');
  const found = [];
  const shown = el => !!el && el.getBoundingClientRect().width > 0
    && el.getBoundingClientRect().height > 0;
  for (const el of document.querySelectorAll('#movement-speed, #movement-speed-number')) {
    if (!shown(el)) continue;
    if (world && world.contains(el)) continue;
    /* The panel is fixed and floats over the world rather than inside it, so
     * "not inside #world" is not enough on its own to mean "in the rail". */
    if (el.closest('.cls-walk-speed-panel')) continue;
    found.push(el.id);
  }
  /* The label went with the controls; catch it by text too, in case a future
   * change reintroduces the block without the ids. */
  const labels = Array.from(document.querySelectorAll('label, span, strong'))
    .filter(el => /walk speed/i.test(el.textContent || '') && shown(el))
    .filter(el => !(world && world.contains(el)))
    .filter(el => !el.closest('.cls-walk-speed-panel'))
    .map(el => el.tagName.toLowerCase());
  return { inputs: found, labels };
});

async function rightClickWorld(fraction) {
  const f = fraction || { x: 0.5, y: 0.5 };
  const box = await page.locator('#world').boundingBox();
  const at = {
    x: Math.round(box.x + box.width * f.x),
    y: Math.round(box.y + box.height * f.y),
  };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForTimeout(700);
  return at;
}

async function openPanel(fraction) {
  await rightClickWorld(fraction);
  const opened = await clickMenuItem('walk speed');
  await page.waitForTimeout(400);
  return opened;
}

/* Drive the controls the way a citizen does - a real DOM event, then let Vue
 * settle - rather than by calling the store setter directly. */
async function setSlider(value) {
  await page.evaluate(v => {
    const el = document.querySelector('#movement-speed');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.waitForTimeout(200);
}

async function setNumber(value) {
  await page.evaluate(v => {
    const el = document.querySelector('#movement-speed-number');
    el.value = String(v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForTimeout(200);
}

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05;

/* ---------- the gate ---------- */

async function main() {
  const browser = await launch();
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await login(ctx, USER, PASS);
  await page.evaluate(() => {
    document.querySelector('#app').__vue__.$store.methods.setView3d(true);
  });
  await enterPlace(page, '#/place/mall', 'shopping.wrl');
  await page.waitForTimeout(2500);

  process.stdout.write('\n=== sidebar ===\n');
  let sb = await sidebarSpeedVisible();
  check('no walk-speed input visible outside the 3D window',
    sb.inputs.length === 0, sb.inputs.join(','));
  check('no "Walk Speed" label visible outside the 3D window',
    sb.labels.length === 0, sb.labels.join(','));
  let st = await panelState();
  check('the panel exists but starts closed', st.exists && !st.visible);

  process.stdout.write('\n=== world right-click ===\n');
  /* The native menu must be suppressed inside the world and nowhere else. */
  const worldPrevented = await page.evaluate(() => new Promise(resolve => {
    const world = document.querySelector('#world');
    const canvas = world.querySelector('x3d-canvas');
    const onCtx = e => { world.removeEventListener('contextmenu', onCtx, false);
      setTimeout(() => resolve(e.defaultPrevented), 0); };
    world.addEventListener('contextmenu', onCtx, false);
    canvas.dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  }));
  check('native menu suppressed inside the 3D window', worldPrevented === true);

  const chatPrevented = await page.evaluate(() => new Promise(resolve => {
    const input = document.querySelector('.bg-chat input[type="text"]')
      || document.querySelector('input[type="text"]');
    if (!input) return resolve('no-input');
    const onCtx = e => { input.removeEventListener('contextmenu', onCtx, false);
      setTimeout(() => resolve(e.defaultPrevented), 0); };
    input.addEventListener('contextmenu', onCtx, false);
    input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  }));
  check('native menu NOT suppressed on the chat text field', chatPrevented === false, chatPrevented);

  await rightClickWorld();
  let items = await menuItems();
  check('right-click in the 3D window opens the X_ITE menu', Array.isArray(items) && items.length > 0);
  check('the menu carries a Walk Speed entry',
    !!items && items.some(t => /walk speed/i.test(t)));
  check('the menu keeps its own X_ITE entries',
    !!items && items.some(t => /viewpoints/i.test(t)) && items.some(t => /about x_ite/i.test(t)));

  /* Right-click outside the world must not raise the world menu at all. */
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
  await page.waitForTimeout(400);
  const chatBox = await page.locator('.bg-chat').boundingBox();
  await page.mouse.click(Math.round(chatBox.x + 40), Math.round(chatBox.y + 40), { button: 'right' });
  await page.waitForTimeout(600);
  items = await menuItems();
  st = await panelState();
  check('right-click on chat opens no world menu', !items || items.length === 0);
  check('right-click on chat opens no walk-speed panel', !st.visible);

  /* Chat's own UserMenu is absolutely positioned and sets left/top from raw
   * cursor coordinates, so it resolves against the viewport. Giving this page's
   * root a `position` would have made that root its containing block and moved
   * the menu by the root's own offset - which is why the walk-speed panel is
   * `fixed` instead. Prove the menu still lands under the pointer. */
  const userRow = await page.locator('.bg-chat li:has-text("testqa")').first();
  const rowBox = await userRow.boundingBox().catch(() => null);
  if (rowBox) {
    const at = { x: Math.round(rowBox.x + 20), y: Math.round(rowBox.y + 6) };
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.mouse.up({ button: 'right' }).catch(() => {});
    await page.waitForTimeout(500);
    const chatMenu = await page.evaluate(() => {
      const m = document.querySelector('.cls-context-menu');
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return { shown: r.width > 0 && r.height > 0, left: r.left, top: r.top };
    });
    check('the chat user menu still opens', !!chatMenu && chatMenu.shown === true,
      JSON.stringify(chatMenu));
    check('the chat user menu still lands under the pointer',
      !!chatMenu && Math.abs(chatMenu.left - (at.x - 15)) < 140
        && Math.abs(chatMenu.top - (at.y - 15)) < 140,
      chatMenu ? `menu=${Math.round(chatMenu.left)},${Math.round(chatMenu.top)} pointer=${at.x},${at.y}` : 'none');
    await page.mouse.click(600, 300);
    await page.waitForTimeout(300);
  } else {
    check('the chat user menu still opens', false, 'no user row found');
  }

  process.stdout.write('\n=== panel ===\n');
  check('Walk Speed opens the panel', await openPanel());
  st = await panelState();
  check('the panel is visible', st.visible);
  check('the panel stays inside the 3D window', st.inWorld === true);
  check('the panel does not cover the 3D window', st.coversWorld === false);
  check('slider, number and Reset are all present',
    st.slider !== null && st.number !== null
      && await page.locator('.cls-walk-speed-reset').count() === 1);

  process.stdout.write('\n=== synchronisation ===\n');
  await setSlider(4);
  st = await panelState();
  check('slider -> number', near(st.number, 4), st.number);
  check('slider -> readout', st.readout === '4.0x', st.readout);
  check('slider -> store', near(st.store, 4), st.store);

  await setNumber(1.2);
  st = await panelState();
  check('number -> slider', near(st.slider, 1.2), st.slider);
  check('number -> store', near(st.store, 1.2), st.store);
  check('number -> readout', st.readout === '1.2x', st.readout);

  process.stdout.write('\n=== range and validation ===\n');
  await setNumber(0.1);
  st = await panelState();
  check('below minimum clamps to 0.5', near(st.store, 0.5) && near(st.slider, 0.5), st.store);

  await setNumber(99);
  st = await panelState();
  check('above maximum clamps to 6', near(st.store, 6) && near(st.slider, 6), st.store);

  await setNumber('abc');
  st = await panelState();
  check('an unreadable number falls back to the default', near(st.store, 2.5), st.store);
  check('the number box is not left empty', st.number !== '' && st.number !== null, st.number);

  await setSlider(3.3);
  await page.locator('.cls-walk-speed-reset').click();
  await page.waitForTimeout(250);
  st = await panelState();
  check('Reset returns slider, number and store to 2.5',
    near(st.slider, 2.5) && near(st.number, 2.5) && near(st.store, 2.5), st.store);

  process.stdout.write('\n=== persistence ===\n');
  await setNumber(5.5);
  st = await panelState();
  check('the value is written to localStorage', near(st.stored, 5.5), st.stored);
  check('it is a browser preference, not an account field', st.stored !== null);

  process.stdout.write('\n=== dismissal ===\n');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape closes the panel', !(await panelState()).visible);

  await openPanel();
  await page.mouse.click(60, 500);
  await page.waitForTimeout(300);
  check('a click outside closes the panel', !(await panelState()).visible);

  await openPanel();
  await rightClickWorld({ x: 0.25, y: 0.3 });
  check('a right-click elsewhere closes the panel', !(await panelState()).visible);
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
  await page.waitForTimeout(300);

  await openPanel();
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  await page.waitForTimeout(1500);
  check('a world change closes the panel', !(await panelState()).visible);
  check('no stale menu is left behind', !(await menuItems()));

  process.stdout.write('\n=== jail override ===\n');
  await enterPlace(page, '#/place/jail', 'jail.wrl');
  await page.waitForTimeout(1500);
  await openPanel();
  st = await panelState();
  check('the panel still shows the stored preference in Jail', near(st.store, 5.5), st.store);
  check('Jail forces the effective speed to 1x', near(st.effective, 1), st.effective);
  await setNumber(6);
  st = await panelState();
  check('raising the preference cannot bypass the Jail override',
    near(st.effective, 1) && near(st.store, 6), `effective=${st.effective} store=${st.store}`);
  await page.keyboard.press('Escape');

  process.stdout.write('\n=== persistence across a reload ===\n');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const reloaded = await page.evaluate(
    () => document.querySelector('#app').__vue__.$store.data.movementSpeedMultiplier);
  check('the preference survives a reload', near(reloaded, 6), reloaded);

  process.stdout.write('\n=== pointer and sensor input ===\n');
  await page.evaluate(() => {
    document.querySelector('#app').__vue__.$store.methods.setView3d(true);
  });
  await enterPlace(page, '#/place/mall', 'shopping.wrl');
  await page.waitForTimeout(2500);

  /* Position comes from WorldBrowserPage's own ProximitySensor feed, the same
   * source qa/movement/tools/check-movement-speed.js measures against. Reading
   * currentViewpoint.getPosition() off the sealed SAI facade returns nothing in
   * X_ITE 16, which would make every movement check silently vacuous. */
  const viewpointOf = () => page.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    const find = c => {
      if (c.$options.name === 'WorldBrowserPage') return c;
      for (const k of c.$children) { const r = find(k); if (r) return r; }
      return null;
    };
    const view = find(app);
    return view && Array.isArray(view.position) ? view.position.slice() : null;
  });

  const focusCanvas = () => page.evaluate(() => {
    const c = document.querySelector('#world x3d-canvas');
    if (c) c.focus();
  });

  const before = await viewpointOf();
  const box = await page.locator('#world').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 140, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const afterDrag = await viewpointOf();
  const moved = before && afterDrag
    && (Math.abs(before[0] - afterDrag[0]) + Math.abs(before[2] - afterDrag[2])) > 0.05;
  check('left-drag still navigates the world', moved,
    `${JSON.stringify(before)} -> ${JSON.stringify(afterDrag)}`);

  await focusCanvas();
  const beforeKeys = await viewpointOf();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(600);
  const afterKeys = await viewpointOf();
  const walked = beforeKeys && afterKeys
    && (Math.abs(beforeKeys[0] - afterKeys[0]) + Math.abs(beforeKeys[2] - afterKeys[2])) > 0.05;
  check('keyboard movement still works', walked,
    `${JSON.stringify(beforeKeys)} -> ${JSON.stringify(afterKeys)}`);

  /* The world's own sensors must still be reachable: the Mall is full of
   * TouchSensors, and a right-click handler that swallowed pointer events
   * would leave them dead. */
  /* X_ITE 16 hands the page a sealed SAI facade that cannot reach inside an
   * Inline's scene, and the Mall's TouchSensors live inside Inlines, so
   * counting nodes would understate the world. What matters for this change is
   * that the sensor PLUMBING is still live, so the check is behavioural: the
   * app's own ProximitySensor is still delivering position events after the
   * menu has been opened and dismissed. A handler that swallowed pointer or
   * sensor events would stop that feed. The Mall door gate
   * (qa/movement-ui/tools/check-mall-door.js) covers a real TouchSensor click. */
  const sensorFeed = await page.evaluate(() => new Promise(resolve => {
    const app = document.querySelector('#app').__vue__;
    const find = c => {
      if (c.$options.name === 'WorldBrowserPage') return c;
      for (const k of c.$children) { const r = find(k); if (r) return r; }
      return null;
    };
    const view = find(app);
    if (!view) return resolve(null);
    const start = JSON.stringify(view.position);
    const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    let ticks = 0;
    b.addBrowserCallback({}, () => { ticks += 1; });
    setTimeout(() => resolve({ start, now: JSON.stringify(view.position), ticks,
      live: Array.isArray(view.position) }), 600);
  }));
  check('the app ProximitySensor feed is still live',
    !!sensorFeed && sensorFeed.live === true, JSON.stringify(sensorFeed));

  /* A right-click must not leave the pointer captured: after dismissing the
   * menu, a left click has to reach the canvas again. */
  await rightClickWorld();
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
  await page.waitForTimeout(400);
  const beforeAfterMenu = await viewpointOf();
  /* Repeat the FORWARD drag exactly. A sideways drag only turns the avatar in
   * WALK mode, so it would leave position unchanged and read as a failure
   * whether or not pointer input actually survived the menu. */
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 140, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const afterAfterMenu = await viewpointOf();
  check('navigation still works after the menu has been used',
    beforeAfterMenu && afterAfterMenu && JSON.stringify(beforeAfterMenu) !== JSON.stringify(afterAfterMenu),
    `${JSON.stringify(beforeAfterMenu)} -> ${JSON.stringify(afterAfterMenu)}`);

  await browser.close();

  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length) {
    process.stdout.write('FAILED:\n');
    failed.forEach(f => process.stdout.write(`  - ${f.name} ${f.detail}\n`));
    process.exit(1);
  }
  process.stdout.write('WALK_SPEED_UI_GATE_PASS\n');
}

main().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
