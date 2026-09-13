/**
 * The Mall Checker's X_ITE 16.2.0 contract.
 *
 * The defect this guards was not a bug in the Checker's code. `ObjectViewer`
 * reports load completion with a LoadSensor, and the preview wrapper it creates
 * that sensor into was declared `#VRML V2.0 utf8`. LoadSensor is an X3D node;
 * it does not exist in VRML97. X_ITE 4.x built it anyway, X_ITE 16.2.0 checks
 * the node's specification range against the scene's declared version and
 * throws, and the Checker reported that throw as
 *
 *   The 3D viewer could not load this object.
 *   Node type 'LoadSensor' does not match specification version in
 *   /assets/object/ObjectPreview.wrl
 *
 * over a model that had in fact loaded.
 *
 * Three kinds of assertion live here.
 *
 *   1. THE WRAPPER, run through X_ITE's own admission rule. The rule is
 *      reimplemented from `X3DExecutionContext.createNode` rather than grepped
 *      for, and applied to the real file on disk, so restoring the old header
 *      fails this suite the way it failed the browser. Negative controls prove
 *      the rule still rejects what it used to reject.
 *   2. THE ITEM BOUNDARY. A wrapper that is X3D grants uploaded objects
 *      nothing: they are still VRML97 and are still read as VRML97.
 *   3. PURE LOGIC for what the viewer does with a sensor's reports and how it
 *      describes a load that failed. No browser, no X_ITE, no GPU - the live
 *      gates under `mall-checker-qa/tools` prove the runtime behaviour.
 */
import assert from "assert";

import {
  LoadReportVerdict,
  describePreviewFailure,
  loadReportReader,
  viewerFailure,
} from "../src/components/mall/preview-load";

const fs = require("fs");
const path = require("path");

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

// Tests run from tests/.compiled/tests/, so three levels up is the spa root.
const SPA = path.resolve(__dirname, "../../..");

const WRAPPER = path.join(SPA, "assets/object/ObjectPreview.x3dv");
const VIEWER = path.join(SPA, "src/components/mall/ObjectViewer.vue");

/*
 * X_ITE's header grammar, copied from `Grammar.Header` in x_ite 16.2.0. Capture
 * group 2 is the version string, and it is what `VRMLParser.headerStatement`
 * hands to `X3DScene.setSpecificationVersion`.
 */
const HEADER = /^#(VRML|X3D) V(.*?) (utf8)\b(.*?)[\r\n]/;

/*
 * LoadSensor's specification range, as X_ITE 16.2.0 registers it:
 *
 *   LoadSensor -> component "Networking", level 3, containerField "children",
 *                 specification range from "3.0"
 *
 * `X3DExecutionContext.createNode` compares the scene's declared version
 * against that range and throws when the scene is older. The comparison is a
 * string comparison, which is why the values here are strings.
 */
const LOADSENSOR_FROM = "3.0";

/**
 * X_ITE 16.2.0's admission rule for a node type, reimplemented.
 *
 * Returns the error X_ITE would throw, or null when the node is allowed.
 */
function createNodeVerdict(declaredVersion: string, from: string, worldURL: string): string | null {
  if (declaredVersion < from) {
    return `Node type 'LoadSensor' does not match specification version in '${worldURL}.`;
  }
  return null;
}

/** The version a file declares, by X_ITE's grammar. Null when it declares none. */
function declaredVersion(source: string): string | null {
  const match = HEADER.exec(source);
  return match ? match[2] : null;
}

const wrapperSource: string = fs.readFileSync(WRAPPER, "utf8");
const viewerSource: string = fs.readFileSync(VIEWER, "utf8");

/* --- 1. The wrapper, judged by X_ITE's own rule ------------------------- */

test("the preview wrapper declares a specification version X_ITE recognises", () => {
  assert.strictEqual(declaredVersion(wrapperSource), "3.3",
    "ObjectPreview.x3dv must declare '#X3D V3.3 utf8'");
});

test("X_ITE 16.2.0 admits LoadSensor into the preview wrapper", () => {
  const verdict = createNodeVerdict(
    declaredVersion(wrapperSource) as string, LOADSENSOR_FROM, WRAPPER);
  assert.strictEqual(verdict, null,
    `X_ITE would refuse the Checker's LoadSensor: ${verdict}`);
});

