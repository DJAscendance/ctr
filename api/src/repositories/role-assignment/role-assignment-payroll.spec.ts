import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { RoleAssignmentRepository } from './role-assignment.repository';

/**
 * Guards the predicate that keeps non-earning roles out of the weekly payroll.
 *
 * getMembersDueRoleCredit's inner join was there only to test "does this member hold a
 * job", with no income filter - so ANY role_assignment row qualified, including roles that
 * pay nothing (Admin is one; place-scoped Home Chat Guest assignments are another). Those
 * members reached giveWeeklyRoleCredit unconditionally, which writes a 0-CityCash
 * `weekly-role-credit` row and stamps last_weekly_role_credit - and, because the batch is
 * capped by `limit`, displaced members who had actually earned pay.
 *
 * Home chat access would have multiplied that: up to eight assignments per home.
 *
 * The predicate is "pays CityCash OR pays XP", not "pays CityCash". The two are independent
 * columns, so filtering on CityCash alone would silently stop an XP-only role accruing XP.
 * No seeded role is XP-only today, which is exactly why that would have gone unnoticed -
 * hence the explicit test below.
 *
 * Asserted against a recording query builder rather than a live database: what matters here
 * is that the predicate reaches BOTH the eligibility query and the highest-paying-role
 * lookup. Behaviour against real MySQL is covered by the fixture run recorded in
 * docs/beta-home-reconciliation.md.
 */
describe('RoleAssignmentRepository payroll eligibility', () => {
  let calls: Array<{ method: string; args: any[] }>;
  let service: RoleAssignmentRepository;

  /** A chainable knex stand-in that records every builder call made against it. */
  function recordingBuilder(resolvesTo: any) {
    const record = (method: string) => (...args: any[]) => {
      calls.push({ method, args });
      return builder;
    };
    const builder: any = {
      select: record('select'),
      from: record('from'),
      innerJoin: record('innerJoin'),
      where: (...args: any[]) => {
        calls.push({ method: 'where', args });
        // knex passes a callback for a grouped OR; run it against a nested recorder so the
        // branches inside the group are captured too.
        if (typeof args[0] === 'function') {
          const group: any = {
            where: (...a: any[]) => {
              calls.push({ method: 'group.where', args: a });
              return group;
            },
            orWhere: (...a: any[]) => {
              calls.push({ method: 'group.orWhere', args: a });
              return group;
            },
          };
          args[0](group);
        }
        return builder;
      },
      whereRaw: record('whereRaw'),
      limit: record('limit'),
      distinct: record('distinct'),
      orderBy: record('orderBy'),
      first: (...args: any[]) => {
        calls.push({ method: 'first', args });
        return Promise.resolve(resolvesTo.first);
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(resolvesTo.rows).then(resolve, reject),
    };
    return builder;
  }

  beforeEach(() => {
    calls = [];
    const db: any = {
      knex: Object.assign(
        () => recordingBuilder({ rows: [], first: undefined }),
        recordingBuilder({ rows: [], first: undefined }),
      ),
    };
    Container.reset();
    Container.set(Db, db);
    service = Container.get(RoleAssignmentRepository);
  });

  function whereCalls() {
    return calls.filter(call => call.method === 'where');
  }

  it('joins role and filters eligibility to income-bearing roles', async () => {
    await service.getMembersDueRoleCredit(20);

    const joinedRole = calls.some(
      call => call.method === 'innerJoin'
        && call.args[0] === 'role'
        && call.args[1] === 'role_assignment.role_id',
    );
    expect(joinedRole).toBe(true);

    // The predicate is a grouped OR: pays CityCash OR pays XP.
    const ccBranch = calls.some(
      c => c.method === 'group.where'
        && c.args[0] === 'role.income_cc' && c.args[1] === '>' && c.args[2] === 0,
    );
    const xpBranch = calls.some(
      c => c.method === 'group.orWhere'
        && c.args[0] === 'role.income_xp' && c.args[1] === '>' && c.args[2] === 0,
    );
    expect(ccBranch).toBe(true);
    expect(xpBranch).toBe(true);
  });

  it('does not filter on CityCash alone, which would drop XP-only roles', async () => {
    await service.getMembersDueRoleCredit(20);

    // A bare .where('role.income_cc','>',0) outside the OR group would silently stop an
    // XP-only role from ever accruing XP.
    const bareCcFilter = whereCalls().some(
      call => call.args[0] === 'role.income_cc',
    );
    expect(bareCcFilter).toBe(false);
  });

  it('still restricts eligibility to active members', async () => {
    await service.getMembersDueRoleCredit(20);

    const statusFilter = whereCalls().some(
      call => call.args[0] === 'member.status' && call.args[1] === 1,
    );
    expect(statusFilter).toBe(true);
  });

  it('applies the income filter to the highest-paying-role lookup too', async () => {
    // Without it, a member who holds BOTH an earning role and a zero-income one could still
    // have the zero-income row selected if it sorted first.
    const db: any = {
      knex: Object.assign(
        () => recordingBuilder({ rows: [], first: undefined }),
        recordingBuilder({
          rows: [{ id: 1, wallet_id: 2, xp: 3 }],
          first: { role_id: 9, income_cc: 50, income_xp: 5 },
        }),
      ),
    };
    Container.reset();
    Container.set(Db, db);
    service = Container.get(RoleAssignmentRepository);
    calls = [];

    await service.getMembersDueRoleCredit(20);

    const ccBranches = calls.filter(
      c => c.method === 'group.where' && c.args[0] === 'role.income_cc',
    );
    const xpBranches = calls.filter(
      c => c.method === 'group.orWhere' && c.args[0] === 'role.income_xp',
    );
    // One group on the eligibility query, one on the per-member role lookup.
    expect(ccBranches.length).toBeGreaterThanOrEqual(2);
    expect(xpBranches.length).toBeGreaterThanOrEqual(2);
  });
});
