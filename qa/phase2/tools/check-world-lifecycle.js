/*
 * Phase 2 world lifecycle gate.
 *
 * Covers: world load on 16.2.0, world transition A->B->A, rapid navigation
 * settlement, the O4/O6 "Replacing world aborted" contract, one browser
 * callback, one canvas, and the migration regression signatures.
 */
const { launch, login, enterPlace, worldURL, URL } = require('../lib/beta-client');
const path = require('path');
const OUT = process.argv[2] || '/home/ryan/cybertownrevival/artifacts/phase2';

const PLACES = [
  { name: 'Plaza',      hash: '#/place/enter',       world: 'enter.wrl' },
  { name: 'Mall',       hash: '#/place/mall',        world: 'shopping.wrl' },
  { name: 'Fleamarket', hash: '#/place/fleamarket',  world: 'fleamarket.wrl' },
];

/* Signatures that mean a real migration regression, per the project's
 * known-noise list. Everything else in the console is content or backend. */
const REGRESSION = [
  /UnimplementedBXXMethod/,
  /\.match is not a function/,
  /_value/,
  /WebGL.*(error|lost)/i,
  /Cannot read propert.*of (null|undefined).*addFieldCallback/,
];

let pass = 0, fail = 0;
function check(ok, name, detail) {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

(async () => {
  const b = await launch();
  console.log('renderer:', b.ctrRenderer);
  const ctx = await b.newContext();
  const p = await login(ctx, process.env.CTR_QA_USER || 'testqa', process.env.CTR_QA_PASS || 'testqa');

  const console_ = [];
  p.on('console', m => console_.push(m.text()));
  p.on('pageerror', e => console_.push(e.message));

  console.log('\n1. EACH WORLD LOADS UNDER X_ITE 16.2.0');
  for (const place of PLACES) {
    let ok = true, err = '';
    try { await enterPlace(p, place.hash, place.world); } catch (e) { ok = false; err = e.message.slice(0, 90); }
    check(ok, `${place.name} loads ${place.world}`, err);
    if (ok) {
      const info = await p.evaluate(() => {
        const c = document.querySelector('#world x3d-canvas');
        const br = X3D.getBrowser(c);
        return { canvases: document.querySelectorAll('#world x3d-canvas').length,
                 roots: br.currentScene.rootNodes.length, w: c.clientWidth, h: c.clientHeight };
      });
      check(info.canvases === 1, `${place.name}: exactly one x3d-canvas`, `got ${info.canvases}`);
      check(info.roots > 0, `${place.name}: scene has root nodes`, `got ${info.roots}`);
      check(info.w > 300 && info.h > 150, `${place.name}: canvas sized to its container`, `${info.w}x${info.h}`);
      await p.screenshot({ path: path.join(OUT, `world-${place.name.toLowerCase()}.png`) });
    }
  }

  console.log('\n2. WORLD TRANSITION A -> B -> A');
  console_.length = 0;
  await enterPlace(p, PLACES[0].hash, PLACES[0].world);
  await enterPlace(p, PLACES[1].hash, PLACES[1].world);
  await enterPlace(p, PLACES[0].hash, PLACES[0].world);
  const back = await worldURL(p);
  check(back && back.indexOf('enter.wrl') !== -1, 'returns to world A', back);
  const afterCycle = await p.evaluate(() => ({
    canvases: document.querySelectorAll('#world x3d-canvas').length,
    roots: X3D.getBrowser(document.querySelector('#world x3d-canvas')).currentScene.rootNodes.length,
  }));
  check(afterCycle.canvases === 1, 'still exactly one x3d-canvas after A->B->A', `got ${afterCycle.canvases}`);
  check(afterCycle.roots > 0, 'world A rebuilt with content', `got ${afterCycle.roots}`);
  const replacingAborted = console_.filter(t => /Replacing world aborted/.test(t)).length;
  check(replacingAborted === 0, 'O4/O6: "Replacing world aborted" = 0 on a normal world change',
    `got ${replacingAborted}`);

  console.log('\n3. RAPID NAVIGATION SETTLES');
  console_.length = 0;
  await p.evaluate(async () => {
    const hashes = ['#/place/enter', '#/place/mall', '#/place/fleamarket', '#/place/enter', '#/place/mall'];
    for (const h of hashes) { window.location.hash = h; await new Promise(r => setTimeout(r, 250)); }
  });
  await enterPlace(p, '#/place/enter', 'enter.wrl');
  const rapid = await p.evaluate(() => ({
    canvases: document.querySelectorAll('#world x3d-canvas').length,
    unexpectedAbort: window.ctrUnexpectedWorldLoadAbort || null,
    world: X3D.getBrowser(document.querySelector('#world x3d-canvas')).currentScene.worldURL,
  }));
  check(rapid.canvases === 1, 'rapid navigation leaves one canvas', `got ${rapid.canvases}`);
  check(rapid.world.indexOf('enter.wrl') !== -1, 'final world is the last one asked for', rapid.world);
  check(!rapid.unexpectedAbort, 'no abort on a run that was still current',
    JSON.stringify(rapid.unexpectedAbort));
  const unhandled = console_.filter(t => /Uncaught \(in promise\).*(Loading of X3D file aborted|Replacing world aborted)/.test(t)).length;
  check(unhandled === 0, 'no unhandled world-load abort rejection', `got ${unhandled}`);

  console.log('\n4. NO MIGRATION REGRESSION SIGNATURES');
  const all = console_.concat(p.ctrErrors || []);
  for (const sig of REGRESSION) {
    const hits = all.filter(t => sig.test(t));
    check(hits.length === 0, `no console match for ${sig}`, hits.slice(0, 1).join(' | ').slice(0, 120));
  }

  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('GATE ERROR', e); process.exit(1); });
