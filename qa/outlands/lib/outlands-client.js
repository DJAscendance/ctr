'use strict';

/*
 * The Outlands half of the Beta QA client.
 *
 * Everything here either DRIVES the page the way a citizen does - click the
 * entrance, press a key - or READS the world's own Script fields back. Nothing
 * writes a gameplay field, and nothing fakes a hit: the gates that use this
 * library press D and then ask ne_game.wrl what happened.
 *
 * The one QA-only liberty is standing a citizen somewhere, and it is taken the
 * way the world takes it: by binding a Viewpoint. set_viewpoint() moves a
 * player by binding battle_view, so a gate that binds its own Viewpoint is
 * using the supported mechanism rather than poking the camera behind the
 * world's back.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CANVAS = '#world x3d-canvas';

/* The four public entrance choices and the avatar rows behind them. The row
 * ids are the ones 14-avatars.outlands.seed.ts writes. */
const SIDES = {
  redm: { avatarId: 16, team: 1, label: 'Join the Red Team', nth: 0 },
  redf: { avatarId: 15, team: 1, label: 'Join the Red Team', nth: 1 },
  bluem: { avatarId: 14, team: 2, label: 'Join the Blue Team', nth: 0 },
  bluef: { avatarId: 13, team: 2, label: 'Join the Blue Team', nth: 1 },
};

/*
 * The spawns are read out of the world file rather than copied, so a gate can
 * never drift into being a restatement of the content it checks.
 */
function spawnPoints(repoRoot) {
  const world = path.join(repoRoot, 'spa', 'assets', 'worlds', 'ne_game', 'vrml', 'ne_game.wrl');
  const raw = fs.readFileSync(world);
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString('latin1');
  const read = name => {
    const m = text.match(new RegExp(`field\\s+MFVec3f\\s+${name}\\s*\\[([^\\]]*)\\]`));
    return m ? m[1].trim().split(',').map(t => t.trim().split(/\s+/).map(Number)) : null;
  };
  return { 1: read('red_view_pos'), 2: read('blue_view_pos') };
}

/*
 * Take a citizen out of any Outlands uniform, so the entrance has to be shown.
 * Uses the same endpoint the entrance uses, and clears the note the entrance
 * would otherwise have left from an earlier run.
 */
async function wearOrdinaryAvatar(page, avatarId = 1) {
  /* The store's user arrives over HTTP after login, so wait for it rather than
   * racing it: a page that is still booting has no `user.avatar` to write to. */
  await page.waitForFunction(() => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue__;
    return !!(app && app.$store.data.isUser && app.$store.data.user.avatar);
  }, undefined, { timeout: 60000 });
  await page.evaluate(async id => {
    const app = document.querySelector('#app').__vue__;
    const res = await app.$http.post('/member/update_avatar', { avatarId: id });
    app.$store.methods.setToken(res.data.token);
    const list = await app.$http.get('/avatar');
    const row = (list.data.avatars || []).find(a => a.id === id);
    if (row) Object.assign(app.$store.data.user.avatar, row);
    localStorage.removeItem('outlandsPreviousSelf');
  }, avatarId);
}

/** The avatar row the SPA believes the citizen is wearing, and their view. */
const wornAvatar = page => page.evaluate(() => {
  const app = document.querySelector('#app').__vue__;
  const a = app.$store.data.user && app.$store.data.user.avatar;
  return {
    id: a && Number(a.id),
    filename: a && a.filename,
    directory: a && a.directory,
    view3d: !!app.$store.data.view3d,
    place: app.$store.data.place && app.$store.data.place.slug,
    /*
     * The entrance's note. Wearing a side no longer writes the citizen's
     * permanent avatar -- `POST /avatar/outlands` only issues a token -- so
     * the note now carries their own token AND their own avatar row, and the
     * restore is a local swap. The gate still only cares which avatar is
     * coming back, so the id is what is reported.
     */
    note: (() => {
      const raw = localStorage.getItem('outlandsPreviousSelf');
      if (!raw) return null;
      try {
        return String(JSON.parse(raw).avatar.id);
      } catch (e) {
        return null;
      }
    })(),
  };
});

