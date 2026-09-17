/**
 * How fast an inmate actually walks, measured by walking.
 *
 * Nothing here reads a NavigationInfo field and calls it proof. Each Jail world is loaded
 * under the pinned X_ITE 16.2.0 with the app's REAL movement patch
 * (spa/src/libs/x_ite_mods/movement_speed.js) and the app's REAL precedence helper
 * (spa/src/helpers/movement-speed.helper.ts, transpiled here rather than copied, so the
 * gate cannot drift from the code it is testing). The viewer is then walked with real
 * mouse input for a fixed interval and the LIVE camera position is read out of an injected
 * ProximitySensor before, during and after. The distance covered is the answer.
 *
 * Two things this gate inherits from qa/jail/tools/check-jail-confinement.js, both learned
 * the hard way:
 *
 *  * `getActiveViewpoint()` reports the AUTHORED viewpoint, not where walking has taken
 *    the avatar. Only a ProximitySensor sees movement.
 *  * Arrow keys do nothing. X_ITE's WALK viewer moves on a held mouse drag.
 *
 * And one of its own: the walk is measured in two halves. A world with walls can stop the
 * avatar mid-measurement, and a single start/end pair cannot tell "walked slowly" from
 * "walked normally into a wall". Two halves that disagree mean the measurement hit
 * something and the gate says so instead of reporting a ratio it cannot stand behind.
 *
 * WHICH WORLD IS WHOSE is not decided here and cannot be: `JailService.applyWorldForMember`
 * answers `vrml/jailinmate.wrl` only for a citizen with a live `jail` ban row. This gate
 * measures the worlds the server hands out; qa's API and SPA suites prove who gets which.
 *
 * Run:  DISPLAY=:1 node qa/jail/tools/check-jail-speed.js [outDir]
 *       CTR_QA_ALLOW_SOFTWARE=1 ...   on a host with no GPU
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const SPA_DIR = path.join(REPO, 'spa');
const ASSETS = path.join(SPA_DIR, 'assets');
const OUT_DIR = process.argv[2] || path.join(REPO, '..', 'artifacts', 'jail-speed');
const PORT = Number(process.env.CTR_JAIL_QA_PORT) || 8212;
const BASE = `http://127.0.0.1:${PORT}`;
const ALLOW_SOFTWARE = process.env.CTR_QA_ALLOW_SOFTWARE === '1';

/** Milliseconds of held movement per half. Short enough that nobody reaches a wall. */
const HALF_MS = Number(process.env.CTR_JAIL_QA_HALF_MS) || 1500;
/** The plane the force field stands on; see check-jail-confinement.js. */
const BOUNDARY_Z = 1.25;
/** How close to the barrier a measurement may end before it is thrown away. */
const CLEARANCE = 1.5;
/** Two halves further apart than this fraction mean the avatar met something. */
const STEADY_TOLERANCE = 0.3;
/** How far the measured ratio may sit from the configured one. */
const RATIO_TOLERANCE = 0.08;

const TYPES = {
  '.wrl': 'model/vrml', '.html': 'text/html', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.png': 'image/png',
  '.mp4': 'video/mp4', '.wav': 'audio/wav',
};

/**
 * The application's own precedence helper, compiled rather than reimplemented.
 *
 * It is plain TypeScript with no imports, so a bare transpile is enough. Copying the
 * numbers into this file instead would have made the gate agree with itself no matter what
 * the app did, which is the one thing a gate must never do.
 */
function helperBundle() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const ts = require(path.join(SPA_DIR, 'node_modules', 'typescript'));
  const source = fs.readFileSync(
    path.join(SPA_DIR, 'src', 'helpers', 'movement-speed.helper.ts'), 'utf8',
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  return `(function () { var exports = {}; ${js}\nwindow.__ctrSpeedHelper = exports; })();`;
}

const PAGE = [
  '<!doctype html><html><head>',
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/x_ite@16.2.0/dist/x_ite.min.css">',
  '<script src="https://cdn.jsdelivr.net/npm/x_ite@16.2.0/dist/x_ite.min.js"></script>',
  '<style>html,body{margin:0;height:100%}#world{width:900px;height:640px}',
  'x3d-canvas{display:block;width:100%;height:100%}</style>',
  '</head><body><div id="world"></div></body></html>',
].join('');

/** The patches the movement seam needs, in the order src/App.vue loads them. */
const PATCHES = [
  'x_ite_compat.js',
  'movement_speed.js',
];

