'use strict';

/*
 * CTR_BETA_OUTLANDS_JOIN_AVATAR_ID
 *
 * The socket JOIN trust boundary, driven over the real wire.
 *
 * Independent QA found `server.js` resolving a citizen's Outlands gameplay
 * avatar by comparing the client's `outlandsAvatarId` after `Number()`.
 * `Number([13])` is `13`, so an ARRAY was answered with a real team avatar and
 * a citizen could be dressed as `bluef.wrl` on the strength of a value that was
 * never an id.
 *
 * Source inspection cannot prove that is closed, and neither can a test against
 * a re-implemented resolver. So this gate opens a SECOND, raw socket.io
 * connection from inside a real logged-in browser page - the same origin, the
 * same socket server, the same signed token the citizen is actually holding -
 * and emits JOIN payloads the SPA would never construct. What is asserted is
 * the server's own answer: the avatar it puts on that presence in ROOM_STATE,
 * which is exactly what every other citizen in the room is told.
 *
 * What is proved, against the live stack:
 *
 *   - [13] in Outlands is refused and the citizen keeps their own avatar;
 *   - "13", {id: 13}, 13.5, null, true, [], -13, 0 and an unsafe integer
 *     are all refused the same way;
 *   - 13 in Outlands IS accepted, and produces bluef.wrl;
 *   - 13 in the Plaza is refused - a team avatar is an Outlands thing;
 *   - the Game Master id and unauthorised integers are refused;
 *   - the socket survives every malformed value and still serves a good one.
 *
 * A negative control runs first: the same assertion is handed a team avatar and
 * must fail, so a gate that silently stopped looking cannot report a pass.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   export CTR_QA_USER=testqa CTR_QA_PASS=testqa
 *   DISPLAY=:1 node qa/outlands/tools/check-join-avatar-id.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, URL } = require('../../phase2/lib/beta-client');

const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', '..', '..', 'artifacts', 'outlands-join-avatar-id');

const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

/* The rooms, by place id. Read from the environment so the gate is not pinned
 * to one seeded database. */
const OUTLANDS_ROOM = process.env.CTR_QA_OUTLANDS_PLACE || '10';
const PLAZA_ROOM = process.env.CTR_QA_PLAZA_PLACE || '1';

/* The historical team mapping. ne_game.wrl reads the side off the avatar FILE,
 * so a wrong file here is a citizen fighting for the wrong team. */
const TEAM_FILES = {
  13: 'bluef.wrl',
  14: 'bluem.wrl',
  15: 'redf.wrl',
  16: 'redm.wrl',
};

/* Every malformed shape a socket.io payload can carry. socket.io serialises
 * with JSON, so `undefined` arrives as an ABSENT key and NaN / Infinity cannot
 * cross the wire at all. Those two are held by the unit case tables instead of
 * being faked here. */
const MALFORMED = [
  ['an array holding the id', [13]],
  ['an array holding the id as a string', ['13']],
  ['an empty array', []],
  ['the id as a string', '13'],
  ['the id as a zero-padded string', '013'],
  ['the id as a padded string', ' 13 '],
  ['an object', {}],
  ['an object carrying the id', { id: 13 }],
  ['a whole avatar row', { id: 13, filename: 'bluef.wrl', directory: '13' }],
  ['true', true],
  ['false', false],
  ['null', null],
  ['a fraction', 13.5],
  ['a negative integer', -13],
  ['zero', 0],
  ['an integer past the safe range', Number.MAX_SAFE_INTEGER + 1],
];

let passed = 0;
let failed = 0;

