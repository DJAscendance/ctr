import { Request, Response } from 'express';
import { Container } from 'typedi';

import { BetaSignupService, MemberService } from '../services';

export class BetaSignupController {
  constructor(
    private betaSignupService: BetaSignupService,
    private memberService: MemberService,
  ) {}

  public async register(request: Request, response: Response): Promise<void> {
    // Honeypot field: real users never fill this in, bots often do.
    if (request.body.website) {
      response.status(200).json({ message: 'Thanks! We will be in touch.' });
      return;
    }

    const { email, note } = request.body;
    if (!email || typeof email !== 'string') {
      response.status(400).json({ error: 'Email is required.' });
      return;
    }

    try {
      await this.betaSignupService.register(email, note);
      response.status(200).json({ message: 'Thanks! We will be in touch.' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error.message });
    }
  }

  public async list(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (!admin) {
      response.status(403).json({ message: 'Access Denied' });
      return;
    }

    try {
      const signups = await this.betaSignupService.list();
      response.status(200).json({ signups });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error.message });
    }
  }
}

const betaSignupService = Container.get(BetaSignupService);
const memberService = Container.get(MemberService);
export const betaSignupController = new BetaSignupController(betaSignupService, memberService);
