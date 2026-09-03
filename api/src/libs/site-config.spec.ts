import {
  getMailFrom,
  getMissingTurnstileKeyName,
  getSiteName,
  getSiteUrl,
  getSmtpConfig,
  getTurnstileConfigState,
  getTurnstileSecretKey,
  getTurnstileSiteKey,
  isMemberApprovalRequired,
} from './site-config';

/**
 * The whole point of this module is that an unconfigured deployment behaves exactly as CTR
 * always has, so most of what is asserted here is what happens when nothing is set.
 */
describe('site-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MEMBER_APPROVAL_REQUIRED;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.SITE_URL;
    delete process.env.SITE_NAME;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isMemberApprovalRequired', () => {
    it('is off when unset, which is every existing deployment', () => {
      expect(isMemberApprovalRequired()).toBe(false);
    });

    it.each(['true', 'TRUE', '1', 'yes', 'on', ' on '])('is on for %p', value => {
      process.env.MEMBER_APPROVAL_REQUIRED = value;
      expect(isMemberApprovalRequired()).toBe(true);
    });

    it.each(['false', '0', 'no', 'off', '', 'maybe'])('is off for %p', value => {
      process.env.MEMBER_APPROVAL_REQUIRED = value;
      expect(isMemberApprovalRequired()).toBe(false);
    });

    it('is read per call, not frozen at import', () => {
      expect(isMemberApprovalRequired()).toBe(false);
      process.env.MEMBER_APPROVAL_REQUIRED = 'true';
      expect(isMemberApprovalRequired()).toBe(true);
    });
  });

  describe('getTurnstileSecretKey', () => {
    it('is null when unset, meaning no bot challenge is configured', () => {
      expect(getTurnstileSecretKey()).toBeNull();
    });

    it('is null for a whitespace-only value rather than an empty secret', () => {
      process.env.TURNSTILE_SECRET_KEY = '   ';
      expect(getTurnstileSecretKey()).toBeNull();
    });

    it('returns the trimmed secret', () => {
      process.env.TURNSTILE_SECRET_KEY = ' s3cret ';
      expect(getTurnstileSecretKey()).toBe('s3cret');
    });
  });

  describe('getSiteUrl', () => {
    it('defaults to production', () => {
      expect(getSiteUrl()).toBe('https://www.cybertownrevival.com');
    });

    it('strips trailing slashes so links do not double up', () => {
      process.env.SITE_URL = 'https://beta.cybertown.dev//';
      expect(getSiteUrl()).toBe('https://beta.cybertown.dev');
    });
  });

  describe('getSiteName', () => {
    it('defaults to Cybertown Revival', () => {
      expect(getSiteName()).toBe('Cybertown Revival');
    });

    it('uses the configured name', () => {
      process.env.SITE_NAME = 'CTNG Beta';
      expect(getSiteName()).toBe('CTNG Beta');
    });
  });

  describe('getTurnstileSiteKey', () => {
    it('is null when unset', () => {
      expect(getTurnstileSiteKey()).toBeNull();
    });

    it('is null for a whitespace-only value', () => {
      process.env.TURNSTILE_SITE_KEY = '  ';
      expect(getTurnstileSiteKey()).toBeNull();
    });

    it('returns the trimmed key', () => {
      process.env.TURNSTILE_SITE_KEY = ' 0xPUBLIC ';
      expect(getTurnstileSiteKey()).toBe('0xPUBLIC');
    });
  });

  /**
   * The four states an operator can leave Turnstile in. Two of them are safe and two are
   * mistakes, and the module's job is to tell them apart -- reading the secret alone could
   * not, which is how a site key with no secret became a silent bypass.
   */
  describe('getTurnstileConfigState', () => {
    it('A: neither key is disabled', () => {
      expect(getTurnstileConfigState()).toBe('disabled');
      expect(getMissingTurnstileKeyName()).toBeNull();
    });

    it('B: both keys is enabled', () => {
      process.env.TURNSTILE_SECRET_KEY = 'shhh';
      process.env.TURNSTILE_SITE_KEY = '0xPUBLIC';
      expect(getTurnstileConfigState()).toBe('enabled');
      expect(getMissingTurnstileKeyName()).toBeNull();
    });

    it('C: secret only is incomplete, missing the site key', () => {
      process.env.TURNSTILE_SECRET_KEY = 'shhh';
      expect(getTurnstileConfigState()).toBe('incomplete');
      expect(getMissingTurnstileKeyName()).toBe('TURNSTILE_SITE_KEY');
    });

    it('D: site key only is incomplete, missing the secret', () => {
      process.env.TURNSTILE_SITE_KEY = '0xPUBLIC';
      expect(getTurnstileConfigState()).toBe('incomplete');
      expect(getMissingTurnstileKeyName()).toBe('TURNSTILE_SECRET_KEY');
    });

    it('treats the empty strings Compose hands over as unset, not as configured', () => {
      // `TURNSTILE_SITE_KEY: ${TURNSTILE_SITE_KEY:-}` gives the container an empty string
      // whenever the operator set nothing. That has to read as state A, not as a key.
      process.env.TURNSTILE_SECRET_KEY = '';
      process.env.TURNSTILE_SITE_KEY = '';
      expect(getTurnstileConfigState()).toBe('disabled');
    });

    it('never returns a key VALUE from getMissingTurnstileKeyName', () => {
      process.env.TURNSTILE_SITE_KEY = '0xPUBLIC';
      expect(getMissingTurnstileKeyName()).not.toContain('0xPUBLIC');
    });
  });

  /**
   * The mail transport. The default has to stay byte-for-byte what `mail.ts` used to
   * hard-code, or an existing CTR host silently stops delivering when it upgrades.
   */
  describe('getSmtpConfig', () => {
    it('defaults to the local MTA the code used to hard-code', () => {
      expect(getSmtpConfig()).toEqual({
        host: '127.0.0.1',
        port: 25,
        secure: false,
        tls: { rejectUnauthorized: false },
      });
    });

    it('adds no auth when no username is configured', () => {
      process.env.SMTP_HOST = 'mail.example.test';
      expect(getSmtpConfig().auth).toBeUndefined();
      expect(getSmtpConfig().requireTLS).toBeUndefined();
    });

    it('treats the empty strings Compose hands over as unset', () => {
      process.env.SMTP_HOST = '';
      process.env.SMTP_PORT = '';
      process.env.SMTP_SECURE = '';
      process.env.SMTP_USER = '';
      expect(getSmtpConfig()).toEqual({
        host: '127.0.0.1',
        port: 25,
        secure: false,
        tls: { rejectUnauthorized: false },
      });
    });

    it('builds the submission transport the beta uses', () => {
      process.env.SMTP_HOST = 'mail.cybertown.dev';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_SECURE = 'false';
      process.env.SMTP_USER = 'noreply@cybertown.dev';
      process.env.SMTP_PASS = 'pw';

      const config = getSmtpConfig();
      expect(config.host).toBe('mail.cybertown.dev');
      expect(config.port).toBe(587);
      expect(config.secure).toBe(false);
      expect(config.auth).toEqual({ user: 'noreply@cybertown.dev', pass: 'pw' });
      // The half that matters: on 587 the session starts in the clear, so the password
      // may only be sent after a STARTTLS upgrade that is allowed to fail the send.
      expect(config.requireTLS).toBe(true);
    });

    it('does not force STARTTLS on an implicit-TLS port, which is already encrypted', () => {
      process.env.SMTP_HOST = 'mail.cybertown.dev';
      process.env.SMTP_SECURE = 'true';
      process.env.SMTP_USER = 'noreply@cybertown.dev';
      process.env.SMTP_PASS = 'pw';

      const config = getSmtpConfig();
      expect(config.secure).toBe(true);
      expect(config.port).toBe(465);
      expect(config.requireTLS).toBeUndefined();
    });

    it.each(['0', 'abc', '-1', '99999', ' '])(
      'falls back to the default port for the unusable value %p',
      value => {
        process.env.SMTP_PORT = value;
        expect(getSmtpConfig().port).toBe(25);
      },
    );
  });

  describe('getMailFrom', () => {
    it('defaults to the address CTR has always sent from', () => {
      expect(getMailFrom()).toBe('Cybertown Revival <donotreply@cybertownrevival.com>');
    });

    it('uses the configured sender', () => {
      process.env.SMTP_FROM = 'CTNG Beta <noreply@cybertown.dev>';
      expect(getMailFrom()).toBe('CTNG Beta <noreply@cybertown.dev>');
    });
  });
});
