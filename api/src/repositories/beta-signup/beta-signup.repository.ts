import { Service } from 'typedi';

import { Db } from '../../db';
import { knex } from '../../db';

export interface BetaSignup {
  id: number;
  email: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

@Service()
export class BetaSignupRepository {
  constructor(private db: Db) { }

  public async create(email: string, note?: string): Promise<BetaSignup> {
    const [id] = await knex('beta_signup').insert({ email, note: note || null });
    return knex('beta_signup').where({ id }).first();
  }

  public async findAll(): Promise<BetaSignup[]> {
    return knex('beta_signup').orderBy('created_at', 'desc');
  }

  public async findByEmail(email: string): Promise<BetaSignup> {
    return knex('beta_signup').where({ email }).first();
  }
}