/** What the historical entrance screen is offering right now. */
function entranceState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.outlands-entrance');
    const buttons = Array.from(document.querySelectorAll('.oe-avatar'));
    /*
     * The 2D pane is a v-show, so the entrance component stays MOUNTED behind
     * the running world once a side has been chosen - the same thing every
     * other place's 2D screen does. "Shown" therefore has to mean visible, not
     * merely present, or the gate reads a hidden screen as the live one.
     */
    const visible = !!root && !!root.offsetParent;
    return {
      shown: visible,
      mounted: !!root,
      choices: buttons.map(b => ({ label: b.getAttribute('aria-label'), enabled: !b.disabled })),
      passwordBox: !!document.querySelector('#outlands-pass'),
      /* Outlands never had a 2D room, so neither the 2D/3D selector nor the
       * place chat panel belongs in front of the entrance. */
      selector2d3d: !!document.querySelector('img[src*="b2dchat.gif"]'),
      chatPanel: !!document.querySelector('.bg-chat'),
      /* The citizen must not be trapped: the control panel's jump gate is the
       * way back out of the entrance. */
      wayOut: !!document.querySelector('select option[value="enter"]'),
      /*
       * The canvas element is a singleton the page keeps for its whole life, so
       * its presence says nothing. What matters is that the Outlands world has
       * NOT been fetched yet, and that the 3D pane is not the one on screen.
       */
      outlandsWorldLoaded: (() => {
        const c = document.querySelector('#world x3d-canvas');
        if (!c) return false;
        try {
          const b = X3D.getBrowser(c);
          const url = b && b.currentScene && b.currentScene.worldURL;
          return !!url && url.indexOf('ne_game.wrl') !== -1;
        } catch (e) { return false; }
      })(),
      worldPaneShown: (() => {
        const world = document.querySelector('#world');
        return !!world && !!world.offsetParent;
      })(),
    };
  });
}

/**
 * Go to Outlands through the historical entrance and pick a side.
 *
 * This is the real citizen path: navigate, read the entrance, click one of the
 * four avatars, and wait for the world the choice unlocks. The avatar row is
 * never written directly - the entrance's own POST does it.
 */
async function enterOutlandsThroughEntrance(page, side, timeout = 120000) {
  const spec = SIDES[side];
  if (!spec) throw new Error(`unknown side ${side}`);
  await page.evaluate(() => { window.location.hash = '#/place/outlands'; });
  await page.waitForSelector('.oe-avatar:not([disabled])', { timeout: 60000 });
  const before = await entranceState(page);
  /*
   * A locator, not an element handle. The avatar library arrives over HTTP and
   * re-renders the picker, so a handle taken a moment earlier can be detached
   * by the time it is clicked - which is a flaky gate, not a product fault.
   */
  await page.locator(`.oe-avatar[aria-label="${spec.label}"]`).nth(spec.nth)
    .click({ timeout: 30000 });
  await page.waitForFunction(() => {
    const c = document.querySelector('#world x3d-canvas');
    if (!c) return false;
    try {
      const b = X3D.getBrowser(c);
      const url = b && b.currentScene && b.currentScene.worldURL;
      return !!url && url.indexOf('ne_game.wrl') !== -1
        && !!b.currentScene.rootNodes && !!b.currentScene.rootNodes.length;
    } catch (e) { return false; }
  }, undefined, { timeout });
  /* The world's own teamTimer is three seconds, and set_team runs on its
   * trailing edge, so nothing may be asserted about a team before then. */
  await page.waitForFunction(() => {
    try {
      const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
      const battle = b.currentScene.getNamedNode('battle');
      const v = battle.getField('team');
      return Number(v.getValue ? v.getValue() : v) > 0;
    } catch (e) { return false; }
  }, undefined, { timeout: 30000 });
  return before;
}

/**
 * Wait until the world's own set_team has put the citizen on a side.
 *
 * teamTimer is a three-second TimeSensor and set_team runs on its trailing
 * edge, so nothing may be asserted about a team, a spawn or a weapon before
 * this resolves.
 */
function waitForBattleTeam(page, timeout = 30000) {
  return page.waitForFunction(() => {
    try {
      const b = X3D.getBrowser(document.querySelector('#world x3d-canvas'));
      const v = b.currentScene.getNamedNode('battle').getField('team');
      return Number(v.getValue ? v.getValue() : v) > 0;
    } catch (e) { return false; }
  }, undefined, { timeout });
}

