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
  mayUseJailStaffDoor,
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

console.log("\n5. THE STAFF DOOR ON SCREEN");

// The door is drawn over the page, not inside the world, so authority alone is not enough
// to decide whether to draw it. In the 2D Jail it sat on top of the chat table and could
// do nothing, because there is no world to step into. Each case below fixes one fact and
// moves one other, so a failure names which of the four conditions broke.

const IN_3D_JAIL = { slug: JAIL_SLUG, view3d: true, force2d: false };

test("authorised staff in the 3D Jail are offered the door", () => {
  assert.strictEqual(mayUseJailStaffDoor(STAFF, IN_3D_JAIL), true);
});

test("the same staff member reading the 2D Jail is not", () => {
  assert.strictEqual(
    mayUseJailStaffDoor(STAFF, { slug: JAIL_SLUG, view3d: false, force2d: false }),
    false,
  );
});

test("a forced 2D fallback withdraws the door even with view3d still set", () => {
  assert.strictEqual(
    mayUseJailStaffDoor(STAFF, { slug: JAIL_SLUG, view3d: true, force2d: true }),
    false,
  );
});

test("both 2D facts at once still withdraw it", () => {
  assert.strictEqual(
    mayUseJailStaffDoor(STAFF, { slug: JAIL_SLUG, view3d: false, force2d: true }),
    false,
  );
});

test("staff standing in another world are not offered a Jail door", () => {
  assert.strictEqual(
    mayUseJailStaffDoor(STAFF, { slug: "plaza", view3d: true, force2d: false }),
    false,
  );
  assert.strictEqual(
    mayUseJailStaffDoor(STAFF, { slug: "mall", view3d: true, force2d: false }),
    false,
  );
  assert.strictEqual(
    mayUseJailStaffDoor(STAFF, { slug: "outlands", view3d: true, force2d: false }),
    false,
  );
});

test("a place the page has not answered yet is not the Jail", () => {
  assert.strictEqual(
    mayUseJailStaffDoor(STAFF, { slug: undefined, view3d: true, force2d: false }),
    false,
  );
  assert.strictEqual(
    mayUseJailStaffDoor(STAFF, { slug: null, view3d: true, force2d: false }),
    false,
  );
});

test("an ordinary citizen in the 3D Jail is never offered it", () => {
  assert.strictEqual(mayUseJailStaffDoor(VISITOR, IN_3D_JAIL), false);
});

test("an inmate in the 3D Jail is never offered it", () => {
  assert.strictEqual(mayUseJailStaffDoor(INMATE, IN_3D_JAIL), false);
});

test("a guard serving a sentence is still an inmate here", () => {
  assert.strictEqual(mayUseJailStaffDoor(JAILED_STAFF, IN_3D_JAIL), false);
});

test("a missing standing does not open the door", () => {
  assert.strictEqual(mayUseJailStaffDoor(null, IN_3D_JAIL), false);
  assert.strictEqual(mayUseJailStaffDoor(undefined, IN_3D_JAIL), false);
});

test("the door agrees with the authority rule it is built on", () => {
  // Every standing that fails hasJailStaffAuthority must also fail here, whatever the
  // place and view say -- the view conditions may only ever remove the door, never add it.
  for (const standing of [VISITOR, INMATE, JAILED_STAFF, null, undefined]) {
    assert.strictEqual(hasJailStaffAuthority(standing), false);
    assert.strictEqual(mayUseJailStaffDoor(standing, IN_3D_JAIL), false);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
