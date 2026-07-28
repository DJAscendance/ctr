/**
 * Guards for the scoped place Update hubs.
 *
 * Three kinds of check live here.
 *
 * PLACEMENT. The largest group, and the reason this file grew: a control may be
 * authorized and still not belong on the Update page. Message to All, Inbox to
 * All, Access Rights and Check Images are permanent tool-bar buttons; message
 * board and inbox moderation are reached from their own windows; the Update
 * wizard's own screens are information, the child map and the background. These
 * tests assert WHERE each control lives, not merely that a route exists.
 *
 * CATALOGUE LOGIC. A tool may only appear on a tier it belongs to, and only when
 * the SERVER granted its capability. That is what keeps the Colony, Neighborhood
 * and Block hubs one component instead of three drifting copies.
 *
 * SOURCE INSPECTION, in the style of place-information-render.test: it pins the
 * properties that would otherwise be easy to regress by editing a template - that
 * the public Information window carries no editor, that no structural colony
 * control or place-tier chat tile exists at all, and that the tool bars decide
 * visibility from the capability endpoint rather than from a broad admin boolean.
 *
 * None of this is an access control. Authorization is server-side and is pinned
 * in api/src/services/place/place-update-hub.service.spec.ts.
 */
import assert from "assert";

import {
  CAPABILITY_PLACEMENT,
  HUB_PLACED_CAPABILITIES,
  HUB_TILES,
  UpdateCapability,
  childListCapability,
  tileHref,
  tileRoute,
  visibleTiles,
} from "../src/helpers/place-update-hub.helper";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const HUB_COMPONENT = path.join(SPA_SRC, "components/place/PlaceUpdateHub.vue");
const HUB_PAGE = path.join(SPA_SRC, "pages/place/PlaceUpdatePage.vue");
/**
 * The hub's loading, refusal and slug-resolution rules moved here when the hubs
 * were made to refresh on route changes; the component and page now delegate to
 * it. The assertions below follow that logic to its new home rather than
 * relaxing what they guard - the behaviour itself is exercised for real in
 * place-hub-route-refresh.test.
 */
const HUB_LOAD = path.join(SPA_SRC, "helpers/place-hub-load.helper.ts");
const INFORMATION_PAGE = path.join(SPA_SRC, "pages/Information.vue");
const ROUTES = path.join(SPA_SRC, "routes.ts");
const COLONY_TOOLS = path.join(SPA_SRC, "pages/world-browser/WorldBrowserTools.vue");
const HOOD_TOOLS = path.join(SPA_SRC, "pages/neighborhood/NeighborhoodTools.vue");
const BLOCK_TOOLS = path.join(SPA_SRC, "pages/block/BlockTools.vue");
const TOOLS = [COLONY_TOOLS, HOOD_TOOLS, BLOCK_TOOLS];

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

const ALL_CAPABILITIES = Object.keys(CAPABILITY_PLACEMENT) as UpdateCapability[];
const TILE_KEYS = HUB_TILES.map((tile) => tile.key);
const EVERY_TIER = ["colony", "hood", "block"] as const;

/* ---------------------------------------------------------------- placement */

test("every capability declares where its control lives", () => {
  for (const key of ALL_CAPABILITIES) {
    const entry = CAPABILITY_PLACEMENT[key];
    assert.ok(
      ["toolbar", "hub", "moderation-page"].includes(entry.placement),
      `${key} must declare a known placement`,
    );
    assert.ok(entry.where.length > 0, `${key} must name the surface that owns it`);
  }
});

test("only hub-placed capabilities have a tile", () => {
  for (const tile of HUB_TILES) {
    assert.strictEqual(
      CAPABILITY_PLACEMENT[tile.key].placement,
      "hub",
      `'${tile.key}' has a tile but is not placed in the hub`,
    );
  }
  for (const key of ALL_CAPABILITIES) {
    if (CAPABILITY_PLACEMENT[key].placement === "hub") continue;
    assert.ok(
      !TILE_KEYS.includes(key),
      `'${key}' lives on ${CAPABILITY_PLACEMENT[key].where} and must not also be `
        + "an Update hub tile - one action in two places",
    );
  }
});

