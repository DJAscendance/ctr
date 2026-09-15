/**
 * Every club-door redirect must carry the club's real id.
 *
 * WHAT IS BEING GUARDED. Three membership gates in `main.ts` turn somebody away from a
 * private club and send them to that club's door: the club world itself, its message
 * board, and its inbox. All three build the same URL from the place they just fetched.
 *
 * The inbox one was written with double quotes - `"/clubdoor/${Data.place.id}"` - so the
 * `${...}` was never interpolated. A non-member opening a private club's inbox was pushed
 * to the 26-character literal path `/clubdoor/${Data.place.id}`, which the route table
 * happily matches as a club door whose id is the text `${Data.place.id}`. The page then
 * asks the API for a club with that id and shows nothing. The two sibling gates beside it
 * used backticks and worked, which is what kept it hidden.
 *
 * HOW IT IS PROVED. The suite reads the REAL `main.ts`, pulls out every argument actually
 * passed to `redirectLate(...)`, and EVALUATES it against a place with a real numeric id.
 * What comes back must be that id's club door - not source text, not a placeholder. Each
 * result is then resolved through the REAL router to confirm the id survives as a param.
 *
 * Reading the source for backticks would not satisfy this; the produced URL is asserted.
 */
import assert from "assert";
import * as fs from "fs";
import * as path from "path";

import { SRC, buildAppRouter } from "./router-harness";

let passed = 0;
let failed = 0;

function test(name: string, body: () => void): Promise<void> {
  return Promise.resolve()
    .then(body)
    .then(() => {
      passed += 1;
      console.log(`  ok   ${name}`);
    })
    .catch((error: Error) => {
      failed += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${error.message}`);
    });
}

/** A place standing in for the one the guard fetched, with an id nothing else can produce. */
const PLACE = { place: { id: 4242 } };
const ITS_DOOR = "/clubdoor/4242";

interface Redirect {
  /** The route family whose membership gate this redirect belongs to, e.g. "/inbox/". */
  gate: string;
  /** The argument exactly as written in main.ts. */
  source: string;
  /** What that argument evaluates to for PLACE. */
  url: string;
}

/**
 * Every `redirectLate(...)` CALL in main.ts - not the declaration - with the route family
 * it guards, taken from the nearest `to.fullPath.includes("...")` above it.
 */
function redirectsIn(source: string): Redirect[] {
  const found: Redirect[] = [];
  const call = /redirectLate\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(source)) !== null) {
    const before = source.slice(0, match.index);
    if (/function\s+$/.test(before)) continue;
    const gates = before.match(/to\.fullPath\.includes\("([^"]+)"\)/g) || [];
    const last = gates[gates.length - 1] || "";
    const argument = match[1].trim();
    found.push({
      gate: (last.match(/"([^"]+)"/) || [])[1] || "(none)",
      source: argument,
      // eslint-disable-next-line no-new-func
      url: String(new Function("Data", `return ${argument};`)(PLACE)),
    });
  }
  return found;
}

async function run(): Promise<void> {
  const source = fs.readFileSync(path.join(SRC, "main.ts"), "utf8");
  const redirects = redirectsIn(source);

  console.log("\n1. THE THREE MEMBERSHIP GATES");

  await test("main.ts still turns members away at 3 gates", () => {
    assert.strictEqual(
      redirects.length, 3, `redirects found: ${JSON.stringify(redirects.map(r => r.source))}`,
    );
  });

  for (const gate of ["/club/", "/messageboard/", "/inbox/"]) {
    await test(`the "${gate}" gate redirects to the club's own door`, () => {
      const redirect = redirects.find(r => r.gate === gate);
      assert.ok(redirect, `no redirect guards "${gate}": ${JSON.stringify(redirects)}`);
      assert.strictEqual(
        (redirect as Redirect).url, ITS_DOOR,
        `"${gate}" redirects to ${JSON.stringify((redirect as Redirect).url)} `
        + `from source ${JSON.stringify((redirect as Redirect).source)}`,
      );
    });
  }

  console.log("\n2. NO REDIRECT SHIPS ITS OWN SOURCE TEXT");

  for (const redirect of redirects) {
    await test(`the "${redirect.gate}" gate's URL holds no uninterpolated \${...}`, () => {
      assert.ok(
        !redirect.url.includes("${"),
        `"${redirect.gate}" produced the literal ${JSON.stringify(redirect.url)}`,
      );
    });
  }

  console.log("\n3. THE PRODUCED URLS RESOLVE TO THE RIGHT DOOR");

  const router = buildAppRouter();

  for (const redirect of redirects) {
    await test(`the "${redirect.gate}" gate's URL resolves to club 4242's door`, () => {
      const resolved = router.resolve(redirect.url);
      assert.strictEqual(resolved.name, "club-door", `matched ${String(resolved.name)}`);
      assert.strictEqual(resolved.params.id, "4242", `id param ${String(resolved.params.id)}`);
    });
  }

  // The control that states the defect's cost: the broken form is not a dead link the
  // router rejects, it is a club door standing on a placeholder id. Nothing would have
  // thrown; the citizen would simply have seen an empty door.
  await test("the uninterpolated form would have opened a door with a placeholder id", () => {
    const resolved = router.resolve("/clubdoor/${Data.place.id}");
    assert.strictEqual(resolved.name, "club-door", `matched ${String(resolved.name)}`);
    assert.notStrictEqual(resolved.params.id, "4242", "the broken form somehow carried the id");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
