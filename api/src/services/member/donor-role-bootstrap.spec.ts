// Importing these services pulls in the repositories barrel, whose RoleRepository queries
// on construction. Without this the spec would try to open a real MySQL connection.
jest.mock('../../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { Db } from '../../db/db.class';
import { RoleRepository } from '../../repositories/role/role.repository';
import { AdminService } from '../admin/admin.services';
import { MemberService } from './member.service';

/**
 * The failure the freshly bootstrapped beta actually hit.
 *
 * Settling a home calls `getDonorLevel` before it creates anything. That resolved the four
 * donor role ids by reading `roleRepository.roleMap` directly, and on a process that
 * started before bootstrap seeded the roles every one of them was `undefined`. The
 * repository then built `whereIn('role_id', [undefined, undefined, undefined, undefined])`,
 * which knex refuses to compile at all -- so the request died with an undefined-binding
 * error rather than merely reporting the member as a non-donor. Restarting the API was the
 * only thing that cleared it.
 *
 * These specs assert the property that makes the restart unnecessary: after bootstrap has
 * run, the donor paths resolve real ids in the same process, and never hand a query a
 * binding that is not a number.
 */

interface RoleRow { id: number; name: string; }

const SEEDED_ROLES: RoleRow[] = [
  { id: 1, name: 'Admin' },
  { id: 75, name: 'Supporter' },
  { id: 76, name: 'Advocate' },
  { id: 77, name: 'Devotee' },
  { id: 78, name: 'Champion' },
];

/** A `role` table that is empty until the test says bootstrap has run. */
class FakeRoleTable {
  public rows: RoleRow[] = [];
}

/** A `Db` over one of those tables, shaped as the single call `findAll` makes. */
function dbFor(table: FakeRoleTable): Db {
  return {
    get role() {
      return { where: () => Promise.resolve([...table.rows]) };
    },
  } as unknown as Db;
}

/** Builds the argument list positionally, leaving every collaborator this path never uses null. */
function serviceArgs(count: number, provided: Record<number, unknown>): unknown[] {
  return Array.from({ length: count }, (_unused, index) => provided[index] ?? null);
}

describe('donor role resolution on a process that started before bootstrap', () => {
  it('resolves real donor ids for getDonorLevel without a restart', async () => {
    const table = new FakeRoleTable();
    const roleRepository = new RoleRepository(dbFor(table));
    const roleAssignmentRepository = { getDonor: jest.fn().mockResolvedValue(undefined) };

    // The API is up and the role table is still empty, exactly as at first deploy.
    await roleRepository.awaitRoleMap();

    // Bootstrap runs. Nothing restarts the API.
    table.rows = [...SEEDED_ROLES];

    const memberService = new MemberService(
      ...serviceArgs(13, { 8: roleAssignmentRepository, 10: roleRepository }) as
        ConstructorParameters<typeof MemberService>,
    );

    await memberService.getDonorLevel(42);

    expect(roleAssignmentRepository.getDonor).toHaveBeenCalledTimes(1);
    const [memberId, donorIds] = roleAssignmentRepository.getDonor.mock.calls[0];
    expect(memberId).toBe(42);
    expect(donorIds).toEqual({ supporter: 75, advocate: 76, devotee: 77, champion: 78 });
    // The binding-level statement of the same thing: knex rejects the query outright if
    // any of these is undefined, so "not undefined" is the property that matters.
    expect(Object.values(donorIds).every(id => typeof id === 'number')).toBe(true);
  });

  it('resolves real donor ids for addDonor without a restart', async () => {
    const table = new FakeRoleTable();
    const roleRepository = new RoleRepository(dbFor(table));
    const roleAssignmentRepository = { addDonor: jest.fn().mockResolvedValue(undefined) };

    await roleRepository.awaitRoleMap();
    table.rows = [...SEEDED_ROLES];

    const adminService = new AdminService(
      ...serviceArgs(13, { 5: roleAssignmentRepository, 6: roleRepository }) as
        ConstructorParameters<typeof AdminService>,
    );

    await adminService.addDonor(42, 'Champion');

    expect(roleAssignmentRepository.addDonor).toHaveBeenCalledTimes(1);
    const [memberId, donorIds] = roleAssignmentRepository.addDonor.mock.calls[0];
    expect(memberId).toBe(42);
    expect(donorIds).toEqual({
      supporter: 75,
      advocate: 76,
      devotee: 77,
      champion: 78,
      donorLevel: 78,
    });
    expect(Object.values(donorIds).every(id => typeof id === 'number')).toBe(true);
  });

  it('still resolves donor ids when the roles were already seeded at startup', async () => {
    const table = new FakeRoleTable();
    table.rows = [...SEEDED_ROLES];
    const roleRepository = new RoleRepository(dbFor(table));
    const roleAssignmentRepository = { getDonor: jest.fn().mockResolvedValue(undefined) };

    const memberService = new MemberService(
      ...serviceArgs(13, { 8: roleAssignmentRepository, 10: roleRepository }) as
        ConstructorParameters<typeof MemberService>,
    );

    await memberService.getDonorLevel(42);

    const [, donorIds] = roleAssignmentRepository.getDonor.mock.calls[0];
    expect(donorIds).toEqual({ supporter: 75, advocate: 76, devotee: 77, champion: 78 });
  });
});