test("Message to All is absent from every Update hub", () => {
  for (const tier of EVERY_TIER) {
    const shown = visibleTiles(tier, ALL_CAPABILITIES).map((t) => t.key);
    assert.ok(
      !shown.includes("message_to_all"),
      `Message to All must not be a tile on the ${tier} hub - it is a permanent `
        + "tool-bar button (CS 4.0 Group Message, bgroupmesa.gif)",
    );
  }
});

test("Inbox to All is absent from every Update hub", () => {
  for (const tier of EVERY_TIER) {
    const shown = visibleTiles(tier, ALL_CAPABILITIES).map((t) => t.key);
    assert.ok(
      !shown.includes("inbox_to_all"),
      `Inbox to All must not be a tile on the ${tier} hub`,
    );
  }
});

test("Owner/Access Rights is absent from every Update hub", () => {
  for (const tier of EVERY_TIER) {
    const shown = visibleTiles(tier, ALL_CAPABILITIES);
    assert.ok(
      !shown.some((t) => t.key === "manage_access_rights"),
      `Access Rights must not be a tile on the ${tier} hub - it is a permanent `
        + "tool-bar button (CS 4.0 baccess.gif, #ifdef rightsaccess)",
    );
    assert.ok(
      !shown.some((t) => /access rights|owner access/i.test(t.label)),
      `no ${tier} tile may be labelled as Access Rights`,
    );
  }
});

test("Moderate Messages is absent from every Update hub", () => {
  for (const tier of EVERY_TIER) {
    const shown = visibleTiles(tier, ALL_CAPABILITIES);
    assert.ok(
      !shown.some((t) => t.key === "moderate_messageboard"),
      `message-board moderation must not be a tile on the ${tier} hub`,
    );
    assert.ok(
      !shown.some((t) => /moderat/i.test(t.label)),
      `no ${tier} tile may present itself as moderation`,
    );
  }
});

test("Moderate Inbox is absent from every Update hub", () => {
  for (const tier of EVERY_TIER) {
    const shown = visibleTiles(tier, ALL_CAPABILITIES).map((t) => t.key);
    assert.ok(
      !shown.includes("moderate_inbox"),
      `inbox moderation must not be a tile on the ${tier} hub`,
    );
  }
});

test("Check Images is absent from the Block Update hub", () => {
  // The evidence puts it on the action bar, not in the wizard: it is
  // block/action.tmpl's third owner tool (edit?...&TPL=block/plist), while the
  // block wizard's own actions are wizardinfo, wizardpresent and wizardimage.
  const shown = visibleTiles("block", ALL_CAPABILITIES).map((t) => t.key);
  assert.ok(
    !shown.includes("check_images"),
    "Check Images belongs on the block tool bar, not inside the Update wizard",
  );
});

test("the Colony hub offers Information and the neighborhood listing only", () => {
  assert.deepStrictEqual(
    visibleTiles("colony", ALL_CAPABILITIES).map((t) => t.key),
    ["update_information"],
    "the colony wizard has one screen; the neighborhood list is not a tile",
  );
  assert.strictEqual(childListCapability("colony"), "list_neighborhoods");
});

test("the Neighborhood hub offers Information and Map Background only", () => {
  assert.deepStrictEqual(
    visibleTiles("hood", ALL_CAPABILITIES).map((t) => t.key),
    ["update_information", "manage_background"],
    "matches CS 4.0 neighbor wizardinfo + wizardimage; the block list is not a tile",
  );
  assert.strictEqual(childListCapability("hood"), "list_blocks");
});

test("the Block hub offers the three Block Wizard functions only", () => {
  assert.deepStrictEqual(
    visibleTiles("block", ALL_CAPABILITIES).map((t) => t.key),
    ["update_information", "manage_lots", "manage_background"],
    "matches CS 4.0 block wizardinfo + wizardpresent + wizardimage",
  );
  assert.strictEqual(childListCapability("block"), null);
});

test("HUB_PLACED_CAPABILITIES is derived from the placement table", () => {
  assert.deepStrictEqual(
    [...HUB_PLACED_CAPABILITIES].sort(),
    [
      "list_blocks",
      "list_neighborhoods",
      "manage_background",
      "manage_lots",
      "update_information",
    ],
    "the hub-placed set must match the server's copy in place-update-hub.service",
  );
});

/* ------------------------------------------------------------------ no chat */

