'use strict';

/*
 * CTR_JOINPLACE_INITIAL_AV
 *
 * One property, no browser: joining a place publishes no initial position.
 *
 * joinPlace() used to follow the room join with an `AV` whose payload was
 * nested one level deep, `{ detail: { pos, rot } }`. Nothing read that shape.
 * The server's AV handler guards on `msg.pos` / `msg.rot`, and a receiving
 * client's onAvatarMoved reads `event.pos` / `event.rot`, so every field was
 * undefined on both ends: no server state was updated and no avatar moved.
 *
 * Deleting it is only safe because the position source is elsewhere. The root
 * ProximitySensor added by startX3DListeners fires position_changed on its own
 * shortly after JOIN, which sets `this.position`, and the watcher publishes the
 * flat `{ pos }` the server and the receivers agree on.
 *
 * So this guards both halves. joinPlace must join and emit nothing - not the
 * old nested payload, and not a hand-built replacement either. The pos it used
 * to send came from `viewpointPosition`, which is viewpoint-local: in the
 * Antique Shop that reads Z = 25 where world space is Z = 13.8, so any manual
 * initial position would publish a coordinate the receivers cannot use. The
 * watchers are driven here too, so "emits nothing" cannot be met by muting the
 * sensor path.
 *
 * The last case is a negative control: the deleted code is run back through the
 * same assertions, which must reject it.
 *
 * Usage:
 *   node qa/members/test/check-joinplace-initial-av.js
 */

const fs = require('fs');
const path = require('path');

const COMPONENT = path.join(
  __dirname, '..', '..', '..',
  'spa', 'src', 'pages', 'world-browser', 'WorldBrowserPage.vue');

const SOURCE = fs.readFileSync(COMPONENT, 'utf8');

/* The Antique Shop entry, measured. The viewpoint reads 11.2 higher in Z than
 * the world-space position the sensor reports, so the two are told apart by
 * value alone. */
const VIEWPOINT_LOCAL = [0, 1.75, 25];
const WORLD_SPACE = [0, 1.75, 13.8];

const results = [];
function check(name, pass, detail) {
  results.push({ name: name, pass: !!pass, detail: detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass && detail !== undefined) {
    process.stdout.write(`  (${JSON.stringify(detail)})`);
  }
  process.stdout.write('\n');
}

/* ------------------------------------------------------------------ *
 * Lift the real methods.
 *
 * The component is a .vue file with TypeScript annotations, so it cannot be
 * required. Each method is cut out by its own boundaries and only its header
 * is rewritten - nothing inside a body is touched, so what runs below is the
 * shipped code.
 * ------------------------------------------------------------------ */

/* Comments explain why the emit is gone, so they name the very things the
 * source checks below forbid. Only executable text is searched. */
function code(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
}

function cut(openMarker, closeMarker) {
  const open = SOURCE.indexOf(openMarker);
  const close = SOURCE.indexOf(closeMarker);
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`${openMarker.trim()} not found in WorldBrowserPage.vue`);
  }
  return SOURCE.slice(open, close).trimEnd().replace(/,$/, '');
}

function compile(body, openMarker, header, name, X3D) {
  const rewritten = body.replace(openMarker.trim(), header);
  return new Function('X3D', `${rewritten}\nreturn ${name};`)(X3D);
}

const JOIN_PLACE_OPEN = '    async joinPlace(): Promise<void> {';
const joinPlaceSource = cut(JOIN_PLACE_OPEN, '    moveObject(objectId): void {');
const positionWatcherSource = cut('    position() {', '    rotation() {');
const rotationWatcherSource = cut('    rotation() {', '    sharedEvent: {');

/* The payload this pass deleted, kept verbatim for the negative control. */
const OLD_JOIN_PLACE = [
  JOIN_PLACE_OPEN,
  '      await this.$socket.joinRoom(this.$store.data.place.id, this.$store.data.user.token);',
  '      this.debugMsg("joined room success", this.$store.data.place.id);',
  '      if(this.$store.data.view3d){',
  '        const { viewpointPosition, viewpointOrientation } = X3D.getBrowser(this.browser);',
  '        const pos = viewpointPosition',
  '          ? [viewpointPosition.x, viewpointPosition.y, viewpointPosition.z]',
  '          : this.position;',
  '        const rot = viewpointOrientation',
  '          ? [',
  '            viewpointOrientation.x,',
  '            viewpointOrientation.y,',
  '            viewpointOrientation.z,',
  '            viewpointOrientation.angle,',
  '          ]',
  '          : this.rotation;',
  '        this.$socket.emit("AV", { detail: { pos, rot } });',
  '      }',
  '    }',
].join('\n');

