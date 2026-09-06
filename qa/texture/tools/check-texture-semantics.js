'use strict';

/*
 * VRML97 colour-texture semantics, proved at runtime.
 *
 * This guards spa/src/libs/x_ite_mods/vrml_texture_color.js. That patch makes a
 * colour texture replace Material.diffuseColor on VRML97 content, which is the
 * VRML97 rule, while leaving X3D content on X_ITE's own multiply rule.
 *
 * Screenshots cannot carry that argument on their own, so this reads the colour
 * back out of each canvas and asserts relations between the cases rather than
 * absolute values - the relations hold on any GPU, the absolutes do not.
 *
 * The cases are deliberately paired against each other:
 *
 *   a == b   a colour texture under a red diffuseColor renders like the same
 *            texture under white: the diffuse tint is gone.       (the fix)
 *   c        untextured red stays red.               (diffuseColor still works)
 *   d != b   the same content in X3D XML keeps the multiply.    (modern safety)
 *   e != b   a one-component intensity texture keeps the multiply.
 *   f == b/2 transparency 0.5 still halves what is drawn.
 *   g        red channel matches b, blue channel exceeds it: the substitution
 *            touched diffuse only, not specular or emissive.
 *
 * Run it against the shipped engine and against the patch set the SPA loads:
 *
 *   NODE_PATH=<dir containing playwright> node qa/texture/tools/check-texture-semantics.js
 *
 * `--no-patch` loads the bare engine instead, which is how the defect itself is
 * reproduced; the same assertions then fail, which is the point.
 *
 * Exits non-zero on any failed assertion.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');

const REPO = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(REPO, 'qa', 'texture', 'fixtures');

/* The patches the SPA loads, in App.vue order, up to and including ours. */
const PATCHES = ['x_ite_compat.js', 'vrml_texture_color.js'];

const SCENES = [
  'a_vrml97_color_texture_tinted.wrl',
  'b_vrml97_color_texture_white.wrl',
  'c_vrml97_untextured.wrl',
  'd_x3d_color_texture_tinted.x3d',
  'e_vrml97_intensity_texture_tinted.wrl',
  'f_vrml97_color_texture_transparent.wrl',
  'g_vrml97_color_texture_specular.wrl',
];

/* Channel tolerance, 0-255. Wide enough for driver rounding, far below any of
 * the differences under test - the smallest one here is about 90 levels. */
const TOLERANCE = 6;

/**
 * The engine URL the SPA actually ships, read out of its index.html so this
 * check cannot silently test a different X_ITE than the app runs.
 */