test("no tile offers Chat Access or Chat Moderation at any tier", () => {
  for (const tile of HUB_TILES) {
    assert.ok(
      !/chat/i.test(tile.key)
        && !/chat/i.test(tile.label)
        && !/chat/i.test(tile.description),
      `'${tile.key}' must not present chat - neither place-tier Chat Access nor `
        + "Chat Moderation has an authoritative backend in CTR",
    );
  }
});

test("the Block hub contains no chat-related tile of any kind", () => {
  // A block is a map of lots you pass through, not a room. There is no block
  // chat, so there can be no block chat tool.
  for (const tile of visibleTiles("block", ALL_CAPABILITIES)) {
    assert.ok(
      !/chat/i.test(tile.key) && !/chat/i.test(tile.label),
      `the block hub must carry no chat tile, found '${tile.key}'`,
    );
  }
});

test("Colony and Neighborhood show no chat tile before a real backend exists", () => {
  // Deliberately asserted per tier and by capability name: a placeholder tile
  // wired to the message board or the inbox would satisfy a looser check.
  const chatKeys = [
    "chat_access",
    "manage_chat_access",
    "chat_moderation",
    "manage_chat_moderation",
    "moderate_chat",
  ];
  for (const tier of ["colony", "hood"] as const) {
    for (const key of chatKeys) {
      assert.ok(
        !ALL_CAPABILITIES.includes(key as UpdateCapability),
        `the catalogue must not offer '${key}' until it has a backend`,
      );
    }
    for (const tile of visibleTiles(tier, ALL_CAPABILITIES)) {
      assert.ok(
        !/chat/i.test(tile.label),
        `the ${tier} hub must not label a tile as chat, found '${tile.label}'`,
      );
      assert.ok(
        tile.hrefTemplate === undefined
          || !/messageboard|inbox/.test(tile.hrefTemplate),
        `'${tile.key}' must not be a chat tile backed by an unrelated endpoint`,
      );
    }
  }
});

/* --------------------------------------------------- public Information page */

test("the Information window offers the classic MANAGE button, not a text link", () => {
  const source = read(INFORMATION_PAGE);
  assert.ok(
    source.includes("data-testid=\"place-manage\""),
    "authorized staff must get a Manage button",
  );
  assert.ok(
    /class="btn-ui"[^>]*data-testid="place-manage"/.test(source)
      || /data-testid="place-manage"[\s\S]{0,80}MANAGE/.test(source),
    "it must be the classic MANAGE button",
  );
  assert.ok(
    !/Update\s*Info/i.test(source),
    "the green 'Update Info' text link must be gone",
  );
  assert.ok(
    !source.includes("text-chat underline"),
    "and must not come back as a green text link in another guise",
  );
});

test("the Manage button uses the same treatment as the Inbox and Message Board", () => {
  // One management control across the three windows, not three inventions.
  const source = read(INFORMATION_PAGE);
  const inbox = read(path.join(SPA_SRC, "pages/Inbox.vue"));
  const board = read(path.join(SPA_SRC, "pages/MessageBoard.vue"));
  for (const [name, other] of [["Inbox", inbox], ["MessageBoard", board]]) {
    assert.ok(
      other.includes("<button class=\"btn-ui\"") && other.includes("MANAGE"),
      `${name} should still use the btn-ui MANAGE button - update this test if it changed`,
    );
  }
  for (const marker of [
    "class=\"flex flex-row justify-center\"",
    "class=\"flex border-4 border-black justify-center\"",
    "<button class=\"btn-ui\"",
  ]) {
    assert.ok(
      inbox.includes(marker),
      `Inbox should still use '${marker}' - update this test if it changed`,
    );
    assert.ok(
      source.includes(marker),
      `the Information window must reuse the Inbox's '${marker}'`,
    );
  }
});

test("only staff the server authorizes see the Manage button", () => {
  const source = read(INFORMATION_PAGE);
  assert.ok(
    /v-if="canEditInformation"/.test(source),
    "the Manage button must be gated on the server's answer",
  );
  assert.ok(
    source.includes("information/can_edit"),
    "that answer must come from the can_edit endpoint",
  );
  assert.ok(
    source.includes("canEditInformation: false"),
    "it must default to hidden, so a failed or anonymous request shows nothing",
  );
  // The catch also drops out early when the response belongs to a superseded
  // route, so the assertion allows that guard between the catch and the reset -
  // but still requires the reset to be what the catch does.
  assert.ok(
    /catch \(e\) \{[^}]*this\.canEditInformation = false;/.test(source),
    "a failed can_edit request must hide the button rather than leaving it shown",
  );
  assert.ok(
    !/can_admin|\$store\.data\.user/.test(source),
    "it must not fall back to a client-side admin flag",
  );
});

