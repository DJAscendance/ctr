/**
 * BETA-REG-001 - the shared admin transaction-reason label contract.
 *
 * The live symptom: on `/admin/user/<id>` a member-to-member CityCash
 * transfer and an immigration grant both rendered as "Weekly Role Credit",
 * because the old `formatReason()` returned that literal for every reason
 * missing from its hand-kept array. The sibling screen rendered a blank cell
 * for the same misses. Both now call one function, and this suite holds it to
 * one label per current server `TransactionReason` value, so a new enum
 * member added on the API side fails here instead of showing a moderator the
 * wrong kind of money movement.
 *
 * All behavioural against the helper. The two source-shape checks at the end
 * exist only to prove neither page kept a second, private reason list.
 */
import assert from "assert";
import fs from "fs";
import path from "path";

import {
  TRANSACTION_REASON_LABELS,
  transactionReasonLabel,
  UNKNOWN_TRANSACTION_REASON_LABEL,
  WEEKLY_CREDIT_REASON,
} from "../src/helpers/transaction-reason.helper";

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

/**
 * Every member of `TransactionReason` in api/src/types/models/transaction.model.ts
 * at base 840a771827cb5345067298a11608e7d0bf468e63, with the label each must show.
 */
const SERVER_REASONS: ReadonlyArray<readonly [string, string]> = [
  ["daily-credit", "Daily Credit"],
  ["home-purchase", "Home Purchase"],
  ["item-purchase", "Item Purchase"],
  ["member-to-member", "CityCash Transfer"],
  ["system-to-member", "Cybertown Transfer"],
  ["immigration-grant", "Immigration Grant"],
  ["home-refund", "Home Refund"],
  ["weekly-role-credit", "Weekly Role Credit"],
  ["object-upload", "Mall Object Upload"],
  ["object-upload-refund", "Mall Reject Refund"],
  ["object-unsold-instances-refund", "Mall Unsold Refund"],
  ["object-purchase", "Mall Item Purchase"],
  ["object-profit", "Mall Item Sold"],
  ["object-sell", "User Object Sells"],
  ["object-restock", "Mall Object Restock"],
];

/* ------------------------------------ 1. EVERY SERVER REASON ---- */
console.log("\n1. EVERY SERVER REASON");

for (const [reason, label] of SERVER_REASONS) {
  test(`"${reason}" shows "${label}"`, () => {
    assert.strictEqual(transactionReasonLabel(reason), label);
  });
}

test("the map covers exactly the current server enum, no more and no less", () => {
  const mapped = Object.keys(TRANSACTION_REASON_LABELS).sort();
  const expected = SERVER_REASONS.map(([reason]) => reason).sort();
  assert.deepStrictEqual(mapped, expected);
});

test("no two server reasons share a label", () => {
  const labels = SERVER_REASONS.map(([, label]) => label);
  assert.strictEqual(new Set(labels).size, labels.length);
});

/* --------------------------------- 2. WEEKLY CREDIT, VALID FORMS ---- */
console.log("\n2. WEEKLY CREDIT, VALID FORMS");

test("the stored live form \"weekly-role-credit for 63\" shows Weekly Role Credit", () => {
  assert.strictEqual(transactionReasonLabel("weekly-role-credit for 63"), "Weekly Role Credit");
});

test("another role id resolves the same way", () => {
  assert.strictEqual(transactionReasonLabel("weekly-role-credit for 114"), "Weekly Role Credit");
});

test("a third role id resolves the same way, so no id is special-cased", () => {
  assert.strictEqual(transactionReasonLabel("weekly-role-credit for 1"), "Weekly Role Credit");
});

test("the bare enum value still resolves, so the role form has not displaced it", () => {
  assert.strictEqual(transactionReasonLabel(WEEKLY_CREDIT_REASON), "Weekly Role Credit");
});

test("a long role id resolves, so the match is not length-bound", () => {
  assert.strictEqual(
    transactionReasonLabel("weekly-role-credit for 1234567"), "Weekly Role Credit",
  );
});

/* ------------------------- 3. WEEKLY CREDIT, FALSE-PREFIX BOUNDARY ---- */
console.log("\n3. WEEKLY CREDIT, FALSE-PREFIX BOUNDARY");

/**
 * Independent QA failed the first candidate here. A `startsWith` test on the
 * enum value swallowed every string that merely began with it, so unknown text
 * was shown to a moderator as a weekly role credit. Each of these must come
 * back as its own raw value.
 */
const WEEKLY_LOOKALIKES = [
  "weekly-role-creditish",
  "weekly-role-credit-other",
  "weekly-role-credit for",
  "weekly-role-credit for abc",
  "weekly-role-credit for 63 extra",
  "xweekly-role-credit",
  "weekly-role-creditfor 63",
  "weekly-role-credit  for 63",
  "weekly-role-credit for 63.5",
  "weekly-role-credit for -1",
];

