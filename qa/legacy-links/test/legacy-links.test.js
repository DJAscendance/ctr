'use strict';

/**
 * Tests for the legacy Cybertown link resolver.
 *
 * The resolver decides what a 3D control does when it is clicked, so the cases
 * that matter most are the negative ones: a URL it fails to recognise must be
 * passed through untouched, and a legacy URL it cannot map must be refused
 * rather than sent somewhere plausible-looking.
 */

const assert = require('assert');
const path = require('path');

const { resolveLegacyUrl, LEGACY_PLACE_SLUGS } = require(
  path.join(__dirname, '..', '..', '..', 'spa', 'src', 'libs', 'legacy_links.js'),
);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('maps an absolute historical shop link to the current place route', () => {
  const result = resolveLegacyUrl(
    'http://www.cybertown.com/cgi-bin/cybertown/place?ID=0000000000000903&plc=shop&ac=index3d',
  );
  assert.deepStrictEqual(result, { route: '/#/place/applianceshop' });
});

test('maps the host-relative form of the same link', () => {
  const result = resolveLegacyUrl(
    '/cgi-bin/cybertown/place?ID=0000000000000911&plc=shop&ac=index3d',
  );
  assert.deepStrictEqual(result, { route: '/#/place/antiqueshop' });
});

test('accepts the bare host and https', () => {
  const result = resolveLegacyUrl(
    'https://cybertown.com/cgi-bin/cybertown/place?ID=0000000000000907',
  );
  assert.deepStrictEqual(result, { route: '/#/place/electronicsstore' });
});

test('maps every Mall shop door this repository has evidence for', () => {
  Object.keys(LEGACY_PLACE_SLUGS).forEach((id) => {
    const result = resolveLegacyUrl(`/cgi-bin/cybertown/place?ID=${id}&plc=shop`);
    assert.deepStrictEqual(result, { route: `/#/place/${LEGACY_PLACE_SLUGS[id]}` });
  });
});

test('produces routes that carry no hostname', () => {
  Object.keys(LEGACY_PLACE_SLUGS).forEach((id) => {
    const { route } = resolveLegacyUrl(`/cgi-bin/cybertown/place?ID=${id}`);
    assert.strictEqual(route.indexOf('/'), 0, `${route} must be root-relative`);
    assert.ok(!/cybertown\.com/.test(route), `${route} must name no dead host`);
  });
});

test('refuses a historical place id with no proven destination', () => {
  // ...901 is the Mall's "Gallery" door; no current place serves it.
  const result = resolveLegacyUrl('/cgi-bin/cybertown/place?ID=0000000000000901');
  assert.ok(result.unresolved, 'must report the link as unresolved');
  assert.ok(!result.route, 'must not invent a destination');
});

test('refuses the Grocery Store door as well', () => {
  const result = resolveLegacyUrl('/cgi-bin/cybertown/place?ID=0000000000000916');
  assert.ok(result.unresolved);
  assert.ok(!result.route);
});

test('refuses a legacy place link with no ID at all', () => {
  const result = resolveLegacyUrl('/cgi-bin/cybertown/place?plc=shop');
  assert.ok(result.unresolved);
});

test('refuses an unknown legacy Cybertown page instead of guessing home', () => {
  const result = resolveLegacyUrl('http://www.cybertown.com/cgi-bin/games/fool/mall_fool_switch.pl');
  assert.ok(result.unresolved, 'must be reported');
  assert.ok(!result.route, 'must never fall back to a default route');
});

test('leaves a genuinely external link alone', () => {
  assert.strictEqual(resolveLegacyUrl('http://www.3dfx.com'), null);
});

test('leaves a route this application already serves alone', () => {
  assert.strictEqual(resolveLegacyUrl('/#/place/largeitemshop'), null);
  assert.strictEqual(resolveLegacyUrl('/#/place/cardealer'), null);
});

test('leaves world and asset loads alone', () => {
  assert.strictEqual(resolveLegacyUrl('/assets/worlds/shopping/vrml/shopping.wrl'), null);
  assert.strictEqual(resolveLegacyUrl('vrml/shopping.wrl'), null);
  assert.strictEqual(resolveLegacyUrl('/api/compat/city-time.wrl'), null);
});

test('leaves other URL schemes alone', () => {
  assert.strictEqual(resolveLegacyUrl('urn:inet:blaxxun.com:node:HUD'), null);
});

test('tolerates junk input', () => {
  assert.strictEqual(resolveLegacyUrl(''), null);
  assert.strictEqual(resolveLegacyUrl(null), null);
  assert.strictEqual(resolveLegacyUrl(undefined), null);
  assert.strictEqual(resolveLegacyUrl(42), null);
});

test('ignores a fragment on a legacy link', () => {
  const result = resolveLegacyUrl(
    'http://www.cybertown.com/cgi-bin/cybertown/place?ID=0000000000000905#top',
  );
  assert.deepStrictEqual(result, { route: '/#/place/carpetshop' });
});

let failed = 0;
tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
});
console.log(`\n${tests.length - failed}/${tests.length} legacy-link tests passed`);
process.exit(failed === 0 ? 0 : 1);