test("the Manage button reaches the existing scoped editor", () => {
  const source = read(INFORMATION_PAGE);
  assert.ok(
    source.includes("name: \"place-update-information\""),
    "Manage must open the existing place information editor route",
  );
  assert.ok(
    read(ROUTES).includes("name: \"place-update-information\""),
    "and that route must be registered",
  );
});

test("the Information window edits nothing itself, and never the place name", () => {
  const source = read(INFORMATION_PAGE);
  for (const marker of ["$http.post", "$http.put", "$http.delete", "<form", "<textarea"]) {
    assert.ok(
      !source.includes(marker),
      `the Information window must not itself mutate anything ('${marker}')`,
    );
  }
  // The heading is interpolated, never bound to an input.
  assert.ok(
    source.includes("{{ placeName }}"),
    "the place name must render as static text",
  );
  assert.ok(
    !/v-model="placeName"/.test(source),
    "the place name must not be editable here",
  );
  // And the editor behind Manage writes exactly one field.
  const editor = read(path.join(SPA_SRC, "pages/place/PlaceUpdateInformationPage.vue"));
  const body = editor.slice(editor.indexOf("$http.put"), editor.indexOf("$http.put") + 200);
  assert.ok(
    body.includes("description: this.description"),
    "the editor must send the description",
  );
  assert.ok(
    !/name:\s*this\./.test(body),
    "the editor must not send a name - place.description is the only column it writes",
  );
});

test("the Information window renders Manage, heading, information, then staffing", () => {
  const source = read(INFORMATION_PAGE);
  const manage = source.indexOf("data-testid=\"place-manage\"");
  const heading = source.indexOf("Welcome to:");
  const description = source.indexOf("<place-information");
  const staffing = source.indexOf("Leader<br/>");
  for (const [name, index] of [
    ["Manage", manage],
    ["heading", heading],
    ["information", description],
    ["staffing", staffing],
  ]) {
    assert.ok(index > -1, `the ${name} block must be present`);
  }
  assert.ok(manage < heading, "Manage must sit above the place heading");
  assert.ok(heading < description, "the heading must sit above the information");
  assert.ok(
    description < staffing,
    "the information must sit above the staffing listing",
  );
});

test("homes get no Manage button and no place heading", () => {
  // A home is not a staff-managed place; its owner has a separate Update tool.
  const source = read(INFORMATION_PAGE);
  // Block layout, not a flex column. A flex column shrink-wrapped the centered
  // section to the width of the information text rather than the page, which is
  // what made the heading look off-centre.
  const PLACE_BRANCH =
    "<div class=\"h-full w-full bg-black\" style=\"padding: 10px\" v-else>";
  const homeBranch = source.slice(
    source.indexOf("v-if=\"$route.params.type === 'home'\""),
    source.indexOf(PLACE_BRANCH),
  );
  assert.ok(homeBranch.length > 0, "the home branch must still exist");
  assert.ok(
    !homeBranch.includes("place-manage"),
    "the home branch must not carry a Manage button",
  );
  assert.ok(
    !homeBranch.includes("Welcome to:"),
    "the home branch must not carry a place heading",
  );
  // Server side, the same answer: information is unsupported for home, shop,
  // storage and club, so can_edit is false and the button never appears.
  const INFORMATION_TYPES = ["block", "hood", "colony", "public"];
  const declared = source.match(/const INFORMATION_TYPES = \[([^\]]+)\]/);
  assert.ok(declared, "the supported list must be declared");
  for (const type of ["home", "shop", "storage", "club"]) {
    assert.ok(
      !declared![1].includes(`"${type}"`),
      `'${type}' must not be treated as a staff-managed information place`,
    );
  }
  for (const type of INFORMATION_TYPES) {
    assert.ok(
      declared![1].includes(`"${type}"`),
      `'${type}' must stay supported`,
    );
  }
});

/* ---------------------------------------------------------------- catalogue */

