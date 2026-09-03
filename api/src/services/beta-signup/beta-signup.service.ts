import { Service } from 'typedi';

import { BetaSignup, BetaSignupRepository } from '../../repositories';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Service()
export class BetaSignupService {
  constructor(private betaSignupRepository: BetaSignupRepository) { }

  public async register(email: string, note?: string): Promise<BetaSignup> {
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new Error('Invalid email address');
    }

    const existing = await this.betaSignupRepository.findByEmail(normalizedEmail);
    if (existing) {
      return existing;
    }

    return this.betaSignupRepository.create(normalizedEmail, note);
  }

  public async list(): Promise<BetaSignup[]> {
    return this.betaSignupRepository.findAll();
  }
}
