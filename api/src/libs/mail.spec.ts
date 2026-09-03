// Typed loosely on purpose: these stand in for nodemailer, whose option and message
// objects are what the assertions below poke at directly.
/* eslint-disable @typescript-eslint/no-explicit-any */
const sendMail: jest.Mock<any, any> = jest.fn();
const createTransport: jest.Mock<any, any> = jest.fn(() => ({ sendMail }));
/* eslint-enable @typescript-eslint/no-explicit-any */

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport },
  createTransport,
}));

import {
  sendEmail,
  sendMemberApprovedEmail,
  sendMemberPendingApprovalEmail,
  sendPasswordResetEmail,
} from './mail';

/**
 * The transport used to be hard-coded, so the risk this file guards is in two directions
 * at once: a container that cannot deliver at all (the defect), and an existing CTR host
 * that silently stops delivering because the default moved (the regression).
 */
describe('mail', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.SITE_NAME;
    delete process.env.SITE_URL;
    sendMail.mockReset();
    sendMail.mockResolvedValue({ accepted: ['someone@example.test'] });
    createTransport.mockClear();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /** The options handed to nodemailer for the message just sent. */
  const transportOptions = () => createTransport.mock.calls[0][0];
  /** The message just sent. */
  const message = () => sendMail.mock.calls[0][0];

  describe('transport', () => {
    it('uses the local MTA when nothing is configured, as CTR always has', async () => {
      await sendEmail({ to: 'a@example.test', subject: 's', body: 'b' });

      expect(transportOptions()).toEqual({
        host: '127.0.0.1',
        port: 25,
        secure: false,
        tls: { rejectUnauthorized: false },
      });
    });

    it('sends from the historical address when nothing is configured', async () => {
      await sendEmail({ to: 'a@example.test', subject: 's', body: 'b' });

      expect(message().from).toBe('Cybertown Revival <donotreply@cybertownrevival.com>');
    });

    it('uses the configured submission server instead', async () => {
      process.env.SMTP_HOST = 'mail.cybertown.dev';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_USER = 'noreply@cybertown.dev';
      process.env.SMTP_PASS = 'pw';
      process.env.SMTP_FROM = 'CTNG Beta <noreply@cybertown.dev>';

      await sendEmail({ to: 'a@example.test', subject: 's', body: 'b' });

      const options = transportOptions();
      expect(options.host).toBe('mail.cybertown.dev');
      expect(options.port).toBe(587);
      expect(options.requireTLS).toBe(true);
      expect(options.auth).toEqual({ user: 'noreply@cybertown.dev', pass: 'pw' });
      expect(message().from).toBe('CTNG Beta <noreply@cybertown.dev>');
    });

    it('reads the transport per send, so a restart is enough to change it', async () => {
      await sendEmail({ to: 'a@example.test', subject: 's', body: 'b' });
      process.env.SMTP_HOST = 'mail.cybertown.dev';
      await sendEmail({ to: 'a@example.test', subject: 's', body: 'b' });

      expect(createTransport.mock.calls[0][0].host).toBe('127.0.0.1');
      expect(createTransport.mock.calls[1][0].host).toBe('mail.cybertown.dev');
    });

    it('throws when the mail server refuses, and never reports a false success', async () => {
      sendMail.mockRejectedValue(new Error('554 relay access denied'));

      await expect(
        sendEmail({ to: 'a@example.test', subject: 's', body: 'b' }),
      ).rejects.toThrow('554 relay access denied');
    });

    it('leaves the existing password-reset mail on the same transport', async () => {
      await sendPasswordResetEmail('a@example.test', 'tok');

      expect(transportOptions().host).toBe('127.0.0.1');
      expect(message().to).toBe('a@example.test');
    });
  });

  describe('immigration mail content', () => {
    beforeEach(() => {
      process.env.SITE_NAME = 'CTNG Beta';
      process.env.SITE_URL = 'https://beta.cybertown.dev';
    });

    it('sends the pending notice to the applicant, named for the deployment', async () => {
      await sendMemberPendingApprovalEmail('applicant@example.test', 'newbie');

      expect(message().to).toBe('applicant@example.test');
      expect(message().subject).toContain('CTNG Beta');
      expect(message().html).toContain('newbie');
      expect(message().html).toContain('CTNG Beta');
    });

    it('sends the approval notice with a login link at the beta host', async () => {
      await sendMemberApprovedEmail('applicant@example.test', 'newbie');

      expect(message().to).toBe('applicant@example.test');
      expect(message().subject).toContain('approved');
      expect(message().html).toContain('https://beta.cybertown.dev/#/login');
      // Never production: a beta applicant sent to the live site cannot log in there.
      expect(message().html).not.toContain('cybertownrevival.com');
    });

    it('sends exactly one message per approval', async () => {
      await sendMemberApprovedEmail('applicant@example.test', 'newbie');

      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  });
});