test("the same rule still refuses LoadSensor in a VRML97 scene", () => {
  // Negative control. Without this, a rule that admitted everything would pass
  // the test above, and the header could go back to VRML97 unnoticed.
  const old = "#VRML V2.0 utf8\nWorldInfo { title \"ObjectPreview\" }\n";
  const verdict = createNodeVerdict(
    declaredVersion(old) as string, LOADSENSOR_FROM, "ObjectPreview.wrl");
  assert.ok(verdict && verdict.indexOf("does not match specification version") !== -1,
    "the reimplemented rule no longer reproduces the original failure");
});

test("the wrapper stays at 3.3, where LoadSensor still answers to watchList", () => {
  /*
   * X_ITE aliases LoadSensor's `watchList` onto `children` only for scenes
   * declaring 3.3 or lower. Declaring 4.0 would admit the node and then leave
   * `sensor.watchList = ...` watching nothing, which reads as a load that never
   * completes rather than as an error.
   */
  const version = Number(declaredVersion(wrapperSource));
  assert.ok(version >= 3.0 && version <= 3.3,
    `wrapper declares ${version}; LoadSensor's watchList alias needs 3.0 to 3.3`);
});

test("the viewer loads the wrapper file that actually exists", () => {
  const match = /const PREVIEW_WORLD = "([^"]+)"/.exec(viewerSource);
  assert.ok(match, "ObjectViewer no longer names a preview world");
  const url = (match as RegExpExecArray)[1];
  const onDisk = path.join(SPA, url.replace(/^\//, ""));
  assert.ok(fs.existsSync(onDisk), `ObjectViewer loads ${url}, which is not in the repo`);
  assert.strictEqual(onDisk, WRAPPER,
    "the wrapper was renamed on one side only");
});

test("every page that loads the preview wrapper loads a file that is there", () => {
  /*
   * The Checker is not the only caller. `ObjectProperties.vue` mounts its own
   * browser in `#objectModel` and loads the same wrapper, and it does not use a
   * LoadSensor -- so renaming the file for the Checker's sake broke a page that
   * never had the bug, silently, because the old file was still sitting on the
   * server from before the deploy.
   *
   * This walks the source rather than naming the callers, so a third one
   * arriving later is covered too.
   */
  const roots = [path.join(SPA, "src")];
  const sources: string[] = [];
  while (roots.length) {
    const dir = roots.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        roots.push(full);
      } else if (/\.(vue|ts|js)$/.test(entry.name)) {
        sources.push(full);
      }
    }
  }

  const references: { file: string; url: string }[] = [];
  for (const file of sources) {
    const text: string = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/["'](\/assets\/object\/ObjectPreview\.[a-z0-9]+)["']/g)) {
      references.push({ file: path.relative(SPA, file), url: match[1] });
    }
  }

  assert.ok(references.length >= 2,
    `expected the wrapper to be loaded from more than one page, found ${references.length}`);

  for (const reference of references) {
    const onDisk = path.join(SPA, reference.url.replace(/^\//, ""));
    assert.ok(fs.existsSync(onDisk),
      `${reference.file} loads ${reference.url}, which is not in the repo`);
  }
});

/* --- 2. The item boundary ---------------------------------------------- */

test("the reference grid the checker judges against is still VRML97", () => {
  // It is content, not wrapper. Nothing in this repair gives it a reason to
  // become X3D, and a sweep that "fixed" every header would break the rule the
  // Mall holds uploaders to.
  const grid = fs.readFileSync(path.join(SPA, "assets/object/MallReference.wrl"), "utf8");
  assert.strictEqual(declaredVersion(grid), "2.0",
    "MallReference.wrl must stay '#VRML V2.0 utf8'");
});

test("an uploaded VRML97 object is admitted by the rule the Mall holds it to", () => {
  const item = "#VRML V2.0 utf8\nShape { geometry Box { size 1 1 1 } }\n";
  assert.strictEqual(declaredVersion(item), "2.0");
  // An Inline parses its own header, so the object keeps its own version
  // regardless of the wrapper's. Box exists in every version from 2.0 on.
  assert.strictEqual(createNodeVerdict(declaredVersion(item) as string, "2.0", "item.wrl"), null);
});

