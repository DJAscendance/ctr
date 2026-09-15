import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { MemberDataRepository } from './member-data.repository';

/**
 * A local chainable mock rather than @spec/mocks' shared one.
 *
 * This repository calls `db.knex('member_data')` as a FUNCTION and awaits the resulting
 * builder, whereas the shared mockDb exposes `knex` as a plain object whose builder is not
 * thenable -- awaiting it yields the builder itself, not rows. Rather than reshape a mock
 * every other repository spec depends on, this keeps the change contained.
 */
function queryBuilder(result: any) {
  const calls: any[][] = [];
  const qb: any = {
    calls,
    /** Makes the builder awaitable, which is how knex builders actually behave. */
    then: (resolve: (value: any) => void) => resolve(result),
  };
  [
    'select', 'where', 'andWhere', 'whereIn', 'orderBy',
    'insert', 'onConflict', 'merge', 'del', 'first',
  ].forEach(method => {
    qb[method] = jest.fn((...args: any[]) => {
      calls.push([method, ...args]);
      return qb;
    });
  });
  return qb;
}

/** The arguments of the first call to `method`, or undefined if it was never called. */
const argsOf = (qb: any, method: string): any[] | undefined =>
  qb.calls.find((call: any[]) => call[0] === method)?.slice(1);

const called = (qb: any, method: string): boolean =>
  qb.calls.some((call: any[]) => call[0] === method);

