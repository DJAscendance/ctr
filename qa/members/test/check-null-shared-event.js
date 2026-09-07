'use strict';

/*
 * CTR_MALL_NULL_SHARED_EVENT
 *
 * One property, no browser: the shared-event list walk tolerates a null entry.
 *
 * shopping.wrl (the Mall) declares `exposedField MFNode events NULL`. X_ITE 16
 * hands that back as a one-item MFNode whose only entry is null. The place
 * startup loop used to call addFieldCallback on it, which threw and stopped
 * startX3DListeners before joinPlace ran, so the Mall never sent JOIN.
 *
 * sharedEventNodes() is the guard. This test drives it with the three list
 * shapes the live worlds produce - Plaza (empty), Mall (one null), Club (one
 * real SharedEvent) - plus the mixed list, and runs the real registration loop
 * over the result so a regression shows up as a throw, not just a wrong count.
 *
 * Usage:
 *   node qa/members/test/check-null-shared-event.js
 */

const { sharedEventNodes } = require('../../../spa/src/libs/shared-events');

const results = [];
function check(name, pass, detail) {
  results.push({ name: name, pass: !!pass, detail: detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass && detail !== undefined) {
    process.stdout.write(`  (${JSON.stringify(detail)})`);
  }
  process.stdout.write('\n');
}

/* A stand-in for an X_ITE SharedEvent node: it records what was bound to it. */
function fakeSharedEvent(name) {
  return {
    name: name,
    callbacks: [],
    addFieldCallback: function (key, fieldName, fn) {
      this.callbacks.push(fieldName);
    },
  };
}

/*
 * The registration loop exactly as startSharedEvents() runs it, over the
 * filtered list. `later` records that the method ran to the end, which is what
 * start3DSocketListeners() and joinPlace() depend on.
 */
const TYPE_NAMES = ['bool', 'color', 'float', 'int32', 'rotation', 'string',
  'time', 'vec2f', 'vec3f'];

function runStartSharedEvents(events) {
  const eventNodeMap = new Map();
  let later = false;
  for (const eventNode of sharedEventNodes(events)) {
    for (const typeName of TYPE_NAMES) {
      eventNode.addFieldCallback({}, `${typeName}ToServer`, () => undefined);
    }
    if (!eventNodeMap.has(eventNode.name)) {
      eventNodeMap.set(eventNode.name, []);
    }
    eventNodeMap.get(eventNode.name).push(eventNode);
  }
  later = true;
  return { eventNodeMap: eventNodeMap, later: later };
}

function attempt(events) {
  try {
    return { threw: false, out: runStartSharedEvents(events) };
  } catch (e) {
    return { threw: true, error: String(e && e.message) };
  }
}

/* Mall: exposedField MFNode events NULL -> one null entry. */
const nullEntry = attempt([null]);
check('null entry does not throw', nullEntry.threw === false, nullEntry.error);
check('null entry registers no callbacks',
  !nullEntry.threw && nullEntry.out.eventNodeMap.size === 0,
  !nullEntry.threw && nullEntry.out.eventNodeMap.size);
check('null entry lets the method complete',
  !nullEntry.threw && nullEntry.out.later === true);
check('null entry is filtered out of the list', sharedEventNodes([null]).length === 0,
  sharedEventNodes([null]).length);

/* Club: events[0] = SharedEvent "F_SELight". */
const light = fakeSharedEvent('F_SELight');
const valid = attempt([light]);
check('valid entry does not throw', valid.threw === false, valid.error);
check('valid entry is registered',
  !valid.threw && valid.out.eventNodeMap.has('F_SELight'));
check('valid entry gets every type callback',
  light.callbacks.length === TYPE_NAMES.length, light.callbacks.length);
check('valid entry callback names are the ToServer fields',
  light.callbacks.join(',') === TYPE_NAMES.map(t => `${t}ToServer`).join(','),
  light.callbacks);

/* Mixed list: the null must not hide the events on either side of it. */
const first = fakeSharedEvent('F_First');
const second = fakeSharedEvent('F_Second');
const mixed = attempt([first, null, second]);
check('mixed list does not throw', mixed.threw === false, mixed.error);
check('mixed list registers the first valid entry',
  !mixed.threw && mixed.out.eventNodeMap.has('F_First'));
check('mixed list registers the second valid entry',
  !mixed.threw && mixed.out.eventNodeMap.has('F_Second'));
check('mixed list skips only the null',
  !mixed.threw && mixed.out.eventNodeMap.size === 2,
  !mixed.threw && mixed.out.eventNodeMap.size);
check('mixed list keeps entry order',
  sharedEventNodes([first, null, second]).map(n => n.name).join(',') === 'F_First,F_Second',
  sharedEventNodes([first, null, second]).map(n => n.name));

/* Plaza: events = [] - the shape that always worked, still works. */
const empty = attempt([]);
check('empty list does not throw', empty.threw === false, empty.error);
check('empty list registers nothing',
  !empty.threw && empty.out.eventNodeMap.size === 0);

/* An absent field is not a list at all. */
check('undefined list yields no nodes', sharedEventNodes(undefined).length === 0);
check('null list yields no nodes', sharedEventNodes(null).length === 0);

const passed = results.filter(x => x.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