test("a tile appears only when the server granted its capability", () => {
  const none = visibleTiles("block", []);
  assert.strictEqual(none.length, 0, "no capabilities must mean no tiles");

  const one = visibleTiles("block", ["manage_lots"]);
  assert.deepStrictEqual(
    one.map((tile) => tile.key),
    ["manage_lots"],
    "only the granted capability should render",
  );
});

test("a tile never appears on a tier it does not belong to", () => {
  // Even if the capability were somehow granted at the wrong tier, the tile's
  // own `types` list keeps it off the page.
  assert.deepStrictEqual(
    visibleTiles("colony", ["manage_lots", "manage_background"]),
    [],
    "block-only tools must not render on a colony",
  );
  assert.deepStrictEqual(
    visibleTiles("hood", ["manage_lots"]).map((t) => t.key),
    [],
    "the lot tool must not render on a neighborhood",
  );
  assert.deepStrictEqual(
    visibleTiles("block", ["manage_background"]).map((t) => t.key),
    ["manage_background"],
    "the background tool does belong to a block",
  );
});

test("no tile exists for any colony structural map action", () => {
  const forbidden = [
    "create_neighborhood",
    "remove_neighborhood",
    "reposition_neighborhood",
    "edit_colony_map",
    "edit_map_coordinates",
    "upload_colony_map",
  ];
  for (const key of forbidden) {
    assert.ok(
      !ALL_CAPABILITIES.includes(key as UpdateCapability),
      `the catalogue must not offer '${key}' - the colony map's coordinates were `
        + "hard-coded in the server's own template and no role may edit them",
    );
  }
  // Granting every capability at once must still produce no such tile.
  for (const tile of visibleTiles("colony", ALL_CAPABILITIES)) {
    assert.ok(
      !/create|remove|delete|reposition|coordinate|image_map/.test(tile.key),
      `unexpected structural tile '${tile.key}'`,
    );
    assert.ok(
      !/add |remove |reposition |edit the map/i.test(tile.label),
      `unexpected structural label '${tile.label}'`,
    );
  }
});

test("no tile exists for block creation, withdrawal or deletion", () => {
  for (const key of ["create_block", "remove_block", "delete_block"]) {
    assert.ok(
      !ALL_CAPABILITIES.includes(key as UpdateCapability),
      `the catalogue must not offer '${key}' in this branch`,
    );
  }
});

test("every tile resolves a usable target for each tier it claims", () => {
  for (const tile of HUB_TILES) {
    for (const type of tile.types) {
      const context = { placeId: 42, type, slug: "yerbabuena" };
      if (tile.kind === "route") {
        const target = tileRoute(tile, context) as { name?: string } | null;
        assert.ok(
          target && typeof target.name === "string" && target.name.length > 0,
          `${tile.key} on ${type} must resolve a named route`,
        );
      } else {
        const href = tileHref(tile, context);
        assert.ok(
          typeof href === "string" && href.startsWith("#/"),
          `${tile.key} on ${type} must resolve a hash target`,
        );
        assert.ok(
          !href.includes("{placeId}"),
          `${tile.key} must substitute the place id, not emit the template`,
        );
      }
    }
  }
});

test("a route tile carries the place id under the parameter its route expects", () => {
  const information = HUB_TILES.find((t) => t.key === "update_information")!;
  const lots = HUB_TILES.find((t) => t.key === "manage_lots")!;
  const context = { placeId: 42, type: "block" as const, slug: null };

  assert.deepStrictEqual(
    tileRoute(information, context),
    { name: "place-update-information", params: { placeId: "42" } },
    "the information route keys its parameter placeId",
  );
  assert.deepStrictEqual(
    tileRoute(lots, context),
    { name: "blockwizard", params: { id: "42" } },
    "the block routes key their parameter id",
  );
});

test("every tile records whether it is classic or a modern composition", () => {
  for (const tile of HUB_TILES) {
    assert.ok(
      tile.origin === "classic" || tile.origin === "modern",
      `${tile.key} must record its origin`,
    );
    assert.ok(tile.description.length > 0, `${tile.key} must describe itself`);
  }
});

