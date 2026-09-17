/**
 * The Jail's client-side rules.
 *
 * These decide what the 3D page does with the API's answer -- they are not the answer.
 * Authority is `GET /api/member/jail/standing`, computed on the server from ban rows and
 * role assignments; every case below feeds this code an answer and checks what it does
 * with it, including the answers a hostile client would like it to accept.
 *
 * The one that matters most is the beam. A beam binds a Viewpoint straight at its
 * destination, so it does not walk and consults no wall on the way -- which made it a way
 * into the cells for anyone who could see an inmate in the citizen list, the modern shape
 * of the old ESC trick.
 */
import assert from "assert";

import {
  JAIL_CELL_BOUNDARY_Z,
  JAIL_CELL_SPAWN,
  JAIL_GALLERY_SPAWN,
  JAIL_SLUG,
  hasJailStaffAuthority,
  isJailCellSide,
  mayBeamTo,
} from "../src/helpers/jail.helper";

let passed = 0;
let failed = 0;

function test(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : err}`);
  }
}

const VISITOR = { inmate: false, staff: false };
const INMATE = { inmate: true, staff: false };
const STAFF = { inmate: false, staff: true };
const JAILED_STAFF = { inmate: true, staff: true };

console.log("\n1. THE HISTORICAL COORDINATES");

test("the boundary is the plane the force field stands on", () => {
  assert.strictEqual(JAIL_CELL_BOUNDARY_Z, 1.25);
});

test("the gallery spawn is jail.wrl's own Viewpoint", () => {
  assert.deepStrictEqual(JAIL_GALLERY_SPAWN.position, [0, 1.75, 19.51]);
});

test("the cell spawn is jailpris.wrl's own Viewpoint", () => {
  assert.deepStrictEqual(JAIL_CELL_SPAWN.position, [0, 1.75, -24.65]);
});

test("the two spawns are on opposite sides of the boundary", () => {
  assert.ok(JAIL_GALLERY_SPAWN.position[2] > JAIL_CELL_BOUNDARY_Z);
  assert.ok(JAIL_CELL_SPAWN.position[2] < JAIL_CELL_BOUNDARY_Z);
});

console.log("\n2. STAFF AUTHORITY");

test("a Security or Jail office is staff", () => {
  assert.strictEqual(hasJailStaffAuthority(STAFF), true);
});

test("an ordinary visitor is not", () => {
  assert.strictEqual(hasJailStaffAuthority(VISITOR), false);
});

test("an inmate is not", () => {
  assert.strictEqual(hasJailStaffAuthority(INMATE), false);
});

test("a JAILED officer is not - a sentence outranks an office", () => {
  // Otherwise a guard could be sentenced and then use their own office to walk out of
  // their own cell, which is the escape this whole lane exists to close.
  assert.strictEqual(hasJailStaffAuthority(JAILED_STAFF), false);
});

test("'could not tell' is not staff", () => {
  assert.strictEqual(hasJailStaffAuthority(null), false);
  assert.strictEqual(hasJailStaffAuthority(undefined), false);
});

test("a truthy-but-not-true staff value is not staff", () => {
  // A client that replies with a string, a 1 or an object must not be read as an office.
  assert.strictEqual(hasJailStaffAuthority({ inmate: false, staff: 1 } as never), false);
  assert.strictEqual(hasJailStaffAuthority({ inmate: false, staff: "yes" } as never), false);
});

console.log("\n3. WHICH SIDE OF THE FORCE FIELD");

test("behind the force field is the cell side", () => {
  assert.strictEqual(isJailCellSide(JAIL_SLUG, -24.65), true);
  assert.strictEqual(isJailCellSide(JAIL_SLUG, 0), true);
});

test("the visiting gallery is not", () => {
  assert.strictEqual(isJailCellSide(JAIL_SLUG, 19.51), false);
  assert.strictEqual(isJailCellSide(JAIL_SLUG, 1.25), false);
});

test("no other place inherits the coordinate", () => {
  assert.strictEqual(isJailCellSide("plaza", -24.65), false);
  assert.strictEqual(isJailCellSide(undefined, -24.65), false);
  assert.strictEqual(isJailCellSide(null, -24.65), false);
});

console.log("\n4. THE BEAM - THE ONE MOVE THAT DOES NOT WALK");

test("a visitor cannot beam into the cells", () => {
  assert.strictEqual(mayBeamTo(JAIL_SLUG, -24.65, VISITOR), false);
});

test("an inmate cannot beam deeper into the cells either", () => {
  assert.strictEqual(mayBeamTo(JAIL_SLUG, -24.65, INMATE), false);
});

test("a jailed officer cannot beam into the cells", () => {
  assert.strictEqual(mayBeamTo(JAIL_SLUG, -24.65, JAILED_STAFF), false);
});

test("staff can, because supervising the Jail means reaching an inmate", () => {
  assert.strictEqual(mayBeamTo(JAIL_SLUG, -24.65, STAFF), true);
});

test("visitors still beam to each other in the gallery", () => {
  assert.strictEqual(mayBeamTo(JAIL_SLUG, 19.51, VISITOR), true);
  assert.strictEqual(mayBeamTo(JAIL_SLUG, 5, VISITOR), true);
});

test("an inmate may still beam within the gallery side coordinates", () => {
  // Nothing here confines the inmate - that is the world's barrier and the server's JOIN
  // rule. This function only refuses the teleport that would skip a wall.
  assert.strictEqual(mayBeamTo(JAIL_SLUG, 19.51, INMATE), true);
});

test("beaming everywhere else in the city is untouched", () => {
  assert.strictEqual(mayBeamTo("plaza", -24.65, VISITOR), true);
  assert.strictEqual(mayBeamTo("mall", -1000, VISITOR), true);
});

test("a missing standing does not buy a beam into the cells", () => {
  assert.strictEqual(mayBeamTo(JAIL_SLUG, -24.65, null), false);
  assert.strictEqual(mayBeamTo(JAIL_SLUG, -24.65, undefined), false);
});

test("exactly on the boundary is the gallery side, not the cells", () => {
  assert.strictEqual(mayBeamTo(JAIL_SLUG, JAIL_CELL_BOUNDARY_Z, VISITOR), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
