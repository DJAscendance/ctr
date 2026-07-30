import { Knex } from 'knex';

/**
 * Seeds role_assignment, which nothing previously populated.
 *
 * roles (05/06/09) and places (02/03/04) are both seeded, but nothing joined them, so
 * role_assignment was empty and no member held a place-scoped office. That is why access
 * rights appeared broken: the table is correctly shaped -- (member_id, role_id, place_id),
 * structurally the CS 4.x `rolemember` record -- and simply had no rows.
 *
 * These are synthetic fixtures so permission behaviour is testable now; real officeholders
 * come later through the admin UI. Consistent with the rest of this directory, the seed is
 * destructive and dev-only: 04-places.hoods.seed.ts already deletes every map_location and
 * all hood/block places, so nothing here is safe to run against production either.
 *
 * Three deliberate choices:
 *
 * 1. Roles are resolved BY NAME, never by id. roles_data.json carries only
 *    {name, income_xp, income_cc} -- ids come from auto-increment insert order, so
 *    hardcoding them would silently repoint every assignment if that file were ever
 *    reordered. The `role` table has a UNIQUE(name) index, so name lookup is stable.
 *
 * 2. The fixture members cannot be logged into. Their password column holds a bcrypt hash
 *    of a random value that was discarded at authoring time, so no password matches. They
 *    exist to hold roles, not to be used as accounts. Give one a real password through the
 *    app if you need to sign in as it.
 *
 * 3. Emails use the reserved .invalid TLD (RFC 2606) so they can never collide with, or be
 *    mistaken for, a real address.
 */

/** bcrypt hash of a discarded random string -- intentionally unmatchable. */
const UNUSABLE_PASSWORD = '$2b$10$dl2N8WvzlGiQdf/AZzNwZejA9a/aRXZKWAJaOrycJt/wP1eScczKS';

const FIXTURE_PREFIX = 'fixture_';
const FIXTURE_COUNT = 12;

/** How many hoods and blocks to staff. Kept small so the fixture stays readable. */
const HOODS_TO_STAFF = 6;
const BLOCKS_TO_STAFF = 8;

type RoleIds = Record<string, number>;

async function resolveRoles(knex: Knex, names: string[]): Promise<RoleIds> {
  const rows = await knex('role').select('id', 'name').whereIn('name', names);
  const byName: RoleIds = {};
  for (const row of rows) byName[row.name] = row.id;

  const missing = names.filter(name => !(name in byName));
  if (missing.length) {
    throw new Error(
      `role_assignment seed: roles not found by name: ${missing.join(', ')}. ` +
      'Run the role seeds (05/09) first.',
    );
  }
  return byName;
}

function fixtureUsername(index: number): string {
  return `${FIXTURE_PREFIX}${String(index).padStart(2, '0')}`;
}

/**
 * Escapes the LIKE metacharacters in a literal prefix.
 *
 * FIXTURE_PREFIX ends in '_', which LIKE reads as "any single character" -- so the raw
 * pattern also matched real usernames such as 'fixtures' or 'fixtureBob'. This function
 * feeds a DELETE, so an over-match takes a real member's account, role assignments and
 * wallet with it.
 */
const LIKE_ESCAPE = '!';
function escapeLikeLiteral(value: string): string {
  return value.replace(/[!%_]/g, character => `${LIKE_ESCAPE}${character}`);
}

async function removePreviousFixtures(knex: Knex): Promise<void> {
  const existing = await knex('member')
    .select('id', 'wallet_id')
    .whereRaw(`username LIKE ? ESCAPE '${LIKE_ESCAPE}'`, [
      `${escapeLikeLiteral(FIXTURE_PREFIX)}%`,
    ]);
  if (!existing.length) return;

  const memberIds = existing.map(member => member.id);
  const walletIds = existing.map(member => member.wallet_id).filter(Boolean);

  console.log(`Removing ${memberIds.length} previous fixture members`);
  await knex('role_assignment').whereIn('member_id', memberIds).del();
  await knex('member').whereIn('id', memberIds).del();
  if (walletIds.length) await knex('wallet').whereIn('id', walletIds).del();
}