test("every tile uses the classic Update Wizard art the home page uses", () => {
  // The place hub is deliberately the same screen as "Update your Home", so it
  // draws from the same icon set rather than inventing a second vocabulary.
  const CLASSIC_ART = [
    "/assets/img/homes/updinfo.jpg",
    "/assets/img/homes/updright.jpg",
    "/assets/img/homes/updimage.jpg",
    "/assets/img/homes/updhome.jpg",
    "/assets/img/homes/updpers.jpg",
    "/assets/img/homes/updpet.jpg",
  ];
  for (const tile of HUB_TILES) {
    assert.ok(
      CLASSIC_ART.includes(tile.image),
      `${tile.key} uses '${tile.image}', which is not part of the classic set`,
    );
  }
});

/* --------------------------------------------------------- source inspection */

test("the hub renders tiles from the server's capability list", () => {
  const source = read(HUB_COMPONENT);
  assert.ok(
    read(HUB_LOAD).includes("/update-hub"),
    "the hub must read capabilities from the server endpoint",
  );
  assert.ok(
    source.includes("visibleTiles"),
    "the hub must build its tiles through the shared catalogue",
  );
  assert.ok(
    !/can_admin/.test(source) && !/can_admin/.test(read(HUB_LOAD)),
    "the hub must not fall back to a broad admin boolean",
  );
});

test("the hub refuses a place whose stored type is not the route's tier", () => {
  assert.ok(
    read(HUB_LOAD).includes("hub.type !== expectedType"),
    "a /block/<hood id>/update style mismatch must be refused, not rendered",
  );
});

test("the hub refuses an actor the server says has no wizard screen", () => {
  assert.ok(
    read(HUB_LOAD).includes("hub.canOpen !== true"),
    "holding only tool-bar or moderation capabilities must not open an empty hub",
  );
});

test("the hub states that the colony map layout is fixed", () => {
  const source = read(HUB_COMPONENT);
  assert.ok(
    source.includes('data-testid="colony-map-notice"'),
    "the colony hub must say why there is no structural control",
  );
});

test("the hub never renders a raw description as HTML", () => {
  // Place information has its own sanitized surface; the hub must not become a
  // second, unsanitized one.
  const source = read(HUB_COMPONENT);
  assert.ok(!/v-html/.test(source), "the hub must not use v-html");
});

test("each tool bar decides its buttons from the capability endpoint", () => {
  for (const file of TOOLS) {
    const source = read(file);
    assert.ok(
      source.includes("/update-hub"),
      `${path.basename(file)} must ask the server which tools apply`,
    );
    assert.ok(
      source.includes("can('") || source.includes('can("'),
      `${path.basename(file)} must gate each button on its own capability`,
    );
    assert.ok(
      source.includes("canOpen"),
      `${path.basename(file)} must gate Update on the server's canOpen answer`,
    );
  }
});

test("the permanent tool bars keep their original buttons and routes", () => {
  // These are where they have always been, and the hub does not carry them. If a
  // route disappears from a bar it has been lost, not moved.
  const expected: Array<[string, string[]]> = [
    [COLONY_TOOLS, ["colonyMessageToAll", "colonyInboxToAll", "worldAccessRights"]],
    [
      HOOD_TOOLS,
      ["neighborhoodMessageToAll", "neighborhoodInboxToAll", "neighborhoodAccessRights"],
    ],
    [BLOCK_TOOLS, ["blockMessageToAll", "blockInboxToAll", "blockaccessrights"]],
  ];
  for (const [file, routes] of expected) {
    const source = read(file);
    for (const route of routes) {
      assert.ok(
        source.includes(route),
        `${path.basename(file)} must still link ${route} from the tool bar`,
      );
    }
  }
});

test("the permanent tool bars keep their Information, Inbox and Messages buttons", () => {
  for (const file of TOOLS) {
    const source = read(file);
    assert.ok(
      source.includes("#/information/"),
      `${path.basename(file)} must keep its Information button`,
    );
    assert.ok(
      source.includes("#/messageboard/"),
      `${path.basename(file)} must keep its Messages button`,
    );
    assert.ok(
      source.includes("#/inbox/"),
      `${path.basename(file)} must keep its Inbox button`,
    );
  }
});

