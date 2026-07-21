import bcrypt from 'bcrypt';
import { createSpyObj } from 'jest-createspyobj';
import { Container } from 'typedi';

import { MemberService } from './member.service';
import {
  Avatar,
  Member,
} from 'models';
import {
  AvatarRepository,
  MemberRepository,
  TransactionRepository,
  WalletRepository,
} from '../../repositories';

describe('MemberService', () => {
  const fakeAvatar: Partial<Avatar> = {
    id: 42,
  };
  const fakeMember: Partial<Member> = {
    id: 11,
    username: 'foo',
    last_daily_login_credit: new Date(),
    password: 'foopassword',
    email: 'foo@foo.com',
  };
  let avatarRepository: jest.Mocked<AvatarRepository>;
  let memberRepository: jest.Mocked<MemberRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let walletRepository: jest.Mocked<WalletRepository>;
  let service: MemberService;

  beforeEach(() => {
    avatarRepository = createSpyObj(AvatarRepository);
    avatarRepository.find.mockResolvedValue(fakeAvatar as Avatar);
    memberRepository = createSpyObj(MemberRepository);
    memberRepository.create.mockResolvedValue(fakeMember.id);
    memberRepository.find.mockResolvedValue(fakeMember as Member);
    memberRepository.findById.mockResolvedValue(fakeMember as Member);
    transactionRepository = createSpyObj(TransactionRepository);
    walletRepository = createSpyObj(WalletRepository);
    Container.reset();
    Container.set(AvatarRepository, avatarRepository);
    Container.set(MemberRepository, memberRepository);
    Container.set(TransactionRepository, transactionRepository);
    Container.set(WalletRepository, walletRepository);
    service = Container.get(MemberService);
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  describe('createMemberAndLogin', () => {
    beforeEach(async () => {
      await service.createMemberAndLogin(
        fakeMember.email,
        fakeMember.username,
        fakeMember.password,
      );
    });
    it('should tell the database to create a member with the provided name and email', () => {
      expect(memberRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: fakeMember.email,
          username: fakeMember.username,
        }),
      );
    });
    it('should not store the provided member password in clear text', () => {
      expect(memberRepository.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          password: fakeMember.password,
        }),
      );
    });
    it('should return a session token for the new member', async () => {
      const token = await service.createMemberAndLogin(
        fakeMember.email,
        fakeMember.username,
        fakeMember.password,
      );
      const fakeToken = await service.getMemberToken(fakeMember.id);
      expect(token).toBe(fakeToken);
    });
  });
  describe('hasReceivedLoginCreditToday', () => {
    let member;
    describe('when a member has already received a daily login credit', () => {
      beforeEach(() => {
        member = {
          ...fakeMember,
          last_daily_login_credit: new Date(),
        };
      });
      it('should return true', () => {
        expect(service.hasReceivedLoginCreditToday(member)).toBe(true);
      });
    });
    describe('when a member has not received a daily login credit today', () => {
      beforeEach(() => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() -1);
        member = {
          ...fakeMember,
          last_daily_login_credit: yesterday,
        };
      });
      it('should return false', () => {
        expect(service.hasReceivedLoginCreditToday(member)).toBe(false);
      });
    });
    describe('when a member recieved their login credit at exactly midnight today', () => {
      beforeEach(() => {
        const todayAtMidnight = new Date().setHours(0,0,0,0);
        member = {
          ...fakeMember,
          last_daily_login_credit: new Date(todayAtMidnight),
        };
      });
      it('should return true', () => {
        expect(service.hasReceivedLoginCreditToday(member)).toBe(true);
      });
    });
  });
  describe('login', () => {
    beforeEach(async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() -1);
      const fakeLoginMember = {
        ...fakeMember,
        last_daily_login_credit: yesterday,
        password: await bcrypt.hash(fakeMember.password, 10),
      } as Member;
      memberRepository.find.mockResolvedValue(fakeLoginMember);
      memberRepository.findById.mockResolvedValue(fakeLoginMember);
    });
    describe('when given a valid username and password', () => {
      beforeEach(async () => {
        await service.login(fakeMember.username, fakeMember.password);
      });
      it('gives daily xp to the member', () => {
        expect(memberRepository.update).toHaveBeenCalledWith(
          fakeMember.id,
          expect.objectContaining({ xp: expect.any(Number) }),
        );
      });
      it('updates the timestamp of when the user last received login credit', () => {
        expect(memberRepository.update).toHaveBeenCalledWith(
          fakeMember.id,
          expect.objectContaining({ last_daily_login_credit: expect.any(Date) }),
        );
      });
    });
  });

  describe('getDirectory', () => {
    beforeEach(() => {
      memberRepository.searchDirectory.mockResolvedValue([
        {
          username: 'withhome',
          created_at: new Date('2020-01-01'),
          last_activity: new Date(),
          primary_role_name: 'Citizen',
          home_id: 42,
        },
        {
          username: 'nohome',
          created_at: new Date('2020-01-01'),
          last_activity: null,
          primary_role_name: 'Citizen',
          home_id: null,
        },
      ]);
      memberRepository.getDirectoryTotal.mockResolvedValue([{ count: 2 }]);
    });

    it('returns hasHome: true for a citizen with a joined home', async () => {
      const { citizens } = await service.getDirectory('', 20, 0);
      expect(citizens.find(c => c.username === 'withhome').hasHome).toBe(true);
    });

    it('returns hasHome: false for a citizen without a home', async () => {
      const { citizens } = await service.getDirectory('', 20, 0);
      expect(citizens.find(c => c.username === 'nohome').hasHome).toBe(false);
    });

    it('does not include the internal member id on the public citizen object', async () => {
      const { citizens } = await service.getDirectory('', 20, 0);
      citizens.forEach(citizen => expect(citizen).not.toHaveProperty('id'));
    });

    it('does not include the home place id on the public citizen object', async () => {
      const { citizens } = await service.getDirectory('', 20, 0);
      citizens.forEach(citizen => expect(citizen).not.toHaveProperty('homeId'));
    });

    it('queries citizens and the total count exactly once each', async () => {
      await service.getDirectory('', 20, 0);
      expect(memberRepository.searchDirectory).toHaveBeenCalledTimes(1);
      expect(memberRepository.getDirectoryTotal).toHaveBeenCalledTimes(1);
    });

    it('returns the total citizen count', async () => {
      const { total } = await service.getDirectory('', 20, 0);
      expect(total).toEqual([{ count: 2 }]);
    });

    it('carries through the role name and immigration date unchanged', async () => {
      const { citizens } = await service.getDirectory('', 20, 0);
      const citizen = citizens.find(c => c.username === 'withhome');
      expect(citizen.primaryRoleName).toBe('Citizen');
      expect(citizen.immigrationDate).toEqual(new Date('2020-01-01'));
    });

    it('marks a citizen online only when recently active', async () => {
      const { citizens } = await service.getDirectory('', 20, 0);
      expect(citizens.find(c => c.username === 'withhome').online).toBe(true);
      expect(citizens.find(c => c.username === 'nohome').online).toBe(false);
    });
  });
});