function startAssetServer() {
  const helper = helperBundle();
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]).replace(/\/{2,}/g, '/');
      if (url === '/jail-speed-qa.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(PAGE);
      }
      if (url === '/ctr/helper.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        return res.end(helper);
      }
      let file = null;
      if (url.startsWith('/ctr/patch/')) {
        const name = path.basename(url);
        if (PATCHES.includes(name)) file = path.join(SPA_DIR, 'src', 'libs', 'x_ite_mods', name);
      } else if (url.startsWith('/assets/')) file = path.join(SPA_DIR, url);
      else if (url.startsWith('/externprotos/')) file = path.join(ASSETS, url);
      if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      });
      return fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

/** Installs the live-position probe. The SAI cannot answer this - see the header. */
async function installProbe(page) {
  await page.evaluate(() => {
    const browser = window.__ctrBrowser;
    const probe = browser.currentScene.createNode('ProximitySensor');
    probe.size = new X3D.SFVec3f(1e6, 1e6, 1e6);
    probe.center = new X3D.SFVec3f(0, 0, 0);
    window.__ctrCam = null;
    probe.getField('position_changed').addFieldCallback('ctr-jail-speed-qa', (value) => {
      window.__ctrCam = [value.x, value.y, value.z];
    });
    browser.currentScene.addRootNode(probe);
  });
}

/** Holds the mouse forward, which is how X_ITE's WALK viewer moves. Returns real ms held. */
async function walk(page, ms) {
  const box = await page.locator('#world x3d-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const began = Date.now();
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    await page.mouse.move(cx, cy - 60);
    await page.waitForTimeout(100);
  }
  const held = Date.now() - began;
  await page.mouse.up();
  await page.waitForTimeout(400);
  return held;
}

const read = (page) => page.evaluate(() => window.__ctrCam);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

