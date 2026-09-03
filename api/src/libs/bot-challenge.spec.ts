import { verifyBotChallenge } from './bot-challenge';

describe('verifyBotChallenge', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SITE_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /**
   * The four configuration states, which is the whole safety argument for this module.
   *
   * The one that matters most is "site key only". Before this was fixed the module read
   * the secret alone, so that state passed every immigration through untouched while the
   * browser still showed a challenge widget -- protection that lived only on the client,
   * which is exactly where an automated caller does not run it.
   */
  describe('configuration states', () => {
    it('A: no keys at all skips the check, which is every existing deployment', async () => {
      const transport = jest.fn();
      const result = await verifyBotChallenge('anything', '1.2.3.4', transport);

      expect(result).toEqual({ passed: true, skipped: true });
      expect(transport).not.toHaveBeenCalled();
    });

    it('B: both keys set makes the check real', async () => {
      process.env.TURNSTILE_SECRET_KEY = 'shhh';
      process.env.TURNSTILE_SITE_KEY = '0xPUBLIC';
      const transport = jest.fn().mockResolvedValue({ success: true });
      const result = await verifyBotChallenge('good-token', '1.2.3.4', transport);

      expect(result.passed).toBe(true);
      expect(result.skipped).toBeUndefined();
      expect(transport).toHaveBeenCalled();
    });

    it('C: secret only fails closed and names the missing site key', async () => {
      process.env.TURNSTILE_SECRET_KEY = 'shhh';
      const transport = jest.fn();
      const result = await verifyBotChallenge('good-token', '1.2.3.4', transport);

      expect(result.passed).toBe(false);
      expect(result.misconfigured).toBe(true);
      expect(result.reason).toContain('TURNSTILE_SITE_KEY');
      expect(transport).not.toHaveBeenCalled();
    });

    it('D: site key only fails closed and names the missing secret', async () => {
      process.env.TURNSTILE_SITE_KEY = '0xPUBLIC';
      const transport = jest.fn();
      const result = await verifyBotChallenge('good-token', '1.2.3.4', transport);

      // The regression guard. A truthy `passed` here is the silent bypass.
      expect(result.passed).toBe(false);
      expect(result.skipped).toBeUndefined();
      expect(result.misconfigured).toBe(true);
      expect(result.reason).toContain('TURNSTILE_SECRET_KEY');
      expect(transport).not.toHaveBeenCalled();
    });

    it('D: site key only fails closed even for a token Cloudflare would accept', async () => {
      process.env.TURNSTILE_SITE_KEY = '0xPUBLIC';
      const transport = jest.fn().mockResolvedValue({ success: true });
      const result = await verifyBotChallenge('good-token', '1.2.3.4', transport);

      expect(result.passed).toBe(false);
      expect(transport).not.toHaveBeenCalled();
    });

    it.each([
      ['secret only', { TURNSTILE_SECRET_KEY: '   ', TURNSTILE_SITE_KEY: '0xPUBLIC' }],
      ['site key only', { TURNSTILE_SECRET_KEY: 'shhh', TURNSTILE_SITE_KEY: '   ' }],
    ])(
      'treats a whitespace-only key as absent, so %s is incomplete',
      async (_label, env) => {
        Object.assign(process.env, env);
        const result = await verifyBotChallenge('good-token', '1.2.3.4', jest.fn());

        expect(result.passed).toBe(false);
        expect(result.misconfigured).toBe(true);
      },
    );

    it('never puts a key value in the reason, only the variable name', async () => {
      process.env.TURNSTILE_SITE_KEY = '0xPUBLIC';
      const result = await verifyBotChallenge('good-token', '1.2.3.4', jest.fn());

      expect(result.reason).not.toContain('0xPUBLIC');
    });
  });

  describe('with both keys configured', () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = 'shhh';
      process.env.TURNSTILE_SITE_KEY = '0xPUBLIC';
    });

    it('passes a token Cloudflare accepts', async () => {
      const transport = jest.fn().mockResolvedValue({ success: true });
      const result = await verifyBotChallenge('good-token', '1.2.3.4', transport);

      expect(result.passed).toBe(true);
      expect(result.skipped).toBeUndefined();
    });

    it('sends the secret, the token and the caller IP', async () => {
      const transport = jest.fn().mockResolvedValue({ success: true });
      await verifyBotChallenge('good-token', '1.2.3.4', transport);

      const body = transport.mock.calls[0][0] as string;
      const params = new URLSearchParams(body);
      expect(params.get('secret')).toBe('shhh');
      expect(params.get('response')).toBe('good-token');
      expect(params.get('remoteip')).toBe('1.2.3.4');
    });

    it('never sends the site key to Cloudflare', async () => {
      const transport = jest.fn().mockResolvedValue({ success: true });
      await verifyBotChallenge('good-token', '1.2.3.4', transport);

      const params = new URLSearchParams(transport.mock.calls[0][0] as string);
      expect(params.get('sitekey')).toBeNull();
    });

    it('fails a token Cloudflare rejects', async () => {
      const transport = jest.fn().mockResolvedValue({
        success: false,
        'error-codes': ['invalid-input-response'],
      });
      const result = await verifyBotChallenge('bad-token', undefined, transport);

      expect(result.passed).toBe(false);
      expect(result.misconfigured).toBeUndefined();
      expect(result.reason).toBe('invalid-input-response');
    });

    it.each([undefined, null, '', '   ', 42, {}])(
      'fails without ever calling out when the token is %p',
      async token => {
        const transport = jest.fn();
        const result = await verifyBotChallenge(token, undefined, transport);

        expect(result.passed).toBe(false);
        expect(result.reason).toBe('missing-token');
        expect(transport).not.toHaveBeenCalled();
      },
    );

    it('fails closed when the verifier is unreachable', async () => {
      const transport = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await verifyBotChallenge('good-token', undefined, transport);

      // The important half: a deployment that asked for a bot challenge does not stop
      // having one because Cloudflare is unreachable.
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('verifier-unreachable');
    });

    it('fails closed on a reply that is not a success', async () => {
      const transport = jest.fn().mockResolvedValue({});
      const result = await verifyBotChallenge('good-token', undefined, transport);

      expect(result.passed).toBe(false);
    });

    it.each([
      ['null', null],
      ['a string', 'not json'],
      ['an array', []],
      ['a success that is not a boolean', { success: 'true' }],
    ])('fails closed on a malformed reply that is %s', async (_label, reply) => {
      const transport = jest.fn().mockResolvedValue(reply);
      const result = await verifyBotChallenge('good-token', undefined, transport);

      expect(result.passed).toBe(false);
    });
  });
});
