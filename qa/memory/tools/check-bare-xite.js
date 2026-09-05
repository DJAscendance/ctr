'use strict';

/*
 * Bare X_ITE control for the repeated-world memory run.
 *
 * check-world-memory.js measures the whole application: Vue, vue-router, the
 * socket, the CTR patches and X_ITE together. When that run shows retained
 * memory climbing, it cannot say which of those is holding the old worlds.
 *
 * This control removes everything except the engine. It serves a hand-written
 * page on the QA origin - so `/assets` still resolves - containing nothing but
 * X_ITE from the same CDN pin the application uses, and then replaces the world
 * over and over through `browser.loadURL`. No Vue, no router, no socket, no CTR
 * component lifecycle.
 *
 * Read the two runs together:
 *
 *   flat here, climbing in the app  -> the retention is CTR's
 *   climbing in both                -> the retention is in the engine
 *
 * The page is fulfilled through page.route rather than written into the served
 * directory, so the control leaves nothing behind on the QA host.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/memory/tools/check-bare-xite.js [loads] [outfile]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const LOADS = Number.parseInt(process.argv[2] || '40', 10);
const OUT = process.argv[3]
  || path.join(__dirname, '..', '..', '..', 'artifacts', 'memory', 'bare-xite.json');

/*
 * The same worlds the application run walks, by their asset URLs.
 *
 * CTR_BARE_WORLDS overrides the list with a comma-separated set, which the
 * minimal-patch run needs: the Mall will not load without the full patch set,
 * so that run walks the worlds that do.
 */
const WORLDS = process.env.CTR_BARE_WORLDS
  ? process.env.CTR_BARE_WORLDS.split(',')
  : [
    '/assets/worlds/enter/vrml/enter.wrl',
    '/assets/worlds/shopping/vrml/shopping.wrl',
    '/assets/worlds/shop/vrml/shop.wrl',
    '/assets/worlds/fleamarket/vrml/fleamarket.wrl',
    '/assets/worlds/shopping/vrml/shopping.wrl',
  ];

/* Pinned to match spa/public/index.html; a control on another build proves nothing. */
const XITE = 'https://cdn.jsdelivr.net/npm/x_ite@15.1.12/dist/x_ite.min.js';
const XITE_CSS = 'https://cdn.jsdelivr.net/npm/x_ite@15.1.12/dist/x_ite.min.css';

/*
 * The engine patches are kept; the application lifecycle is what is removed.
 *
 * The control exists to answer "is CTR holding the old worlds, or is X_ITE?",
 * so it must drop Vue, the router, the socket and the components - and it must
 * not drop the engine. These patches are what makes X_ITE 15 render these
 * particular archived worlds at all: without them the Mall fails to load in
 * this harness, and a control that cannot walk the same worlds as the
 * application run answers nothing.
 *
 * legacy_links.js is the one omission. It is the only patch that pulls in a
 * module through `require`, so it cannot be inlined into a plain page, and it
 * only rewrites dead cybertown.com URLs on navigation - which this harness
 * never performs.
 *
 * They are read from the repository rather than copied, so the control cannot
 * drift away from what the application ships. x_ite_compat.js must stay first,
 * exactly as in App.vue.
 */
const PATCH_DIR = path.join(__dirname, '..', '..', '..', 'spa', 'src', 'libs', 'x_ite_mods');
const PATCH_FILES = [
  'x_ite_compat.js',
  'spec_color.js',
  'relax_route.js',
  'relax_is.js',
  'arrow_keys.js',
  'viewpoint_bind.js',
  'allow_sf_string.js',
  'bxx_auth.js',
  'scene_cache.js',
];
/*
 * CTR_BARE_PATCHES=minimal drops every patch but the compatibility shim.
 *
 * The full-patch control still runs CTR code, so on its own it cannot separate
 * "the engine retains worlds" from "one of our patches retains worlds" -
 * scene_cache.js in particular reaches into the engine's file cache. Re-running
 * with only x_ite_compat.js, over the worlds that load without the rest,
 * settles that. Both runs growing at the same rate clears the patches.
 */
const MINIMAL = process.env.CTR_BARE_PATCHES === 'minimal';
/*
 * CTR_BARE_PATCH_LIST names an exact patch set, always behind the compat shim.
 * This is what turns the control into a bisector once the two runs above have
 * shown that some patch, rather than the engine, is doing the retaining.
 */