async function createFixtureMembers(knex: Knex): Promise<number[]> {
  const memberIds: number[] = [];
  for (let index = 1; index <= FIXTURE_COUNT; index++) {
    const username = fixtureUsername(index);
    // member.wallet_id is notNullable, unique and a foreign key, so each needs its own.
    const [walletId] = await knex('wallet').insert({});
    const [memberId] = await knex('member').insert({
      username,
      email: `${username}@example.invalid`,
      password: UNUSABLE_PASSWORD,
      wallet_id: walletId,
    });
    memberIds.push(memberId);
  }
  console.log(
    `Created ${memberIds.length} fixture members ` +
    `(${fixtureUsername(1)}..${fixtureUsername(FIXTURE_COUNT)})`,
  );
  return memberIds;
}

export async function seed(knex: Knex): Promise<void> {
  console.log('Seeding role assignments');

  const roles = await resolveRoles(knex, [
    'Colony Leader', 'Colony Deputy',
    'Neighborhood Leader', 'Neighborhood Deputy',
    'Block Leader', 'Block Deputy',
    'City Guide',
  ]);

  await removePreviousFixtures(knex);
  const members = await createFixtureMembers(knex);

  // Ordered deterministically so re-running produces the same assignments.
  const colonies = await knex('place').select('id', 'name')
    .where('type', 'colony').orderBy('id');
  const hoods = await knex('place').select('id', 'name')
    .where('type', 'hood').orderBy('id').limit(HOODS_TO_STAFF);
  const blocks = await knex('place').select('id', 'name')
    .where('type', 'block').orderBy('id').limit(BLOCKS_TO_STAFF);

  if (!colonies.length) {
    throw new Error(
      'role_assignment seed: no colony places found. Run the place seeds (02/03/04) first.',
    );
  }

  const assignments: { member_id: number; role_id: number; place_id: number }[] = [];
  const assign = (memberIndex: number, roleId: number, placeId: number) =>
    assignments.push({
      member_id: members[memberIndex % members.length],
      role_id: roleId,
      place_id: placeId,
    });

  // Colonies: leader + deputy, drawn from the front of the pool.
  colonies.forEach((colony, i) => {
    assign(i, roles['Colony Leader'], colony.id);
    assign(i + 1, roles['Colony Deputy'], colony.id);
  });

  // Hoods and blocks: offset into the pool so the same members pick up several offices at
  // different levels. That overlap is the point -- it is what exercises multi-role
  // reconciliation and, once hierarchical inheritance lands, authority flowing downward.
  hoods.forEach((hood, i) => {
    assign(i + 2, roles['Neighborhood Leader'], hood.id);
    assign(i + 3, roles['Neighborhood Deputy'], hood.id);
  });
  blocks.forEach((block, i) => {
    assign(i + 5, roles['Block Leader'], block.id);
    assign(i + 6, roles['Block Deputy'], block.id);
  });

  // A city-wide role with no place scope. place_id is nullable precisely for these: the RE
  // distinguishes city offices from the per-instance geographic roles above.
  assign(FIXTURE_COUNT - 1, roles['City Guide'], null as any);

  await knex('role_assignment').insert(assignments);

  const perRole = assignments.reduce<Record<number, number>>((acc, a) => {
    acc[a.role_id] = (acc[a.role_id] || 0) + 1;
    return acc;
  }, {});
  const nameById = Object.fromEntries(Object.entries(roles).map(([n, id]) => [id, n]));

  console.log(`Inserted ${assignments.length} role assignments across ` +
    `${colonies.length} colonies, ${hoods.length} hoods, ${blocks.length} blocks:`);
  for (const [roleId, count] of Object.entries(perRole)) {
    console.log(`  ${count.toString().padStart(3)}  ${nameById[roleId]}`);
  }

  const multiOffice = Object.values(
    assignments.reduce<Record<number, number>>((acc, a) => {
      acc[a.member_id] = (acc[a.member_id] || 0) + 1;
      return acc;
    }, {}),
  ).filter(count => count > 1).length;
  console.log(`  ${multiOffice} fixture members hold more than one office`);
}
