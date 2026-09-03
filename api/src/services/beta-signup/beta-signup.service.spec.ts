/*
 * Importing the repository barrel eagerly constructs a real knex instance, and
 * this project ships no knex configuration for the test environment. This spec
 * only ever exercises a mocked repository, so the db module is stubbed out
 * before anything can pull the real one in.
 */
jest.mock('../../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mockDb } = require('@spec/mocks');
  return { db: mockDb, knex: mockDb.knex };
});

import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { BetaSignupService } from './beta-signup.service';
import { BetaSignupRepository } from '../../repositories';

describe('BetaSignupService', () => {
  let betaSignupRepository: jest.Mocked<BetaSignupRepository>;
  let service: BetaSignupService;

  beforeEach(() => {
    betaSignupRepository = createSpyObj(BetaSignupRepository);
    Container.reset();
    Container.set(BetaSignupRepository, betaSignupRepository);
    service = Container.get(BetaSignupService);
  });

  describe('register', () => {
    it('rejects a malformed email without touching the repository', async () => {
      await expect(service.register('not-an-email')).rejects.toThrow('Invalid email address');
      expect(betaSignupRepository.create).not.toHaveBeenCalled();
    });

    it('normalizes the email before storing it', async () => {
      betaSignupRepository.findByEmail.mockResolvedValue(undefined);
      betaSignupRepository.create.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        note: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await service.register('  Test@Example.com  ');

      expect(betaSignupRepository.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(betaSignupRepository.create).toHaveBeenCalledWith('test@example.com', undefined);
    });

    it('returns the existing row instead of creating a duplicate', async () => {
      const existing = {
        id: 1,
        email: 'test@example.com',
        note: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      betaSignupRepository.findByEmail.mockResolvedValue(existing);

      const result = await service.register('test@example.com');

      expect(result).toBe(existing);
      expect(betaSignupRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('passes through to the repository', async () => {
      betaSignupRepository.findAll.mockResolvedValue([]);

      const result = await service.list();

      expect(result).toEqual([]);
      expect(betaSignupRepository.findAll).toHaveBeenCalled();
    });
  });
});
