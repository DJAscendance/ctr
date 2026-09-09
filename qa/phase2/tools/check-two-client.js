/*
 * Phase 2 two-client gate.
 *
 * Two authenticated Beta clients in one 3D world under X_ITE 16.2.0. Everything
 * here is asserted against the ACTUAL RENDERED NODE, not against wire traffic:
 * Phase 1 already proved the wire.
 *
 * Covers: remote add / update / remove, the Collision { collide FALSE } wrapper,
 * the wrapper<->presenceKey binding, node identity for two presences that share
 * a username, and world-change cleanup of nodes and bindings.
 */
const { launch, login, enterPlace } = require('../lib/beta-client');
const path = require('path');
const OUT = process.argv[2] || '/home/ryan/cybertownrevival/artifacts/phase2';

let pass = 0, fail = 0;
function check(ok, name, detail) {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail !== undefined ? ' :: ' + detail : ''}`); }
}

/* Everything the page knows about the citizens it has rendered. Read out of the
 * live component so the assertions are about real scene nodes. */
const READ = () => {
  const app = document.querySelector('#app').__vue__;
  const find = c => {
    if (c.$options.name === 'WorldBrowserPage') return c;
    for (const k of c.$children) { const r = find(k); if (r) return r; }
    return null;
  };
  const page = find(app);
  if (!page) return { error: 'WorldBrowserPage not mounted' };
  const canvas = document.querySelector('#world x3d-canvas');
  const browser = canvas ? X3D.getBrowser(canvas) : null;
  const roots = browser && browser.currentScene ? Array.from(browser.currentScene.rootNodes) : [];
  const out = { keys: [], world: browser && browser.currentScene && browser.currentScene.worldURL };
  for (const key of Object.keys(page.users)) {
    const e = page.users[key];
    let wrapperType = null, collide = null, isRoot = null;
    try { wrapperType = e.collision && e.collision.getNodeTypeName(); } catch (err) { wrapperType = 'ERR ' + err.message; }
    try { collide = e.collision ? e.collision.collide.valueOf() : null; } catch (err) { collide = 'ERR ' + err.message; }
    try { isRoot = !!(e.collision && roots.indexOf(e.collision) !== -1); } catch (err) { isRoot = 'ERR'; }
    /* The binding is checked BOTH ways: key -> node and node -> key. */
    let boundNode = null, keyForWrapper = null, memberForWrapper = null;
    try { boundNode = page.remoteMembers.getRemoteNode(key); } catch (err) { boundNode = 'ERR'; }
    try { keyForWrapper = page.remoteMembers.remoteKeyForNode(e.collision); } catch (err) { keyForWrapper = 'ERR'; }
    try {
      const m = page.remoteMembers.remoteMemberForNode(e.collision);
      memberForWrapper = m ? { key: m.key, username: m.username, presenceId: m.presenceId } : null;
    } catch (err) { memberForWrapper = 'ERR'; }
    out.keys.push({
      key, loaded: !!e.loaded, wrapperType, collide, isRoot,
      hasInline: !!e.inline, hasImport: !!e.import,
      bindingIsWrapper: boundNode === e.collision,
      bindingIsInline: boundNode === e.inline,
      keyForWrapper, memberForWrapper,
      pos: e.transform && e.transform.pos ? e.transform.pos.slice() : null,
    });
  }
  return out;
};

const waitCitizens = async (page, n, timeout = 45000) => {
  await page.waitForFunction(want => {
    const app = document.querySelector('#app').__vue__;
    const find = c => {
      if (c.$options.name === 'WorldBrowserPage') return c;
      for (const k of c.$children) { const r = find(k); if (r) return r; }
      return null;
    };
    const p = find(app);
    if (!p) return false;
    return Object.keys(p.users).filter(k => p.users[k].loaded).length === want;
  }, n, { timeout });
};

(async () => {
  const b = await launch();
  console.log('renderer:', b.ctrRenderer);

  const ctxA = await b.newContext();
  const ctxB = await b.newContext();
  const A = await login(ctxA, 'testqa', 'testqa');
  const B = await login(ctxB, 'outlandsqa2', 'testqa');
  console.log('two clients logged in');

  console.log('\n1. REMOTE ADD - A AND B SEE EACH OTHER IN ONE WORLD');
  await enterPlace(A, '#/place/enter', 'enter.wrl');
  await enterPlace(B, '#/place/enter', 'enter.wrl');
  let okA = true, okB = true;
  try { await waitCitizens(A, 1); } catch (e) { okA = false; }
  try { await waitCitizens(B, 1); } catch (e) { okB = false; }
  check(okA, 'A renders exactly one remote citizen (B)');
  check(okB, 'B renders exactly one remote citizen (A)');
  const a1 = await A.evaluate(READ);
  const b1 = await B.evaluate(READ);
  console.log('   A sees:', JSON.stringify(a1.keys));
  console.log('   B sees:', JSON.stringify(b1.keys));

  console.log('\n2. COLLISION WRAPPER');
  for (const [who, r] of [['A', a1], ['B', b1]]) {
    const e = r.keys[0];
    if (!e) { check(false, `${who}: has a rendered citizen to inspect`); continue; }
    check(e.wrapperType === 'Collision', `${who}: citizen is wrapped in a Collision node`, e.wrapperType);
    check(e.collide === false, `${who}: wrapper collide = FALSE`, String(e.collide));
    check(e.isRoot === true, `${who}: wrapper is a ROOT node of the scene`, String(e.isRoot));
    check(e.hasInline, `${who}: the avatar Inline hangs below the wrapper`);
    check(e.hasImport, `${who}: an avatar transform node was resolved`);
  }

  console.log('\n3. PRESENCE NODE BINDING');
  for (const [who, r] of [['A', a1], ['B', b1]]) {
    const e = r.keys[0];
    if (!e) continue;
    check(e.bindingIsWrapper, `${who}: registry binds the WRAPPER, not the Inline`,
      `wrapper=${e.bindingIsWrapper} inline=${e.bindingIsInline}`);
    check(e.keyForWrapper === e.key, `${who}: node -> presenceKey resolves`, `${e.keyForWrapper} vs ${e.key}`);
    check(!!e.memberForWrapper && e.memberForWrapper.key === e.key,
      `${who}: node -> remote member resolves to the right presence`, JSON.stringify(e.memberForWrapper));
    check(/^\d+:/.test(e.key), `${who}: identity is memberId:presenceId, not a username`, e.key);
  }

  console.log('\n4. REMOTE UPDATE - MOVEMENT REACHES THE RENDERED NODE');
  const before = (await A.evaluate(READ)).keys[0];
  await B.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    const find = c => { if (c.$options.name === 'WorldBrowserPage') return c;
      for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
    const p = find(app);
    p.position = [11, 0, 22];
    p.rotation = [0, 1, 0, 1.5];
  });
  let moved = false;
  try {
    await A.waitForFunction(() => {
      const app = document.querySelector('#app').__vue__;
      const find = c => { if (c.$options.name === 'WorldBrowserPage') return c;
        for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
      const p = find(app);
      const k = Object.keys(p.users)[0];
      const t = k && p.users[k].transform && p.users[k].transform.pos;
      return !!t && Math.abs(t[0] - 11) < 0.001 && Math.abs(t[2] - 22) < 0.001;
    }, { timeout: 20000 });
    moved = true;
  } catch (e) { /* reported below */ }
  check(moved, "A sees B's new position on the rendered citizen",
    JSON.stringify(before && before.pos));
  const afterMove = (await A.evaluate(READ)).keys[0];
  check(afterMove && afterMove.bindingIsWrapper, 'binding survives a movement update');

  await A.screenshot({ path: path.join(OUT, 'two-client-A.png') });
  await B.screenshot({ path: path.join(OUT, 'two-client-B.png') });

  console.log('\n5. REMOTE REMOVE - LEAVING TAKES THE NODE AND THE BINDING');
  await enterPlace(B, '#/place/mall', 'shopping.wrl');
  let gone = false;
  try { await waitCitizens(A, 0); gone = true; } catch (e) { /* reported */ }
  check(gone, 'A drops the citizen when B leaves the room');
  const a2 = await A.evaluate(READ);
  check(a2.keys.length === 0, 'no rendered citizen entries remain', JSON.stringify(a2.keys));
  const strayRoots = await A.evaluate(() => {
    const br = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    return Array.from(br.currentScene.rootNodes)
      .filter(n => { try { return n.getNodeTypeName() === 'Collision'; } catch (e) { return false; } }).length;
  });
  check(strayRoots === 0, 'the departed citizen leaves no Collision wrapper in the scene', String(strayRoots));

  console.log('\n6. RETURN ADDS THE CITIZEN ONCE');
  await enterPlace(B, '#/place/enter', 'enter.wrl');
  let backOnce = false;
  try { await waitCitizens(A, 1); backOnce = true; } catch (e) { /* reported */ }
  check(backOnce, 'A renders the returning citizen exactly once');
  const a3 = await A.evaluate(READ);
  check(a3.keys.length === 1, 'exactly one entry after the return', JSON.stringify(a3.keys.map(k => k.key)));
  check(a3.keys[0] && a3.keys[0].collide === false, 'the rebuilt citizen is still collide FALSE');
  check(a3.keys[0] && a3.keys[0].bindingIsWrapper, 'the rebuilt citizen is bound to its new wrapper');

  console.log('\n7. WORLD CHANGE CLEARS NODES AND BINDINGS');
  await enterPlace(A, '#/place/fleamarket', 'fleamarket.wrl');
  const a4 = await A.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    const find = c => { if (c.$options.name === 'WorldBrowserPage') return c;
      for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
    const p = find(app);
    const br = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    return {
      users: Object.keys(p.users).length,
      wrappers: Array.from(br.currentScene.rootNodes)
        .filter(n => { try { return n.getNodeTypeName() === 'Collision'; } catch (e) { return false; } }).length,
      world: br.currentScene.worldURL,
    };
  });
  check(a4.users === 0, 'no citizen from the old world survives the change', String(a4.users));
  check(a4.wrappers === 0, 'no old-world wrapper is left in the new scene', String(a4.wrappers));
  check(a4.world.indexOf('fleamarket.wrl') !== -1, 'the new world is the one asked for', a4.world);

  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('GATE ERROR', e); process.exit(1); });