test("the wrapper does not let an uploaded object use an X3D-only node", () => {
  // The boundary, stated as a test: a VRML97 item is still judged as VRML97,
  // so LoadSensor inside an uploaded object is still refused.
  const item = "#VRML V2.0 utf8\nLoadSensor { }\n";
  const verdict = createNodeVerdict(
    declaredVersion(item) as string, LOADSENSOR_FROM, "item.wrl");
  assert.ok(verdict, "a VRML97 upload must not inherit the wrapper's X3D version");
});

/* --- 3. What the viewer does with the sensor's reports ------------------ */

test("a sensor's opening negative report is ignored", () => {
  const read = loadReportReader();
  assert.strictEqual(read(false), "ignore");
});

test("a negative report after the opening one is a failure", () => {
  const read = loadReportReader();
  read(false);
  assert.strictEqual(read(false), "failed");
});

test("an opening positive report is a successful load", () => {
  const read = loadReportReader();
  assert.strictEqual(read(true), "loaded");
});

test("every later positive report is still a successful load", () => {
  const read = loadReportReader();
  read(false);
  const verdicts: LoadReportVerdict[] = [read(true), read(true)];
  assert.deepStrictEqual(verdicts, ["loaded", "loaded"]);
});

test("each object gets its own reader, so one object cannot mask the next", () => {
  const first = loadReportReader();
  first(false);
  assert.strictEqual(first(false), "failed");
  const second = loadReportReader();
  assert.strictEqual(second(false), "ignore",
    "a fresh sensor must drop its own opening report");
});

/* --- 4. Telling the checker what actually went wrong -------------------- */

test("a served file the viewer cannot read is reported as a bad upload", () => {
  const failure = describePreviewFailure({ url: "/assets/object/u/a.wrl", status: 200, timedOut: false });
  assert.strictEqual(failure.kind, "invalid");
  assert.ok(/could not read it as VRML/.test(failure.message));
});

test("a missing file is reported as a fetch failure, with its status", () => {
  const failure = describePreviewFailure({ url: "/assets/object/u/a.wrl", status: 404, timedOut: false });
  assert.strictEqual(failure.kind, "http");
  assert.ok(/404/.test(failure.message), "the status is what makes this actionable");
});

test("a server error is a fetch failure too, not a bad upload", () => {
  assert.strictEqual(
    describePreviewFailure({ url: "/a.wrl", status: 500, timedOut: false }).kind, "http");
});

test("a load that never settles is reported as a timeout, not as a bad upload", () => {
  const failure = describePreviewFailure({ url: "/a.wrl", status: null, timedOut: true });
  assert.strictEqual(failure.kind, "timeout");
});

test("a timeout is still a timeout when the file itself fetches cleanly", () => {
  // Blaming the object for a wait that ran out would send a checker looking at
  // a file that is fine.
  assert.strictEqual(
    describePreviewFailure({ url: "/a.wrl", status: 200, timedOut: true }).kind, "timeout");
});

test("an unknown status is not held against the upload", () => {
  const failure = describePreviewFailure({ url: "/a.wrl", status: null, timedOut: false });
  assert.strictEqual(failure.kind, "viewer",
    "a probe that could not run is not evidence that the object is broken");
});

test("the viewer's own failures keep their own wording", () => {
  const failure = viewerFailure("The X_ITE viewer library is not available.");
  assert.strictEqual(failure.kind, "viewer");
  assert.strictEqual(failure.message, "The X_ITE viewer library is not available.");
});

test("the four failure kinds are all distinguishable", () => {
  // The point of the classification: a checker must be able to tell a broken
  // upload from a missing file from a viewer that never started.
  const kinds = [
    describePreviewFailure({ url: "/a", status: 200, timedOut: false }).kind,
    describePreviewFailure({ url: "/a", status: 404, timedOut: false }).kind,
    describePreviewFailure({ url: "/a", status: null, timedOut: true }).kind,
    viewerFailure("nope").kind,
  ];
  assert.deepStrictEqual(kinds, ["invalid", "http", "timeout", "viewer"]);
  assert.strictEqual(new Set(kinds).size, 4);
});

/* ----------------------------------------------------------------------- */

let failed = 0;
for (const t of tests) {
  try {
    t.run();
    console.log(`  ok  ${t.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${t.name}`);
    console.error(`      ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