/* ------------------------------------------------------------------ *
 * Stand-ins. Every read and every call the method could make is counted, so
 * "did nothing" is checked, not assumed.
 * ------------------------------------------------------------------ */

function makeRecorder() {
  return {
    joinRoom: [],
    emits: [],
    debug: 0,
    getBrowser: 0,
    readViewpointPosition: 0,
    readViewpointOrientation: 0,
    readPosition: 0,
    readRotation: 0,
  };
}

function makeX3D(recorder) {
  return {
    getBrowser: function () {
      recorder.getBrowser += 1;
      return {
        get viewpointPosition() {
          recorder.readViewpointPosition += 1;
          return { x: VIEWPOINT_LOCAL[0], y: VIEWPOINT_LOCAL[1], z: VIEWPOINT_LOCAL[2] };
        },
        get viewpointOrientation() {
          recorder.readViewpointOrientation += 1;
          return { x: 0, y: 1, z: 0, angle: 0 };
        },
      };
    },
  };
}

function makeContext(recorder, view3d) {
  return {
    browser: 'world',
    $store: {
      data: {
        place: { id: 4211 },
        user: { token: 'member-token' },
        view3d: view3d,
      },
    },
    $socket: {
      joinRoom: function (room, token) {
        recorder.joinRoom.push({ room: room, token: token });
        return Promise.resolve();
      },
      emit: function (event, payload) {
        recorder.emits.push({ event: event, payload: payload });
      },
    },
    debugMsg: function () { recorder.debug += 1; },
    /* The sensor's own reading. Counted so a manual send is visible even when
     * it happens to pick the right coordinate space. */
    get position() { recorder.readPosition += 1; return WORLD_SPACE.slice(); },
    get rotation() { recorder.readRotation += 1; return [0, 1, 0, 0]; },
  };
}

/* Everything the join path must not do, in one place, so the real method and
 * the deleted one are judged by the same rules. */
function violations(recorder) {
  const found = [];
  const av = recorder.emits.filter((sent) => sent.event === 'AV');
  if (recorder.emits.length !== 0) found.push('emitted');
  if (av.length !== 0) found.push('emitted AV');
  if (av.some((sent) => sent.payload && sent.payload.detail)) found.push('nested payload');
  if (recorder.getBrowser !== 0) found.push('asked for a browser');
  if (recorder.readViewpointPosition !== 0) found.push('read viewpointPosition');
  if (recorder.readViewpointOrientation !== 0) found.push('read viewpointOrientation');
  if (recorder.readPosition !== 0) found.push('read this.position');
  if (recorder.readRotation !== 0) found.push('read this.rotation');
  if (JSON.stringify(recorder.emits).indexOf(String(VIEWPOINT_LOCAL[2])) !== -1) {
    found.push('published a viewpoint-local coordinate');
  }
  return found;
}

function runJoinPlace(source, view3d) {
  const recorder = makeRecorder();
  const joinPlace = compile(
    source, JOIN_PLACE_OPEN, 'async function joinPlace() {', 'joinPlace',
    makeX3D(recorder));
  const context = makeContext(recorder, view3d);
  return joinPlace.call(context).then(function () { return recorder; });
}

/* ------------------------------------------------------------------ *
 * The source contract.
 * ------------------------------------------------------------------ */

const joinPlaceCode = code(joinPlaceSource);

check('joinPlace is still in the component', joinPlaceSource.length > 0);
check('joinPlace body sends nothing',
  joinPlaceCode.indexOf('$socket.emit') === -1, joinPlaceCode);
check('joinPlace body names no AV event',
  joinPlaceCode.indexOf('"AV"') === -1, joinPlaceCode);
check('joinPlace body does not reach for the viewpoint',
  joinPlaceCode.indexOf('viewpointPosition') === -1
  && joinPlaceCode.indexOf('viewpointOrientation') === -1, joinPlaceCode);
check('joinPlace body does not read the sensor value either',
  joinPlaceCode.indexOf('this.position') === -1
  && joinPlaceCode.indexOf('this.rotation') === -1, joinPlaceCode);
check('joinPlace still joins the room',
  joinPlaceCode.indexOf('this.$socket.joinRoom(') !== -1, joinPlaceCode);