function engineUrl () {
  const html = fs.readFileSync(path.join(REPO, 'spa', 'public', 'index.html'), 'utf8');
  const match = /src="(https:\/\/[^"]*x_ite[^"]*\.js)"/.exec(html);

  if (!match) throw new Error('no X_ITE script tag found in spa/public/index.html');

  return match[1];
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wrl': 'model/vrml',
  '.x3d': 'model/x3d+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

/**
 * Static server for the fixtures, the patch sources and the real world assets.
 * The scenes point at a genuine repository texture, so the thing under test is
 * the content we ship, not a stand-in.
 */
function serve () {
  const roots = [
    ['/scenes/', path.join(FIXTURES, 'scenes')],
    ['/patches/', path.join(REPO, 'spa', 'src', 'libs', 'x_ite_mods')],
    ['/assets/', path.join(REPO, 'spa', 'assets')],
  ];

  const server = http.createServer((request, response) => {
    const url = decodeURI(request.url.split('?')[0]);
    let file = url === '/' ? path.join(FIXTURES, 'harness.html') : null;

    for (const [prefix, root] of roots) {
      if (!file && url.startsWith(prefix)) {
        const candidate = path.join(root, url.slice(prefix.length));
        /* Refuse anything that climbs out of its root. */
        if (candidate.startsWith(root + path.sep)) file = candidate;
      }
    }

    if (!file || !fs.existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * Mean RGB of the middle of each canvas, where the test shape fills the view.
 *
 * The colour is taken from a screenshot rather than from the live canvas: the
 * WebGL drawing buffer is gone by the time script can read it, but the page
 * compositor still holds the frame. The screenshot PNG is then decoded by the
 * browser itself, which keeps this tool dependency-free on the pinned Node.
 */
async function readColors (page, measurer, ids) {
  const colors = [];

  for (const id of ids) {
    const png = await page.locator('#scene-' + id).screenshot();

    const rgb = await measurer.evaluate(async (dataUrl) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();

      const size = 64;
      const scratch = document.createElement('canvas');

      scratch.width = size;
      scratch.height = size;

      const context = scratch.getContext('2d');
      /* Take the middle 30% of the canvas: all shape, no background. */
      const inset = Math.round(image.width * 0.35);

      context.drawImage(image,
        inset, inset, image.width - inset * 2, image.height - inset * 2,
        0, 0, size, size);

      const data = context.getImageData(0, 0, size, size).data;
      const sum = [0, 0, 0];

      for (let i = 0; i < data.length; i += 4) {
        sum[0] += data[i];
        sum[1] += data[i + 1];
        sum[2] += data[i + 2];
      }

      const pixels = data.length / 4;
      return sum.map((value) => value / pixels);
    }, 'data:image/png;base64,' + png.toString('base64'));

    colors.push({ id, rgb });
  }

  return colors;
}

function near (a, b) {
  return Math.abs(a - b) <= TOLERANCE;
}

function sameColor (a, b) {
  return near(a.rgb[0], b.rgb[0]) && near(a.rgb[1], b.rgb[1]) && near(a.rgb[2], b.rgb[2]);
}

function show (color) {
  return `[${color.rgb.map((value) => value.toFixed(1)).join(', ')}]`;
}

function assertions (by) {
  const { a, b, c, d, e, f, g } = by;

  return [
    {
      name: 'VRML97 colour texture replaces diffuseColor',
      pass: sameColor(a, b),
      detail: `tinted ${show(a)} vs white ${show(b)}`,
    },
    {
      name: 'VRML97 colour texture is not rendered flat red',
      pass: b.rgb[1] > 30 && a.rgb[1] > 30,
      detail: `tinted ${show(a)}`,
    },
    {
      name: 'VRML97 untextured material keeps diffuseColor',
      pass: c.rgb[0] > 200 && c.rgb[1] < TOLERANCE && c.rgb[2] < TOLERANCE,
      detail: `untextured ${show(c)}`,
    },
    {
      name: 'modern X3D colour texture keeps modern multiply semantics',
      pass: !sameColor(d, b) && d.rgb[1] < TOLERANCE && d.rgb[2] < TOLERANCE,
      detail: `x3d ${show(d)} vs white-diffuse vrml ${show(b)}`,
    },
    {
      name: 'VRML97 intensity texture still modulates diffuseColor',
      pass: e.rgb[0] > 30 && e.rgb[1] < TOLERANCE && e.rgb[2] < TOLERANCE,
      detail: `intensity ${show(e)}`,
    },
    {
      name: 'transparency survives the diffuse substitution',
      pass: [0, 1, 2].every((i) => near(f.rgb[i], b.rgb[i] / 2)),
      detail: `transparent ${show(f)} vs half of ${show(b)}`,
    },
    {
      name: 'specular and emissive survive the diffuse substitution',
      pass: near(g.rgb[0], b.rgb[0]) && g.rgb[2] > b.rgb[2] + TOLERANCE,
      detail: `specular ${show(g)} vs plain ${show(b)}`,
    },
  ];
}

(async () => {
  const patched = !process.argv.includes('--no-patch');
  const { server, port } = await serve();

  const url = `http://127.0.0.1:${port}/?engine=${encodeURIComponent(engineUrl())}` +
    `&scenes=${SCENES.join(',')}` +
    (patched ? `&patches=${PATCHES.join(',')}` : '');

  const browser = await launchBrowser();

  let failed = 0;

  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 300 } });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(
      (count) => window.CTR_LOADED >= count || window.CTR_FAILED.length,
      SCENES.length,
      { timeout: 90000 },
    );

    const broken = await page.evaluate(() => window.CTR_FAILED);
    if (broken.length) throw new Error(`fixtures failed to load: ${broken.join(', ')}`);

    /* One extra frame after load, so the texture upload has reached the GPU. */
    await page.waitForTimeout(2000);

    const measurer = await browser.newPage();
    const ids = SCENES.map((name) => name.split('_')[0]);
    const colors = await readColors(page, measurer, ids);
    const by = Object.fromEntries(colors.map((color) => [color.id, color]));

    console.log(`engine ${engineUrl()}`);
    console.log(`patches ${patched ? PATCHES.join(', ') : '(none - bare engine)'}\n`);
    colors.forEach((color) => console.log(`  ${color.id}  ${show(color)}`));
    console.log('');

    assertions(by).forEach((check) => {
      if (!check.pass) failed += 1;
      console.log(`${check.pass ? '  ok  ' : 'FAIL  '}${check.name}`);
      console.log(`      ${check.detail}`);
    });
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${7 - failed}/7 assertions`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
