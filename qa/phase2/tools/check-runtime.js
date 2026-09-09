const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=gl'] });
  const p = await b.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://127.0.0.1:8128/', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForFunction(() => typeof window.X3D !== 'undefined', { timeout: 30000 });
  const out = await p.evaluate(() => ({
    BROWSER_VERSION: X3D.BROWSER_VERSION,
    hasConcreteNodes: typeof X3D.ConcreteNodes,
    hudRegistered: !!(X3D.ConcreteNodes && X3D.ConcreteNodes.get && X3D.ConcreteNodes.get('HUD')),
    hudConstant: X3D.X3DConstants ? X3D.X3DConstants.HUD : undefined,
    bxxSeam: !!(X3D.bxx && typeof X3D.bxx.setIdentityProvider === 'function'),
    computeRayHit: typeof (X3D.X3DBrowser && X3D.X3DBrowser.prototype.computeRayHit),
    registerAvatar: typeof (X3D.X3DBrowser && X3D.X3DBrowser.prototype.registerBlaxxunAvatar),
    routeShim: typeof (X3D.X3DBrowser && X3D.X3DBrowser.prototype.installBlaxxunRouteShim),
    eventDelivery: typeof (X3D.X3DBrowser && X3D.X3DBrowser.prototype.installBlaxxunEventDelivery),
    getName: typeof (X3D.SFNode && X3D.SFNode.prototype.getName),
    scriptPatched: !!(X3D.ConcreteNodes),
  }));
  // GPU proof
  const gpu = await p.evaluate(() => {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { renderer: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a',
             vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'n/a',
             version: gl.getParameter(gl.VERSION) };
  });
  console.log(JSON.stringify({ runtime: out, gpu }, null, 1));
  console.log('--- console errors/warnings (' + errs.length + ') ---');
  errs.slice(0, 25).forEach(e => console.log(e));
  await b.close();
})();
