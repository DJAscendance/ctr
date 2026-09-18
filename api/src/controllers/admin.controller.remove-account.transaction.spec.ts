import { Request, Response } from 'express';
import { Knex } from 'knex';
import { Container } from 'typedi';

import { Db } from '../db/db.class';
import {
  AdminAuditEventRepository,
  AvatarRepository,
  BanRepository,
  ClubMemberRepository,
  HomeRepository,
  InboxRepository,
  MapLocationRepository,
  MemberRepository,
  MessageRepository,
  MessageboardRepository,
  ObjectInstanceRepository,
  ObjectRepository,
  PlaceRepository,
  RoleAssignmentRepository,
  TransactionRepository,
  VirtualPetRepository,
  VoteRepository,
  WalletRepository,
} from '../repositories';
import {
  AdminAuditService,
  AdminService,
  AvatarService,
  ClubService,
  InboxService,
  MemberService,
  MessageService,
  MessageboardService,
  ObjectInstanceService,
  ObjectService,
  PlaceService,
  RoleAssignmentService,
} from '../services';
import { AdminController } from './admin.controller';

/**
 * Transaction identity for admin account removal.
 *
 * The rollback tests in `admin.controller.remove-account.spec.ts` prove that a failure
 * undoes the writes. They cannot prove WHY, and a sequence that quietly left one write
 * outside the transaction would still roll back most of the time. This spec answers the
 * other half: every participating repository is handed the SAME transaction object, and
 * none of them is handed none.
 *
 * Nothing here touches a database. The services and repositories are the real wired
 * objects, but every destructive repository method is replaced by a recorder, so the run
 * only exercises how the transaction is passed along.
 */

/** Stands in for a knex transaction; identity is the only thing asserted about it. */
const TRANSACTION = { id: 'the-one-transaction' } as unknown as Knex.Transaction;

const MEMBER_ID = 4242;
const WALLET_ID = 77;
const HOME_PLACE_ID = 11;
const CLUB_PLACE_ID = 12;

/** Every repository write the removal path reaches, and the method it reaches it by. */
const PARTICIPANTS: ReadonlyArray<[unknown, string]> = [
  [ObjectInstanceRepository, 'moveAllObjects'],
  [ObjectRepository, 'removeAccount'],
  [MessageRepository, 'removeAllMessages'],
  [MessageRepository, 'removeAllPlaceMessages'],
  [InboxRepository, 'removeAllMessages'],
  [InboxRepository, 'removeAllPlaceMessages'],
  [MessageboardRepository, 'removeAllMessages'],
  [MessageboardRepository, 'removeAllPlaceMessages'],
  [AvatarRepository, 'removeAllAvatars'],
  [ClubMemberRepository, 'removeAccount'],
  [ClubMemberRepository, 'removeAllMembers'],
  [VirtualPetRepository, 'removeVirtualPet'],
  [RoleAssignmentRepository, 'removeRoleAssignment'],
  [RoleAssignmentRepository, 'removeAllByUserId'],
  [VoteRepository, 'removePlace'],
  [VoteRepository, 'removeListByUserId'],
  [VoteRepository, 'removeResponseByUserId'],
  [PlaceRepository, 'removePlace'],
  [HomeRepository, 'removePlace'],
  [MapLocationRepository, 'removePlace'],
  [BanRepository, 'removeAllByUserId'],
  [TransactionRepository, 'removeAllByWalletId'],
  [MemberRepository, 'removeAccount'],
  [WalletRepository, 'removeAccount'],
  // The audit event is a participant, not an afterthought: baseline section 11 makes the
  // record part of what the removal owes, so it has to join the same transaction as the
  // writes it describes. If it ever stops being handed the transaction, the store could
  // hold an `allowed` row for a removal that rolled back.
  [AdminAuditEventRepository, 'insert'],
];

/** A repository seen as a bag of async methods, so a test can replace one of them. */
function asSpyTarget(repository: unknown): Record<string, () => Promise<unknown>> {
  return repository as Record<string, () => Promise<unknown>>;
}

/** A response double; this spec only needs the handler not to throw on it. */
function mockResponse(): Response & { statusCode?: number; body?: unknown } {
  const response = {} as Response & { statusCode?: number; body?: unknown };
  response.status = jest.fn().mockImplementation((code: number) => {
    response.statusCode = code;
    return response;
  });
  response.json = jest.fn().mockImplementation((body: unknown) => {
    response.body = body;
    return response;
  });
  return response;
}