function check(ok, name, detail) {
  const tail = detail === undefined ? '' : `  ${JSON.stringify(detail)}`;
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}${tail}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${tail}`);
  }
}

/*
 * Load a raw socket.io client into the page. The socket server serves its own
 * client at /socket.io/socket.io.js, so the gate speaks the exact protocol
 * version the server does rather than a separately pinned one.
 */
async function installRawClient(page) {
  await page.addScriptTag({ url: `${URL}/socket.io/socket.io.js` });
  await page.waitForFunction(() => typeof window.io === 'function', undefined, { timeout: 20000 });
}

/*
 * Emit one JOIN over a fresh raw socket and answer with the avatar the SERVER
 * decided that presence wears. `hasOverride` false omits the key entirely,
 * which is a different case from sending an explicit null.
 */
function joinRaw(page, room, override, hasOverride) {
  return page.evaluate(
    ({ room, override, hasOverride, origin }) => new Promise((resolve, reject) => {
      const token = window.localStorage.getItem('token');
      const presenceId = `qa-${Math.random().toString(36).slice(2)}`;
      const joinId = `qa-join-${Math.random().toString(36).slice(2)}`;
      const sock = window.io(origin, { transports: ['websocket'], reconnection: false,
        forceNew: true });
      const done = (fn, value) => {
        clearTimeout(timer);
        try { sock.disconnect(); } catch (e) { /* ignore */ }
        fn(value);
      };
      const timer = setTimeout(() => done(reject, new Error('ROOM_STATE timeout')), 15000);
      sock.on('connect_error', e => done(reject, new Error(`connect_error: ${e.message}`)));
      sock.on('ROOM_STATE', payload => {
        if (payload.joinId !== joinId) return;
        const mine = (payload.presences || [])
          .find(p => p.presenceId === presenceId);
        done(resolve, {
          connected: sock.connected,
          avatar: mine ? mine.avatar : null,
          found: !!mine,
        });
      });
      sock.on('connect', () => {
        const payload = { room, token, presenceId, joinId };
        if (hasOverride) payload.outlandsAvatarId = override;
        sock.emit('JOIN', payload);
      });
    }),
    { room, override, hasOverride, origin: URL },
  );
}

/** The citizen's own avatar, straight off the SPA store. */
function ownAvatar(page) {
  return page.evaluate(() => {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__.config.globalProperties;
    return app && app.$store.data.user ? app.$store.data.user.avatar : null;
  });
}

function isOwn(avatar, own) {
  if (!avatar || !own) return false;
  return `${avatar.id}` === `${own.id}` && avatar.filename === own.filename;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  console.log(`renderer: ${browser.ctrRenderer}`);
  const context = await browser.newContext();
  let page;
  try {
    page = await login(context, USER, PASS);
    await installRawClient(page);

    const own = await ownAvatar(page);
    check(!!(own && own.filename), 'the citizen has an ordinary avatar to fall back to', own);
    check(
      !Object.values(TEAM_FILES).includes(own && own.filename),
      "and it is not one of the four team avatars", own && own.filename,
    );

    // ---------------------------------------------------------------------
    // NEGATIVE CONTROL. The gate must be able to SEE a team avatar, or every
    // pass below is vacuous.
    // ---------------------------------------------------------------------
    check(
      isOwn(own, own) && !isOwn({ id: 13, filename: 'bluef.wrl' }, own),
      'negative control: the check distinguishes a team avatar from the citizen',
    );

    // ---------------------------------------------------------------------
    // THE EXACT QA FINDING
    // ---------------------------------------------------------------------
    const array13 = await joinRaw(page, OUTLANDS_ROOM, [13], true);
    check(array13.found, 'the [13] JOIN was accepted as a presence at all', array13.found);
    check(
      array13.avatar && array13.avatar.filename !== 'bluef.wrl',
      'regression: [13] does NOT authorise bluef.wrl', array13.avatar,
    );
    check(isOwn(array13.avatar, own),
      'regression: [13] falls back to the citizen\'s own avatar', array13.avatar);
    check(array13.connected, 'regression: [13] does not disconnect the citizen');

    // ---------------------------------------------------------------------
    // EVERY MALFORMED SHAPE
    // ---------------------------------------------------------------------
    const teamFiles = Object.values(TEAM_FILES);
    for (const [label, value] of MALFORMED) {
      const result = await joinRaw(page, OUTLANDS_ROOM, value, true);
      check(
        isOwn(result.avatar, own) && !teamFiles.includes(result.avatar && result.avatar.filename),
        `malformed in Outlands: ${label} falls back`, result.avatar,
      );
    }
    const absent = await joinRaw(page, OUTLANDS_ROOM, undefined, false);
    check(isOwn(absent.avatar, own), 'malformed in Outlands: an absent id falls back',
      absent.avatar);

    // ---------------------------------------------------------------------
    // VALID CONTROLS. Outlands still works.
    // ---------------------------------------------------------------------
    for (const id of Object.keys(TEAM_FILES).map(Number)) {
      const result = await joinRaw(page, OUTLANDS_ROOM, id, true);
      check(
        result.avatar && result.avatar.filename === TEAM_FILES[id],
        `valid: ${id} in Outlands still produces ${TEAM_FILES[id]}`, result.avatar,
      );
    }

    // ---------------------------------------------------------------------
    // ROOM CONTROL. A team avatar is an Outlands thing.
    // ---------------------------------------------------------------------
    for (const id of Object.keys(TEAM_FILES).map(Number)) {
      const result = await joinRaw(page, PLAZA_ROOM, id, true);
      check(isOwn(result.avatar, own),
        `room control: ${id} in the Plaza falls back`, result.avatar);
    }
    const plazaArray = await joinRaw(page, PLAZA_ROOM, [13], true);
    check(isOwn(plazaArray.avatar, own), 'room control: [13] in the Plaza falls back',
      plazaArray.avatar);

    // ---------------------------------------------------------------------
    // AUTHORITY. The database decides, not the client.
    // ---------------------------------------------------------------------
    const gm = await joinRaw(page, OUTLANDS_ROOM, 12, true);
    check(
      isOwn(gm.avatar, own) && (gm.avatar || {}).filename !== 'gm.wrl',
      'authority: the Game Master id is never served', gm.avatar,
    );
    for (const id of [1, 11, 17, 999999, Number.MAX_SAFE_INTEGER]) {
      const result = await joinRaw(page, OUTLANDS_ROOM, id, true);
      check(isOwn(result.avatar, own),
        `authority: the unauthorised id ${id} falls back`, result.avatar);
    }

    // ---------------------------------------------------------------------
    // The server is still alive AND still correct after all of it.
    // ---------------------------------------------------------------------
    const after = await joinRaw(page, OUTLANDS_ROOM, 13, true);
    check(after.avatar && after.avatar.filename === 'bluef.wrl',
      'the socket still serves a good id after every malformed one', after.avatar);

    await page.screenshot({ path: path.join(OUT_DIR, 'join-avatar-id.png') });
  } catch (err) {
    failed += 1;
    console.error('FATAL', err && err.message ? err.message : err);
    if (page) {
      try { await page.screenshot({ path: path.join(OUT_DIR, 'fatal.png') }); } catch (e) { /**/ }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
