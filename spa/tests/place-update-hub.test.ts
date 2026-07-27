/**
 * Guards for the scoped place Update hubs.
 *
 * Two kinds of check live here.
 *
 * The first is pure logic over the shared tile catalogue: a tool may only appear
 * on a tier it belongs to, and only when the SERVER granted its capability. That
 * is what keeps the Colony, Neighborhood and Block hubs one component instead of
 * three drifting copies.
 *
 * The second is source inspection, in the style of place-information-render.test:
 * it pins the properties that would otherwise be easy to regress by editing a
 * template - that no structural colony control or place-tier Chat Access tile
 * exists at all, and that the tool bars decide visibility from the capability
 * endpoint rather than from a broad admin boolean.
 *
 * Neither kind is an access control. Authorization is server-side and is pinned
 * in api/src/services/place/place-update-hub.service.spec.ts.
 */
import assert from "assert";

import {
  HUB_TILES,
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
const ROUTES = path.join(SPA_SRC, "routes.ts");
const TOOLS = [
  path.join(SPA_SRC, "pages/world-browser/WorldBrowserTools.vue"),
  path.join(SPA_SRC, "pages/neighborhood/NeighborhoodTools.vue"),
  path.join(SPA_SRC, "pages/block/BlockTools.vue"),
];

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

const ALL_CAPABILITIES = HUB_TILES.map((tile) => tile.key);

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
    visibleTiles("colony", ["manage_lots", "check_images", "manage_background"]),
    [],
    "block-only tools must not render on a colony",
  );
  assert.deepStrictEqual(
    visibleTiles("hood", ["manage_lots", "check_images"]).map((t) => t.key),
    [],
    "lot and image tools must not render on a neighborhood",
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
      !ALL_CAPABILITIES.includes(key as never),
      `the catalogue must not offer '${key}' - the colony map's coordinates were `
        + "hard-coded in the server's own template and no role may edit them",
    );
  }
  // Granting every capability at once must still produce no such tile.
  const everything = visibleTiles("colony", ALL_CAPABILITIES);
  for (const tile of everything) {
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
      !ALL_CAPABILITIES.includes(key as never),
      `the catalogue must not offer '${key}' in this branch`,
    );
  }
});

test("no tile offers Chat Access outside homes", () => {
  for (const tile of HUB_TILES) {
    assert.ok(
      !/chat/i.test(tile.key) && !/chat/i.test(tile.label),
      `'${tile.key}' must not present chat access - place-tier chat has no backend`,
    );
  }
});

test("Access Rights is labelled as access and ownership, never as chat", () => {
  const tile = HUB_TILES.find((t) => t.key === "manage_access_rights");
  assert.ok(tile, "the access rights tile must exist");
  assert.strictEqual(tile!.label, "Access Rights");
  assert.ok(
    /leader|deput/i.test(tile!.description),
    "its description must say what it assigns, so it is not mistaken for chat",
  );
  assert.ok(!/chat/i.test(tile!.description));
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

test("child listing is offered at colony and neighborhood only", () => {
  assert.strictEqual(childListCapability("colony"), "list_neighborhoods");
  assert.strictEqual(childListCapability("hood"), "list_blocks");
  assert.strictEqual(childListCapability("block"), null);
});

/* --------------------------------------------------------- source inspection */

test("the hub renders tiles from the server's capability list", () => {
  const source = read(HUB_COMPONENT);
  assert.ok(
    source.includes("/update-hub"),
    "the hub must read capabilities from the server endpoint",
  );
  assert.ok(
    source.includes("visibleTiles"),
    "the hub must build its tiles through the shared catalogue",
  );
  assert.ok(
    !/can_admin/.test(source),
    "the hub must not fall back to a broad admin boolean",
  );
});

test("the hub refuses a place whose stored type is not the route's tier", () => {
  const source = read(HUB_COMPONENT);
  assert.ok(
    source.includes("hub.type !== this.expectedType"),
    "a /block/<hood id>/update style mismatch must be refused, not rendered",
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
      source.includes("hubAvailable"),
      `${path.basename(file)} must gate its admin cluster on that answer`,
    );
    assert.ok(
      source.includes("can('") || source.includes('can("'),
      `${path.basename(file)} must gate each button on its own capability`,
    );
  }
});

test("the tool bars keep Message to All, Inbox to All and Access Rights", () => {
  // These stay on the bar where they have always been. The hub carries them too,
  // so either route reaches them - but moving them off the bar is a regression.
  const expected: Array<[string, string[]]> = [
    [
      path.join(SPA_SRC, "pages/world-browser/WorldBrowserTools.vue"),
      ["colonyMessageToAll", "colonyInboxToAll", "worldAccessRights"],
    ],
    [
      path.join(SPA_SRC, "pages/neighborhood/NeighborhoodTools.vue"),
      ["neighborhoodMessageToAll", "neighborhoodInboxToAll", "neighborhoodAccessRights"],
    ],
    [
      path.join(SPA_SRC, "pages/block/BlockTools.vue"),
      ["blockMessageToAll", "blockInboxToAll", "blockaccessrights"],
    ],
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

test("the block tool bar keeps its Check Images button", () => {
  const source = read(path.join(SPA_SRC, "pages/block/BlockTools.vue"));
  assert.ok(
    source.includes("#/home/image-check"),
    "Check Images must stay on the block tool bar",
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
  const source = read(HUB_PAGE);
  assert.ok(
    source.includes("/place/${param}"),
    "a colony route param is a slug and must be resolved to a place id",
  );
  assert.ok(
    source.includes("Number.parseInt"),
    "numeric tiers must parse their id rather than pass a raw string through",
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
