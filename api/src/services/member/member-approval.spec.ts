jest.mock('../../libs/mail', () => ({
  sendMemberApprovedEmail: jest.fn().mockResolvedValue(undefined),
}));

import bcrypt from 'bcrypt';
import { createSpyObj } from 'jest-createspyobj';
import { Container } from 'typedi';

import { MemberService } from './member.service';
import { Member } from 'models';
import {
  AvatarRepository,
  CreditRepository,
  MemberRepository,
  RoleAssignmentRepository,
  TransactionRepository,
  WalletRepository,
} from '../../repositories';
import { sendMemberApprovedEmail } from '../../libs/mail';

/**
 * The manual-approval gate.
 *
 * Half of these tests exist to prove the gate is INVISIBLE when it is off, because that is
 * the promise made to every deployment that does not want it -- including production.
 */
describe('MemberService immigration approval', () => {
  const originalEnv = process.env;
  let memberRepository: jest.Mocked<MemberRepository>;
  let creditRepository: jest.Mocked<CreditRepository>;
  let service: MemberService;
  let approvedMember: Partial<Member>;
  let pendingMember: Partial<Member>;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.MEMBER_APPROVAL_REQUIRED;
    process.env.JWT_SECRET = 'test-secret';

    const password = await bcrypt.hash('correct-horse', 4);
    approvedMember = {
      id: 11,
      username: 'approved',
      email: 'approved@example.com',
      password,
      status: 1,
      approved_at: new Date('2026-01-01T00:00:00Z'),
    };
    pendingMember = {
      id: 12,
      username: 'pending',
      email: 'pending@example.com',
      password,
      status: 1,
      approved_at: null,
    };

    memberRepository = createSpyObj(MemberRepository);
    memberRepository.findById.mockResolvedValue(pendingMember as Member);
    memberRepository.approve.mockResolvedValue(true);
    memberRepository.findPendingApproval.mockResolvedValue([pendingMember]);
    memberRepository.reconcileFirstHomesteadXp.mockResolvedValue(false);
    creditRepository = createSpyObj(CreditRepository);
    creditRepository.giveDailyCredit.mockResolvedValue({ credited: true });

    Container.reset();
    Container.set(AvatarRepository, createSpyObj(AvatarRepository));
    Container.set(CreditRepository, creditRepository);
    Container.set(MemberRepository, memberRepository);
    const roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleAssignmentRepository.getByMemberId.mockResolvedValue([]);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(TransactionRepository, createSpyObj(TransactionRepository));
    Container.set(WalletRepository, createSpyObj(WalletRepository));
    service = Container.get(MemberService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('with approval NOT required (the default, and production)', () => {
    it('reports that approval is not required', () => {
      expect(service.isApprovalRequired()).toBe(false);
    });

    it('logs in a member who was never approved, exactly as before', async () => {
      memberRepository.find.mockResolvedValue(pendingMember as Member);

      await expect(service.login('pending', 'correct-horse')).resolves.toEqual(
        expect.any(String),
      );
    });

    it('never calls a member pending', async () => {
      await expect(service.isPendingApproval(12)).resolves.toBe(false);
      // Proven by behaviour, not by the flag: the member row is not even consulted.
      expect(memberRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('with approval required', () => {
    beforeEach(() => {
      process.env.MEMBER_APPROVAL_REQUIRED = 'true';
    });

    it('refuses to log in a member who has not been approved', async () => {
      memberRepository.find.mockResolvedValue(pendingMember as Member);

      await expect(service.login('pending', 'correct-horse')).rejects.toThrow(
        MemberService.PENDING_APPROVAL_ERROR,
      );
    });

    it('does not burn the daily login credit on a refused attempt', async () => {
      memberRepository.find.mockResolvedValue(pendingMember as Member);

      await expect(service.login('pending', 'correct-horse')).rejects.toThrow();
      expect(creditRepository.giveDailyCredit).not.toHaveBeenCalled();
    });

    it('still logs in an approved member', async () => {
      memberRepository.find.mockResolvedValue(approvedMember as Member);

      await expect(service.login('approved', 'correct-horse')).resolves.toEqual(
        expect.any(String),
      );
    });

    it('rejects a wrong password before it ever mentions approval', async () => {
      // Otherwise the pending queue becomes a username oracle for anyone guessing.
      memberRepository.find.mockResolvedValue(pendingMember as Member);

      await expect(service.login('pending', 'wrong')).rejects.toThrow(
        'Incorrect login details.',
      );
    });

    it('reports a member with no approval as pending', async () => {
      memberRepository.findById.mockResolvedValue(pendingMember as Member);
      await expect(service.isPendingApproval(12)).resolves.toBe(true);
    });

    it('reports an approved member as not pending', async () => {
      memberRepository.findById.mockResolvedValue(approvedMember as Member);
      await expect(service.isPendingApproval(11)).resolves.toBe(false);
    });
  });

  describe('createMember', () => {
    it('creates the account without issuing a token', async () => {
      memberRepository.create.mockResolvedValue(99);

      const memberId = await service.createMember('a@b.com', 'newbie', 'pw');

      expect(memberId).toBe(99);
      expect(creditRepository.giveDailyCredit).not.toHaveBeenCalled();
    });

    it('stores a hash, never the raw password', async () => {
      memberRepository.create.mockResolvedValue(99);

      await service.createMember('a@b.com', 'newbie', 'pw');

      const stored = memberRepository.create.mock.calls[0][0];
      expect(stored.password).not.toBe('pw');
      await expect(bcrypt.compare('pw', stored.password)).resolves.toBe(true);
    });
  });

  describe('approveMember', () => {
    it('approves and emails the applicant', async () => {
      memberRepository.findById.mockResolvedValue(pendingMember as Member);

      await expect(service.approveMember(12, 1)).resolves.toBe(true);

      expect(memberRepository.approve).toHaveBeenCalledWith(12, 1);
      expect(sendMemberApprovedEmail).toHaveBeenCalledWith(
        'pending@example.com',
        'pending',
      );
    });

    it('sends no email when the member was already approved', async () => {
      memberRepository.approve.mockResolvedValue(false);

      await expect(service.approveMember(12, 1)).resolves.toBe(false);
      expect(sendMemberApprovedEmail).not.toHaveBeenCalled();
    });

    it('keeps the approval when the email cannot be sent', async () => {
      memberRepository.findById.mockResolvedValue(pendingMember as Member);
      (sendMemberApprovedEmail as jest.Mock).mockRejectedValueOnce(
        new Error('no mail server'),
      );

      await expect(service.approveMember(12, 1)).resolves.toBe(true);
    });
  });

  describe('listPendingApproval', () => {
    it('returns the queue', async () => {
      await expect(service.listPendingApproval()).resolves.toEqual([pendingMember]);
    });
  });
});