describe('AdminController.removeAccount transaction identity', () => {
  let controller: AdminController;
  let memberService: MemberService;
  let recorded: Map<string, unknown[][]>;

  beforeEach(() => {
    memberService = Container.get(MemberService);
    controller = new AdminController(
      Container.get(AdminService),
      memberService,
      Container.get(AvatarService),
      Container.get(PlaceService),
      Container.get(RoleAssignmentService),
      Container.get(ObjectInstanceService),
      Container.get(ObjectService),
      Container.get(MessageService),
      Container.get(InboxService),
      Container.get(MessageboardService),
      Container.get(ClubService),
      Container.get(AdminAuditService),
    );

    jest.spyOn(memberService, 'decryptSession').mockReturnValue({ id: 1 } as never);
    jest.spyOn(memberService, 'canAdmin').mockResolvedValue(true as never);
    // The boundary itself: hand the sequence one transaction and run it.
    jest.spyOn(memberService, 'runInTransaction')
      .mockImplementation(work => work(TRANSACTION) as never);

    recorded = new Map();
    for (const [repository, method] of PARTICIPANTS) {
      const target = asSpyTarget(Container.get(repository as never));
      const key = `${(repository as { name: string }).name}.${method}`;
      const calls: unknown[][] = [];
      recorded.set(key, calls);
      jest.spyOn(target, method).mockImplementation((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(undefined);
      });
    }
    // Reads the sequence makes along the way, answered so it reaches every write.
    jest.spyOn(asSpyTarget(Container.get(MemberRepository)), 'lockMember')
      .mockResolvedValue({ id: MEMBER_ID, wallet_id: WALLET_ID });
    jest.spyOn(asSpyTarget(Container.get(MemberRepository)), 'findById')
      .mockResolvedValue({ id: MEMBER_ID, wallet_id: WALLET_ID });
    jest.spyOn(asSpyTarget(Container.get(PlaceRepository)), 'findByUserId')
      .mockResolvedValue([
        { id: HOME_PLACE_ID, type: 'home' },
        { id: CLUB_PLACE_ID, type: 'club' },
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Nothing here queries, but resolving the services builds a `Db`, and its pool keeps the
  // jest worker alive until it is closed.
  afterAll(async () => {
    await Container.get(Db).knex.destroy();
  });

  it('hands every participating repository the one transaction', async () => {
    const response = mockResponse();

    await controller.removeAccount(
      { body: { id: MEMBER_ID }, headers: { apitoken: 't' } } as unknown as Request,
      response,
    );

    expect(response.statusCode).toBe(200);
    const missing: string[] = [];
    const wrong: string[] = [];
    for (const [key, calls] of recorded) {
      if (!calls.length) {
        missing.push(key);
        continue;
      }
      for (const args of calls) {
        if (!args.includes(TRANSACTION)) {
          wrong.push(`${key}(${args.length} args)`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(wrong).toEqual([]);
    expect(recorded.size).toBe(PARTICIPANTS.length);
  });

  it('locks the member row before the first destructive write', async () => {
    const lock = jest.spyOn(asSpyTarget(Container.get(MemberRepository)), 'lockMember')
      .mockResolvedValue({ id: MEMBER_ID, wallet_id: WALLET_ID });
    const firstWrite = jest
      .spyOn(asSpyTarget(Container.get(ObjectInstanceRepository)), 'moveAllObjects');
    const response = mockResponse();

    await controller.removeAccount(
      { body: { id: MEMBER_ID }, headers: { apitoken: 't' } } as unknown as Request,
      response,
    );

    expect(lock).toHaveBeenCalledWith(TRANSACTION, MEMBER_ID);
    expect(lock.mock.invocationCallOrder[0])
      .toBeLessThan(firstWrite.mock.invocationCallOrder[0]);
  });

  it('stops at the first failure instead of running later deletions', async () => {
    jest.spyOn(asSpyTarget(Container.get(AvatarRepository)), 'removeAllAvatars')
      .mockRejectedValue(new Error('forced failure'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const later = jest.spyOn(asSpyTarget(Container.get(MemberRepository)), 'removeAccount');
    const response = mockResponse();

    await controller.removeAccount(
      { body: { id: MEMBER_ID }, headers: { apitoken: 't' } } as unknown as Request,
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(later).not.toHaveBeenCalled();
  });

  it('refuses an id with no member without touching a single write', async () => {
    jest.spyOn(asSpyTarget(Container.get(MemberRepository)), 'lockMember')
      .mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const firstWrite = jest
      .spyOn(asSpyTarget(Container.get(ObjectInstanceRepository)), 'moveAllObjects');
    const response = mockResponse();

    await controller.removeAccount(
      { body: { id: MEMBER_ID }, headers: { apitoken: 't' } } as unknown as Request,
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'Account removal failed.' });
    expect(firstWrite).not.toHaveBeenCalled();
  });
});
