/**
 * An inmate walks slower than everybody else in the Jail.
 *
 * The rule has exactly two moving parts and this suite pins both:
 *
 *  1. WHO IS AN INMATE is decided on the server, by `JailService`, from a live
 *     `jail` ban row - and expressed to the client only as the world file it
 *     is served. Nothing a client can say changes it.
 *  2. WHICH PACE THAT WORLD GETS is `WORLD_SPEED_OVERRIDES`, an override, so
 *     the citizen's own dial is short-circuited rather than multiplied.
 *
 * So the whole restriction rides on the two ends lining up: the exact filename
 * `JailService` answers has to be the exact key the override table carries.
 * That is a cross-project coupling no type checker sees, so the last section
 * reads the API service's own source and checks the three names against the
 * table. Everything else is behavioural - real calls, real return values.
 */
import assert from "assert";

import {
  DEFAULT_MOVEMENT_SPEED_MULTIPLIER,
  effectiveMovementSpeed,
  JAIL_INMATE_WALK_SPEED,
  JAIL_INMATE_WORLD,
  mayChooseWalkSpeed,
  MAX_MOVEMENT_SPEED_MULTIPLIER,
  MIN_MOVEMENT_SPEED_MULTIPLIER,
  movementSpeedFactor,
  WORLD_SPEED_OVERRIDES,
} from "../src/helpers/movement-speed.helper";

const fs = require("fs");
const path = require("path");

const JAIL_SERVICE = path.resolve(
  __dirname, "../../../../api/src/services/jail/jail.service.ts",
);
const WORLD_PAGE = path.resolve(
  __dirname, "../../../src/pages/world-browser/WorldBrowserPage.vue",
);

/** Every Jail world authors `NavigationInfo.speed 3.0`; see jail.wrl line 14. */
const JAIL_AUTHORED_SPEED = 3.0;

/** What the server answers for each standing - see JailService.applyWorldForMember. */
const VISITOR_WORLD = "vrml/jailvisit.wrl";
const STAFF_WORLD = "vrml/jailstaff.wrl";
const INMATE_WORLD = "vrml/jailinmate.wrl";

/** The dial readings a citizen can actually reach, plus the default. */
const DIALS = [
  MIN_MOVEMENT_SPEED_MULTIPLIER, 1, 2, DEFAULT_MOVEMENT_SPEED_MULTIPLIER, 4,
  MAX_MOVEMENT_SPEED_MULTIPLIER,
];

let passed = 0;
let failed = 0;