test("each tool bar keeps exactly one Update entry, pointing at its hub", () => {
  const expected: Array<[string, string]> = [
    [COLONY_TOOLS, "colonyUpdate"],
    [HOOD_TOOLS, "neighborhoodUpdate"],
    [BLOCK_TOOLS, "blockUpdate"],
  ];
  for (const [file, name] of expected) {
    const source = read(file);
    const occurrences = source.split(`name: '${name}'`).length - 1
      + source.split(`name: "${name}"`).length - 1;
    assert.strictEqual(
      occurrences,
      1,
      `${path.basename(file)} must link ${name} exactly once`,
    );
  }
});

test("the block tool bar keeps its Check Images button", () => {
  const source = read(BLOCK_TOOLS);
  // It opens in the block's own content area now rather than a detached popup,
  // but it is still a permanent TOOL BAR action - it must not migrate into the
  // Update hub, which carries only the Update Wizard's own screens.
  assert.ok(
    source.includes("name: 'blockImageCheck'"),
    "Check Images must stay on the block tool bar",
  );
  assert.ok(
    source.includes("can('check_images')"),
    "and stay gated on its own capability",
  );
});

test("Check Images is a real control, not a bare span", () => {
  const source = read(BLOCK_TOOLS);
  const check = source.slice(
    source.indexOf("can('check_images')") - 400,
    source.indexOf("can('check_images')") + 400,
  );
  assert.ok(
    /<router-link[^>]*name: 'blockImageCheck'/s.test(check),
    "Check must be a router-link, so it gets the cursor, hover, tab stop and "
      + "focus ring its neighbours get for free",
  );
  assert.ok(
    !/<span[^>]*check_images/s.test(source),
    "it must not go back to being a click-handled span",
  );
  assert.ok(
    !/opener\('#\/home\/image-check'\)/.test(source),
    "and must not reopen the detached popup window",
  );
});

test("the block image-check route reuses the moderation page in the block frame", () => {
  const routes = read(ROUTES);
  assert.ok(
    /name: "blockImageCheck"/.test(routes),
    "the block-scoped image check route must exist",
  );
  const blockRoute = routes.slice(
    routes.indexOf("path: \"/block/:id\""),
    routes.indexOf("path: \"/home/update\""),
  );
  assert.ok(
    /name: "blockImageCheck"/.test(blockRoute),
    "it must be a CHILD of /block/:id so it renders in the block's content area",
  );
  assert.ok(
    /component: HomeImageCheckPage,\s*name: "blockImageCheck"/.test(blockRoute),
    "and must reuse the existing moderation page rather than forking it",
  );
  // The standalone popup route stays: nothing else that linked to it changes.
  assert.ok(
    /name: "home-image-check"/.test(routes),
    "the standalone image-check route must remain for its own callers",
  );
});

test("the hub is presented as the home Update page is", () => {
  const hub = read(HUB_COMPONENT);
  const home = read(path.join(SPA_SRC, "pages/home/HomeUpdatePage.vue"));
  for (const marker of ["mx-auto max-w-2xl grid grid-cols-3 gap-4", "<strong>"]) {
    assert.ok(
      home.includes(marker),
      `the home Update page should still use '${marker}' - update this test if it changed`,
    );
    assert.ok(
      hub.includes(marker),
      `the place hub must match the home Update page's '${marker}'`,
    );
  }
  assert.ok(
    hub.includes(":src=\"tile.image\""),
    "the hub must render the classic tile art, like the home Update page",
  );
});

test("the three Update routes are registered and carry their tier", () => {
  const source = read(ROUTES);
  for (const [name, tier] of [
    ["colonyUpdate", "colony"],
    ["neighborhoodUpdate", "hood"],
    ["blockUpdate", "block"],
  ]) {
    assert.ok(source.includes(`name: "${name}"`), `${name} must be routed`);
    assert.ok(
      source.includes(`props: { tier: "${tier}" }`),
      `${name} must declare its tier in the route table, not infer it`,
    );
  }
});

test("the hub page resolves a colony slug rather than trusting it as an id", () => {
  const source = read(HUB_LOAD);
  assert.ok(
    source.includes("/place/${param}"),
    "a colony route param is a slug and must be resolved to a place id",
  );
  assert.ok(
    source.includes("Number.parseInt"),
    "numeric tiers must parse their id rather than pass a raw string through",
  );
  assert.ok(
    read(HUB_PAGE).includes("createPlaceResolver"),
    "the page must resolve through the shared controller",
  );
});

/* ------------------------------------------------------------------- runner */

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`  ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
process.exit(failures === 0 ? 0 : 1);