/** Everything the world's own `battle` Script currently believes. */
function state(page) {
  return page.evaluate(sel => {
    const b = X3D.getBrowser(document.querySelector(sel));
    const battle = b.currentScene.getNamedNode('battle');
    const f = n => { const v = battle.getField(n); return v.getValue ? v.getValue() : v; };
    const p = b.viewpointPosition;
    let message = null;
    try {
      message = Array.from(b.currentScene.getNamedNode('message').getField('string')).map(String);
    } catch (e) { /* none */ }
    let weapon = null;
    try {
      weapon = Array.from(b.currentScene.getNamedNode('weapon').getField('url')).map(String);
    } catch (e) { /* none */ }
    return {
      team: Number(f('team')),
      type: String(f('type')),
      ammo: { beamer: Number(f('b_ammo')), repulsor: Number(f('r_ammo')), aapd: Number(f('a_ammo')) },
      isBeamed: String(f('isBeamed')) === 'true',
      fireDisable: String(f('fire_disable')) === 'true',
      message,
      weapon,
      camera: [p.x, p.y, p.z],
      gravity: b.getGravity(),
      eventMask: b.eventMask,
      browserEventRoutes: (b.browserEventRoutes_ || []).length,
      knownAvatars: typeof b.blaxxunAvatarCount === 'function' ? b.blaxxunAvatarCount() : null,
      /* Beta's gameplay identity: this is what the world compares a Beamer
       * message against, and it must be this presence's own key. */
      myAvatarName: b.myAvatarName,
      myAvatarURL: b.myAvatarURL,
    };
  }, CANVAS);
}

/** This page's own presence key, and every remote citizen it can target. */
function presenceView(page) {
  return page.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    const find = c => { if (c.remoteMembers !== undefined) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
    const view = find(app);
    if (!view) return null;
    const registry = view.remoteMembers;
    return {
      self: `${app.$store.data.user.id}:${view.$socket.presenceId}`,
      room: app.$store.data.place && app.$store.data.place.id,
      remote: registry ? registry.listRemoteMembers().map(m => ({
        key: m.key, username: m.username, hasNode: !!registry.getRemoteNode(m.key),
        placed: Array.isArray(m.pos),
      })) : [],
      rendered: Object.keys(view.users),
      canvases: document.querySelectorAll('#world x3d-canvas').length,
    };
  });
}

/** Bind a Viewpoint of the gate's own - the way the world moves a player. */
const stand = (page, pos, rot) => page.evaluate(([sel, p, r]) => {
  const b = X3D.getBrowser(document.querySelector(sel));
  const vp = b.currentScene.createNode('Viewpoint');
  vp.position = new X3D.SFVec3f(p[0], p[1], p[2]);
  vp.orientation = new X3D.SFRotation(r[0], r[1], r[2], r[3]);
  vp.jump = true;
  b.currentScene.addRootNode(vp);
  vp.set_bind = true;
}, [CANVAS, pos, rot]);

const camera = page => page.evaluate(sel => {
  const p = X3D.getBrowser(document.querySelector(sel)).viewpointPosition;
  return [p.x, p.y, p.z];
}, CANVAS);

/** Where the world has decided the citizen should stand: battle_view. */
const worldSpawn = page => page.evaluate(sel => {
  const v = X3D.getBrowser(document.querySelector(sel)).currentScene
    .getNamedNode('battle_view').position;
  return [v.x, v.y, v.z];
}, CANVAS);

/** Turn the shooter to face a point. Sets up a shot; never takes one. */
const aimAt = (page, target, dropY) => page.evaluate(([sel, t, drop]) => {
  const b = X3D.getBrowser(document.querySelector(sel));
  const s = b.viewpointPosition;
  const d = [t[0] - s.x, (t[1] - drop) - s.y, t[2] - s.z];
  const yaw = Math.atan2(-d[0], -d[2]);
  const pitch = Math.atan2(d[1], Math.sqrt(d[0] * d[0] + d[2] * d[2]));
  const rot = new X3D.SFRotation(0, 1, 0, yaw).multiply(new X3D.SFRotation(1, 0, 0, pitch));
  const vp = b.currentScene.createNode('Viewpoint');
  vp.position = new X3D.SFVec3f(s.x, s.y, s.z);
  vp.orientation = rot;
  vp.jump = true;
  b.currentScene.addRootNode(vp);
  vp.set_bind = true;
}, [CANVAS, target, dropY || 0]);

