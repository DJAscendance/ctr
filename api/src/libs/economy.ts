/**
 * Cybertown's final deployed economy values.
 *
 * These are read from the live server's own configuration files, recovered from the
 * 2010-2011 IVN11 backup:
 *
 *   colonycity/config/money.cfg
 *     sha256 675d7cd6a61a06af2809dc1d91964170a4d44769fa9185c485a524da3ab0358b  (854 bytes)
 *   colonycity/config/exper.cfg
 *     sha256 3c34e6472511e698352abb487bbefdc4f76427f367937592f7949003f452a0da  (726 bytes)
 *
 * Both store plain decimal integers -- there is no hex encoding to decode here, unlike the
 * member money field (`M.MON`) the Bank's Perl read, which was 8-char hex.
 *
 * WHY THESE AND NOT THE NUMBERS ON THE HELP PAGES
 *
 * Cybertown's economy changed repeatedly over its lifetime, so several different rate
 * tables all legitimately describe "Cybertown". They are not in conflict; they are
 * snapshots taken by different means:
 *
 *   source                   visiting        employed          immigration   referral
 *   2000 public              5xp /  50cc     10xp / 100cc       1,000cc        500cc
 *   2007 public chart        5xp /  50cc     21xp / 336cc       5,000cc      2,000cc
 *   2010 public FAQ          5xp /  10cc     (row removed)      1,000cc         --
 *   DEPLOYED_RUNTIME_CONFIG  5xp /  80cc     21xp / 336cc      20,000cc      2,000cc
 *
 * DEPLOYED_RUNTIME_CONFIG is the term used throughout this lane for the last row, and it is
 * a statement about PROVENANCE rather than about a date: these are the values the recovered
 * server was actually configured to pay, read out of its own config files, as distinct from
 * the first three rows, which are values Cybertown PUBLISHED. Labelling it by a year instead
 * -- "2010 rates", "final-era rates" -- would quietly demote it to a fourth competing
 * snapshot and invite the next reader to arbitrate between four dates. There is nothing to
 * arbitrate: for what the server paid, deployed runtime config outranks published
 * documentation, and a public page quoting different amounts is evidence about what was
 * ADVERTISED, not a correction to what was configured.
 *
 * CTR previously ran the February-2000 public regime.
 *
 * `moneyold.cfg` in the same directory is the immediately preceding generation and differs
 * in exactly one field, `m_immigrate` 5000 -> 20000, which is what dates money.cfg as the
 * later of the two.
 */

/** `m_member_daily_login` -- CityCash for logging in at least once on a given day. */
export const DAILY_CC = 80;

/** `e_member_daily_login` -- experience for logging in at least once on a given day. */
export const DAILY_XP = 5;

/**
 * Total CityCash an employed member receives for a daily login.
 *
 * The historical config expresses this as two additive events: `m_member_daily_login` 80
 * plus `m_job_daily_login` 256. CTR's payout picks ONE of the employed/unemployed amounts
 * rather than summing them, so the total belongs here. Paying 80 + 336 would be 416.
 */
export const DAILY_CC_EMPLOYED = DAILY_CC + 256;

/**
 * Total experience an employed member receives for a daily login.
 *
 * Likewise additive historically: `e_member_daily_login` 5 + `e_job_daily_login` 16. Not 26.
 */
export const DAILY_XP_EMPLOYED = DAILY_XP + 16;

/**
 * `m_immigrate` -- CityCash granted to a new citizen on immigration.
 *
 * Modelled as an awarded event recorded in the ledger rather than as the wallet column's
 * DEFAULT, because that is what it was historically and because the largest single grant in
 * the economy should be auditable.
 */
export const IMMIGRATION_GRANT_CC = 20000;

/**
 * `e_propsettle` -- experience for successfully settling a home, paid once per member ever.
 */
export const FIRST_HOMESTEAD_XP = 50;

/**
 * `m_referer` -- CityCash a referrer receives when the member they referred immigrates.
 *
 * NOT PAID BY CTR TODAY. CTR has no referral concept at all: no column, no table, no signup
 * parameter. The amount is recorded here so that the historical value is not lost while the
 * mechanism is deferred to a later lane -- see the ECON-F follow-up. Do not wire this up
 * without building the referral workflow it belongs to.
 */
export const REFERRER_BONUS_CC = 2000;

/**
 * `m_property_move` -- CityCash CHARGED for moving a property to a different place.
 *
 * A charge, not an award: money.cfg's own comment reads "Value to pay for moving a property
 * to a different place". NOT CHARGED BY CTR TODAY -- HomeController.moveHome is free.
 * Recorded here to preserve the amount and its sign while the workflow is deferred.
 */
export const PROPERTY_MOVE_COST_CC = 50;