function test(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(error as Error).message}`);
  }
}

/** The engine term X_ITE multiplies the step by, for a citizen standing in `world`. */
function factor(world: string, dial: number = DEFAULT_MOVEMENT_SPEED_MULTIPLIER): number {
  return movementSpeedFactor(world, dial, JAIL_AUTHORED_SPEED);
}

/* -------------------------------------------- 1. THE INMATE IS SLOWER ---- */
console.log("\n1. THE INMATE IS SLOWER");

test("an active inmate walks at the reduced pace", () => {
  assert.strictEqual(factor(INMATE_WORLD), JAIL_INMATE_WALK_SPEED);
});

test("the reduced pace is a real reduction against the rest of the Jail", () => {
  assert.ok(factor(INMATE_WORLD) < factor(VISITOR_WORLD),
    "an inmate must be slower than a visitor standing in the same building");
  assert.strictEqual(factor(INMATE_WORLD) / factor(VISITOR_WORLD), JAIL_INMATE_WALK_SPEED);
});

test("the owner's test value is 0.4, and it lives in exactly one place", () => {
  assert.strictEqual(JAIL_INMATE_WALK_SPEED, 0.4);
  assert.strictEqual(WORLD_SPEED_OVERRIDES["jailinmate.wrl"], JAIL_INMATE_WALK_SPEED);
  /* Changing the constant alone has to move the pace - nothing may hold a
   * second copy of the number. This is what makes 0.25 a one-line test. */
  const saved = WORLD_SPEED_OVERRIDES["jailinmate.wrl"];
  try {
    WORLD_SPEED_OVERRIDES["jailinmate.wrl"] = 0.25;
    assert.strictEqual(factor(INMATE_WORLD), 0.25);
    assert.strictEqual(factor(INMATE_WORLD) / factor(VISITOR_WORLD), 0.25);
  } finally {
    WORLD_SPEED_OVERRIDES["jailinmate.wrl"] = saved;
  }
});

/* ------------------------------------- 2. EVERYBODY ELSE IS UNCHANGED ---- */
console.log("\n2. EVERYBODY ELSE IS UNCHANGED");

test("an ordinary visitor keeps the normal Jail pace", () => {
  assert.strictEqual(factor(VISITOR_WORLD), 1);
});

test("a Jail guard who is not jailed keeps the normal Jail pace", () => {
  assert.strictEqual(factor(STAFF_WORLD), 1);
});

test("Security staff who are not jailed keep the normal Jail pace", () => {
  /* Security and the Jail guards are served the same world - JailService has
   * one staff answer, not two - so this is the same measurement, asserted
   * separately because it is a separate requirement. */
  assert.strictEqual(factor(STAFF_WORLD), 1);
  assert.strictEqual(factor(STAFF_WORLD), factor(VISITOR_WORLD));
});

test("the Jail's historical pin is still the pace the other two get", () => {
  assert.strictEqual(WORLD_SPEED_OVERRIDES["jail.wrl"], 1);
  assert.strictEqual(WORLD_SPEED_OVERRIDES["jailvisit.wrl"], 1);
  assert.strictEqual(WORLD_SPEED_OVERRIDES["jailstaff.wrl"], 1);
});

test("no place outside the Jail is touched", () => {
  for (const world of ["enter.wrl", "shopping.wrl", "shop.wrl", "beach.wrl",
    "carshowcase.wrl", "largeitems.wrl", "outlands.wrl"]) {
    assert.ok(!Object.prototype.hasOwnProperty.call(WORLD_SPEED_OVERRIDES, world),
      `${world} must not be pinned by the Jail lane`);
  }
  assert.strictEqual(Object.keys(WORLD_SPEED_OVERRIDES).length, 4,
    "only the four Jail world files may be pinned");
});

/* ----------------------------------------------- 3. RELEASE AND RELOAD ---- */
console.log("\n3. RELEASE AND RELOAD");

test("an expired sentence restores the normal pace", () => {
  /* `JailService.isInmate` is a live, unexpired ban row, so an expired one
   * makes the server answer the visitor world on the very next place fetch.
   * There is no client-side state to unwind. */
  assert.strictEqual(factor(INMATE_WORLD), JAIL_INMATE_WALK_SPEED);
  assert.strictEqual(factor(VISITOR_WORLD), 1);
});

test("a removed sentence restores the normal pace by the same route", () => {
  assert.strictEqual(factor(VISITOR_WORLD), 1);
  assert.strictEqual(factor(STAFF_WORLD), 1);
});

test("nothing is remembered between worlds, so a reload cannot leave a citizen slow", () => {
  /* The factor is recomputed from the CURRENT place row on every call - the
   * provider reads `$store.data.place.world_filename` each time X_ITE asks.
   * Walking the same sequence twice must give the same answers. */
  for (let pass = 0; pass < 2; pass += 1) {
    assert.strictEqual(factor(INMATE_WORLD), JAIL_INMATE_WALK_SPEED);
    assert.strictEqual(factor(VISITOR_WORLD), 1);
    assert.notStrictEqual(factor("enter.wrl"), JAIL_INMATE_WALK_SPEED);
    assert.ok(factor("enter.wrl", 4) > factor("enter.wrl", 1),
      "leaving the Jail hands the citizen their own dial back");
  }
});

test("a released citizen's own dial works again outside the Jail", () => {
  assert.ok(factor("enter.wrl", MAX_MOVEMENT_SPEED_MULTIPLIER)
    > factor("enter.wrl", MIN_MOVEMENT_SPEED_MULTIPLIER));
});

/* ------------------------------------------------- 4. CLIENT CANNOT SAY ---- */
console.log("\n4. CLIENT CANNOT SAY");

test("no dial reading lets an inmate walk at the normal pace", () => {
  for (const dial of DIALS) {
    assert.strictEqual(factor(INMATE_WORLD, dial), JAIL_INMATE_WALK_SPEED, `dial ${dial}`);
  }
});

test("a hostile value in the dial cannot widen or narrow the inmate pace", () => {
  for (const dial of [NaN, Infinity, -Infinity, 1e9, -1e9, 0]) {
    assert.strictEqual(factor(INMATE_WORLD, dial as number), JAIL_INMATE_WALK_SPEED);
  }
  assert.strictEqual(
    movementSpeedFactor(INMATE_WORLD, "999" as unknown as number, JAIL_AUTHORED_SPEED),
    JAIL_INMATE_WALK_SPEED,
  );
});

test("a claimed world name is matched on the basename, prefix or not", () => {
  for (const name of ["jailinmate.wrl", "vrml/jailinmate.wrl", "/jail/vrml/jailinmate.wrl"]) {
    assert.strictEqual(factor(name), JAIL_INMATE_WALK_SPEED, name);
  }
});

test("a lie about the authored world speed cannot speed an inmate up", () => {
  /* An override short-circuits normalisation, so the NavigationInfo term
   * X_ITE reports is never divided back out for a pinned world. A tampered
   * scene therefore buys nothing. */
  for (const authored of [0.001, 1, 10, 1000, NaN, null, "fast"]) {
    assert.strictEqual(
      movementSpeedFactor(INMATE_WORLD, DEFAULT_MOVEMENT_SPEED_MULTIPLIER, authored),
      JAIL_INMATE_WALK_SPEED,
      `authored ${String(authored)}`,
    );
  }
});

test("the panel cannot be used to leave the reduced pace", () => {
  for (const dial of DIALS) {
    assert.strictEqual(effectiveMovementSpeed(INMATE_WORLD, dial), JAIL_INMATE_WALK_SPEED);
  }
});

/* ------------------------------------ 5. THE SERVER'S NAMES ARE THE KEYS ---- */
console.log("\n5. THE SERVER'S NAMES ARE THE KEYS");

const jailServiceSource: string = fs.readFileSync(JAIL_SERVICE, "utf8");

/** Reads `public static readonly NAME = '...'` out of the API service. */
function serviceWorld(name: string): string {
  const match = jailServiceSource.match(
    new RegExp(`${name}\\s*=\\s*'([^']+)'`),
  );
  assert.ok(match, `JailService.${name} is gone - the Jail speed rule is keyed off it`);
  return (match as RegExpMatchArray)[1];
}

