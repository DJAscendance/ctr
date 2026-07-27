import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { RoleAssignmentRepository } from './role-assignment.repository';

/**
 * Guards the predicate that keeps non-earning roles out of the weekly payroll.
 *
 * getMembersDueRoleCredit's inner join was there only to test "does this member hold a
 * job", with no income filter - so ANY role_assignment row qualified, including roles
 * seeded with income_cc = 0 (Admin is one; place-scoped Home Chat Guest assignments are
 * another). Those members reached giveWeeklyRoleCredit unconditionally, which writes a
 * 0-CityCash `weekly-role-credit` row and stamps last_weekly_role_credit - and, because the
 * batch is capped by `limit`, displaced members who had actually earned pay.
 *
 * Home chat access would have multiplied that: up to eight assignments per home. Rather
 * than model chat guests as something payroll cannot see, the query now says what its own
 * comment always claimed - only income-bearing roles count as holding a job.
 *
 * Asserted against a recording query builder rather than a live database: what matters is
 * that the income predicate is applied to BOTH the eligibility query and the
 * highest-paying-role lookup, which is exactly what the builder calls express.
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
      where: record('where'),
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

    const incomeFilter = whereCalls().some(
      call => call.args[0] === 'role.income_cc' && call.args[1] === '>' && call.args[2] === 0,
    );
    expect(incomeFilter).toBe(true);
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

    const incomeFilters = whereCalls().filter(
      call => call.args[0] === 'role.income_cc' && call.args[1] === '>' && call.args[2] === 0,
    );
    // One on the eligibility query, one on the per-member role lookup.
    expect(incomeFilters.length).toBeGreaterThanOrEqual(2);
  });
});
