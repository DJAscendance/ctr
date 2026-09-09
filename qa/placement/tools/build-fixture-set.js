'use strict';

/**
 * Generates `fixtures/fixture-set.json`, the durable definition of the
 * placement regression fixture set.
 *
 * The set is synthetic-but-representative: the QA database carries only seed
 * data, so there is no real citizen placement to sample. Every record uses a
 * numeric id and a `qafix/` asset path, so nothing user-identifying is
 * committed. Asset geometry is copied from the local item library at seed time
 * and is not vendored into this repository.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'fixtures', 'fixture-set.json');

/** Item library entries: [category, slug, main file, animated]. */
const ITEMS = [
  ['furniture', 'ct-table', 'Table_finished.wrl', false],
  ['furniture', 'advenbed1', 'advenbed1.wrl', false],
  ['furniture', 'black-willow-bed', 'black-willow-bed.wrl', false],
  ['furniture', 'low-poly-couch', null, false],
  ['electronics', 'flux-tape-deck', 'flux-tape-deck.wrl', true],
  ['electronics', 'signal-storm-globe', 'signal-storm-globe.wrl', true],
  ['electronics', 'pulse-prism-console', 'pulse-prism-console.wrl', true],
  ['decorative', 'aurora-kinetic-art', 'aurora-kinetic-art.wrl', true],
  ['decorative', 'velvet-thornwing', 'velvet-thornwing.wrl', false],
  ['kitchens', 'galactic-prep-island', 'galactic-prep-island.wrl', false],
  ['kitchens', 'cyberchef-corner-kitchen', 'cyberchef-corner-kitchen.wrl', false],
  ['toys', 'comet-crown-spin-top', 'comet-crown-spin-top.wrl', true],
  ['toys', 'zero-g-ring-toss', 'zero-g-ring-toss.wrl', false],
  ['toys', 'pocket-moon-playset', 'pocket-moon-playset.wrl', false],
  ['antiques', 'chronos-orrery', 'chronos-orrery.wrl', true],
  ['antiques', 'echo-cabinet', 'echo-cabinet.wrl', false],
  ['antiques', 'starlight-zoetrope', 'starlight-zoetrope.wrl', true],
  ['antiques', 'meridian-time-chest', 'meridian-time-chest.wrl', false],
  ['appliances', 'orbitwash-washer', 'orbitwash-washer.wrl', false],
  ['appliances', 'orbitcool-smart-refrigerator', 'orbitcool-smart-refrigerator.wrl', false],
  ['appliances', 'patiochef-e-grill', 'patiochef-e-grill.wrl', false],
  ['jewelry', 'cipher-heart-locket', 'cipher-heart-locket.wrl', false],
  ['jewelry', 'aether-crown-display', 'aether-crown-display.wrl', false],
  ['art', 'by-the-sea', 'by-the-sea.wrl', false],
  ['art', 'rainbow-room', 'rainbow-room.wrl', false],
];

const HALF_PI = Math.PI / 2;

/**
 * Placement traits, chosen so the set covers every axis sign, several rotation
 * axes, stacked objects, wall-adjacent objects and floor-level objects.
 */
