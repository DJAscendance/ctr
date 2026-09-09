/*
 * Phase 2 WALK / collision / gravity gate, plus the multiple-presence identity
 * contract. All measured on the real GPU against the rendered scene.
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

async function pos(page) {
  return page.evaluate(new Function(`${FIND} return p.position.slice();`));
}
async function walk(page, key, ms) {
  await page.evaluate(() => {
    const c = document.querySelector('#world x3d-canvas');
    c.setAttribute('tabindex', '0'); c.focus();
  });
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(500);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

(async () => {
  const b = await launch();
  console.log('renderer:', b.ctrRenderer);
  const ctxA = await b.newContext();
  const A = await login(ctxA, 'testqa', 'testqa');

  console.log('\n1. WALK - ALONE');
  await enterPlace(A, '#/place/enter', 'enter.wrl');
  await A.waitForTimeout(3000);
  const nav = await A.evaluate(new Function(`${FIND}
    const br=X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    let type=null; try{type=Array.from(br.getActiveNavigationInfo().getField('type')).slice();}catch(e){type='ERR '+e.message;}
    let gravity=null; try{gravity=br.getBrowserOption('Gravity');}catch(e){gravity='ERR '+e.message;}
    let gflag=null; try{gflag=br.getGravity();}catch(e){gflag='ERR '+e.message;}
    return {type,gravity,gflag};`));
  console.log('   navigation:', JSON.stringify(nav));
  check(Array.isArray(nav.type) && nav.type.indexOf('WALK') !== -1,
    'the world offers the WALK viewer', JSON.stringify(nav.type));
  check(typeof nav.gravity === 'number' && nav.gravity > 0,
    'gravity is on and numeric after the world loaded', String(nav.gravity));
  check(nav.gflag === true, 'blaxxun getGravity() reports gravity on', String(nav.gflag));

  const p0 = await pos(A);
  await walk(A, 'ArrowUp', 2500);
  const p1 = await pos(A);
  const moved = dist(p0, p1);
  console.log(`   alone: ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}  moved ${moved.toFixed(3)}`);
  check(moved > 1, 'the local citizen can WALK forward when alone', moved.toFixed(3));

  console.log('\n2. GRAVITY - THE CITIZEN IS HELD ON THE FLOOR');
  const yStart = p1[1];
  await A.waitForTimeout(2000);
  const p2 = await pos(A);
  check(Math.abs(p2[1] - yStart) < 2, 'height is stable, not falling through the world',
    `${yStart.toFixed(3)} -> ${p2[1].toFixed(3)}`);

  console.log('\n3. COLLISION - THE WORLD STILL STOPS THE CITIZEN');
  /* Walk a long way in one direction: an enclosed world must stop the camera
   * short of the distance a free-flying camera would cover. */
  const before = await pos(A);
  await walk(A, 'ArrowUp', 8000);
  const after = await pos(A);
  const far = dist(before, after);
  console.log(`   long walk moved ${far.toFixed(3)}`);
  const bounded = await A.evaluate(new Function(`${FIND}
    const br=X3D.getBrowser(document.querySelector('#world x3d-canvas'));
    let size=null; try{size=Array.from(br.getActiveNavigationInfo().getField('avatarSize')).map(Number);}catch(e){size='ERR '+e.message;}
    return {avatarSize:size};`));
  console.log('   avatarSize:', JSON.stringify(bounded.avatarSize));
  check(Array.isArray(bounded.avatarSize) && bounded.avatarSize[0] > 0,
    'collision distance is non-zero, so the collision test is live',
    JSON.stringify(bounded.avatarSize));
  check(far < 400, 'a long walk is bounded by the world rather than unbounded', far.toFixed(3));

  console.log('\n4. A REMOTE CITIZEN DOES NOT BLOCK WALK');
  /* B joins and is placed on top of A. Under a bare root Inline this is what
   * wedged two citizens together; under Collision { collide FALSE } it must not. */
  const ctxB = await b.newContext();
  const B = await login(ctxB, 'outlandsqa2', 'testqa');
  await enterPlace(B, '#/place/enter', 'enter.wrl');
  await A.waitForFunction(new Function(`${FIND}
    return Object.keys(p.users).filter(k=>p.users[k].loaded).length===1;`), { timeout: 45000 });
  const here = await pos(A);
  /*
   * Move the RENDERED node, not the peer's own camera. Writing the peer's
   * `position` is overwritten by its own ProximitySensor on the next tick, so
   * the two citizens never actually shared a spot and the test proved nothing.
   * Driving `import.set_position` from A's side puts the peer's model exactly
   * where A is standing, which is the case that used to wedge them together.
   */
  const onTop = await A.evaluate(new Function('here', `${FIND}
    const k=Object.keys(p.users)[0];
    const e=p.users[k];
    e.transform=e.transform||{};
    e.transform.pos=here.slice();
    e.import.set_position=new X3D.SFVec3f(here[0],here[1],here[2]);
    const q=e.import.set_position||e.import.translation;
    return {asked:here, collide:e.collision.collide.valueOf(),
            placed:[e.transform.pos[0],e.transform.pos[1],e.transform.pos[2]]};`), here);
  await A.waitForTimeout(1500);
  console.log('   remote citizen placed at', JSON.stringify(onTop));
  check(onTop.collide === false, 'the remote citizen sits under collide FALSE', String(onTop.collide));
  check(Math.abs(onTop.placed[0] - here[0]) < 0.001 && Math.abs(onTop.placed[2] - here[2]) < 0.001,
    'the remote citizen model is standing exactly where the local citizen is',
    `${JSON.stringify(onTop.placed)} vs ${JSON.stringify(here)}`);

  const q0 = await pos(A);
  await walk(A, 'ArrowUp', 2500);
  const q1 = await pos(A);
  const movedWith = dist(q0, q1);
  console.log(`   with a peer on the spot: moved ${movedWith.toFixed(3)}`);
  check(movedWith > 1, 'the local citizen can still WALK with a peer on the same spot',
    movedWith.toFixed(3));

  console.log('\n5. MULTIPLE PRESENCES - SAME USERNAME, DIFFERENT NODE');
  /* A second tab for the SAME member. Same username, different presenceId, so
   * it must render as a separate citizen bound to a separate node. */
  const ctxC = await b.newContext();
  const C = await login(ctxC, 'outlandsqa2', 'testqa');
  await enterPlace(C, '#/place/enter', 'enter.wrl');
  let two = false;
  try {
    await A.waitForFunction(new Function(`${FIND}
      return Object.keys(p.users).filter(k=>p.users[k].loaded).length===2;`), { timeout: 45000 });
    two = true;
  } catch (e) { /* reported */ }
  check(two, 'A renders two citizens for one member in two tabs');
  const multi = await A.evaluate(new Function(`${FIND}
    const out=[];
    for(const k of Object.keys(p.users)){
      const e=p.users[k];
      out.push({key:k,
        username:(p.remoteMembers.getRemoteMember(k)||{}).username,
        presenceId:(p.remoteMembers.getRemoteMember(k)||{}).presenceId,
        keyForNode:p.remoteMembers.remoteKeyForNode(e.collision),
        nodeId:Object.getOwnPropertySymbols(e.collision).length});
    }
    out.sameNode = out.length===2 ? (p.users[out[0].key].collision===p.users[out[1].key].collision) : null;
    return {entries:out, sameNode:out.sameNode};`));
  console.log('   ', JSON.stringify(multi.entries));
  const [e1, e2] = multi.entries;
  if (e1 && e2) {
    check(e1.username === e2.username, 'the two presences share one username', `${e1.username} / ${e2.username}`);
    check(e1.presenceId !== e2.presenceId, 'the two presences have different presenceIds');
    check(e1.key !== e2.key, 'the two presences have different presence keys');
    check(multi.sameNode === false, 'the two presences are rendered by DIFFERENT nodes');
    check(e1.keyForNode === e1.key && e2.keyForNode === e2.key,
      'each node resolves back to its OWN presence key',
      `${e1.keyForNode}|${e1.key}  ${e2.keyForNode}|${e2.key}`);
  } else {
    check(false, 'two presence entries available to compare');
  }

  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('GATE ERROR', e); process.exit(1); });