async function main() {
  // Playwright is installed once at the wrapper level and shared by every worktree.
  // eslint-disable-next-line global-require
  const { chromium } = require(require.resolve('playwright', {
    paths: [path.resolve(REPO, '..'), REPO],
  }));
  const server = await startAssetServer();
  const browser = await chromium.launch({
    args: ALLOW_SOFTWARE
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist']
      : ['--use-gl=angle', '--use-angle=gl'],
  });

  const failures = [];
  const report = [];

  /** Loads one world with the real patches in place and walks it at one dial setting. */
  async function measure(label, worldFilename, dial) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message ? e.message : e)));
    page.on('response', r => {
      if (r.url().startsWith(BASE) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${BASE}/jail-speed-qa.html`);
    await page.waitForFunction(() => typeof window.X3D !== 'undefined', { timeout: 30000 });

    for (const patch of PATCHES) await page.addScriptTag({ url: `${BASE}/ctr/patch/${patch}` });
    await page.addScriptTag({ url: `${BASE}/ctr/helper.js` });

    /*
     * The same provider WorldBrowserPage.applyMovementSpeed() registers, with the same
     * three arguments: the place row's world_filename (the server's answer), the citizen's
     * dial, and the bound NavigationInfo.speed the patch reads for us.
     */
    const wired = await page.evaluate(({ world, dialValue }) => {
      if (!window.__ctrSpeedHelper || !window.X3D.bxx
        || typeof window.X3D.bxx.setSpeedMultiplierProvider !== 'function') return false;
      window.X3D.bxx.setSpeedMultiplierProvider(
        (authoredWorldSpeed) => window.__ctrSpeedHelper.movementSpeedFactor(
          world, dialValue, authoredWorldSpeed,
        ),
      );
      return true;
    }, { world: worldFilename, dialValue: dial });
    if (!wired) {
      failures.push(`${label}: the movement patch or helper did not load`);
      await page.close();
      return null;
    }

    const loadError = await page.evaluate(async (url) => {
      const canvas = X3D.createBrowser();
      document.getElementById('world').appendChild(canvas);
      const b = X3D.getBrowser(canvas);
      window.__ctrBrowser = b;
      try {
        await b.loadURL(new X3D.MFString(url));
      } catch (e) {
        return String(e && e.message ? e.message : e);
      }
      return null;
    }, `${BASE}/assets/worlds/jail/${worldFilename}`);
    if (loadError) {
      failures.push(`${label}: world failed to load: ${loadError}`);
      await page.close();
      return null;
    }

    await installProbe(page);
    await page.waitForTimeout(4000);
    /* A short nudge first: it proves the control reaches the browser at all, and it gets
     * the avatar past the first frame so the measurement is steady-state walking. */
    await walk(page, 300);

    const start = await read(page);
    const heldA = await walk(page, HALF_MS);
    const mid = await read(page);
    const heldB = await walk(page, HALF_MS);
    const end = await read(page);

    await page.close();

    if (!start || !mid || !end) {
      failures.push(`${label}: could not read the live camera position`);
      return null;
    }
    const first = flat(start, mid);
    const second = flat(mid, end);
    const distance = first + second;
    const seconds = (heldA + heldB) / 1000;
    const entry = {
      label,
      world: worldFilename,
      dial,
      start: start.map(n => Number(n.toFixed(3))),
      end: end.map(n => Number(n.toFixed(3))),
      firstHalf: Number(first.toFixed(3)),
      secondHalf: Number(second.toFixed(3)),
      distance: Number(distance.toFixed(3)),
      seconds: Number(seconds.toFixed(3)),
      unitsPerSecond: Number((distance / seconds).toFixed(3)),
      errors,
    };
    report.push(entry);
    process.stdout.write(
      `${label.padEnd(26)} dial=${dial}  dist=${entry.distance}  `
      + `units/s=${entry.unitsPerSecond}  halves=${entry.firstHalf}/${entry.secondHalf}  `
      + `endZ=${entry.end[2]}\n`,
    );

    if (distance < 0.5) {
      failures.push(`${label}: the viewer never moved - this measurement proves nothing`);
      return null;
    }
    if (end[1] < 0) {
      failures.push(`${label}: the viewer fell through the floor (end y=${entry.end[1]})`);
      return null;
    }
    const steadiness = Math.abs(first - second) / Math.max(first, second);
    if (steadiness > STEADY_TOLERANCE) {
      failures.push(
        `${label}: the two halves disagree (${entry.firstHalf} vs ${entry.secondHalf}) - `
        + 'the avatar met something, so this is not a speed measurement',
      );
      return null;
    }
    if (Math.abs(end[2] - BOUNDARY_Z) < CLEARANCE) {
      failures.push(
        `${label}: the walk ended against the cell boundary (z=${entry.end[2]}) - `
        + 'shorten CTR_JAIL_QA_HALF_MS and measure again',
      );
      return null;
    }
    return entry;
  }

  /* The helper's own numbers, read the same way the app reads them. */
  const ts = require(path.join(SPA_DIR, 'node_modules', 'typescript'));
  const helperSource = fs.readFileSync(
    path.join(SPA_DIR, 'src', 'helpers', 'movement-speed.helper.ts'), 'utf8',
  );
  const helperJs = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  const helper = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', helperJs)(helper);
  const expectedRatio = helper.JAIL_INMATE_WALK_SPEED;

  const visitor = await measure('visitor (normal)', 'vrml/jailvisit.wrl', 2.5);
  const staff = await measure('staff (normal)', 'vrml/jailstaff.wrl', 2.5);
  const inmate = await measure('inmate', 'vrml/jailinmate.wrl', 2.5);
  const inmateMaxDial = await measure('inmate (dial at max)', 'vrml/jailinmate.wrl', 6);

  let ratio = null;
  if (visitor && inmate) {
    ratio = inmate.unitsPerSecond / visitor.unitsPerSecond;
    process.stdout.write(
      `\nratio inmate/visitor = ${ratio.toFixed(3)}  (configured ${expectedRatio})\n`,
    );
    if (Math.abs(ratio - expectedRatio) > RATIO_TOLERANCE) {
      failures.push(
        `the measured ratio ${ratio.toFixed(3)} is not the configured `
        + `JAIL_INMATE_WALK_SPEED ${expectedRatio}`,
      );
    }
  }
  if (visitor && staff) {
    const staffRatio = staff.unitsPerSecond / visitor.unitsPerSecond;
    process.stdout.write(`ratio staff/visitor  = ${staffRatio.toFixed(3)}  (expected 1)\n`);
    if (Math.abs(staffRatio - 1) > RATIO_TOLERANCE * 2) {
      failures.push(`staff do not walk at the normal pace (ratio ${staffRatio.toFixed(3)})`);
    }
  }
  if (inmate && inmateMaxDial) {
    const dialRatio = inmateMaxDial.unitsPerSecond / inmate.unitsPerSecond;
    process.stdout.write(`ratio inmate@6/inmate = ${dialRatio.toFixed(3)}  (expected 1)\n`);
    if (Math.abs(dialRatio - 1) > RATIO_TOLERANCE * 2) {
      failures.push(
        `the citizen's own dial changed an inmate's pace (ratio ${dialRatio.toFixed(3)})`,
      );
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'jail-speed.json'),
    `${JSON.stringify({ expectedRatio, ratio, report, failures }, null, 2)}\n`,
  );

  await browser.close();
  server.close();

  if (failures.length) {
    process.stdout.write(`\nFAIL\n${failures.map(f => `  - ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('\nPASS - an inmate walks at the configured fraction of the Jail pace\n');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