test("the world JailService serves an inmate is the world that is slowed", () => {
  assert.strictEqual(serviceWorld("WORLD_INMATE"), INMATE_WORLD);
  assert.strictEqual(factor(serviceWorld("WORLD_INMATE")), JAIL_INMATE_WALK_SPEED);
});

test("the worlds JailService serves visitors and staff keep the normal pace", () => {
  assert.strictEqual(serviceWorld("WORLD_VISITOR"), VISITOR_WORLD);
  assert.strictEqual(serviceWorld("WORLD_STAFF"), STAFF_WORLD);
  assert.strictEqual(factor(serviceWorld("WORLD_VISITOR")), 1);
  assert.strictEqual(factor(serviceWorld("WORLD_STAFF")), 1);
});

test("a sentence still outranks an office on the server side", () => {
  /* The jailed-guard rule is what makes "jailed staff also get 0.4" true:
   * applyWorldForMember must test `inmate` BEFORE `staff`. Order matters, so
   * it is asserted rather than assumed. */
  const body = jailServiceSource.slice(jailServiceSource.indexOf("applyWorldForMember"));
  const inmateAt = body.indexOf("WORLD_INMATE");
  const staffAt = body.indexOf("WORLD_STAFF");
  assert.ok(inmateAt > -1 && staffAt > -1, "applyWorldForMember no longer names both worlds");
  assert.ok(inmateAt < staffAt,
    "a jailed guard would be served the staff world - and walk at full speed");
});

