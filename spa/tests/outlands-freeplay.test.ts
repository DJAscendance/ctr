/**
 * Pure-logic gate for Outlands free-play on the Beta architecture.
 *
 * Nothing here needs a browser, a socket or a GPU. Two kinds of fact are
 * proved:
 *
 *  1. THE SPA'S OWN RULES - the team a chosen avatar puts a citizen on, and the
 *     two translations the historical `battle` Script needs from the browser.
 *  2. THE WORLD'S OWN CONTRACT - read straight out of the shipped, gzipped
 *     `ne_game.wrl`. Ammunition, weapon order, key codes, event-mask bits,
 *     message channels and the respawn timing are asserted against the file
 *     that actually runs, so this gate cannot pass on a CTR reimplementation of
 *     the game, and it fails if somebody quietly edits historical evidence.
 *
 * The live two-client behaviour is `qa/outlands/tools/check-freeplay.js`.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import zlib from "zlib";

/* The module reads localStorage through try/catch, but the avatar-note tests
 * want a real one. Installed before the import so the module sees it. */
const store: { [k: string]: string } = {};
(global as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; },
};

import {
  OUTLANDS_TEAM_AVATARS,
  RED_TEAM,
  BLUE_TEAM,
  outlandsTeamOfFile,
  outlandsTeamOfAvatar,
  isOutlands,
  outlandsEntranceActive,
  blaxxunAvatarURLFor,
  blaxxunAvatarNameFor,
  rememberAvatarBeforeOutlands,
  avatarToRestoreAfterOutlands,
  forgetAvatarBeforeOutlands,
} from "../src/libs/outlands";
import { PresenceStore, presenceKey } from "../src/presence";
import { RemoteMemberRegistry } from "../src/remote-members";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const OUTLANDS_PLACE = { slug: "outlands" };
const PLAZA = { slug: "enter" };

/* The world exactly as it is served. Read once; every assertion below is a
 * search of this text rather than a copy of it. */
/* Compiled to tests/.compiled/tests/, so the SPA root is three levels up -
 * the same resolution the other source-reading suites use. */
const SPA = path.resolve(__dirname, "../../..");
const WORLD_FILE = path.join(SPA, "assets/worlds/ne_game/vrml/ne_game.wrl");
const worldBytes = fs.readFileSync(WORLD_FILE);
const world = zlib.gunzipSync(worldBytes).toString("latin1");

/* -------------------------------------------------------------------------
 * 1. THE FOUR CHOICES AND THEIR SIDES
 * ---------------------------------------------------------------------- */
console.log("\nOutlands free-play - the entrance choices");

test("the entrance offers exactly the four historical choices", () => {
  assert.deepStrictEqual(
    OUTLANDS_TEAM_AVATARS.map(a => a.filename),
    ["redm.wrl", "redf.wrl", "bluem.wrl", "bluef.wrl"],
  );
});

test("the Game Master avatar is not one of them", () => {
  assert.strictEqual(OUTLANDS_TEAM_AVATARS.some(a => a.filename === "gm.wrl"), false);
});

test("both red choices are team 1", () => {
  assert.strictEqual(outlandsTeamOfFile("redm.wrl"), RED_TEAM);
  assert.strictEqual(outlandsTeamOfFile("redf.wrl"), RED_TEAM);
  assert.strictEqual(RED_TEAM, 1);
});

test("both blue choices are team 2", () => {
  assert.strictEqual(outlandsTeamOfFile("bluem.wrl"), BLUE_TEAM);
  assert.strictEqual(outlandsTeamOfFile("bluef.wrl"), BLUE_TEAM);
  assert.strictEqual(BLUE_TEAM, 2);
});

test("the side is read off the file name, whatever path or query carries it", () => {
  assert.strictEqual(outlandsTeamOfFile("/assets/avatars/16/redm.wrl"), RED_TEAM);
  assert.strictEqual(
    outlandsTeamOfFile("http://www.cybertown.com/places/ne_game/vrml/avatars/bluef.wrl"),
    BLUE_TEAM,
  );
  assert.strictEqual(outlandsTeamOfFile("/assets/avatars/14/bluem.wrl?v=2"), BLUE_TEAM);
});

