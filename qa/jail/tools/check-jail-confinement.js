/**
 * The Jail's cell boundary, measured by walking into it.
 *
 * Nothing here trusts a world file. Each Jail world is loaded under the pinned X_ITE
 * 16.2.0, the LIVE camera position is read out of an injected ProximitySensor, and the
 * viewer is then walked at the boundary with real mouse input for several seconds. Where
 * they end up is the answer.
 *
 * Two things this gate had to learn the hard way, both recorded so nobody repeats them:
 *
 *  * `browser.getActiveViewpoint()` and the Blaxxun `viewpointPosition` shim report the
 *    AUTHORED viewpoint, not where walking has taken the avatar, so neither can see a
 *    barrier work. A ProximitySensor big enough to hold the world emits `position_changed`
 *    on every move, and that IS the avatar's position.
 *  * Arrow keys do nothing: X_ITE's WALK viewer moves on a held mouse drag. The first
 *    version of this gate reported every world as "confined" purely because no input ever
 *    reached the browser and nobody moved at all, so `assertMoves` now proves the control
 *    works before any negative result is allowed to mean anything.
 *
 * The coordinates are historical, not invented. `DEF forcefield` in jail.wrl is a polygon
 * at z = 1.25 once its -90 degree X rotation is applied, and the worlds' own `DEF CheckMe`
 * scripts turned a visitor back inside z < 1.5 and a prisoner back outside z > 0.9.
 *
 * Run:  node qa/jail/tools/check-jail-confinement.js
 *       CTR_QA_ALLOW_SOFTWARE=1 ...   on a host with no GPU
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const SPA_DIR = path.resolve(__dirname, '../../../spa');
const ASSETS = path.join(SPA_DIR, 'assets');
const PORT = Number(process.env.CTR_JAIL_QA_PORT) || 8211;
const BASE = `http://127.0.0.1:${PORT}`;
const ALLOW_SOFTWARE = process.env.CTR_QA_ALLOW_SOFTWARE === '1';

/** The plane the force field stands on. */
const BOUNDARY_Z = 1.25;
/** Past this much on the far side counts as "through", not "pressed against". */
const MARGIN = 1.0;
/** Milliseconds of held movement. Long enough to cross the gallery at the world's speed. */
const WALK_MS = 10000;
/** The staff door's destination, from jailpris.wrl's own Viewpoint. */
const CELL_SPAWN = [0, 1.75, -24.65];

const WORLDS = [
  { name: 'visitor', file: 'jailvisit.wrl', startsInCells: false },
  { name: 'inmate', file: 'jailinmate.wrl', startsInCells: true },
  { name: 'staff', file: 'jailstaff.wrl', startsInCells: false },
];

const TYPES = {
  '.wrl': 'model/vrml', '.html': 'text/html', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.png': 'image/png',
  '.mp4': 'video/mp4', '.wav': 'audio/wav',
};

const PAGE = [
  '<!doctype html><html><head>',
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/x_ite@16.2.0/dist/x_ite.min.css">',
  '<script src="https://cdn.jsdelivr.net/npm/x_ite@16.2.0/dist/x_ite.min.js"></script>',
  '<style>html,body{margin:0;height:100%}#world{width:900px;height:640px}',
  'x3d-canvas{display:block;width:100%;height:100%}</style>',
  '</head><body><div id="world"></div></body></html>',
].join('');

function startAssetServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]).replace(/\/{2,}/g, '/');
      if (url === '/jail-qa.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(PAGE);
      }
      let file = null;
      if (url.startsWith('/assets/')) file = path.join(SPA_DIR, url);
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

/** Installs the live-position probe. See the header for why the SAI cannot answer this. */
async function installProbe(page) {
  await page.evaluate(() => {
    const browser = window.__ctrBrowser;
    const probe = browser.currentScene.createNode('ProximitySensor');
    probe.size = new X3D.SFVec3f(1e6, 1e6, 1e6);
    probe.center = new X3D.SFVec3f(0, 0, 0);
    window.__ctrCam = null;
    probe.getField('position_changed').addFieldCallback('ctr-jail-qa', (value) => {
      window.__ctrCam = [
        Number(value.x.toFixed(2)), Number(value.y.toFixed(2)), Number(value.z.toFixed(2)),
      ];
    });
    browser.currentScene.addRootNode(probe);
  });
}