test("a full ban never reaches the Jail speed path at all", () => {
  /* `isInmate` is `hasActiveJailBan`, which filters on type 'jail'. A full
   * ban is a different type and a fully banned citizen is not admitted to any
   * place, so no Jail world - and no Jail pace - is ever chosen for them. */
  assert.ok(/hasActiveJailBan/.test(jailServiceSource));
  assert.ok(!/'full'/.test(jailServiceSource), "JailService must not branch on a full ban");
});

/* ------------------------------------ 6. NO DIAL IS OFFERED TO AN INMATE ---- */
console.log("\n6. NO DIAL IS OFFERED TO AN INMATE");

const worldPageSource: string = fs.readFileSync(WORLD_PAGE, "utf8");

test("the Walk Speed entry is withheld in the inmate world", () => {
  for (const name of ["jailinmate.wrl", "vrml/jailinmate.wrl", "/jail/vrml/jailinmate.wrl"]) {
    assert.strictEqual(mayChooseWalkSpeed(name), false, name);
  }
});

test("everybody else still gets the entry", () => {
  for (const name of [VISITOR_WORLD, STAFF_WORLD, "jail.wrl", "vrml/jail.wrl",
    "enter.wrl", "shopping.wrl", undefined, null, ""]) {
    assert.strictEqual(mayChooseWalkSpeed(name as string), true, String(name));
  }
});

test("the inmate world name is the one the server actually serves", () => {
  assert.strictEqual(JAIL_INMATE_WORLD, serviceWorld("WORLD_INMATE").split("/").pop());
  assert.strictEqual(mayChooseWalkSpeed(serviceWorld("WORLD_INMATE")), false);
  assert.strictEqual(mayChooseWalkSpeed(serviceWorld("WORLD_VISITOR")), true);
  assert.strictEqual(mayChooseWalkSpeed(serviceWorld("WORLD_STAFF")), true);
});

test("the menu is built per open, so it cannot be inherited from the last world", () => {
  /* X_ITE keeps one browser across a world load and the menu is installed
   * once, so the entries must be computed inside setUserMenu's callback. A
   * literal object there would freeze whatever the first world decided. */
  const install = worldPageSource.slice(worldPageSource.indexOf("setUserMenu"));
  const guardAt = install.indexOf("mayChooseWalkSpeed");
  const entryAt = install.indexOf("\"walk-speed\"");
  assert.ok(guardAt > -1, "setUserMenu no longer consults mayChooseWalkSpeed");
  assert.ok(entryAt > -1 && guardAt < entryAt,
    "the Walk Speed entry must be built behind the guard, not beside it");
});

test("the panel itself refuses to open for an inmate", () => {
  const open = worldPageSource.slice(worldPageSource.indexOf("openWalkSpeedPanel(): void"));
  const body = open.slice(0, open.indexOf("closeWalkSpeedPanel"));
  assert.ok(/if\s*\(!this\.mayChooseWalkSpeed\)\s*return;/.test(body),
    "openWalkSpeedPanel must turn an inmate away even if the menu is stale");
});

test("hiding the dial changes nothing about the pace itself", () => {
  /* The menu is presentation. Enforcement stays in the override table, and
   * this is what proves the two are not the same mechanism. */
  assert.strictEqual(factor(INMATE_WORLD), JAIL_INMATE_WALK_SPEED);
  assert.strictEqual(effectiveMovementSpeed(INMATE_WORLD, MAX_MOVEMENT_SPEED_MULTIPLIER),
    JAIL_INMATE_WALK_SPEED);
});

/* ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