test("an ordinary avatar is on no side, and neither is the Game Master's", () => {
  assert.strictEqual(outlandsTeamOfFile("default.wrl"), 0);
  assert.strictEqual(outlandsTeamOfFile("gm.wrl"), 0);
  assert.strictEqual(outlandsTeamOfFile(""), 0);
  assert.strictEqual(outlandsTeamOfAvatar(null), 0);
  assert.strictEqual(outlandsTeamOfAvatar({}), 0);
});

test("the entrance stands in front of Outlands only, and only until a side is worn", () => {
  assert.strictEqual(isOutlands(OUTLANDS_PLACE), true);
  assert.strictEqual(isOutlands(PLAZA), false);
  assert.strictEqual(
    outlandsEntranceActive(OUTLANDS_PLACE, { avatar: { filename: "default.wrl" } }), true,
  );
  assert.strictEqual(
    outlandsEntranceActive(OUTLANDS_PLACE, { avatar: { filename: "redm.wrl" } }), false,
  );
  assert.strictEqual(
    outlandsEntranceActive(PLAZA, { avatar: { filename: "default.wrl" } }), false,
  );
});

test("the avatar worn before Outlands is remembered once and given back once", () => {
  forgetAvatarBeforeOutlands();
  rememberAvatarBeforeOutlands({ id: 7, filename: "jaz.wrl" });
  assert.strictEqual(avatarToRestoreAfterOutlands(), 7);
  // Switching sides must not overwrite the note with a team avatar.
  rememberAvatarBeforeOutlands({ id: 16, filename: "redm.wrl" });
  assert.strictEqual(avatarToRestoreAfterOutlands(), 7);
  forgetAvatarBeforeOutlands();
  assert.strictEqual(avatarToRestoreAfterOutlands(), 0);
  // A citizen who arrived already in uniform leaves no note at all.
  rememberAvatarBeforeOutlands({ id: 16, filename: "redm.wrl" });
  assert.strictEqual(avatarToRestoreAfterOutlands(), 0);
});

/* -------------------------------------------------------------------------
 * 2. THE TWO COMPATIBILITY TRANSLATIONS
 * ---------------------------------------------------------------------- */
console.log("\nOutlands free-play - the browser identity boundary");

test("set_team's five URLs are still the ones the world compares against", () => {
  for (const name of ["redm.wrl", "redf.wrl", "bluem.wrl", "bluef.wrl", "gm.wrl"]) {
    assert.ok(
      world.indexOf(`http://www.cybertown.com/places/ne_game/vrml/avatars/${name}`) > -1,
      `${name} is no longer one of set_team's comparisons`,
    );
  }
});

test("inside Outlands the browser reports the historical avatar URL", () => {
  assert.strictEqual(
    blaxxunAvatarURLFor(OUTLANDS_PLACE, "redm.wrl", "http://localhost/assets/avatars/16/redm.wrl"),
    "http://www.cybertown.com/places/ne_game/vrml/avatars/redm.wrl",
  );
  assert.strictEqual(
    blaxxunAvatarURLFor(OUTLANDS_PLACE, "bluef.wrl", "http://localhost/assets/avatars/13/bluef.wrl"),
    "http://www.cybertown.com/places/ne_game/vrml/avatars/bluef.wrl",
  );
});

test("the URL it answers with is one set_team actually matches", () => {
  for (const entry of OUTLANDS_TEAM_AVATARS) {
    const url = blaxxunAvatarURLFor(OUTLANDS_PLACE, entry.filename, "http://localhost/x.wrl");
    assert.ok(world.indexOf(`avatar == '${url}'`) > -1,
      `set_team has no comparison for ${url}`);
  }
});

test("outside Outlands, and for a non-team avatar, the real URL is untouched", () => {
  const real = "http://localhost/assets/avatars/1/default.wrl";
  assert.strictEqual(blaxxunAvatarURLFor(PLAZA, "redm.wrl", real), real);
  assert.strictEqual(blaxxunAvatarURLFor(OUTLANDS_PLACE, "default.wrl", real), real);
});

