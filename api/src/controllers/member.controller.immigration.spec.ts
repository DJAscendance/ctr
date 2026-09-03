/*
 * Importing the controller barrel eagerly constructs a real knex instance, and this project
 * ships no knex configuration for the test environment. These specs only exercise mocked
 * services, so the db module is stubbed out before anything can pull the real one in.
 */
jest.mock('../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mockDb } = require('@spec/mocks');
  return { db: mockDb, knex: mockDb.knex };
});

jest.mock('../libs', () => {
  const actual = jest.requireActual('../libs');
  return {
    ...actual,
    verifyBotChallenge: jest.fn().mockResolvedValue({ passed: true, skipped: true }),
    sendMemberPendingApprovalEmail: jest.fn().mockResolvedValue(undefined),
  };
});

import type { Request, Response } from 'express';
import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { HomeService, MemberDataService, MemberService, PlaceService } from '../services';
import { Member } from 'models';
import { Db } from '../db/db.class';
import { mockDb } from '@spec/mocks';
import { sendMemberPendingApprovalEmail, verifyBotChallenge } from '../libs';

Container.set(Db, {
  ...mockDb,
  role: { where: jest.fn().mockResolvedValue([]) },
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { memberController } = require('./member.controller') as
  typeof import('./member.controller');

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

function signupRequest(body: Record<string, unknown> = {}) {
  return {
    ip: '1.2.3.4',
    body: {
      email: 'new@example.com',
      username: 'newbie',
      password: 'correct-horse',
      ...body,
    },
  } as unknown as Request;
}

const signup = (request: Request, response: MockResponse) =>
  memberController.signup(request, response as unknown as Response);

describe('MemberController immigration', () => {
  let memberService: jest.Mocked<MemberService>;

  beforeEach(() => {
    memberService = createSpyObj(MemberService);
    memberService.find.mockResolvedValue(undefined);
    memberService.isApprovalRequired.mockReturnValue(false);
    memberService.createMemberAndLogin.mockResolvedValue('a-session-token');
    memberService.createMember.mockResolvedValue(99);

    // The controller is a module singleton built from Container.get, so its collaborators
    // are replaced on the instance rather than reconstructed. They are private fields, so
    // the instance is viewed through a plain record to reach them.
    const collaborators = memberController as unknown as Record<string, unknown>;
    collaborators.memberService = memberService;
    collaborators.homeService = createSpyObj(HomeService);
    collaborators.placeService = createSpyObj(PlaceService);
    collaborators.memberDataService = createSpyObj(MemberDataService);

    (verifyBotChallenge as jest.Mock).mockResolvedValue({ passed: true, skipped: true });
    (sendMemberPendingApprovalEmail as jest.Mock).mockResolvedValue(undefined);
  });

  describe('bot challenge', () => {
    it('creates the account when the challenge passes', async () => {
      const response = mockResponse();
      await signup(signupRequest({ botChallengeToken: 'tok' }), response);

      expect(verifyBotChallenge).toHaveBeenCalledWith('tok', '1.2.3.4');
      expect(response.status).toHaveBeenCalledWith(200);
      expect(memberService.createMemberAndLogin).toHaveBeenCalled();
    });

    it('refuses and creates nothing when the challenge fails', async () => {
      (verifyBotChallenge as jest.Mock).mockResolvedValue({
        passed: false,
        reason: 'invalid-input-response',
      });
      const response = mockResponse();
      await signup(signupRequest({ botChallengeToken: 'bad' }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(memberService.createMemberAndLogin).not.toHaveBeenCalled();
      expect(memberService.createMember).not.toHaveBeenCalled();
    });

    it('does not leak Cloudflare error codes to the caller', async () => {
      (verifyBotChallenge as jest.Mock).mockResolvedValue({
        passed: false,
        reason: 'invalid-input-secret',
      });
      const response = mockResponse();
      await signup(signupRequest(), response);

      expect(response.json.mock.calls[0][0].error).not.toContain('invalid-input-secret');
    });

    it('settles the challenge before probing whether the nickname is taken', async () => {
      // Otherwise a bot gets a free username/email oracle out of the endpoint the
      // challenge exists to protect.
      (verifyBotChallenge as jest.Mock).mockResolvedValue({ passed: false });
      const response = mockResponse();
      await signup(signupRequest(), response);

      expect(memberService.find).not.toHaveBeenCalled();
    });
  });

  /**
   * A deployment that set one Turnstile key and not the other. The applicant cannot fix
   * it, so the message must not tell them to try the challenge again, and no account may
   * be made -- the whole reason this state fails closed is that nothing verified anything.
   */
  describe('bot challenge misconfigured', () => {
    const misconfigured = {
      passed: false,
      misconfigured: true,
      reason: 'turnstile-misconfigured: TURNSTILE_SECRET_KEY is not set',
    };

    beforeEach(() => {
      (verifyBotChallenge as jest.Mock).mockResolvedValue(misconfigured);
    });

    it('creates no member of any kind', async () => {
      const response = mockResponse();
      await signup(signupRequest({ botChallengeToken: 'tok' }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(memberService.createMemberAndLogin).not.toHaveBeenCalled();
      expect(memberService.createMember).not.toHaveBeenCalled();
    });

    it('creates no member even where approval is required', async () => {
      memberService.isApprovalRequired.mockReturnValue(true);
      const response = mockResponse();
      await signup(signupRequest({ botChallengeToken: 'tok' }), response);

      expect(memberService.createMember).not.toHaveBeenCalled();
      expect(sendMemberPendingApprovalEmail).not.toHaveBeenCalled();
    });

    it('looks up nothing, so it is no enumeration oracle either', async () => {
      const response = mockResponse();
      await signup(signupRequest(), response);

      expect(memberService.find).not.toHaveBeenCalled();
    });

    it('does not blame the applicant or tell them to retry the challenge', async () => {
      const response = mockResponse();
      await signup(signupRequest(), response);

      const message = response.json.mock.calls[0][0].error as string;
      expect(message).not.toContain('confirm you are a human');
      expect(message).toContain('temporarily closed');
    });

    it('tells the applicant nothing about the configuration', async () => {
      const response = mockResponse();
      await signup(signupRequest(), response);

      const message = response.json.mock.calls[0][0].error as string;
      expect(message).not.toContain('TURNSTILE');
      expect(message).not.toContain('misconfigured');
    });
  });

  describe('with approval NOT required', () => {
    it('issues a session token immediately, as CTR always has', async () => {
      const response = mockResponse();
      await signup(signupRequest(), response);

      const body = response.json.mock.calls[0][0];
      expect(body.token).toBe('a-session-token');
      expect(body.pendingApproval).toBe(false);
      expect(sendMemberPendingApprovalEmail).not.toHaveBeenCalled();
    });
  });

  describe('with approval required', () => {
    beforeEach(() => {
      memberService.isApprovalRequired.mockReturnValue(true);
    });

    it('creates the account but issues NO token', async () => {
      const response = mockResponse();
      await signup(signupRequest(), response);

      const body = response.json.mock.calls[0][0];
      expect(response.status).toHaveBeenCalledWith(200);
      expect(body.pendingApproval).toBe(true);
      expect(body.token).toBeUndefined();
      expect(memberService.createMember).toHaveBeenCalled();
      expect(memberService.createMemberAndLogin).not.toHaveBeenCalled();
    });

    it('tells the applicant their application is being reviewed', async () => {
      const response = mockResponse();
      await signup(signupRequest(), response);

      expect(sendMemberPendingApprovalEmail).toHaveBeenCalledWith(
        'new@example.com',
        'newbie',
      );
    });

    it('still succeeds when that email cannot be sent', async () => {
      (sendMemberPendingApprovalEmail as jest.Mock).mockRejectedValue(new Error('no smtp'));
      const response = mockResponse();
      await signup(signupRequest(), response);

      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json.mock.calls[0][0].pendingApproval).toBe(true);
    });

    it('keeps rejecting a duplicate nickname', async () => {
      memberService.find.mockResolvedValue({ id: 1 } as Member);
      const response = mockResponse();
      await signup(signupRequest(), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(memberService.createMember).not.toHaveBeenCalled();
    });
  });
});
