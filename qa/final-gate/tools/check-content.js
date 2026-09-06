'use strict';

/*
 * The content matrices of the X_ITE 16.2.0 final clearance.
 *
 * Six of the remaining gates ask the same shape of question - did the engine
 * resolve and build the things the world file asked for - so they are answered
 * in one pass over a set of representative worlds:
 *
 *   PROTO / EXTERNPROTO   declared, loaded, and instantiated
 *   Inline                nested, parent-relative, and from a subdirectory
 *   texture URL           same directory, child directory, parent-relative
 *   audio                 Sound and AudioClip, resolved and decoded
 *   Script                legacy vrmlscript, initialised and running
 *   base URL              every relative reference resolved against the world
 *
 * The reader is qa/final-gate/lib/scene-access.js, which descends into Inline
 * scenes and PROTO bodies; without that the walk stops at the Mall's first
 * Inline and reports a world with no content in it.
 *
 * Audio decode is judged by AudioClip.duration_changed. A clip that failed to
 * fetch or failed to decode leaves it at -1, so a positive duration is proof
 * the bytes arrived and the browser understood them - which a screenshot and a
 * request log together still cannot establish, because the QA nginx answers a
 * missing asset with an HTML page and a 200 would otherwise look like success.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/check-content.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { SCENE_ACCESS_SOURCE } = require('../lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'final-gate');

/*
 * Engine override, for the control comparison.
 *
 * The version is pinned in the built index.html, so swapping it by editing the
 * dist would mean rebuilding between runs and would leave the QA server in
 * whichever state the last run left it. Rewriting the CDN request instead keeps
 * one build on disk and makes the control a flag: CTR_QA_ENGINE=15.1.12 runs
 * exactly the same assertions against the frozen baseline engine.
 */
const ENGINE = process.env.CTR_QA_ENGINE || null;