test("inside Outlands the browser's own name is the presence key", () => {
  const key = presenceKey(2, "tab-a");
  assert.strictEqual(blaxxunAvatarNameFor(OUTLANDS_PLACE, key, "testqa"), "2:tab-a");
});

test("outside Outlands it stays the username historical worlds display", () => {
  assert.strictEqual(blaxxunAvatarNameFor(PLAZA, presenceKey(2, "tab-a"), "testqa"), "testqa");
});

test("a citizen with no presence key yet is never named as somebody else", () => {
  assert.strictEqual(blaxxunAvatarNameFor(OUTLANDS_PLACE, "", "testqa"), "testqa");
});

/* -------------------------------------------------------------------------
 * 3. SAME-USERNAME SAFETY - the whole point of the presence key
 * ---------------------------------------------------------------------- */
console.log("\nOutlands free-play - two tabs of one member are two citizens");

/* The shooter's half of the historical Beamer, exactly as ne_game.wrl writes
 * it: `send_beamer(team + ray.hitPath[i].nickname)`. */
const sendBeamer = (team: number, nickname: string) => `${team}${nickname}`;

/* The receiver's half: `teamSent = parseInt(v.substring(0,1)); name =
 * v.substring(1,v.length); if(name == Browser.myAvatarName && teamSent != team)`. */
function receiveBeamer(wire: string, myName: string, myTeam: number): boolean {
  const teamSent = parseInt(wire.substring(0, 1), 10);
  const name = wire.substring(1, wire.length);
  return name === myName && teamSent !== myTeam;
}

function twoTabsOfOneMember() {
  const store2 = new PresenceStore();
  const registry = new RemoteMemberRegistry(() => ({ memberId: 9, presenceId: "shooter" }));
  registry.attach(store2);
  const shared = { username: "twintabs", avatar: { directory: "16", filename: "redm.wrl" } };
  store2.reconcile([
    { memberId: 9, presenceId: "shooter", socketId: "s0", ...shared },
    { memberId: 4, presenceId: "tab-a", socketId: "s1", pos: [0, 0, 0], ...shared },
    { memberId: 4, presenceId: "tab-b", socketId: "s2", pos: [5, 0, 0], ...shared },
  ] as any);
  const nodeA = { id: "wrapper-a" };
  const nodeB = { id: "wrapper-b" };
  registry.bindRemoteNode(presenceKey(4, "tab-a"), nodeA);
  registry.bindRemoteNode(presenceKey(4, "tab-b"), nodeB);
  return { registry, nodeA, nodeB };
}

test("one member with two tabs is two remote citizens, not one", () => {
  const { registry } = twoTabsOfOneMember();
  assert.strictEqual(registry.listRemoteMembers().length, 2);
  assert.strictEqual(registry.remoteMembersForUsername("twintabs").length, 2);
});

test("each wrapper node resolves to its own presence", () => {
  const { registry, nodeA, nodeB } = twoTabsOfOneMember();
  assert.strictEqual(registry.remoteMemberForNode(nodeA)!.key, "4:tab-a");
  assert.strictEqual(registry.remoteMemberForNode(nodeB)!.key, "4:tab-b");
});

test("a Beamer shot at one tab names that tab and only that tab", () => {
  const { registry, nodeA } = twoTabsOfOneMember();
  const hit = registry.remoteMemberForNode(nodeA)!;
  const wire = sendBeamer(1, hit.key);
  assert.strictEqual(receiveBeamer(wire, "4:tab-a", 2), true);
  assert.strictEqual(receiveBeamer(wire, "4:tab-b", 2), false);
});

test("NEGATIVE CONTROL: naming by username would have beamed both tabs", () => {
  const { registry, nodeA } = twoTabsOfOneMember();
  const hit = registry.remoteMemberForNode(nodeA)!;
  const wire = sendBeamer(1, hit.username);
  assert.strictEqual(receiveBeamer(wire, "twintabs", 2), true);
  assert.strictEqual(receiveBeamer(wire, "twintabs", 2), true);
});

test("a teammate is never beamed, whichever tab is named", () => {
  const { registry, nodeA } = twoTabsOfOneMember();
  const wire = sendBeamer(1, registry.remoteMemberForNode(nodeA)!.key);
  assert.strictEqual(receiveBeamer(wire, "4:tab-a", 1), false);
});

