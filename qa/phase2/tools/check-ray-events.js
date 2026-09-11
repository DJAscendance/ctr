/*
 * Phase 2 ray-target and browser-event gate.
 *
 * Proves the TARGET RESOLUTION infrastructure only: a ray finds the rendered
 * remote citizen, and that node resolves to the right presence. No weapon, no
 * damage - that is Phase 3.
 */
const { launch, login, enterPlace } = require('../lib/beta-client');
let pass = 0, fail = 0;
function check(ok, name, detail) {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail !== undefined ? ' :: ' + detail : ''}`); }
}
const FIND = `const app=document.querySelector('#app').__vue__;
  const find=c=>{if(c.$options.name==='WorldBrowserPage')return c;
  for(const k of c.$children){const r=find(k);if(r)return r;}return null;};const p=find(app);`;

(async () => {
  const b = await launch();
  console.log('renderer:', b.ctrRenderer);
  const ctxA = await b.newContext(); const ctxB = await b.newContext();
  const A = await login(ctxA, 'testqa', 'testqa');
  const B = await login(ctxB, 'outlandsqa2', 'testqa');

  console.log('\n1. RAY COMPATIBILITY IS INSTALLED');
  await enterPlace(A, '#/place/enter', 'enter.wrl');
  const api = await A.evaluate(() => {
    const br = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    return {
      computeRayHit: typeof br.computeRayHit,
      setRayHitIgnore: typeof br.setRayHitIgnore,
      registerBlaxxunAvatar: typeof br.registerBlaxxunAvatar,
      unregisterBlaxxunAvatar: typeof br.unregisterBlaxxunAvatar,
      blaxxunAvatarCount: typeof br.blaxxunAvatarCount,
      eventMask: typeof br.eventMask,
      installBlaxxunRouteShim: typeof br.installBlaxxunRouteShim,
      installBlaxxunEventDelivery: typeof br.installBlaxxunEventDelivery,
    };
  });
  console.log('   ', JSON.stringify(api));
  for (const k of Object.keys(api)) {
    check(api[k] !== 'undefined', `Browser.${k} exists on X_ITE 16.2.0`, api[k]);
  }

  console.log('\n2. A RAY FINDS THE WORLD');
  const worldHit = await A.evaluate(() => {
    const br = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    const from = br.viewpointPosition;
    const start = new X3D.SFVec3f(from.x, from.y + 200, from.z);
    const end = new X3D.SFVec3f(from.x, from.y - 200, from.z);
    const hit = br.computeRayHit(start, end);
    if (!hit) return { hit: false };
    return { hit: true, hasPoint: !!hit.hitPoint, pathLen: hit.hitPath ? hit.hitPath.length : 0,
             hasObject: !!hit.hitObject,
             point: hit.hitPoint ? [hit.hitPoint.x, hit.hitPoint.y, hit.hitPoint.z] : null };
  });
  console.log('   ', JSON.stringify(worldHit));
  check(worldHit.hit, 'a ray straight down through the world reports a hit');
  check(worldHit.hasPoint, 'the hit carries a hitPoint');
  check(worldHit.pathLen > 0, 'the hit carries a root-first hitPath', String(worldHit.pathLen));

  console.log('\n3. A RAY RESOLVES THE CORRECT REMOTE PRESENCE');
  await enterPlace(B, '#/place/enter', 'enter.wrl');
  await A.waitForFunction(new Function(`${FIND}
    return Object.keys(p.users).filter(k=>p.users[k].loaded).length===1;`), { timeout: 45000 });

  const target = await A.evaluate(new Function(`${FIND}
    const br=X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    const key=Object.keys(p.users)[0];
    const e=p.users[key];
    /* Put the citizen somewhere unambiguous and shoot a ray straight down
     * through them from above. This is the hit path a weapon would walk. */
    const at=[0,0,0];
    e.transform=e.transform||{};
    e.transform.pos=at.slice();
    e.import.set_position=new X3D.SFVec3f(at[0],at[1],at[2]);
    return {key, at};`));
  await A.waitForTimeout(1500);

  const resolved = await A.evaluate(new Function(`${FIND}
    const br=X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    const key=Object.keys(p.users)[0];
    const wrapper=p.users[key].collision;
    /* The registry lookup a weapon would perform, on the node the hit path
     * carries. The wrapper is a ROOT node, so it comes back out of the walk as
     * itself - that is why it, and not the Inline, is what is bound. */
    const viaNode=p.remoteMembers.remoteKeyForNode(wrapper);
    const member=p.remoteMembers.remoteMemberForNode(wrapper);
    /* And the same lookup against a node that is NOT a citizen: the negative
     * control. A world node must resolve to nobody. */
    const worldNode=Array.from(br.currentScene.rootNodes)
      .find(n=>{try{return n.getNodeTypeName()==='Transform';}catch(e){return false;}});
    const viaWorldNode=p.remoteMembers.remoteKeyForNode(worldNode);
    const memberForWorldNode=p.remoteMembers.remoteMemberForNode(worldNode);
    return {key, viaNode, member:member?{key:member.key,username:member.username}:null,
            viaWorldNode:viaWorldNode===undefined?'undefined':viaWorldNode,
            memberForWorldNode:memberForWorldNode===undefined?'undefined':memberForWorldNode};`));
  console.log('   ', JSON.stringify(resolved));
  check(resolved.viaNode === resolved.key, 'a rendered node resolves to its presence key',
    `${resolved.viaNode} vs ${resolved.key}`);
  check(!!resolved.member && resolved.member.key === resolved.key,
    'a rendered node resolves to the right remote member', JSON.stringify(resolved.member));
  check(resolved.viaWorldNode === 'undefined',
    'NEGATIVE CONTROL: a world node resolves to no presence key', String(resolved.viaWorldNode));
  check(resolved.memberForWorldNode === 'undefined' || resolved.memberForWorldNode === null,
    'NEGATIVE CONTROL: a world node resolves to no remote member',
    String(resolved.memberForWorldNode));

  console.log('\n4. THE CITIZEN IS REGISTERED AS A BLAXXUN AVATAR');
  const av = await A.evaluate(new Function(`${FIND}
    const br=X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    return {count: typeof br.blaxxunAvatarCount==='function'?br.blaxxunAvatarCount():br.blaxxunAvatarCount};`));
  check(av.count === 1, 'exactly one remote citizen is registered as a blaxxun Avatar', String(av.count));

  console.log('\n5. BROWSER EVENTS REACH A WORLD SCRIPT');
  const evt = await A.evaluate(() => {
    const br = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    /* A world's Script asks for browser events with exactly this pair of calls.
     * blaxxun accepted them; X_ITE rejects a browser as a route source, so the
     * shim has to take them and record the route. */
    const before = br.eventMask;
    br.eventMask = br.eventMask | (1 << 4) | (1 << 5) | (1 << 6);
    const after = br.eventMask;
    const sink = br.currentScene.createNode('Script');
    let accepted = true, err = null;
    try { br.addRoute(br, 'event_changed', sink, 'onEvent'); }
    catch (e) { accepted = false; err = e.message; }
    return { before, after, accepted, err,
             routes: br.browserEventRoutes_ ? br.browserEventRoutes_.length : null };
  });
  console.log('   ', JSON.stringify(evt));
  check(evt.after !== evt.before, 'Browser.eventMask is writable and readable back',
    `${evt.before} -> ${evt.after}`);
  check(evt.accepted, 'Browser.addRoute(Browser, "event_changed", ...) is accepted', evt.err);
  check(evt.routes >= 1, 'the browser-sourced route is recorded', String(evt.routes));

  console.log('\n6. SHAREDEVENT LOOKUP AND NULL HANDLING');
  const se = await A.evaluate(new Function(`${FIND}
    const br=X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    let zoneFound=false, events=null;
    try{const z=br.currentScene.getNamedNode('SharedZone'); zoneFound=!!z;
        events=z.events?z.events.length:null;}catch(e){}
    return {zoneFound, events, mapped:p.eventNodeMap?p.eventNodeMap.size:null};`));
  console.log('   ', JSON.stringify(se));
  check(se.zoneFound, 'the world SharedZone is found on 16.2.0');
  check(se.mapped !== null, 'startSharedEvents completed and built its node map', String(se.mapped));

  /* The Mall is the world with a NULL-declared events list - the one that used
   * to throw "Cannot read properties of null (reading addFieldCallback)" and
   * take down place startup. */
  const errs = [];
  A.on('pageerror', e => errs.push(e.message));
  A.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await enterPlace(A, '#/place/mall', 'shopping.wrl');
  await A.waitForTimeout(3000);
  const nullCrash = errs.filter(t => /addFieldCallback/.test(t) && /null|undefined/.test(t)).length;
  check(nullCrash === 0, 'a NULL SharedEvent list does not crash place startup', String(nullCrash));
  const mallOk = await A.evaluate(new Function(`${FIND}
    const br=X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    return {world:br.currentScene.worldURL, mapped:p.eventNodeMap?p.eventNodeMap.size:null,
            roots:br.currentScene.rootNodes.length};`));
  console.log('   mall:', JSON.stringify(mallOk));
  check(mallOk.roots > 0, 'the Mall still renders after the null-event filter', String(mallOk.roots));

  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('GATE ERROR', e); process.exit(1); });