describe('MemberDataRepository', () => {
  const MEMBER = 11;
  let repository: MemberDataRepository;
  let qb: any;
  let knex: any;

  /**
   * Rest args rather than a default parameter: `.first()` resolves to undefined when there
   * is no row, and a default would turn an explicit useBuilder(undefined) into [], which is
   * truthy and would quietly test the opposite of the no-row case.
   */
  const useBuilder = (...result: any[]) => {
    qb = queryBuilder(result.length ? result[0] : []);
    knex.mockReturnValue(qb);
    return qb;
  };

  beforeEach(() => {
    knex = jest.fn();
    knex.transaction = jest.fn();
    Container.reset();
    Container.set(Db, { knex } as any);
    repository = Container.get(MemberDataRepository);
    useBuilder([]);
  });

  it('should create', () => {
    expect(repository).toBeTruthy();
  });

  describe('get', () => {
    it('returns the stored value', async () => {
      useBuilder({ value: 'hello' });
      expect(await repository.get(MEMBER, 'IMS')).toBe('hello');
    });

    /** Absent and empty must not be distinguishable to callers. */
    it('returns null when there is no row', async () => {
      useBuilder(undefined);
      expect(await repository.get(MEMBER, 'IMS')).toBeNull();
    });
  });

  describe('getAll', () => {
    it('reduces rows to a name -> value object', async () => {
      useBuilder([
        { name: 'IMS', value: '1' },
        { name: 'BU0', value: 'HawK' },
      ]);
      expect(await repository.getAll(MEMBER)).toEqual({ IMS: '1', BU0: 'HawK' });
    });

    it('is an empty object rather than null when nothing is stored', async () => {
      expect(await repository.getAll(MEMBER)).toEqual({});
    });
  });

  describe('getByPrefix', () => {
    it('matches on the prefix and orders by name', async () => {
      useBuilder([{ name: 'BU0', value: 'a' }]);
      await repository.getByPrefix(MEMBER, 'BU');
      expect(argsOf(qb, 'andWhere')).toEqual(['name', 'like', 'BU%']);
      expect(called(qb, 'orderBy')).toBe(true);
    });

    /**
     * '_' and '%' are LIKE wildcards. Unescaped, a prefix of 'BU_' would match 'BUxx' and a
     * caller could widen their own read past the family they asked for.
     */
    it('escapes LIKE wildcards in the prefix', async () => {
      await repository.getByPrefix(MEMBER, 'B_U%');
      expect(argsOf(qb, 'andWhere')).toEqual(['name', 'like', 'B\\_U\\%%']);
    });

    it('escapes a literal backslash too', async () => {
      await repository.getByPrefix(MEMBER, 'B\\U');
      expect(argsOf(qb, 'andWhere')).toEqual(['name', 'like', 'B\\\\U%']);
    });
  });

  describe('set', () => {
    it('upserts a real value', async () => {
      await repository.set(MEMBER, 'IMS', '1');
      expect(argsOf(qb, 'insert')).toEqual([{ member_id: MEMBER, name: 'IMS', value: '1' }]);
      expect(argsOf(qb, 'onConflict')).toEqual([['member_id', 'name']]);
      expect(called(qb, 'del')).toBe(false);
    });

    /**
     * "Unset" has to have exactly one representation, or a cleared buddy slot reads back as
     * '' from one path and null from another.
     */
    it.each([
      ['null', null],
      ['an empty string', ''],
      ['undefined', undefined],
    ])('deletes the row when given %s', async (_label, value) => {
      await repository.set(MEMBER, 'IMS', value as any);
      expect(called(qb, 'del')).toBe(true);
      expect(called(qb, 'insert')).toBe(false);
    });
  });

  describe('setMany', () => {
    /**
     * Runs the transaction callback against a trx that yields the same builder.
     *
     * Returns the builder WRAPPED, because the builder is thenable: returning it bare from
     * an async function makes the runtime await it, so the caller would receive the query
     * result ([]) instead of the builder whose calls they want to assert on.
     */
    const runTransaction = async (values: Record<string, string | null | undefined>) => {
      const trxBuilder = queryBuilder([]);
      const trx: any = jest.fn(() => trxBuilder);
      knex.transaction.mockImplementation(async (cb: any) => cb(trx));
      await repository.setMany(MEMBER, values);
      return { builder: trxBuilder };
    };

    it('does nothing at all when given no values', async () => {
      await repository.setMany(MEMBER, {});
      expect(knex.transaction).not.toHaveBeenCalled();
    });

    it('runs inside a transaction so a partial write cannot land', async () => {
      await runTransaction({ BU0: 'a' });
      expect(knex.transaction).toHaveBeenCalledTimes(1);
    });

    it('upserts the set values', async () => {
      const { builder: trxBuilder } = await runTransaction({ BU0: 'a', BU1: 'b' });
      expect(argsOf(trxBuilder, 'insert')).toEqual([[
        { member_id: MEMBER, name: 'BU0', value: 'a' },
        { member_id: MEMBER, name: 'BU1', value: 'b' },
      ]]);
    });

    it('deletes the cleared ones by name', async () => {
      const { builder: trxBuilder } = await runTransaction({ BU0: null, BU1: '', BU2: undefined });
      expect(argsOf(trxBuilder, 'whereIn')).toEqual(['name', ['BU0', 'BU1', 'BU2']]);
      expect(called(trxBuilder, 'del')).toBe(true);
    });

    /** A mixed batch has to do both halves, not pick one. */
    it('handles a mix of sets and clears in one call', async () => {
      const { builder: trxBuilder } = await runTransaction({ BU0: 'a', BU1: null });
      expect(argsOf(trxBuilder, 'whereIn')).toEqual(['name', ['BU1']]);
      expect(argsOf(trxBuilder, 'insert')).toEqual([[
        { member_id: MEMBER, name: 'BU0', value: 'a' },
      ]]);
    });

    it('does not issue a delete when nothing is being cleared', async () => {
      const { builder: trxBuilder } = await runTransaction({ BU0: 'a' });
      expect(called(trxBuilder, 'del')).toBe(false);
    });
  });

  describe('removeAllForMember', () => {
    it('deletes every attribute for the member', async () => {
      await repository.removeAllForMember(MEMBER);
      expect(argsOf(qb, 'where')).toEqual(['member_id', MEMBER]);
      expect(called(qb, 'del')).toBe(true);
    });
  });
});
