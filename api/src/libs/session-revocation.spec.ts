import { NextFunction, Request, Response } from 'express';

import { SessionStandingReader, sessionRevocationGuard } from './session-revocation';

/**
 * The gate that turns a ban into the end of a session already in progress.
 *
 * The defect being closed is asserted head-on: the SAME token object, accepted before the
 * ban and refused after it, with nothing changed in between but the citizen's standing.
 */
describe('sessionRevocationGuard', () => {
  const VALID_TOKEN = 'a.valid.token';

  function buildRequest(path: string, apitoken?: string): Request {
    return { path, headers: apitoken ? { apitoken } : {} } as unknown as Request;
  }

  function buildResponse(): Response & { statusCode?: number; body?: unknown } {
    const response: any = {};
    response.status = (code: number) => {
      response.statusCode = code;
      return response;
    };
    response.json = (body: unknown) => {
      response.body = body;
      return response;
    };
    return response;
  }

  function buildMembers(revoked: boolean, overrides: Partial<SessionStandingReader> = {}) {
    return {
      decodeMemberToken: (token: string) => {
        if (token !== VALID_TOKEN) throw new Error('bad token');
        return { id: 42 };
      },
      isSessionRevoked: async () => revoked,
      ...overrides,
    } as SessionStandingReader;
  }

  async function run(members: SessionStandingReader, request: Request) {
    const response = buildResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };
    await sessionRevocationGuard(members)(request, response, next);
    return { response, nextCalled };
  }

  it('lets a citizen in good standing through', async () => {
    const result = await run(buildMembers(false), buildRequest('/api/home/1', VALID_TOKEN));
    expect(result.nextCalled).toBe(true);
    expect(result.response.statusCode).toBeUndefined();
  });

  it('refuses the SAME token once the citizen is banned', async () => {
    const request = buildRequest('/api/home/1', VALID_TOKEN);
    const before = await run(buildMembers(false), request);
    expect(before.nextCalled).toBe(true);

    const after = await run(buildMembers(true), request);
    expect(after.nextCalled).toBe(false);
    expect(after.response.statusCode).toBe(403);
  });

  it('says nothing about WHY -- no reason, no end date, no member', async () => {
    const result = await run(buildMembers(true), buildRequest('/api/home/1', VALID_TOKEN));
    expect(result.response.body).toEqual({ error: 'Forbidden.' });
  });

  it('lets a visitor with no token past, so public routes and login still work', async () => {
    const members = buildMembers(true, {
      isSessionRevoked: async () => {
        throw new Error('standing must not be read without a token');
      },
    });
    const result = await run(members, buildRequest('/api/member/login'));
    expect(result.nextCalled).toBe(true);
  });

  it('leaves an unverifiable token to the route that will refuse it anyway', async () => {
    const result = await run(buildMembers(true), buildRequest('/api/home/1', 'nonsense'));
    expect(result.nextCalled).toBe(true);
    expect(result.response.statusCode).toBeUndefined();
  });

  it.each([
    ['/api/member/session'],
    ['/api/member/is_banned'],
  ])('still serves %s to a banned citizen, so the browser can show the ban notice',
    async (path) => {
      const result = await run(buildMembers(true), buildRequest(path, VALID_TOKEN));
      expect(result.nextCalled).toBe(true);
      expect(result.response.statusCode).toBeUndefined();
    });

  it('does NOT extend that exception to the socket probe underneath it', async () => {
    const result = await run(
      buildMembers(true),
      buildRequest('/api/member/session/status', VALID_TOKEN),
    );
    expect(result.nextCalled).toBe(false);
    expect(result.response.statusCode).toBe(403);
  });

  it('fails closed when standing cannot be read at all', async () => {
    const members = buildMembers(false, {
      isSessionRevoked: async () => { throw new Error('database is down'); },
    });
    const result = await run(members, buildRequest('/api/home/1', VALID_TOKEN));
    expect(result.nextCalled).toBe(false);
    expect(result.response.statusCode).toBe(403);
  });

  it('ignores a token whose payload names no member', async () => {
    const members = buildMembers(true, {
      decodeMemberToken: () => ({ id: 'not-a-number' }),
    });
    const result = await run(members, buildRequest('/api/home/1', VALID_TOKEN));
    expect(result.nextCalled).toBe(true);
  });
});