test("world geometry resolves to no citizen at all", () => {
  const { registry } = twoTabsOfOneMember();
  assert.strictEqual(registry.remoteMemberForNode({ id: "a rock" }), undefined);
  assert.strictEqual(registry.remoteMemberForNode(null), undefined);
});

test("a citizen who leaves takes their target binding with them", () => {
  const { registry, nodeA } = twoTabsOfOneMember();
  registry.removeRemoteMember(presenceKey(4, "tab-a"));
  assert.strictEqual(registry.remoteMemberForNode(nodeA), undefined);
  assert.strictEqual(registry.listRemoteMembers().length, 1);
});

test("a world change drops every target binding", () => {
  const { registry, nodeA, nodeB } = twoTabsOfOneMember();
  assert.deepStrictEqual(registry.clearRemoteMembers(), { cleared: 2 });
  assert.strictEqual(registry.remoteMemberForNode(nodeA), undefined);
  assert.strictEqual(registry.remoteMemberForNode(nodeB), undefined);
});

/* -------------------------------------------------------------------------
 * 4. THE WORLD'S OWN GAMEPLAY CONTRACT
 * ---------------------------------------------------------------------- */
console.log("\nOutlands free-play - the contract read out of ne_game.wrl");

test("the world is still shipped as gzip, not unpacked into the tree", () => {
  assert.strictEqual(worldBytes[0], 0x1f);
  assert.strictEqual(worldBytes[1], 0x8b);
});

test("the historical ammunition load is 100 / 7 / 4", () => {
  assert.ok(/b_ammo\s*=\s*100/.test(world), "the Beamer no longer loads 100");
  assert.ok(/r_ammo\s*=\s*7\b/.test(world), "the Repulsor no longer loads 7");
  assert.ok(/a_ammo\s*=\s*4\b/.test(world), "the AAPD no longer loads 4");
});

test("the ammunition dispensers restore the same three numbers", () => {
  const setAmmo = world.slice(world.indexOf("function set_ammo"));
  assert.ok(/'beamer'\s*\)\s*\{b_ammo = 100;\}/.test(setAmmo));
  assert.ok(/'repulsor'\)\{r_ammo = 7; \}/.test(setAmmo));
  assert.ok(/'aapd'\s*\)\s*\{a_ammo = 4; \}/.test(setAmmo));
});

test("respawn restores the same load and the opening weapon", () => {
  const beamTimer = world.slice(world.indexOf("function beamTimer"));
  const body = beamTimer.slice(0, beamTimer.indexOf("function receive_beamer"));
  assert.ok(/b_ammo = 100;/.test(body) && /r_ammo = 7;/.test(body) && /a_ammo = 4;/.test(body));
  assert.ok(/set_weapon\(1,t\);/.test(body), "respawn no longer hands back the Beamer");
  assert.ok(/isBeamed = false;/.test(body) && /fire_disable = false;/.test(body));
  assert.ok(/Browser\.setGravity\(true\);/.test(body), "respawn no longer restores gravity");
});

test("the opening weapon is the Beamer", () => {
  assert.ok(/set_weapon\(1,t\);\s*\n\s*teamTimer_changed/.test(world)
    || /set_weapon\(1,t\);/.test(world.slice(world.indexOf("function initialize"))),
  "initialize no longer selects weapon 1");
});

test("W cycles beamer -> repulsor -> AAPD -> beamer", () => {
  const change = world.slice(world.indexOf("function changeWeapon"));
  const body = change.slice(0, change.indexOf("//####"));
  assert.ok(/'beamer'\)\{set_weapon\(2,t\); return;\}/.test(body));
  assert.ok(/'repulsor'\)\{set_weapon\(3,t\); return;\}/.test(body));
  assert.ok(/'aapd'\)\{set_weapon\(1,t\); return;\}/.test(body));
});