const CHOSEN = process.env.CTR_BARE_PATCH_LIST
  ? ['x_ite_compat.js'].concat(process.env.CTR_BARE_PATCH_LIST.split(',').filter(Boolean))
  : null;
const PATCHES = (CHOSEN || (MINIMAL ? PATCH_FILES.slice(0, 1) : PATCH_FILES))
  .map(name => `try {\n${fs.readFileSync(path.join(PATCH_DIR, name), 'utf8')}\n} catch (e) {`
    + ` console.warn('patch failed: ${name}', e); }`)
  .join('\n');

const PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="${XITE_CSS}">
    <style>html,body{margin:0;height:100%} x3d-canvas{display:block;width:100%;height:100%}</style>
    <script src="${XITE}"></script>
    <script>${PATCHES}</script>
  </head>
  <body>
    <div id="world" style="width:1280px;height:700px"></div>
    <script>
      /*
       * One canvas for the whole run, exactly as the application keeps one.
       * loadURL replaces the world in place; a new canvas per load would be a
       * different test with a different answer.
       */
      window.__control = {
        ready: false,
        loads: 0,
        scenes: [],
        start() {
          const canvas = X3D.createBrowser();
          document.querySelector('#world').appendChild(canvas);
          this.canvas = canvas;
          this.browser = X3D.getBrowser(canvas);
          this.ready = true;
        },
        load(url) {
          return new Promise((resolve, reject) => {
            const done = (eventType) => {
              if (eventType === X3D.X3DConstants.INITIALIZED_EVENT) {
                this.loads += 1;
                const scene = this.browser.currentScene;
                resolve({
                  loads: this.loads,
                  rootNodes: scene ? scene.rootNodes.length : -1,
                  canvases: document.querySelectorAll('x3d-canvas').length,
                });
              } else if (eventType === X3D.X3DConstants.CONNECTION_ERROR
                  || eventType === X3D.X3DConstants.INITIALIZED_ERROR) {
                reject(new Error('load failed: ' + url));
              }
            };
            /* Keyed by a constant, matching what the application does. */
            this.browser.addBrowserCallback(this, done);
            this.browser.loadURL(new X3D.MFString(url), new X3D.MFString());
          });
        },
      };
      X3D(() => { window.__control.start(); }, (error) => { window.__controlError = String(error); });
    </script>
  </body>
</html>`;

async function forcedHeap(cdp) {
  for (let pass = 0; pass < 2; pass += 1) {
    await cdp.send('HeapProfiler.collectGarbage');
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  const usage = await cdp.send('Runtime.getHeapUsage');
  return usage.usedSize;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl',
      '--enable-precise-memory-info'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('Runtime.enable');

  await page.route(`${BASE}/xite-control.html`, route => route.fulfill({
    status: 200, contentType: 'text/html', body: PAGE,
  }));

  let died = null;
  page.on('crash', () => { died = 'page crashed'; });

  const rows = [];
  await page.goto(`${BASE}/xite-control.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__control && window.__control.ready', null, { timeout: 60000 });

  try {
    for (let i = 1; i <= LOADS; i += 1) {
      const url = WORLDS[(i - 1) % WORLDS.length];
      const info = await page.evaluate(u => window.__control.load(u), url);
      const row = { load: i, url, rootNodes: info.rootNodes, canvases: info.canvases };
      if (i === 1 || i % 10 === 0 || i === LOADS) {
        row.retainedHeap = await forcedHeap(cdp);
        row.checkpoint = true;
      }
      rows.push(row);
      process.stdout.write(`#${String(i).padStart(3)} ${url.padEnd(44)}` +
        ` roots=${row.rootNodes} canvas=${row.canvases}` +
        (row.retainedHeap ? ` retained=${(row.retainedHeap / 1048576).toFixed(1)}MB` : '') + '\n');
      if (died) break;
    }
  } catch (error) {
    died = died || String(error);
  }

  const points = rows.filter(r => r.checkpoint && r.load >= 10);
  let perLoad = null;
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    perLoad = (last.retainedHeap - first.retainedHeap) / (last.load - first.load);
  }

  fs.writeFileSync(OUT, `${JSON.stringify({ died, perLoad, rows }, null, 2)}\n`);
  process.stdout.write(`\nbare X_ITE retained growth: ${perLoad === null ? 'n/a'
    : `${(perLoad / 1048576).toFixed(2)} MB per load`}${died ? ` (died: ${died})` : ''}\n`);

  await browser.close();
  process.exit(died ? 2 : 0);
}

main();
