import { Container } from 'typedi';

import { mockDb } from '@spec/mocks';
import { Db } from '../../db/db.class';
import { Member, Wallet } from 'models';
import { MemberRepository} from './member.repository';

describe('MemberRepository', () => {
  const fakeMember: Partial<Member> = {
    id: 11,
    username: 'foo',
    password: 'foopassword',
    email: 'foo@foo.com',
  };
  const fakeWallet: Partial<Wallet> = { id: 42 };
  let repository: MemberRepository;

  beforeEach(() => {
    mockDb.knex.transaction.mockResolvedValue(fakeMember.id);
    Container.reset();
    Container.set(Db, mockDb);
    repository = Container.get(MemberRepository);
  });

  it('should create', () => {
    expect(repository).toBeTruthy();
  });

  describe('create', () => {
    let walletInsert;
    let memberInsert;
    let transactionInsert;
    let walletIncrement;
    let walletWhere;

    beforeEach(async () => {
      walletInsert = jest.fn().mockResolvedValue([fakeWallet.id]);
      memberInsert = jest.fn().mockResolvedValue([fakeMember.id]);
      transactionInsert = jest.fn().mockResolvedValue([1]);
      walletIncrement = jest.fn().mockResolvedValue(1);
      walletWhere = jest.fn().mockReturnValue({ increment: walletIncrement });

      await repository.create(fakeMember);
      await mockDb.knex.transaction.mock.lastCall[0](tableName => {
        switch (tableName) {
        case 'wallet':
          return { insert: walletInsert, where: walletWhere };
        case 'member':
          return { insert: memberInsert };
        case 'transaction':
          return { insert: transactionInsert };
        }
      });
    });

    it('should create a wallet for a new member', () => {
      expect(walletInsert).toHaveBeenCalled();
    });
    it('should open the wallet empty rather than relying on the column default', () => {
      // The immigration grant is credited explicitly below so that it leaves a ledger row.
      // Opening at the schema's DEFAULT would silently add money nothing can account for.
      expect(walletInsert).toHaveBeenCalledWith({ balance: 0 });
    });
    it('should assign a wallet id to the new member', () => {
      expect(memberInsert).toHaveBeenCalledWith(
        expect.objectContaining({ wallet_id: fakeWallet.id }),
      );
    });
    it('should tell the database to create a member with the provided name and email', () => {
      expect(memberInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'foo@foo.com',
          username: 'foo',
        }),
      );
    });
    it('should credit the new citizen their immigration grant', () => {
      // `m_immigrate` -- see libs/economy.ts for the config file this comes from.
      expect(walletWhere).toHaveBeenCalledWith({ id: fakeWallet.id });
      expect(walletIncrement).toHaveBeenCalledWith('balance', 20000);
    });
    it('should record the immigration grant in the ledger', () => {
      expect(transactionInsert).toHaveBeenCalledWith({
        amount: 20000,
        reason: 'immigration-grant',
        recipient_wallet_id: fakeWallet.id,
      });
    });
    it('should return the id of the new member', async () => {
      const id = await repository.create(fakeMember);
      expect(id).toBe(fakeMember.id);
    });
  });
});
