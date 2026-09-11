import { Knex } from 'knex';

import { seed } from '../db/seed/14-avatars.outlands.seed';

/**
 * The five Outlands avatars have to end up in the database whatever state it
 * starts in. The rule this guards against is the one that shipped first:
 * "if any one of the five file names is already there, skip all five", which
 * left a database that had lost four of them stuck with one forever.
 *
 * The seed only ever calls knex('avatar').whereIn(...).orWhereIn(...) and
 * knex('avatar').insert(...), so an `avatar` table kept in an array is enough to
 * run it for real - no socket, which is what every other unit spec here assumes.
 */
type Row = {
  id: number;
  name: string;
  filename: string;
  image: string;
  directory: string;
  status: number;
  private: number;
};

const REQUIRED: Row[] = [
  { id: 12, name: 'Outlands Game Master', filename: 'gm.wrl', image: 'gm.jpg',
    directory: '12', status: 1, private: 0 },
  { id: 13, name: 'Outlands Blue Team (female)', filename: 'bluef.wrl', image: 'bluef.jpg',
    directory: '13', status: 1, private: 0 },
  { id: 14, name: 'Outlands Blue Team (male)', filename: 'bluem.wrl', image: 'bluem.jpg',
    directory: '14', status: 1, private: 0 },
  { id: 15, name: 'Outlands Red Team (female)', filename: 'redf.wrl', image: 'redf.jpg',
    directory: '15', status: 1, private: 0 },
  { id: 16, name: 'Outlands Red Team (male)', filename: 'redm.wrl', image: 'redm.jpg',
    directory: '16', status: 1, private: 0 },
];

/** The row every database already has, so "leave rows you do not own alone" is testable. */
const UNRELATED: Row = {
  id: 11, name: 'Sparkie', filename: 'sparkie.wrl', image: 'sparkie.jpg',
  directory: '11', status: 1, private: 0,
};

type Matcher = (row: Row) => boolean;

/**
 * A hand-built `avatar` table: the smallest knex the seed can run against. Every
 * way of changing a row the seed must never use throws instead of working, so a
 * seed that starts updating or deleting fails here rather than in production.
 */
interface FakeBuilder {
  whereIn(column: keyof Row, values: unknown[]): FakeBuilder;
  orWhereIn(column: keyof Row, values: unknown[]): FakeBuilder;
  insert(added: Row[]): Promise<number[]>;
  update(): never;
  del(): never;
  delete(): never;
  truncate(): never;
  then(resolve: (rows: Row[]) => unknown, reject: (err: Error) => unknown): Promise<unknown>;
}

function fakeDb(rows: Row[]): Knex & { rows: Row[] } {
  const table: Row[] = rows.map(row => ({ ...row }));
  const forbid = (method: string) => (): never => {
    throw new Error(`the seed called ${method}, which can change a row it does not own`);
  };
  const open = (tableName: string): FakeBuilder => {
    if (tableName !== 'avatar') throw new Error(`the seed touched ${tableName}, not avatar`);
    const matchers: Matcher[] = [];
    const whereIn = (column: keyof Row, values: unknown[]): FakeBuilder => {
      matchers.push(row => values.indexOf(row[column]) > -1);
      return builder;
    };
    const builder: FakeBuilder = {
      whereIn,
      orWhereIn: whereIn,
      insert(added: Row[]): Promise<number[]> {
        table.push(...added.map(row => ({ ...row })));
        return Promise.resolve([]);
      },
      update: forbid('update'),
      del: forbid('del'),
      delete: forbid('delete'),
      truncate: forbid('truncate'),
      then(resolve, reject) {
        const found = matchers.length
          ? table.filter(row => matchers.some(matches => matches(row)))
          : table.slice();
        return Promise.resolve(found).then(resolve, reject);
      },
    };
    return builder;
  };
  const knex = open as unknown as Knex & { rows: Row[] };
  knex.rows = table;
  return knex;
}

/** Every required row, exactly as it has to end up, and nothing duplicated. */
function expectTheFive(table: Row[]): void {
  for (const wanted of REQUIRED) {
    expect(table.filter(row => row.id === wanted.id)).toEqual([ wanted ]);
    expect(table.filter(row => row.filename === wanted.filename).length).toBe(1);
  }
}

describe('14-avatars.outlands.seed', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('creates all five on a clean database', async () => {
    const db = fakeDb([ UNRELATED ]);
    await seed(db);
    expectTheFive(db.rows);
    expect(db.rows.length).toBe(6);
  });

  it('is a no-op the second time it runs', async () => {
    const db = fakeDb([ UNRELATED ]);
    await seed(db);
    await seed(db);
    expectTheFive(db.rows);
    expect(db.rows.length).toBe(6);
  });

  it('is a no-op when all five are already there', async () => {
    const db = fakeDb([ UNRELATED, ...REQUIRED ]);
    await expect(seed(db)).resolves.toBeUndefined();
    expectTheFive(db.rows);
    expect(db.rows.length).toBe(6);
  });

  /*
   * This is the state independent QA failed on: a database holding only
   * bluef.wrl / id 13. The rule that shipped first saw that one row and skipped
   * the other four, so the database stayed at one Outlands avatar for good.
   */
  it('completes a database that kept only bluef.wrl / id 13', async () => {
    const kept = REQUIRED.filter(row => row.filename === 'bluef.wrl');
    const db = fakeDb([ UNRELATED, ...kept ]);
    await seed(db);
    expectTheFive(db.rows);
    expect(db.rows.length).toBe(6);
  });

  it('completes a database that kept gm.wrl and redm.wrl', async () => {
    const kept = REQUIRED.filter(row => row.filename === 'gm.wrl' || row.filename === 'redm.wrl');
    const db = fakeDb([ UNRELATED, ...kept ]);
    await seed(db);
    expectTheFive(db.rows);
    expect(db.rows.length).toBe(6);
  });

  it('refuses to take an id another avatar already owns', async () => {
    const squatter: Row = {
      ...UNRELATED, id: 14, filename: 'unrelated-avatar.wrl',
      image: 'unrelated-avatar.jpg', directory: '14',
    };
    const db = fakeDb([ squatter ]);
    await expect(seed(db)).rejects.toThrow(/id 14 is already unrelated-avatar\.wrl/);
    expect(db.rows).toEqual([ squatter ]);
  });

  it('refuses to move a required file name off the id that has it', async () => {
    const misplaced: Row = {
      ...UNRELATED, id: 40, filename: 'bluem.wrl', image: 'bluem.jpg', directory: '40',
    };
    const db = fakeDb([ misplaced ]);
    await expect(seed(db)).rejects.toThrow(/bluem\.wrl is already avatar id 40/);
    expect(db.rows).toEqual([ misplaced ]);
  });

  it('leaves the rows it does not own alone while completing a partial database', async () => {
    const db = fakeDb([ UNRELATED, ...REQUIRED.slice(0, 2) ]);
    await seed(db);
    expectTheFive(db.rows);
    expect(db.rows.filter(row => row.id === UNRELATED.id)).toEqual([ UNRELATED ]);
    expect(db.rows.length).toBe(6);
  });
});
