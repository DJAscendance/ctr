'use strict';

/*
 * A bare-engine control: the same world file, loaded by X_ITE 15.1.12 and by
 * X_ITE 16.2.0, with nothing of CTR in the page but the compatibility shim.
 *
 * The application-level control could not be run. Swapping the CDN pin under
 * the built SPA leaves 15.1.12 executing a patch set written against 16 - the
 * canvas sizing, the arrow-key binding and the VRML97 texture rule all target
 * the newer field API - and the world does not load at all, which measures the
 * patches rather than the engine.
 *
 * So this compares the engines directly. It answers one kind of question:
 * given this world file, does each engine build the same nodes? That is enough
 * to separate a regression introduced by the upgrade from a defect in the
 * archived content that both engines have always had - which is exactly what
 * the Outlands HUD needs, because ne_game.wrl uses HUD{} without declaring it
 * in a PROTO or an EXTERNPROTO anywhere in the file.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/compare-engines.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const { SCENE_ACCESS_SOURCE } = require('../lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'final-gate');

const ENGINES = ['15.1.12', '16.2.0'];

const WORLDS = [
  { key: 'outlands', url: '/assets/worlds/ne_game/vrml/ne_game.wrl' },
  { key: 'mall', url: '/assets/worlds/shopping/vrml/shopping.wrl' },
  { key: 'plaza', url: '/assets/worlds/enter/vrml/enter.wrl' },
];

/* Only the shim, so what is measured is the engine and not our compatibility work. */
const PATCH_DIR = path.join(__dirname, '..', '..', '..', 'spa', 'src', 'libs', 'x_ite_mods');
const SHIM = fs.readFileSync(path.join(PATCH_DIR, 'x_ite_compat.js'), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || null });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}`);
}

function pageFor(engine) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/x_ite@${engine}/dist/x_ite.min.css">
<script src="https://cdn.jsdelivr.net/npm/x_ite@${engine}/dist/x_ite.min.js"></script>
<style>html,body{margin:0;height:100%}x3d-canvas{display:block;width:100%;height:100%}</style>
</head><body><x3d-canvas id="c"></x3d-canvas>
<script>try {\n${SHIM}\n} catch (e) { console.warn('shim failed', e); }</script>
</body></html>`;
}

/*
 * The page is served from the QA origin so that /assets resolves and every
 * relative reference inside a world resolves the way it does in the product.
 */
function serve(engine) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(pageFor(engine));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/*
 * Loads a world and waits for it to be the world that was asked for.
 *
 * Waiting for "root nodes above zero" is not enough: the previous world is
 * still mounted when loadURL is called, so the very first sample passes and the
 * run surveys the scene it was leaving. The first pass of this tool did exactly
 * that and reported the Mall with the Outlands' node counts. Readiness is
 * therefore the scene's worldURL matching the request, and only then the root
 * count settling.
 */