const TRAITS = [
  { tag: 'origin-floor', pos: [0, 0, 0], rot: [0, 1, 0, 0] },
  { tag: 'pos-x-floor', pos: [3.25, 0, 0], rot: [0, 1, 0, HALF_PI] },
  { tag: 'neg-x-floor', pos: [-3.25, 0, 0], rot: [0, 1, 0, -HALF_PI] },
  { tag: 'pos-z-floor', pos: [0, 0, 4.5], rot: [0, 1, 0, Math.PI] },
  { tag: 'neg-z-floor', pos: [0, 0, -4.5], rot: [0, 1, 0, 0.7853981633974483] },
  { tag: 'raised-y', pos: [1.125, 1.75, -2.5], rot: [0, 1, 0, 2.356194490192345] },
  { tag: 'deep-negative', pos: [-7.875, -1.25, -9.5], rot: [0, 1, 0, 3.9269908169872414] },
  { tag: 'stack-base', pos: [2.5, 0, 2.5], rot: [0, 1, 0, 0] },
  { tag: 'stack-mid', pos: [2.5, 0.82, 2.5], rot: [0, 1, 0, 0] },
  { tag: 'stack-top', pos: [2.5, 1.64, 2.5], rot: [0, 1, 0, 0] },
  { tag: 'wall-north', pos: [0, 1.4, -9.95], rot: [0, 1, 0, 0] },
  { tag: 'wall-south', pos: [0, 1.4, 9.95], rot: [0, 1, 0, Math.PI] },
  { tag: 'wall-east', pos: [9.95, 1.4, 0], rot: [0, 1, 0, HALF_PI] },
  { tag: 'wall-west', pos: [-9.95, 1.4, 0], rot: [0, 1, 0, -HALF_PI] },
  { tag: 'tilt-x-axis', pos: [4.4, 0.5, -1.1], rot: [1, 0, 0, 0.5235987755982988] },
  { tag: 'tilt-z-axis', pos: [-4.4, 0.5, 1.1], rot: [0, 0, 1, -0.5235987755982988] },
  { tag: 'oblique-axis', pos: [1.7320508, 0.9, -1.7320508], rot: [0.5773503, 0.5773503, 0.5773503, 2.0943951] },
  { tag: 'axis-xy', pos: [-2.2, 2.2, 3.3], rot: [0.7071068, 0.7071068, 0, 1.0471975511965976] },
  { tag: 'high-precision', pos: [18.510206479792842, 1.6000000127534366, -5.537815135201809], rot: [0, 1, 0, 5.344663704667898] },
  { tag: 'tiny-offset', pos: [0.0001, 0.0002, -0.0003], rot: [0, 1, 0, 0.0001] },
];

/** Fixture groups. `source` selects which table the row lands in. */
const GROUPS = [
  { group: 'home', source: 'object_instance', placeKey: 'home', count: 20, memberKey: 'owner' },
  { group: 'club', source: 'object_instance', placeKey: 'club', count: 10, memberKey: 'owner' },
  // `mall_object` rows are the shop placement table. They are stored-layer
  // coverage only: the individual shop world stalls on load at the 15.1.12
  // baseline, so the flea market carries the rendered place coverage instead.
  { group: 'shop', source: 'mall_object', placeKey: 'shop', count: 10, memberKey: null },
  { group: 'place', source: 'object_instance', placeKey: 'fleamarket', count: 10, memberKey: 'owner' },
  { group: 'public', source: 'object_instance', placeKey: 'plaza', count: 5, memberKey: 'owner' },
];

function build() {
  const objects = ITEMS.map((item, index) => ({
    objectRef: `qafix-${index + 1}`,
    category: item[0],
    slug: item[1],
    filename: item[2],
    directory: `qafix/${item[1]}`,
    animated: item[3],
    name: `QAFIX ${item[1]}`,
  })).filter(o => o.filename !== null);

  const fixtures = [];
  let seq = 0;
  GROUPS.forEach(group => {
    for (let i = 0; i < group.count; i += 1) {
      const trait = TRAITS[i % TRAITS.length];
      const object = objects[seq % objects.length];
      // Alternate created_at era so the set spans historical and recent rows.
      const era = i % 3 === 0 ? 'historical' : 'recent';
      fixtures.push({
        fixtureRef: `${group.group}-${String(i + 1).padStart(2, '0')}`,
        group: group.group,
        source: group.source,
        placeKey: group.placeKey,
        memberKey: group.memberKey,
        objectRef: object.objectRef,
        trait: trait.tag,
        era,
        animated: object.animated,
        position: { x: trait.pos[0], y: trait.pos[1], z: trait.pos[2] },
        rotation: {
          x: trait.rot[0], y: trait.rot[1], z: trait.rot[2], angle: trait.rot[3],
        },
      });
      seq += 1;
    }
  });

  return {
    generatedBy: 'qa/placement/tools/build-fixture-set.js',
    note: 'Synthetic placement fixtures. No citizen data. Seed into a disposable QA database only.',
    itemLibrary: '/home/ryan/Projects/cybertown/new-items/item-categories (read-only source)',
    objects,
    fixtures,
  };
}

const set = build();
fs.writeFileSync(OUT, `${JSON.stringify(set, null, 2)}\n`);
console.log(`wrote ${OUT}: ${set.objects.length} objects, ${set.fixtures.length} fixtures`);