check('no nested AV payload is built anywhere in the component',
  /emit\(\s*["']AV["']\s*,\s*\{\s*detail/.test(SOURCE) === false);
check('the sensor watchers still send AV',
  code(positionWatcherSource).indexOf('$socket.emit("AV"') !== -1
  && code(rotationWatcherSource).indexOf('$socket.emit("AV"') !== -1);

/* ------------------------------------------------------------------ *
 * The join path, run.
 * ------------------------------------------------------------------ */

Promise.resolve()
  .then(function () { return runJoinPlace(joinPlaceSource, true); })
  .then(function (recorder) {
    check('joinPlace joins the room once', recorder.joinRoom.length === 1,
      recorder.joinRoom);
    check('joinPlace joins the member\'s place with the member\'s token',
      recorder.joinRoom.length === 1
      && recorder.joinRoom[0].room === 4211
      && recorder.joinRoom[0].token === 'member-token', recorder.joinRoom);
    check('joinPlace emits nothing at all', recorder.emits.length === 0,
      recorder.emits);
    check('joinPlace sends no obsolete nested initial AV',
      violations(recorder).indexOf('nested payload') === -1, recorder.emits);
    check('joinPlace calculates no initial position',
      recorder.getBrowser === 0
      && recorder.readViewpointPosition === 0
      && recorder.readViewpointOrientation === 0
      && recorder.readPosition === 0
      && recorder.readRotation === 0,
      recorder);
    check('joinPlace publishes no viewpoint-local coordinate',
      violations(recorder).indexOf('published a viewpoint-local coordinate') === -1,
      recorder.emits);
    check('the whole join path is clean in 3D', violations(recorder).length === 0,
      violations(recorder));
  })
  .then(function () { return runJoinPlace(joinPlaceSource, false); })
  .then(function (recorder) {
    check('a 2D place joins the room too', recorder.joinRoom.length === 1,
      recorder.joinRoom);
    check('the whole join path is clean in 2D', violations(recorder).length === 0,
      violations(recorder));
  })
  .then(function () {
    /* ---------------------------------------------------------------- *
     * The sensor path is untouched: normal AV traffic still flows, flat.
     * ---------------------------------------------------------------- */
    const recorder = makeRecorder();
    const context = makeContext(recorder, true);
    const positionWatcher = compile(
      positionWatcherSource, '    position() {', 'function positionWatcher() {',
      'positionWatcher', makeX3D(recorder));
    const rotationWatcher = compile(
      rotationWatcherSource, '    rotation() {', 'function rotationWatcher() {',
      'rotationWatcher', makeX3D(recorder));

    positionWatcher.call(context);
    rotationWatcher.call(context);

    const av = recorder.emits.filter((sent) => sent.event === 'AV');
    check('the sensor still produces AV traffic', av.length === 2, recorder.emits);
    check('the position AV is top-level, not nested',
      av[0] && av[0].payload && av[0].payload.detail === undefined
      && Array.isArray(av[0].payload.pos), av[0]);
    check('the position AV carries the world-space reading',
      av[0] && JSON.stringify(av[0].payload.pos) === JSON.stringify(WORLD_SPACE),
      av[0]);
    check('the rotation AV is top-level, not nested',
      av[1] && av[1].payload && av[1].payload.detail === undefined
      && Array.isArray(av[1].payload.rot), av[1]);
    check('the sensor path reads the sensor values, not the viewpoint',
      recorder.readPosition === 1 && recorder.readRotation === 1
      && recorder.readViewpointPosition === 0
      && recorder.readViewpointOrientation === 0, recorder);
  })
  .then(function () { return runJoinPlace(OLD_JOIN_PLACE, true); })
  .then(function (recorder) {
    /* ---------------------------------------------------------------- *
     * Negative control: the deleted code, judged by the same rules.
     * ---------------------------------------------------------------- */
    const found = violations(recorder);
    check('negative control: the old join path still joins the room',
      recorder.joinRoom.length === 1, recorder.joinRoom);
    check('negative control: the old nested AV is caught',
      found.indexOf('nested payload') !== -1, found);
    check('negative control: the old viewpoint read is caught',
      found.indexOf('read viewpointPosition') !== -1, found);
    check('negative control: the old viewpoint-local coordinate is caught',
      found.indexOf('published a viewpoint-local coordinate') !== -1, found);
  })
  .then(function () {
    const failed = results.filter((result) => !result.pass);
    process.stdout.write(
      `\n${results.length - failed.length}/${results.length} PASS\n`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch(function (error) {
    process.stdout.write(`\nFAIL  ${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
  });
