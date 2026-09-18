/**
 * Human-readable labels for the `transaction.reason` column.
 *
 * WHAT THIS SOLVES. Both admin transaction screens used to carry their own
 * pair of parallel arrays (`reasons` / `reasonDisplay`) and look a row up by
 * `indexOf()`. Neither list covered the whole server enum, so a real stored
 * reason that was simply missing from the list fell off the end:
 * `spa/src/pages/admin/user/TransactionHistory.vue` returned the literal
 * "Weekly Role Credit" for every miss - a member-to-member CityCash transfer
 * and an immigration grant both rendered as a weekly role credit, which is
 * not merely unhelpful, it names the wrong kind of money movement - and
 * `spa/src/pages/admin/transactions/search.vue` indexed `reasonDisplay[-1]`
 * and rendered a blank cell. This module is the one place the mapping lives.
 *
 * THE DATA IS CORRECT. Nothing here repairs a row. `api/src/types/models/
 * transaction.model.ts` holds the authoritative `TransactionReason` enum and
 * the ledger stores exactly those values; this is a display contract over
 * them. The SPA has no build-time import of API source (no shared contract
 * module exists in this repo), so the keys below are a hand-kept mirror of
 * that enum - `tests/transaction-reason.test.ts` asserts one label per
 * current enum member so drift shows up as a failing test, not as a wrong
 * label in front of a moderator.
 *
 * WEEKLY CREDIT CARRIES A ROLE ID. `CreditRepository` writes the weekly job
 * credit as `` `${TransactionReason.WeeklyCredit} for ${role_id}` `` (e.g.
 * "weekly-role-credit for 63"), so a real row is never the bare enum value and
 * plain equality would miss every one of them.
 *
 * It is still not a loose prefix. Independent QA rejected a first attempt that
 * matched with `startsWith("weekly-role-credit")`: that also swallowed
 * "weekly-role-creditish" and "weekly-role-credit for abc", labelling unknown
 * text as a weekly role credit - exactly the class of lie this whole module
 * exists to remove. The match is the enum value exactly, or the enum value
 * followed by " for " and digits to the end of the string
 * ({@link WEEKLY_CREDIT_WITH_ROLE_PATTERN}). Anything else is unknown text and
 * falls through to the raw-value rule below.
 *
 * UNKNOWN STAYS VISIBLE. A reason this module has never seen renders as its
 * own raw string. It must never borrow another transaction type's label and
 * it must never render blank - a moderator reading the ledger has to be able
 * to tell "a kind of row this screen is too old to name" from "a weekly role
 * credit".
 */

/** The bare `TransactionReason.WeeklyCredit` enum value. */
export const WEEKLY_CREDIT_REASON = "weekly-role-credit";

/**
 * The shape `CreditRepository` actually stores: the enum value, " for ", and
 * the role id. Anchored at both ends on purpose - see the module note above on
 * why a prefix test is not good enough.
 */
export const WEEKLY_CREDIT_WITH_ROLE_PATTERN = /^weekly-role-credit for \d+$/;

/** Shown when the row carries no reason at all, against the column contract. */
export const UNKNOWN_TRANSACTION_REASON_LABEL = "Unknown";

/**
 * One entry per member of the server's `TransactionReason` enum.
 *
 * The labels for the reasons the old arrays already covered are kept byte for
 * byte, so this change moves no wording a moderator already knows. The two
 * screens disagreed on `object-purchase` and `object-profit` ("Mall Item
 * Purchase"/"Mall Item Sold" against "Mall Purchase"/"Mall Sold"); one shared
 * function can hold only one of each, so the longer, less ambiguous pair
 * wins. The remaining entries are new because no screen could name them:
 * "CityCash Transfer" is the Bank's own historical wording (see
 * `components/place/bank/main2d.vue`), and the rest restate the enum's
 * documented meaning in plain words.
 */
export const TRANSACTION_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "daily-credit": "Daily Credit",
  "home-purchase": "Home Purchase",
  "home-refund": "Home Refund",
  "object-sell": "User Object Sells",
  "object-upload": "Mall Object Upload",
  "object-upload-refund": "Mall Reject Refund",
  "object-restock": "Mall Object Restock",
  "object-unsold-instances-refund": "Mall Unsold Refund",
  "object-purchase": "Mall Item Purchase",
  "object-profit": "Mall Item Sold",
  "member-to-member": "CityCash Transfer",
  "immigration-grant": "Immigration Grant",
  "system-to-member": "Cybertown Transfer",
  "item-purchase": "Item Purchase",
  [WEEKLY_CREDIT_REASON]: "Weekly Role Credit",
});

/**
 * Turns a stored `transaction.reason` into the text an admin screen shows.
 *
 * @param reason the raw column value, exactly as the API returned it.
 * @returns a known label, else the raw reason, else
 *   {@link UNKNOWN_TRANSACTION_REASON_LABEL} when there is no value at all.
 */
export function transactionReasonLabel(reason: string | null | undefined): string {
  if (typeof reason !== "string") {
    return UNKNOWN_TRANSACTION_REASON_LABEL;
  }

  const value = reason.trim();
  if (value === "") {
    return UNKNOWN_TRANSACTION_REASON_LABEL;
  }

  const known = TRANSACTION_REASON_LABELS[value];
  if (known !== undefined) {
    return known;
  }

  if (WEEKLY_CREDIT_WITH_ROLE_PATTERN.test(value)) {
    return TRANSACTION_REASON_LABELS[WEEKLY_CREDIT_REASON];
  }

  return value;
}