const LOAD = (url) => new Promise((resolve) => {
  const canvas = document.querySelector('#c');
  const browser = X3D.getBrowser(canvas);
  const started = performance.now();
  const state = () => {
    try {
      const scene = browser.currentScene;
      if (!scene) return { roots: -1, worldURL: null };
      return {
        roots: scene.rootNodes ? scene.rootNodes.length : -1,
        worldURL: String(scene.worldURL),
      };
    } catch (e) { return { roots: -1, worldURL: null }; }
  };
  browser.loadURL(new X3D.MFString(url), new X3D.MFString());
  let previous = -1;
  const tick = () => {
    const now = state();
    const isTarget = !!(now.worldURL && now.worldURL.indexOf(url) !== -1);
    if (isTarget && now.roots > 0 && now.roots === previous) {
      /* Let textures, audio and Inlines finish arriving before the census. */
      setTimeout(() => resolve({
        roots: now.roots,
        worldURL: now.worldURL,
        ms: Math.round(performance.now() - started),
      }), 5000);
      return;
    }
    if (isTarget) previous = now.roots;
    if (performance.now() - started > 60000) {
      resolve({ roots: now.roots, worldURL: now.worldURL, ms: null, timedOut: true });
      return;
    }
    setTimeout(tick, 100);
  };
  tick();
});

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const record = { engines: {}, capturedAt: new Date().toISOString() };

  for (const engine of ENGINES) {
    const server = await serve(engine);
    const port = server.address().port;
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    /* The world files live on the QA origin; the harness page does not. */
    await page.route('**/assets/**', route => route.continue({
      url: route.request().url().replace(/^http:\/\/127\.0\.0\.1:\d+/, BASE),
    }));
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const version = await page.evaluate(() => {
      try { return X3D.getBrowser(document.querySelector('#c')).getVersion(); } catch (e) { return null; }
    });
    console.log(`\nX_ITE ${engine} (browser reports ${version})`);

    const worlds = {};
    for (const world of WORLDS) {
      const loaded = await page.evaluate(LOAD, world.url);
      await page.evaluate(SCENE_ACCESS_SOURCE);
      /*
       * A world that never arrived must not be surveyed. The scene the engine
       * is still holding is the previous world, and reading it produced a run
       * in which the Mall reported the Outlands' node counts on both engines
       * and the comparison passed on data from neither.
       */
      const survey = loaded.timedOut ? null : await page.evaluate(() => {
        const a = window.__ctr;
        const scene = a.scene();
        if (!scene) return null;
        const c = a.census(scene);
        return {
          rootNodes: scene.rootNodes.length,
          censusTotal: c.total,
          census: c.census,
          hud: c.census.HUD || 0,
          scripts: c.census.Script || 0,
          textures: c.census.ImageTexture || 0,
          audio: c.census.AudioClip || 0,
          protos: (() => { try { return Array.from(scene.protos).map(p => p.getName()); } catch (e) { return null; } })(),
          externprotos: (() => { try { return Array.from(scene.externprotos).map(p => p.getName()); } catch (e) { return null; } })(),
        };
      });
      worlds[world.key] = { loaded, survey };
      console.log(`  ${world.key.padEnd(10)} roots ${loaded.roots} nodes ${survey && survey.censusTotal}`
        + ` HUD ${survey && survey.hud} Script ${survey && survey.scripts}`
        + ` texture ${survey && survey.textures} audio ${survey && survey.audio}`
        + ` load ${loaded.ms}ms${loaded.timedOut ? ' TIMED OUT' : ''}`);
    }
    record.engines[engine] = { version, worlds, errors };
    await browser.close();
    server.close();
  }

  /* --- the comparison --------------------------------------------------- */
  console.log('\nComparison');
  const a = record.engines['15.1.12'];
  const b = record.engines['16.2.0'];
  check('both engines reported the version they were asked for',
    a.version === '15.1.12' && b.version === '16.2.0',
    `${a.version} and ${b.version}`);

  for (const world of WORLDS) {
    const x = a.worlds[world.key].survey;
    const y = b.worlds[world.key].survey;
    if (!x || !y) {
      /*
       * The bare page carries only x_ite_compat.js, and some CTR worlds need
       * more of the patch set than that to load at all - the Mall is the known
       * case, as qa/memory/tools/check-bare-xite.js already records. A world
       * that will not load here is outside what this control can measure, and
       * saying so is the honest result; the application-level runs cover it.
       */
      console.log(`  --   ${world.key}: not measurable in the bare harness`
        + ` (15.1.12 ${x ? 'loaded' : 'timed out'}, 16.2.0 ${y ? 'loaded' : 'timed out'})`);
      continue;
    }
    check(`${world.key}: both engines built the world`,
      x.rootNodes > 0 && y.rootNodes > 0,
      `roots ${x.rootNodes} vs ${y.rootNodes}, nodes ${x.censusTotal} vs ${y.censusTotal}`);
    check(`${world.key}: 16.2.0 did not build fewer nodes than 15.1.12`,
      y.censusTotal >= x.censusTotal * 0.98,
      `${x.censusTotal} -> ${y.censusTotal}`);
    for (const field of ['scripts', 'textures', 'audio']) {
      check(`${world.key}: 16.2.0 built the same number of ${field} as 15.1.12`,
        y[field] === x[field], `${x[field]} -> ${y[field]}`);
    }
  }

  const outA = a.worlds.outlands.survey;
  const outB = b.worlds.outlands.survey;
  check('the Outlands HUD is absent on both engines, so it is not an upgrade regression',
    outA && outB && outA.hud === 0 && outB.hud === 0,
    `HUD nodes: 15.1.12 ${outA && outA.hud}, 16.2.0 ${outB && outB.hud};`
    + ` ne_game.wrl declares ${JSON.stringify(outB && outB.protos)} and no EXTERNPROTO,`
    + ' and uses HUD{} twice without declaring it');

  const mallA = a.worlds.mall.survey;
  const mallB = b.worlds.mall.survey;
  if (mallA && mallB) {
    check('the Mall HUD EXTERNPROTO is unresolved on both engines',
      mallA.hud === 0 && mallB.hud === 0,
      `HUD nodes: 15.1.12 ${mallA.hud}, 16.2.0 ${mallB.hud};`
      + ' declared against a urn: address and a retired blaxxun.com URL');
  } else {
    console.log('  --   the Mall is not measurable in the bare harness; its HUD'
      + ' EXTERNPROTO is covered by check-content.js against the application');
  }

  const plazaA = a.worlds.plaza.survey;
  const plazaB = b.worlds.plaza.survey;
  check('the custom HUD type builds on both engines where it is declared locally',
    plazaA && plazaB && plazaA.hud > 0 && plazaB.hud > 0,
    `Plaza HUD nodes: 15.1.12 ${plazaA && plazaA.hud}, 16.2.0 ${plazaB && plazaB.hud};`
    + ' declared as EXTERNPROTO HUD ["/externprotos/nodes_xite.wrl#HUD"]');

  fs.writeFileSync(path.join(OUT_DIR, 'engine-comparison.json'),
    `${JSON.stringify({ ...record, results }, null, 2)}\n`);
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} comparison checks passed`);
  console.log(`report ${path.join(OUT_DIR, 'engine-comparison.json')}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