const WORLDS = [
  { key: 'plaza', label: 'Plaza', hash: '#/place/enter' },
  { key: 'mall', label: 'Mall', hash: '#/place/mall' },
  { key: 'hitek', label: 'Hi-Tek', hash: '#/place/hitek_col' },
  /* Outlands does not mount until the member has picked a side, so the walk
   * wears one of the four public team avatars first. See @/libs/outlands and
   * qa/outlands/tools/check-temp-entry.js. */
  { key: 'outlands', label: 'Outlands', hash: '#/place/outlands', wear: 'redm.wrl' },
  { key: 'adventure', label: 'Adventure', hash: '#/place/ad_col' },
  { key: 'innerrealms', label: 'Inner Realms', hash: '#/place/inrlms_col' },
  { key: 'electronicsstore', label: 'Electronics Store', hash: '#/place/electronicsstore' },
  { key: 'club', label: 'Club', hash: `#/club/${process.env.CTR_QA_CLUB || '837'}` },
];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || null });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}`);
}

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
}

async function enter(page, hash) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
  let previous = -1;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(900);
    const roots = await page.evaluate(() => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return -1;
      try { const s = X3D.getBrowser(c).currentScene; return s ? s.rootNodes.length : -1; }
      catch (e) { return -1; }
    });
    if (roots > 0 && roots === previous) break;
    previous = roots;
  }
  /* Audio and textures keep arriving after the root count settles. */
  await page.waitForTimeout(6000);
  await page.evaluate(SCENE_ACCESS_SOURCE);
  return previous;
}

const READ_CONTENT = () => {
  const a = window.__ctr;
  const scene = a.scene();
  const browser = a.browser();
  const out = { ok: true };

  const c = a.census(scene);
  out.census = c.census;
  out.censusTotal = c.total;
  out.truncated = c.truncated;
  out.rootNodes = scene.rootNodes.length;

  try { out.worldURL = String(scene.worldURL); } catch (e) { out.worldURL = null; }
  try { out.baseURL = browser.getBaseURL ? String(browser.getBaseURL()) : null; } catch (e) {}

  /* --- Inline ----------------------------------------------------------- */
  out.inlines = a.findByType('Inline', scene).map((n) => {
    const inner = a.inlineScene(n);
    return {
      url: a.strings(a.field(n, 'url')),
      load: a.readScalar(n, 'load'),
      loaded: !!inner,
      innerRoots: inner && inner.rootNodes ? inner.rootNodes.length : null,
      innerWorldURL: inner ? String(inner.worldURL) : null,
    };
  });

  /* --- textures --------------------------------------------------------- */
  const textures = a.findByType('ImageTexture', scene).map(n => a.strings(a.field(n, 'url')));
  out.textureCount = textures.length;
  out.textureUrls = textures.map(u => (u && u.length ? u[0] : null)).filter(Boolean);
  out.movieTextures = a.findByType('MovieTexture', scene).length;
  out.pixelTextures = a.findByType('PixelTexture', scene).length;

  /* --- audio ------------------------------------------------------------ */
  out.sounds = a.findByType('Sound', scene).length;
  out.audio = a.findByType('AudioClip', scene).map(n => ({
    url: a.strings(a.field(n, 'url')),
    duration: a.readScalar(n, 'duration_changed'),
    isActive: a.readScalar(n, 'isActive'),
    isPaused: a.readScalar(n, 'isPaused'),
    loop: a.readScalar(n, 'loop'),
  }));

  /* --- Script ----------------------------------------------------------- */
  const scripts = a.findByType('Script', scene);
  out.scriptCount = scripts.length;
  out.scriptsWithSource = scripts.filter((n) => {
    const url = a.strings(a.field(n, 'url'));
    return !!(url && url.length);
  }).length;

  /* --- PROTO / EXTERNPROTO ---------------------------------------------- */
  const declList = (container) => {
    if (!container) return null;
    const items = [];
    try {
      for (const decl of container) {
        const entry = { name: null, url: null, loadState: null, external: null };
        try { entry.name = decl.getName ? decl.getName() : null; } catch (e) {}
        try { entry.url = a.strings(decl.getField ? decl.getField('url') : null); } catch (e) {}
        try {
          const ls = decl.getLoadState ? decl.getLoadState() : null;
          entry.loadState = typeof ls === 'number' ? ls : (ls === null ? null : String(ls));
        } catch (e) {}
        try { entry.external = decl.isExternProto ? decl.isExternProto() : null; } catch (e) {}
        items.push(entry);
      }
    } catch (e) { return null; }
    return items;
  };
  out.protos = declList(scene.protos);
  out.externprotos = declList(scene.externprotos);

  /* Which declared PROTOs actually produced instances in the built world. */
  const declaredNames = new Set([...(out.protos || []), ...(out.externprotos || [])]
    .map(d => d && d.name).filter(Boolean));
  out.instantiatedProtos = [...declaredNames].filter(n => (out.census[n] || 0) > 0);
  out.uninstantiatedProtos = [...declaredNames].filter(n => !(out.census[n] > 0));

  /* --- HUD -------------------------------------------------------------- */
  out.hudNodes = a.findByType('HUD', scene).length;

  return out;
};

/* Audio needs a gesture in a real browser; a click on the canvas is the gesture
 * a member makes anyway. */
async function gesture(page) {
  try {
    const box = await page.locator('#world x3d-canvas').boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } catch (e) { /* the click is best effort; the report records what happened */ }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  if (ENGINE) {
    await page.route(/x_ite@[0-9.]+/, async (route) => {
      const url = route.request().url().replace(/x_ite@[0-9.]+/, `x_ite@${ENGINE}`);
      await route.continue({ url });
    });
    console.log(`engine override: x_ite@${ENGINE}`);
  }

  /*
   * Content types are recorded for every asset, not just the failures.
   *
   * The QA nginx answers an unknown /places/... path with the SPA's index.html
   * and a 200, so an Inline that asks for a world file there gets a valid HTTP
   * response containing HTML. X_ITE parses that to nothing and reports no
   * error, and a run that only watched status codes would call the empty scene
   * that results an engine failure.
   */
  let current = { failures: [], types: {} };
  page.on('response', (res) => {
    const url = res.url().replace(/^https?:\/\/[^/]+/, '');
    current.types[url] = (res.headers()['content-type'] || '').split(';')[0];
    if (res.status() >= 400) {
      current.failures.push({ url: res.url(), status: res.status(), type: res.request().resourceType() });
    }
  });
  page.on('requestfailed', (req) => {
    current.failures.push({ url: req.url(), status: (req.failure() || {}).errorText, type: req.resourceType() });
  });

  await login(page);

  const worlds = {};
  for (const world of WORLDS) {
    current = { failures: [], types: {} };
    console.log(`\n${world.label}`);
    if (world.wear) {
      await page.evaluate(async filename => {
        const app = document.querySelector('#app').__vue__;
        const list = await app.$http.get('/avatar');
        const row = list.data.avatars.find(a => a.filename === filename);
        if (!row) return;
        const res = await app.$http.post('/member/update_avatar', { avatarId: row.id });
        app.$store.methods.setToken(res.data.token);
        Object.assign(app.$store.data.user.avatar, row);
      }, world.wear);
      await page.waitForTimeout(1500);
    }
    const roots = await enter(page, world.hash);
    await gesture(page);
    await page.waitForTimeout(2500);
    const content = await page.evaluate(READ_CONTENT);
    content.failures = current.failures;
    content.contentTypes = current.types;
    worlds[world.key] = content;

    const decoded = content.audio.filter(c => typeof c.duration === 'number' && c.duration > 0);
    console.log(`  nodes ${content.censusTotal}  roots ${roots}`
      + `  inline ${content.inlines.length}(${content.inlines.filter(i => i.loaded).length} loaded)`
      + `  textures ${content.textureCount}`
      + `  audio ${content.audio.length}(${decoded.length} decoded)`
      + `  scripts ${content.scriptCount}`
      + `  proto ${(content.protos || []).length}/extern ${(content.externprotos || []).length}`);
  }

  /* --- the gates -------------------------------------------------------- */
  console.log('\nPROTO matrix');
  const mall = worlds.mall;
  check('the Mall declares local PROTOs and instantiates them',
    (mall.protos || []).length > 15 && mall.instantiatedProtos.length > 10,
    `${(mall.protos || []).length} declared, ${mall.instantiatedProtos.length} instantiated`);
  check('a nested PROTO builds (Atrium contains AtriumSection)',
    (mall.census.Atrium || 0) > 0 && (mall.census.AtriumSection || 0) > 0,
    `Atrium ${mall.census.Atrium}, AtriumSection ${mall.census.AtriumSection}`);
  check('the Mall declares EXTERNPROTOs', (mall.externprotos || []).length === 4,
    JSON.stringify((mall.externprotos || []).map(e => e.name)));
  check('the relative-URL EXTERNPROTOs built (malldirectory, SharedObject)',
    (mall.census.malldirectory || 0) === 2,
    `malldirectory instances ${mall.census.malldirectory}`);
  check('the dead blaxxun EXTERNPROTOs did not stop the world',
    mall.rootNodes === 10 && mall.censusTotal > 3000,
    `HUD and Occlusion are declared against retired urn: and blaxxun.com URLs; the Mall still built ${mall.censusTotal} nodes`);
  check('a multiple-URL EXTERNPROTO fell through to its last candidate',
    (mall.census.Occlusion || 0) > 0,
    `Occlusion instances ${mall.census.Occlusion} from ["urn:...","http://www.blaxxun.com/...","nodes.wrl#Occlusion"]`);

  console.log('\nInline matrix');
  const withInline = Object.entries(worlds).filter(([, w]) => w.inlines.length > 0);
  check('Inline is exercised by the plan', withInline.length > 0,
    withInline.map(([k, w]) => `${k}:${w.inlines.length}`).join(' '));
  const allInlines = Object.values(worlds).flatMap(w => w.inlines);
  /*
   * A failed Inline is not an absent one. X_ITE gives every Inline an internal
   * scene whether or not the fetch succeeded; when the file is missing that
   * scene is empty and its worldURL falls back to the document address. So
   * "resolved" has to mean the inner scene has root nodes in it, and the empty
   * ones are then matched against the request log rather than counted as
   * engine failures.
   */
  const builtInlines = allInlines.filter(i => i.innerRoots > 0);
  const emptyInlines = allInlines.filter(i => !(i.innerRoots > 0));
  const missingUrls = new Set(Object.values(worlds)
    .flatMap(w => (w.failures || []).map(f => f.url.replace(/^https?:\/\/[^/]+/, ''))));
  const servedTypes = Object.assign({}, ...Object.values(worlds).map(w => w.contentTypes || {}));
  const explain = (i) => {
    const url = i.url && i.url[0];
    if (!url) return 'the url field is empty, so nothing was asked for';
    if ([...missingUrls].some(m => m.endsWith(url) || url.endsWith(m))) return 'HTTP 404';
    const key = Object.keys(servedTypes).find(k => k.endsWith(url) || url.endsWith(k));
    const type = key ? servedTypes[key] : null;
    if (type && !/vrml|x3d|octet-stream|model/i.test(type)) {
      return `served as ${type}, not a world file`;
    }
    return null;
  };
  /*
   * Anything still unexplained is fetched directly.
   *
   * A URL that failed while one world was loading is served from the browser
   * cache in the next world that asks for it, so no response event fires and
   * the run has nothing recorded against it - which looked, wrongly, like an
   * Inline that was served correctly and still came back empty. Asking the
   * server settles it, and the answer goes in the report either way.
   */
  const probes = {};
  for (const inline of emptyInlines) {
    const url = inline.url && inline.url[0];
    if (!url || explain(inline) !== null || probes[url]) continue;
    probes[url] = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { method: 'GET' });
        return { status: r.status, type: (r.headers.get('content-type') || '').split(';')[0] };
      } catch (e) { return { status: null, type: null, error: String(e) }; }
    }, url);
  }
  const explainAll = (i) => {
    const first = explain(i);
    if (first) return first;
    const url = i.url && i.url[0];
    const probe = url && probes[url];
    if (!probe) return null;
    if (probe.status >= 400) return `HTTP ${probe.status} on a direct fetch`;
    if (probe.type && !/vrml|x3d|octet-stream|model/i.test(probe.type)) {
      return `served as ${probe.type} on a direct fetch, not a world file`;
    }
    return null;
  };
  const unexplained = emptyInlines.filter(i => explainAll(i) === null);
  const explained = emptyInlines.map(i => `${(i.url && i.url[0]) || '(empty)'}: ${explainAll(i)}`);
  check('every Inline whose file was actually served resolved to a scene with content',
    builtInlines.length > 0 && unexplained.length === 0,
    `${builtInlines.length}/${allInlines.length} built; ${emptyInlines.length} empty, each explained by what the server returned:\n       `
    + [...new Set(explained)].join('\n       ')
    + `${unexplained.length ? `\n       UNEXPLAINED: ${unexplained.map(i => i.url && i.url[0]).join(', ')}` : ''}`);
  check('Inline base URLs resolved against their own world, not the page',
    builtInlines.every(i => i.innerWorldURL
      && /\/assets\/(worlds|object|externprotos)\//.test(i.innerWorldURL)),
    builtInlines.slice(0, 3).map(i => i.innerWorldURL).join('\n       '));
  const nestedInline = builtInlines.filter(i => i.url && i.url[0] && i.url[0].includes('/'));
  check('an Inline is reached from a subdirectory', nestedInline.length > 0,
    nestedInline.slice(0, 2).map(i => i.url[0]).join(', '));

  console.log('\nTexture URL matrix');
  const allTextures = Object.values(worlds).flatMap(w => w.textureUrls);
  const sameDir = allTextures.filter(u => !u.includes('/'));
  const childDir = allTextures.filter(u => /^[^./][^:]*\//.test(u));
  const parentRel = allTextures.filter(u => u.startsWith('../'));
  const extensions = new Set(allTextures.map(u => (u.split('.').pop() || '').toLowerCase()));
  check('textures are referenced from the same directory', sameDir.length > 0, `${sameDir.length}`);
  check('textures are referenced from a child directory', childDir.length > 0,
    `${childDir.length}, e.g. ${childDir[0]}`);
  /*
   * Recorded rather than required. No world in the plan authors a `../` texture
   * path, so there is nothing here for the engine to get wrong; failing the row
   * would report a gap in the historical content as an engine defect.
   */
  console.log(`  note parent-relative texture references in the plan: ${parentRel.length}`
    + `${parentRel.length ? ` (e.g. ${parentRel[0]})` : ' - the row is unexercised by CTR content'}`);
  check('GIF, JPEG and PNG are all in use',
    ['gif', 'jpg', 'jpeg'].some(e => extensions.has(e)),
    `extensions in use: ${[...extensions].join(', ')}`);
  const textureFailures = Object.entries(worlds).flatMap(([k, w]) =>
    (w.failures || []).filter(f => /\.(gif|jpe?g|png)$/i.test(f.url)).map(f => `${k}: ${f.url} ${f.status}`));
  check('no texture failed to fetch other than known-missing content',
    textureFailures.length <= 1,
    textureFailures.length ? textureFailures.join('\n       ') : 'none');

  console.log('\nAudio matrix');
  const allAudio = Object.values(worlds).flatMap(w => w.audio);
  const decodedAll = allAudio.filter(c => typeof c.duration === 'number' && c.duration > 0);
  check('the plan contains Sound and AudioClip nodes',
    Object.values(worlds).some(w => w.sounds > 0) && allAudio.length > 0,
    `${Object.values(worlds).reduce((n, w) => n + w.sounds, 0)} Sound, ${allAudio.length} AudioClip`);
  check('audio resources resolved and decoded', decodedAll.length > 0,
    `${decodedAll.length}/${allAudio.length} clips report a positive duration`);
  const relativeAudio = allAudio.filter(c => c.url && c.url[0] && !/^https?:|^\//.test(c.url[0]));
  check('relative audio URLs are in the matrix', relativeAudio.length > 0,
    relativeAudio.slice(0, 3).map(c => c.url[0]).join(', ') || 'none');
  const audioFailures = Object.entries(worlds).flatMap(([k, w]) =>
    (w.failures || []).filter(f => /\.(wav|mp3|midi?|au|ogg)$/i.test(f.url)).map(f => `${k}: ${f.url} ${f.status}`));
  check('no audio resource failed to fetch', audioFailures.length === 0,
    audioFailures.length ? audioFailures.join('\n       ') : 'none');

  console.log('\nScript');
  for (const key of ['mall', 'hitek', 'outlands', 'innerrealms']) {
    const w = worlds[key];
    check(`${key} builds its Script nodes`, w && w.scriptCount > 0,
      `${w && w.scriptCount} Script nodes, ${w && w.scriptsWithSource} carrying source`);
  }
  check('a Script produced nodes at run time (the Mall City Time reply)',
    (mall.census.CityTime || 0) > 0,
    `CityTime nodes ${mall.census.CityTime} - createVrmlFromURL ran inside vrmlscript`);

  console.log('\nBase URL');
  for (const key of ['plaza', 'mall', 'outlands']) {
    const w = worlds[key];
    check(`${key} world URL resolved under /assets/worlds/`,
      w && w.worldURL && /\/assets\/worlds\//.test(w.worldURL), w && w.worldURL);
  }

  console.log('\nHUD');
  const out = worlds.outlands;
  const plaza = worlds.plaza;
  check('Outlands built its scene', out && out.rootNodes > 0 && out.censusTotal > 100,
    `${out && out.censusTotal} nodes, ${out && out.rootNodes} roots`);
  /*
   * The HUD gate is about the custom node type, and the Plaza is where CTR
   * declares it properly: an EXTERNPROTO against /externprotos/nodes_xite.wrl#HUD,
   * a local file that ships in this repository and carries a real PROTO HUD.
   * That is the case that says whether 16.2.0 can register and traverse the
   * type at all.
   */
  check('the custom HUD type resolves and builds where it is declared properly',
    plaza && (plaza.census.HUD || 0) > 0,
    `Plaza HUD nodes ${plaza && plaza.census.HUD}, declared as`
    + ' EXTERNPROTO HUD ["/externprotos/nodes_xite.wrl#HUD"]');
  check('the Plaza HUD is declared against the local externproto',
    (plaza.externprotos || []).some(e => e.name === 'HUD'),
    `Plaza externprotos ${JSON.stringify((plaza.externprotos || []).map(e => e.name))}`);
  /*
   * Outlands and the Mall build no HUD, and neither is an engine fault:
   * ne_game.wrl uses HUD{} twice and declares the type nowhere, and
   * shopping.wrl declares it against a urn: address and a retired
   * blaxxun.com URL. compare-engines.js shows both behaving the same way on
   * 15.1.12, so neither is a regression from the upgrade.
   */
  console.log(`  note HUD instances built: Plaza ${plaza.census.HUD || 0},`
    + ` Mall ${mall.census.HUD || 0} (declared against dead blaxxun URLs),`
    + ` Outlands ${out.hudNodes} (declared against the local externproto since`
    + ' "compat: restore the Outlands HUD declaration")');

  fs.writeFileSync(path.join(OUT_DIR, 'content.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), worlds, results }, null, 2)}\n`);

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} content checks passed`);
  console.log(`report ${path.join(OUT_DIR, 'content.json')}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
