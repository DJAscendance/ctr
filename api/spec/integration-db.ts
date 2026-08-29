import dotenv from 'dotenv';
import { Knex } from 'knex';

// `knexfile` loads this same file, but these helpers read DB_* directly to decide whether
// they are allowed to write, so they cannot rely on that import having happened first.
// jest's cwd is `api/`, so `../.env` is the repository root env the API itself uses.
dotenv.config({ path: '../.env' });

/**
 * Whether a spec may create and delete fixture rows in the configured database.
 *
 * `DB_HOST`/`DB_DATABASE` only prove that *a* database is reachable, and the API's
 * ordinary environment defines both -- pointed at a shared or production schema where
 * fixture INSERTs and cleanup DELETEs must never run. Writing therefore additionally
 * requires `CTR_INTEGRATION_TEST_DB` to name the configured database exactly: an
 * explicit, per-environment statement that this specific schema is disposable, rather
 * than an inference drawn from configuration that happens to be present.
 */
export function integrationDbAuthorized(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.DB_HOST
    && env.DB_DATABASE
    && env.CTR_INTEGRATION_TEST_DB
    && env.CTR_INTEGRATION_TEST_DB === env.DB_DATABASE,
  );
}

/**
 * `describe` for a block that writes to the database, downgraded to `describe.skip`
 * when the opt-in above has not been given. Skipped blocks report as skipped, never as
 * a silent pass.
 */
export const describeWithDb = integrationDbAuthorized() ? describe : describe.skip;

/** Marks every row this run creates, so cleanup can never reach a row it did not make. */
export const FIXTURE_TAG = 'b1itest';

let sequence = 0;

/** A name unique to this process and call, prefixed so cleanup can find it again. */
export function fixtureName(label: string): string {
  sequence += 1;
  return `${FIXTURE_TAG}-${label}-${process.pid}-${sequence}`;
}

/**
 * A fresh Bank idempotency key, unique to this process and call.
 *
 * Every transfer that is meant to be its OWN transfer needs its own key -- including the
 * ones a spec fires concurrently, which is why this is a function call at each site rather
 * than a shared constant. A spec that deliberately RETRIES an intent instead captures one
 * of these in a variable and passes the same value twice; that difference is the thing
 * under test in the idempotency specs.
 *
 * Shaped to satisfy the service's key rules: at least 8 characters, at most 64, drawn only
 * from `[A-Za-z0-9_-]`.
 */
export function intentKey(label = 'intent'): string {
  sequence += 1;
  return `${FIXTURE_TAG}-${label}-${process.pid}-${sequence}`;
}

/** Fields of a fixture role that a test actually cares about. */
export interface RoleFixture {
  name: string;
  income_cc: number;
  income_xp: number;
}

/** A fixture member, with the wallet the payout paths credit. */
export interface MemberFixture {
  id: number;
  walletId: number;
  username: string;
}

/** Inserts a role and returns its id. */
export async function createRole(knex: Knex, role: RoleFixture): Promise<number> {
  const [id] = await knex('role').insert(role);
  return id;
}

/**
 * Inserts a member and its wallet.
 * @param knex connection to write through
 * @param overrides member columns to set, most usefully the two credit timestamps
 */
export async function createMember(
  knex: Knex,
  overrides: Record<string, unknown> = {},
): Promise<MemberFixture> {
  const username = fixtureName('member');
  const [walletId] = await knex('wallet').insert({ balance: 1000 });
  const [id] = await knex('member').insert({
    username,
    email: `${username}@example.invalid`,
    password: 'not-a-real-hash',
    wallet_id: walletId,
    ...overrides,
  });
  return { id, walletId, username };
}

/** Assigns a role to a member, optionally scoped to a place. */
export async function assignRole(
  knex: Knex,
  memberId: number,
  roleId: number,
  placeId: number = null,
): Promise<void> {
  await knex('role_assignment').insert({
    member_id: memberId,
    role_id: roleId,
    place_id: placeId,
  });
}

/**
 * Settles a home for a member: the `place` row that records ownership plus its `home`
 * side-table row.
 *
 * Written directly rather than through HomeService, because specs that need a homesteaded
 * member usually do not want the map-location plumbing, and because a spec asserting on the
 * settle path must not use that same path to build its own fixtures.
 *
 * The place is named with the fixture tag so cleanUpFixtures can find it again.
 * @param knex connection to write through
 * @param memberId member who will own the home
 * @returns the home's place id -- which is also where that member's Inbox is
 */
export async function createHome(knex: Knex, memberId: number): Promise<number> {
  const [placeId] = await knex('place').insert({
    type: 'home',
    member_id: memberId,
    name: fixtureName('home'),
    status: 1,
  });
  await knex('home').insert({ place_id: placeId, home_design_id: null });
  return placeId;
}

/** A timestamp `days` days before now, for setting a credit timestamp out of its window. */
export function daysAgo(days: number): Date {
  const when = new Date();
  when.setDate(when.getDate() - days);
  return when;
}

/**
 * Deletes every row created by `createMember`/`createRole` in this schema.
 *
 * Keyed off {@link FIXTURE_TAG} rather than off ids collected during the run, so a spec
 * that died part way through still cleans up after itself on the next run.
 */
export async function cleanUpFixtures(knex: Knex): Promise<void> {
  const members = await knex('member')
    .select('id', 'wallet_id')
    .where('username', 'like', `${FIXTURE_TAG}-%`);
  const memberIds = members.map(member => member.id);
  const walletIds = members.map(member => member.wallet_id);

  // Deleted before the places and members they reference, because `inbox` has foreign keys
  // to both. Matched on the fixture places AND on the fixture members, so a receipt filed
  // for one fixture citizen at another's home is still reached.
  const places = await knex('place')
    .select('id')
    .where('name', 'like', `${FIXTURE_TAG}-%`);
  const placeIds = places.map(place => place.id);
  if (placeIds.length || memberIds.length) {
    const inbox = knex('inbox');
    if (placeIds.length) inbox.orWhereIn('place_id', placeIds);
    if (memberIds.length) inbox.orWhereIn('member_id', memberIds);
    await inbox.del();
  }
  if (placeIds.length) {
    await knex('map_location').whereIn('place_id', placeIds).update({ place_id: 0 });
    await knex('home').whereIn('place_id', placeIds).del();
    await knex('place').whereIn('id', placeIds).del();
  }

  if (memberIds.length) {
    await knex('role_assignment').whereIn('member_id', memberIds).del();
    await knex('member').whereIn('id', memberIds).del();
  }
  if (walletIds.length) {
    // Both directions: a transfer between two fixture citizens writes ONE row carrying both
    // wallet ids, and a debit-only row carries only the sender's.
    await knex('transaction')
      .whereIn('recipient_wallet_id', walletIds)
      .orWhereIn('sender_wallet_id', walletIds)
      .del();
    await knex('wallet').whereIn('id', walletIds).del();
  }
  await knex('role_assignment')
    .whereIn('role_id', knex('role').select('id').where('name', 'like', `${FIXTURE_TAG}-%`))
    .del();
  await knex('role').where('name', 'like', `${FIXTURE_TAG}-%`).del();
}
