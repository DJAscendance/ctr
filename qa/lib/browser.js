'use strict';

/*
 * One place that decides how QA launches a browser.
 *
 * Every gate used to hard-code `--use-gl=swiftshader`, which is Chromium's
 * software rasteriser. On a host with a real GPU that throws the graphics card
 * away and renders X_ITE on the CPU: an hour of QA becomes several, and any
 * timing number it produces describes the CPU rather than the product.
 *
 * This host has an NVIDIA card and a real logged-in X session on DISPLAY=:1,
 * so the right answer is headless Chromium pointed at that display through
 * ANGLE's desktop-GL backend. Headless keeps the QA windows off the owner's
 * screen; ANGLE-over-GL is what actually reaches the driver. Those two flags
 * are the whole of it - `--enable-gpu` and `--ignore-gpu-blocklist` were tried
 * and make no difference here, so they are not carried.
 *
 * Nothing is assumed. `launch()` reads WEBGL_debug_renderer_info back out of a
 * live page, and refuses to hand over a browser that fell back to software.
 * A gate that cannot get the GPU stops rather than quietly burning an hour of
 * CPU and reporting numbers nobody can use.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/* The smallest flag set that reaches the NVIDIA driver from headless Chromium
 * on this host. Verified against six configurations; see the report. */
const GPU_ARGS = ['--use-gl=angle', '--use-angle=gl'];

/* What Chromium calls itself when it has given up on the GPU. */
const SOFTWARE = /SwiftShader|llvmpipe|Software Rasterizer|Mesa OffScreen|Disabled/i;

/* Set CTR_QA_ALLOW_SOFTWARE=1 to run somewhere that genuinely has no GPU. It
 * is not a way round a broken driver: the renderer still gets recorded. */
const ALLOW_SOFTWARE = process.env.CTR_QA_ALLOW_SOFTWARE === '1';

const ARTIFACT = process.env.CTR_QA_GPU_ARTIFACT
  || path.join(__dirname, '..', '..', '..', 'artifacts', 'qa-gpu', 'browser-gpu.txt');

/** Reads the real renderer out of a live page, not out of the launch flags. */
async function readRenderer(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const read = kind => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext(kind);
        if (!gl) return { vendor: null, renderer: null };
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
          renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        };
      };
      return { webgl: read('webgl'), webgl2: read('webgl2') };
    });
  } finally {
    await page.close();
  }
}

/**
 * Launches a browser for a QA gate and proves it is on the GPU.
 *
 * @param {object} [options] extra Playwright launch options, merged over the
 *   defaults. `args` is appended to the GPU flags rather than replacing them.
 * @returns {Promise<import('playwright').Browser>}
 * @throws when the renderer comes back as a software path.
 */
async function launch(options) {
  const opts = Object.assign({ headless: true }, options || {});
  opts.args = GPU_ARGS.concat(opts.args || []);
  const browser = await chromium.launch(opts);
  const gpu = await readRenderer(browser);
  const renderer = (gpu.webgl2 && gpu.webgl2.renderer) || (gpu.webgl && gpu.webgl.renderer) || '';
  const software = SOFTWARE.test(renderer) || !renderer;

  record({ gpu, renderer, software, args: opts.args, headless: opts.headless });

  if (software && !ALLOW_SOFTWARE) {
    await browser.close();
    throw new Error(
      `GPU_QA_BLOCKED: browser fell back to a software renderer (${renderer || 'none'}). `
      + `DISPLAY=${process.env.DISPLAY || '(unset)'} args=${opts.args.join(' ')}. `
      + 'Set CTR_QA_ALLOW_SOFTWARE=1 only on a host with no GPU.');
  }
  process.stdout.write(`      renderer: ${renderer}\n`);
  return browser;
}

/** Writes the renderer proof beside the other QA artifacts. */
function record(state) {
  try {
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    fs.writeFileSync(ARTIFACT, [
      `captured        ${new Date().toISOString()}`,
      `display         ${process.env.DISPLAY || '(unset)'}`,
      `chromium        ${chromium.executablePath()}`,
      `headless        ${state.headless}`,
      `launch flags    ${state.args.join(' ')}`,
      `webgl vendor    ${state.gpu.webgl && state.gpu.webgl.vendor}`,
      `webgl renderer  ${state.gpu.webgl && state.gpu.webgl.renderer}`,
      `webgl2 vendor   ${state.gpu.webgl2 && state.gpu.webgl2.vendor}`,
      `webgl2 renderer ${state.gpu.webgl2 && state.gpu.webgl2.renderer}`,
      `software        ${state.software ? 'YES' : 'NO'}`,
      '',
    ].join('\n'));
  } catch (e) { /* the artifact is evidence, not a dependency */ }
}

module.exports = { launch, GPU_ARGS, readRenderer };