test("the historical key codes are D fire, W weapon, A pan", () => {
  assert.ok(/keyCode == 68\)\s*\{fire\(0,t\);\}/.test(world), "D no longer fires");
  assert.ok(/keyCode == 87\)\s*\{changeWeapon\(\);\}/.test(world), "W no longer changes weapon");
  assert.ok(/keyCode == 65\)\s*\{Browser\.setNavigationMode\('PAN'\);\}/.test(world),
    "A no longer engages PAN");
  assert.ok(/keyup'\s*&& e\.keyCode == 65\)\s*\{Browser\.setNavigationMode\('WALK'\);\}/.test(world),
    "releasing A no longer returns to WALK");
});

test("the world asks for browser event bits 4, 5 and 6", () => {
  assert.ok(/m = m \| \(1<<5\) \| \(1<<6\) \| \(1<<4\);/.test(world),
    "the event mask the world builds has changed");
  assert.strictEqual((1 << 4) | (1 << 5) | (1 << 6), 112);
});

test("the world routes the browser's own events into its Script", () => {
  assert.ok(/Browser\.addRoute\(Browser,'event_changed',self,'onEvent'\);/.test(world));
  assert.ok(/Browser\.deleteRoute\(Browser,'event_changed',self,'onEvent'\);/.test(world),
    "shutdown no longer gives the route back");
});

test("the four free-play message channels are the historical ones", () => {
  for (const name of ["BeamerEvent", "RepulsorEvent", "AapdEvent", "BeamOutEvent"]) {
    assert.ok(world.indexOf(`SharedEvent{name "${name}"}`) > -1, `${name} is gone`);
  }
});

test("firing costs a round on every weapon", () => {
  const fire = world.slice(world.indexOf("function fire(v,t)"));
  const body = fire.slice(0, fire.indexOf("//####"));
  assert.ok(/b_ammo < 1\)\{return;\}\s*\n\s*b_ammo -= 1;/.test(body));
  assert.ok(/r_ammo < 1\)\{return;\}\s*\n\s*r_ammo -= 1;/.test(body));
  assert.ok(/a_ammo < 1\)\{return;\}\s*\n\s*a_ammo -= 1;/.test(body));
});

test("a shot names the person it hit, not the model it hit", () => {
  assert.ok(
    /if\(ray\.hitPath\[i\]\.getType\(\) == 'Avatar'\)\{send_beamer\(team \+ ray\.hitPath\[i\]\.nickname\);\}/
      .test(world),
    "fire() no longer walks the hit path for a person",
  );
});