/* The exact ray fire() casts. Used only to VERIFY an aim before D is pressed. */
const fireRay = page => page.evaluate(sel => {
  const b = X3D.getBrowser(document.querySelector(sel));
  const s = b.viewpointPosition;
  const end = s.add(b.viewpointOrientation.multVec(new X3D.SFVec3f(0, 0, -1000)));
  const hit = b.computeRayHit(s, end);
  if (!hit) return null;
  return {
    types: hit.hitPath.map(n => { const t = n.getType(); return typeof t === 'string' ? t : n.getNodeTypeName(); }),
    nicknames: hit.hitPath.map(n => n.nickname).filter(Boolean),
    point: [hit.hitPoint.x, hit.hitPoint.y, hit.hitPoint.z].map(v => Number(v.toFixed(2))),
  };
}, CANVAS);

/* Press a gameplay key at the 3D screen. Focus rather than a click: a click is
 * a zero-length drag as far as the navigator is concerned, and over a dozen
 * presses it walks the shooter's aim off the target. */
const press = async (page, key, settle = 1200) => {
  await page.evaluate(sel => {
    const c = document.querySelector(sel);
    if (c && c.focus) c.focus({ preventScroll: true });
  }, CANVAS);
  await page.waitForTimeout(300);
  await page.keyboard.press(key);
  await page.waitForTimeout(settle);
};

/** Cycle W until the wanted weapon is held. The world is what knows. */
async function selectWeapon(page, want) {
  for (let i = 0; i < 4; i += 1) {
    if ((await state(page)).type === want) return true;
    await press(page, 'w');
  }
  return (await state(page)).type === want;
}

/* Tap the room message channel, so a failure can say whether a message left
 * the shooter, arrived at the target, or was refused by the target's Script. */
const tapMessages = page => page.evaluate(() => {
  window.__ctrSharedEvents = { sent: [], received: [] };
  const app = document.querySelector('#app').__vue__;
  const find = c => { if (c.remoteMembers !== undefined) return c; for (const k of c.$children) { const r = find(k); if (r) return r; } return null; };
  const socket = find(app).$socket;
  const emit = socket.emit.bind(socket);
  socket.emit = function (name, payload) {
    if (name === 'SE') window.__ctrSharedEvents.sent.push(payload);
    return emit(name, payload);
  };
  socket.on('SE', e => window.__ctrSharedEvents.received.push(e));
});

const messages = page => page.evaluate(() => window.__ctrSharedEvents || { sent: [], received: [] });

/** The state the Repulsor's push writes on the client it lands on. */
const pushState = page => page.evaluate(sel => {
  const b = X3D.getBrowser(document.querySelector(sel));
  const scene = b.currentScene;
  const keys = Array.from(scene.getNamedNode('rep_interp').getField('keyValue'))
    .map(v => [v.x, v.y, v.z]);
  const view = scene.getNamedNode('battle_view');
  const vp = b.viewpointPosition;
  return {
    startTime: Number(scene.getNamedNode('rep_clock').startTime),
    keyValue: keys,
    battleView: [view.position.x, view.position.y, view.position.z],
    camera: [vp.x, vp.y, vp.z].map(v => Number(v.toFixed(3))),
  };
}, CANVAS);

/** The state the AAPD's cloud writes on the client it reaches. */
const cloudState = page => page.evaluate(sel => {
  const scene = X3D.getBrowser(document.querySelector(sel)).currentScene;
  const t = scene.getNamedNode('aapd_trans').translation;
  return { startTime: Number(scene.getNamedNode('aapd_clock').startTime), at: [t.x, t.y, t.z] };
}, CANVAS);

/* The world gives a beamed-out citizen three twelve-second tries at a score
 * confirmation before it respawns them anyway. Nothing here shortens that. */
const RESPAWN_LIMIT_MS = 50000;

async function waitForRespawn(page) {
  const started = Date.now();
  while (Date.now() - started < RESPAWN_LIMIT_MS) {
    await page.waitForTimeout(2000);
    const s = await state(page);
    if (!s.isBeamed) return { respawned: true, waitedMs: Date.now() - started, state: s };
  }
  return { respawned: false, waitedMs: Date.now() - started, state: await state(page) };
}

module.exports = {
  CANVAS, SIDES, RESPAWN_LIMIT_MS,
  spawnPoints, wearOrdinaryAvatar, wornAvatar, entranceState, enterOutlandsThroughEntrance,
  waitForBattleTeam, state, presenceView, stand, camera, worldSpawn, aimAt, fireRay, press, selectWeapon,
  tapMessages, messages, pushState, cloudState, waitForRespawn,
};