for (const lookalike of WEEKLY_LOOKALIKES) {
  test(`"${lookalike}" stays raw, it is not a weekly role credit`, () => {
    assert.strictEqual(transactionReasonLabel(lookalike), lookalike.trim());
  });

  test(`"${lookalike}" never shows the Weekly Role Credit label`, () => {
    assert.notStrictEqual(transactionReasonLabel(lookalike), "Weekly Role Credit");
  });
}

/* -------------------------- 4. DOUG_BLACK THREE-ROW SYMPTOM ---- */
console.log("\n4. DOUG_BLACK THREE-ROW SYMPTOM");

test("the three live rows resolve to three distinct labels", () => {
  const transfer = transactionReasonLabel("member-to-member");
  const grant = transactionReasonLabel("immigration-grant");
  const weekly = transactionReasonLabel("weekly-role-credit for 63");
  assert.strictEqual(new Set([transfer, grant, weekly]).size, 3);
});

test("transaction 56 (member-to-member) is no longer a weekly role credit", () => {
  assert.strictEqual(transactionReasonLabel("member-to-member"), "CityCash Transfer");
});

test("transaction 54 (immigration-grant) is no longer a weekly role credit", () => {
  assert.strictEqual(transactionReasonLabel("immigration-grant"), "Immigration Grant");
});

test("transaction 126 (weekly-role-credit for 63) keeps its correct label", () => {
  assert.strictEqual(transactionReasonLabel("weekly-role-credit for 63"), "Weekly Role Credit");
});

/* ------------------------------ 5. PLURAL UNSOLD REFUND KEY ---- */
console.log("\n5. PLURAL UNSOLD REFUND KEY");

test("the real API/stored plural value resolves", () => {
  assert.strictEqual(
    transactionReasonLabel("object-unsold-instances-refund"), "Mall Unsold Refund",
  );
});

test("the old singular typo is not a known key and shows itself raw", () => {
  assert.strictEqual(
    transactionReasonLabel("object-unsold-instance-refund"), "object-unsold-instance-refund",
  );
});

/* ------------------------------------ 6. UNKNOWN REASON RULE ---- */
console.log("\n6. UNKNOWN REASON RULE");

test("an unknown future reason shows its own raw value", () => {
  assert.strictEqual(transactionReasonLabel("club-dues"), "club-dues");
});

test("an unknown reason never borrows a known label", () => {
  const labels = new Set(SERVER_REASONS.map(([, label]) => label));
  assert.ok(!labels.has(transactionReasonLabel("some-reason-from-the-future")));
});

test("an unknown reason never renders blank", () => {
  assert.notStrictEqual(transactionReasonLabel("some-reason-from-the-future").trim(), "");
});

test("a reason that embeds the weekly value later on is not a weekly credit", () => {
  assert.strictEqual(
    transactionReasonLabel("reversal-of-weekly-role-credit"), "reversal-of-weekly-role-credit",
  );
});

test("surrounding whitespace does not hide a known reason", () => {
  assert.strictEqual(transactionReasonLabel("  member-to-member  "), "CityCash Transfer");
});

test("surrounding whitespace does not hide a real weekly role credit either", () => {
  assert.strictEqual(
    transactionReasonLabel("  weekly-role-credit for 63  "), "Weekly Role Credit",
  );
});

test("an empty reason shows the neutral literal", () => {
  assert.strictEqual(transactionReasonLabel(""), UNKNOWN_TRANSACTION_REASON_LABEL);
});

test("a null reason shows the neutral literal", () => {
  assert.strictEqual(transactionReasonLabel(null), UNKNOWN_TRANSACTION_REASON_LABEL);
});

test("an undefined reason shows the neutral literal", () => {
  assert.strictEqual(transactionReasonLabel(undefined), UNKNOWN_TRANSACTION_REASON_LABEL);
});

/* ------------------------------- 7. ONE LIST, NOT THREE ---- */
console.log("\n7. ONE LIST, NOT THREE");

const PAGES = [
  path.resolve(__dirname, "../../../src/pages/admin/user/TransactionHistory.vue"),
  path.resolve(__dirname, "../../../src/pages/admin/transactions/search.vue"),
];

for (const page of PAGES) {
  const name = path.basename(page);
  const source = fs.readFileSync(page, "utf8");

  test(`${name} calls the shared helper`, () => {
    assert.ok(source.includes("transaction-reason.helper"));
    assert.ok(source.includes("transactionReasonLabel("));
  });

  test(`${name} keeps no private reason list`, () => {
    assert.ok(!source.includes("reasonDisplay"));
    assert.ok(!source.includes("Weekly Role Credit"));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