test("the beam-out timer is the historical three tries of twelve seconds", () => {
  assert.ok(/DEF beamTimer TimeSensor\{cycleInterval 12 /.test(world),
    "the beam-out timer is no longer 12 seconds");
  assert.ok(/beamTimerIndex\+\+;\s*\n\s*if\(beamTimerIndex < 3\)\{/.test(world),
    "the beam-out timer no longer waits three times");
});

test("the team timer is the historical three seconds", () => {
  assert.ok(/DEF teamTimer TimeSensor\{cycleInterval 3 /.test(world));
});

/* -------------------------------------------------------------------------
 * 5. THE ONE CORRECTION, AND NOTHING ELSE
 * ---------------------------------------------------------------------- */
console.log("\nOutlands free-play - the AAPD comparator");

test("an enemy inside ten metres of an AAPD burst is beamed out", () => {
  const aapd = world.slice(world.indexOf("function receive_aapd"));
  const body = aapd.slice(0, aapd.indexOf("//####"));
  assert.ok(/if\(dist < 10\)\{/.test(body), "the ten-metre radius has changed");
  assert.ok(
    /if\(team == teamSent \|\| lastBeamTime \+ 10 > t\)\{return;\}/.test(body),
    "the AAPD still carries the inverted comparator: a clean citizen can never be beamed",
  );
  assert.strictEqual(
    /if\(team == teamSent \|\| lastBeamTime \+ 10 < t\)\{return;\}/.test(body), false,
    "the historical defect has been restored",
  );
});

test("the AAPD still refuses a teammate", () => {
  const aapd = world.slice(world.indexOf("function receive_aapd"));
  assert.ok(/team == teamSent \|\|/.test(aapd.slice(0, aapd.indexOf("//####"))));
});

test("the Beamer's own respawn-window rule is untouched", () => {
  assert.ok(
    /name == Browser\.myAvatarName && teamSent != team && lastBeamTime \+ 10 < t/.test(world),
    "receive_beamer's condition has been edited; only receive_aapd was corrected",
  );
});

test("no other historical Script defect was 'fixed' in the world file", () => {
  // Beta repairs blaxxun's tolerant Script semantics in bxx_script.js, not in
  // the evidence. These three omissions are the ones that shim exists for, and
  // they must still be present in the shipped source.
  assert.ok(/function set_team\(\)\s*\{/.test(world), "set_team gained a parameter list");
  assert.ok(/function changeWeapon\(\)\s*\{/.test(world), "changeWeapon gained a parameter list");
  assert.ok(/set_weapon\(1,t\);/.test(world), "initialize's free `t` was removed");
});

test("no HUD EXTERNPROTO was added; Beta registers the node type instead", () => {
  assert.strictEqual(/EXTERNPROTO\s+HUD/.test(world), false);
  assert.strictEqual(/PROTO\s+HUD/.test(world), false);
});

/* -------------------------------------------------------------------------
 * 6. WORLD CLEANUP WIRING
 * ---------------------------------------------------------------------- */
console.log("\nOutlands free-play - what the outgoing world gives back");

const read = (p: string) => fs.readFileSync(path.join(SPA, p), "utf8");
const PAGE = read("src/pages/world-browser/WorldBrowserPage.vue");
const EVENTS = read("src/libs/x_ite_mods/bxx_events.js");

test("the browser hands back the event mask and the event routes on request", () => {
  assert.ok(/b\.releaseBlaxxunWorldState = function \(\)/.test(EVENTS));
  assert.ok(/this\.browserEventRoutes_ = \[\]/.test(EVENTS), "the routes are not dropped");
  assert.ok(/this\.eventMask = 0/.test(EVENTS), "the event mask is not given back");
  assert.ok(/this\.blaxxunEventPool_ = null/.test(EVENTS),
    "the pooled event nodes are kept, and they belong to the scene that built them");
});

test("the DOM listeners are NOT dropped with the world; they belong to the canvas", () => {
  const release = EVENTS.slice(EVENTS.indexOf("releaseBlaxxunWorldState"));
  const body = release.slice(0, release.indexOf("removeBlaxxunEventDelivery"));
  assert.strictEqual(/removeEventListener/.test(body), false);
});

test("the page releases the outgoing world's browser state before the next load", () => {
  assert.ok(/releaseWorldScriptState\(browser\);/.test(PAGE));
  const start = PAGE.indexOf("async startX3D(");
  const load = PAGE.indexOf("browser.loadURL(", start);
  const release = PAGE.indexOf("this.releaseWorldScriptState(browser)", start);
  assert.ok(release > -1 && release < load,
    "the release happens after loadURL, so the new world's initialize would be undone");
});

test("leaving 3D altogether also releases it", () => {
  const unload = PAGE.slice(PAGE.indexOf("async unloadPlace("));
  const body = unload.slice(0, unload.indexOf("async joinPlace("));
  assert.ok(/replaceWorld\(null\);\s*\n\s*this\.releaseWorldScriptState\(browser\);/.test(body));
});

test("the entrance listener is taken off again when the page goes away", () => {
  assert.ok(/\$root\.\$on\("outlands-team-selected", this\.loadAndJoinPlace\)/.test(PAGE));
  assert.ok(/\$root\.\$off\("outlands-team-selected", this\.loadAndJoinPlace\)/.test(PAGE));
});

test("the remote node still wears the presence key, never the username", () => {
  assert.ok(/registerBlaxxunAvatar\(collision, key\)/.test(PAGE));
  assert.strictEqual(/registerBlaxxunAvatar\([^)]*username/.test(PAGE), false);
});

test("a citizen leaving Outlands is given their own avatar back", () => {
  assert.ok(/await this\.restoreAvatarAfterOutlands\(generation\);/.test(PAGE));
  const branch = PAGE.slice(PAGE.indexOf("if (isOutlands(this.$store.data.place))"));
  assert.ok(branch.indexOf("restoreAvatarAfterOutlands") > branch.indexOf("} else {"),
    "the restore is not on the not-Outlands branch");
});

// ---------------------------------------------------------------------------

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : err);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