/** Holds the mouse forward, which is how X_ITE's WALK viewer moves. */
async function walk(page, ms) {
  const box = await page.locator('#world x3d-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    await page.mouse.move(cx, cy - 60);
    await page.waitForTimeout(100);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
}

const read = (page) => page.evaluate(() => window.__ctrCam);

async function main() {
  // Playwright is installed once at the wrapper level and shared by every worktree.
  // eslint-disable-next-line global-require
  const { chromium } = require(require.resolve('playwright', {
    paths: [path.resolve(SPA_DIR, '../../..'), path.resolve(SPA_DIR, '..')],
  }));
  const server = await startAssetServer();
  const browser = await chromium.launch({
    args: ALLOW_SOFTWARE
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist']
      : ['--use-gl=angle', '--use-angle=gl'],
  });

  const failures = [];
  const report = [];

  for (const world of WORLDS) {
    const page = await browser.newPage();
    const notFound = [];
    page.on('response', r => {
      if (r.url().startsWith(BASE) && r.status() >= 400 && !notFound.includes(r.url())) {
        notFound.push(r.url().replace(BASE, ''));
      }
    });
    await page.goto(`${BASE}/jail-qa.html`);
    await page.waitForFunction(() => typeof window.X3D !== 'undefined', { timeout: 30000 });

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
    }, `${BASE}/assets/worlds/jail/vrml/${world.file}`);

    if (loadError) {
      failures.push(`${world.name}: world failed to load: ${loadError}`);
      await page.close();
      continue;
    }
    await installProbe(page);
    await page.waitForTimeout(3000);
    await walk(page, 300);

    const start = await read(page);
    await walk(page, WALK_MS);
    const end = await read(page);
    const entry = { world: world.name, start, end, notFound };
    report.push(entry);

    if (!start || !end) {
      failures.push(`${world.name}: could not read the live camera position`);
      await page.close();
      continue;
    }
    // A negative result only counts if the viewer could move at all.
    if (Math.abs(end[0] - start[0]) < 0.05 && Math.abs(end[2] - start[2]) < 0.05) {
      failures.push(`${world.name}: the viewer never moved - this gate proves nothing`);
      await page.close();
      continue;
    }
    // And only if they did not simply fall out of the world. jailpris.wrl's historical
    // NavigationInfo asks for Blaxxun's "WALK_RESTRICTED", which X_ITE does not know, and
    // an inmate loaded straight from it drops through the floor to y = -6. The wrappers
    // state a plain WALK NavigationInfo of their own, and this is what proves it.
    if (end[1] < 0) {
      failures.push(`${world.name}: the viewer fell through the floor (end y=${end[1]})`);
    }

    const startedInCells = start[2] < BOUNDARY_Z;
    if (startedInCells !== world.startsInCells) {
      failures.push(
        `${world.name}: spawned ${startedInCells ? 'inside' : 'outside'} the cells, `
        + `expected ${world.startsInCells ? 'inside' : 'outside'} (start z=${start[2]})`,
      );
    }
    const endedInCells = end[2] < BOUNDARY_Z;
    if (endedInCells !== startedInCells && Math.abs(end[2] - BOUNDARY_Z) > MARGIN) {
      failures.push(
        `${world.name}: WALKED THROUGH the cell boundary (start z=${start[2]} `
        + `end z=${end[2]})`,
      );
    }

    /*
     * The staff door, proved on the world staff are actually served.
     *
     * The force field is solid to everyone under X_ITE 16 -- staff included -- so there is
     * no walking in. The staff door binds a Viewpoint at the cell-block spawn instead, and
     * this checks that the destination is real: the viewer lands inside the cells and is
     * still standing on the floor when they get there.
     */
    if (world.name === 'staff') {
      await page.evaluate((spawn) => {
        const b = window.__ctrBrowser;
        const vp = b.currentScene.createNode('Viewpoint');
        b.currentScene.addRootNode(vp);
        vp.position = new X3D.SFVec3f(...spawn);
        vp.orientation = new X3D.SFRotation(0, 1, 0, Math.PI);
        vp.set_bind = true;
      }, CELL_SPAWN);
      await page.waitForTimeout(1500);
      await walk(page, 1200);
      const inside = await read(page);
      entry.afterStaffDoor = inside;
      if (!inside || inside[2] >= BOUNDARY_Z) {
        failures.push(
          `staff: the staff door did not reach the cells (z=${inside ? inside[2] : 'null'})`,
        );
      } else if (inside[1] < 0) {
        failures.push(`staff: the staff door dropped the guard through the floor`);
      }
    }
    await page.close();
  }

  await browser.close();
  server.close();

  console.log(JSON.stringify(report, null, 1));
  if (failures.length > 0) {
    console.error('\nFAIL');
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log('\nPASS - every Jail world holds its viewer on the side their standing allows');
}

main().catch(err => {
  console.error('gate could not run:', err && err.message ? err.message : err);
  process.exit(1);
});
