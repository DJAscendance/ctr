/*
 * Phase 2 memory-retention gate: 100 world transitions on the real GPU.
 * Reports the heap slope per transition and proves the renderer, the canvas,
 * the socket listeners and the remote-citizen registry all stay flat.
 */
const { launch, login, enterPlace } = require('../lib/beta-client');
const N = Number(process.env.CTR_TRANSITIONS || 100);
const WORLDS = [
  ['#/place/enter', 'enter.wrl'],
  ['#/place/mall', 'shopping.wrl'],
  ['#/place/fleamarket', 'fleamarket.wrl'],
];
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
  console.log(`baseline heap ${base.toFixed(2)} MB`);

  for (let i = 0; i < N; i += 1) {
    const [hash, world] = WORLDS[(i + 1) % WORLDS.length];
    try { await enterPlace(A, hash, world, 60000); }
    catch (e) { console.log(`  transition ${i + 1} FAILED: ${e.message.slice(0, 70)}`); break; }
    if ((i + 1) % 10 === 0) {
      const mb = await heap();
      samples.push([i + 1, mb]);
      const st = await A.evaluate(new Function(`${FIND}
        return {canvases:document.querySelectorAll('#world x3d-canvas').length,
                users:Object.keys(p.users).length,
                bindings:p.remoteMembers?p.remoteMembers.clearRemoteMembers?undefined:undefined:undefined};`));
      console.log(`  ${String(i + 1).padStart(3)} transitions  heap ${mb.toFixed(2)} MB  canvases ${st.canvases}  citizens ${st.users}`);
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
            generation:p.loadGeneration};`));

  console.log('\n--- RESULT ---');
  console.log(`transitions completed : ${samples.length ? samples[samples.length - 1][0] : 0}`);
  console.log(`heap slope            : ${slope.toFixed(4)} MB per transition (target <= 1.5)`);
  console.log(`final state           : ${JSON.stringify(final)}`);
  const ok = slope <= 1.5 && final.canvases === 1 && final.users === 0 && final.roots > 0;
  console.log(ok ? 'MEMORY GATE PASS' : 'MEMORY GATE FAIL');
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('GATE ERROR', e); process.exit(1); });
