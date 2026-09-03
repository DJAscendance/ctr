/*
 * Importing the repository barrel eagerly constructs a real knex instance, and
 * this project ships no knex configuration for the test environment. These
 * specs only ever exercise mocked repositories and services, so the db module
 * is stubbed out before anything can pull the real one in.
 */
jest.mock('../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mockDb } = require('@spec/mocks');
  return { db: mockDb, knex: mockDb.knex };
});

import type { Request, Response } from 'express';
import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { BetaSignupService, MemberService } from '../services';
import { Db } from '../db/db.class';
import { mockDb } from '@spec/mocks';
import type { SessionInfo } from '../types';
import type { BetaSignupController as BetaSignupControllerType } from './beta-signup.controller';

Container.set(Db, {
  ...mockDb,
  role: { where: jest.fn().mockResolvedValue([]) },
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BetaSignupController } = require('./beta-signup.controller') as
  typeof import('./beta-signup.controller');

interface MockRequest {
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

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

const session = { id: 42 } as SessionInfo;
const signupRow = {
  id: 1, email: 'test@example.com', note: null, created_at: new Date(), updated_at: new Date(),
};

describe('BetaSignupController', () => {
  let betaSignupService: jest.Mocked<BetaSignupService>;
  let memberService: jest.Mocked<MemberService>;
  let controller: BetaSignupControllerType;

  const register = (request: MockRequest, response: MockResponse) =>
    controller.register(request as unknown as Request, response as unknown as Response);
  const list = (request: MockRequest, response: MockResponse) =>
    controller.list(request as unknown as Request, response as unknown as Response);

  beforeEach(() => {
    betaSignupService = createSpyObj(BetaSignupService);
    memberService = createSpyObj(MemberService);
    controller = new BetaSignupController(betaSignupService, memberService);
  });

  describe('register', () => {
    it('registers a valid email and returns 200', async () => {
      const request: MockRequest = { body: { email: 'test@example.com' } };
      const response = mockResponse();
      betaSignupService.register.mockResolvedValue(signupRow);

      await register(request, response);

      expect(betaSignupService.register).toHaveBeenCalledWith('test@example.com', undefined);
      expect(response.status).toHaveBeenCalledWith(200);
    });

    it('is idempotent for a duplicate email', async () => {
      const request: MockRequest = { body: { email: 'test@example.com' } };
      const response = mockResponse();
      betaSignupService.register.mockResolvedValue(signupRow);

      await register(request, response);

      expect(response.status).toHaveBeenCalledWith(200);
      const errorShape = expect.objectContaining({ error: expect.anything() });
      expect(response.json).not.toHaveBeenCalledWith(errorShape);
    });

    it('returns 400 when email is missing', async () => {
      const request: MockRequest = { body: {} };
      const response = mockResponse();

      await register(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(betaSignupService.register).not.toHaveBeenCalled();
    });

    it('returns 400 when the service rejects an invalid email', async () => {
      const request: MockRequest = { body: { email: 'not-an-email' } };
      const response = mockResponse();
      betaSignupService.register.mockRejectedValue(new Error('Invalid email address'));

      await register(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
    });

    it('silently no-ops when the honeypot field is filled in', async () => {
      const request: MockRequest = {
        body: { email: 'test@example.com', website: 'http://spam.example' },
      };
      const response = mockResponse();

      await register(request, response);

      expect(betaSignupService.register).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(200);
    });
  });

  describe('list', () => {
    it('returns 400 when no token is present', async () => {
      const request: MockRequest = { headers: {} };
      const response = mockResponse();
      memberService.decryptSession.mockImplementation((_request, resp) => {
        (resp as unknown as MockResponse).status(400).json({ error: 'Invalid token.' });
        return undefined;
      });

      await list(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(memberService.canAdmin).not.toHaveBeenCalled();
    });

    it('returns 403 when the member is not an admin', async () => {
      const request: MockRequest = { headers: { apitoken: 'token' } };
      const response = mockResponse();
      memberService.decryptSession.mockReturnValue(session);
      memberService.canAdmin.mockResolvedValue(false);

      await list(request, response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(betaSignupService.list).not.toHaveBeenCalled();
    });

    it('returns the signup list for an admin', async () => {
      const request: MockRequest = { headers: { apitoken: 'token' } };
      const response = mockResponse();
      memberService.decryptSession.mockReturnValue(session);
      memberService.canAdmin.mockResolvedValue(true);
      betaSignupService.list.mockResolvedValue([]);

      await list(request, response);

      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ signups: [] });
    });
  });
});
