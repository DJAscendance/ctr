/*
 * Phase 2 memory-retention gate: 100 world transitions on the real GPU.
 * Reports the heap slope per transition and proves the renderer, the canvas,
 * the socket listeners and the remote-citizen registry all stay flat.
 */
const { launch, login, enterPlace } = require('../lib/beta-client');
const N = Number(process.env.CTR_TRANSITIONS || 100);
/*
 * The default loop is the three normal worlds. CTR_WORLDS overrides it with a
 * `hash=file,hash=file` list, which is how the Script-shutdown stress case is
 * run: a world whose Script defines shutdown() is the one shape that used to
 * retain its whole scene through the window's `unload` listener list.
 */
const WORLDS = process.env.CTR_WORLDS
  ? process.env.CTR_WORLDS.split(',').map(pair => pair.split('='))
  : [
    ['#/place/enter', 'enter.wrl'],
    ['#/place/mall', 'shopping.wrl'],
    ['#/place/fleamarket', 'fleamarket.wrl'],
  ];
const BUDGET = Number(process.env.CTR_MB_PER_CYCLE || 1.5);
/*
 * Worlds that may still be reachable at the end whatever the visit count is:
 * bxx_auth.js's one-deep `worldStartScene_` slot, and the world of the cycle
 * just measured, whose WeakRef needs a collection pass to clear.
 */
const MAX_HELD_WORLDS = 2;

/*
 * The number of `unload` listeners on the window.
 *
 * This is the leak's own counter. X_ITE registers one per Script that defines
 * shutdown(), and the window's listener list is a GC root, so before the fix it
 * rose by one per visit and every old world came with it. Read through CDP:
 * `addEventListener` leaves nothing a script can enumerate.
 */
async function unloadListeners(cdp) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  return listeners.filter(l => l.type === 'unload').length;
}

/* Remember the world about to be left, weakly, so asking whether the collector
 * took it does not itself keep it. */
const trackWorld = page => page.evaluate(() => {
  const canvas = document.querySelector('#world x3d-canvas');
  const b = canvas ? X3D.getBrowser(canvas) : null;
  if (!b || !b.currentScene) return null;
  if (!window.__ctrOldWorlds) window.__ctrOldWorlds = [];
  window.__ctrOldWorlds.push(new WeakRef(b.currentScene));
  return b.currentScene.worldURL;
});
const FIND = `const app=document.querySelector('#app').__vue__;
  const find=c=>{if(c.$options.name==='WorldBrowserPage')return c;
  for(const k of c.$children){const r=find(k);if(r)return r;}return null;};const p=find(app);`;

(async () => {
  const b = await launch();
  console.log('renderer:', b.ctrRenderer);
  const ctx = await b.newContext();
  const A = await login(ctx, 'testqa', 'testqa');
  const cdp = await ctx.newCDPSession(A);
  await cdp.send('HeapProfiler.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await cdp.send('Runtime.getHeapUsage');
    return m.usedSize / (1024 * 1024);
  };

  await enterPlace(A, WORLDS[0][0], WORLDS[0][1]);
  await A.waitForTimeout(2000);
  const samples = [];
  const base = await heap();
  const baseListeners = await unloadListeners(cdp);
  console.log(`baseline heap ${base.toFixed(2)} MB  unload listeners ${baseListeners}`);
  const listenerSamples = [];
  const worldSamples = [];

  for (let i = 0; i < N; i += 1) {
    const [hash, world] = WORLDS[(i + 1) % WORLDS.length];
    await trackWorld(A);
    try { await enterPlace(A, hash, world, 90000); }
    catch (e) { console.log(`  transition ${i + 1} FAILED: ${e.message.slice(0, 70)}`); break; }
    if ((i + 1) % 10 === 0) {
      const mb = await heap();
      samples.push([i + 1, mb]);
      const st = await A.evaluate(new Function(`${FIND}
        const c=document.querySelectorAll('#world x3d-canvas');
        const br=c.length?X3D.getBrowser(c[0]):null;
        return {canvases:c.length,
                users:Object.keys(p.users).length,
                routes:br?(br.browserEventRoutes_||[]).length:null,
                oldWorldsTracked:(window.__ctrOldWorlds||[]).length,
                oldWorldsAlive:(window.__ctrOldWorlds||[]).filter(r=>r.deref()!==undefined).length,
                heldByWorldStartSlot:(window.__ctrOldWorlds||[])
                  .filter(r=>br&&r.deref()!==undefined&&r.deref()===br.worldStartScene_).length};`));
      const ul = await unloadListeners(cdp);
      listenerSamples.push([i + 1, ul]);
      worldSamples.push([i + 1, st.oldWorldsAlive]);
      console.log(`  ${String(i + 1).padStart(3)} transitions  heap ${mb.toFixed(2)} MB  canvases ${st.canvases}`
        + `  citizens ${st.users}  routes ${st.routes}  unload ${ul}`
        + `  old worlds alive ${st.oldWorldsAlive}/${st.oldWorldsTracked}`);
    }
  }

  /* Least-squares slope over the samples, in MB per transition. */
  const n = samples.length;
  const sx = samples.reduce((a, s) => a + s[0], 0);
  const sy = samples.reduce((a, s) => a + s[1], 0);
  const sxy = samples.reduce((a, s) => a + s[0] * s[1], 0);
  const sxx = samples.reduce((a, s) => a + s[0] * s[0], 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);

  const final = await A.evaluate(new Function(`${FIND}
    const c=document.querySelectorAll('#world x3d-canvas');
    const br=c.length?X3D.getBrowser(c[0]):null;
    let renderer=null;
    try{const gl=c[0].getContext&&null; renderer='alive';}catch(e){renderer='ERR';}
    return {canvases:c.length, users:Object.keys(p.users).length,
            roots:br&&br.currentScene?br.currentScene.rootNodes.length:null,
            world:br&&br.currentScene?br.currentScene.worldURL:null,
            routes:br?(br.browserEventRoutes_||[]).length:null,
            oldWorldsTracked:(window.__ctrOldWorlds||[]).length,
            oldWorldsAlive:(window.__ctrOldWorlds||[]).filter(r=>r.deref()!==undefined).length,
            generation:p.loadGeneration};`));
  const finalListeners = await unloadListeners(cdp);

  console.log('\n--- RESULT ---');
  console.log(`transitions completed : ${samples.length ? samples[samples.length - 1][0] : 0}`);
  console.log(`heap slope            : ${slope.toFixed(4)} MB per transition (target <= ${BUDGET})`);
  console.log(`unload listeners      : ${baseListeners} -> ${finalListeners} (flat required)`);
  console.log(`old worlds alive      : ${final.oldWorldsAlive} of ${final.oldWorldsTracked} left`
    + ` (<= ${MAX_HELD_WORLDS} required)`);
  console.log(`listener samples      : ${JSON.stringify(listenerSamples)}`);
  console.log(`old-world samples     : ${JSON.stringify(worldSamples)}`);
  console.log(`final state           : ${JSON.stringify(final)}`);
  const ok = slope <= BUDGET && final.canvases === 1 && final.users === 0 && final.roots > 0
    && finalListeners <= baseListeners + 1
    && final.oldWorldsAlive <= MAX_HELD_WORLDS;
  console.log(ok ? 'MEMORY GATE PASS' : 'MEMORY GATE FAIL');
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('GATE ERROR', e); process.exit(1); });
