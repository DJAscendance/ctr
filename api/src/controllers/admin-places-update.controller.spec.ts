import { AdminController } from './admin.controller';

/**
 * Authorization for the GLOBAL Admin Panel place editor.
 *
 * THE BUG THIS PINS. `MemberService.getAccessLevel` returns an ARRAY of the
 * access levels a member holds - `['admin']`, `['security']`, `['leader']`, or
 * `[]` for an ordinary member. The guard was `if (!admin) { 403 }`, and in
 * JavaScript an empty array is TRUTHY, so `![]` is false and the branch was
 * unreachable. Every authenticated member passed. Independent QA demonstrated a
 * colony leader editing the Mall and receiving 200.
 *
 * The tests drive the real controller method with a stubbed member service, so
 * they exercise the actual guard rather than a description of it. Each
 * unauthorized case asserts BOTH the response and that no write reached the
 * service - a 403 that still mutated would pass a response-only assertion.
 */
describe('AdminController.placesUpdate authorization', () => {
  let memberService: any;
  let placeService: any;
  let controller: AdminController;

  /** A member with no elevated access at all - getAccessLevel returns []. */
  const ORDINARY: string[] = [];

  const mockResponse = (): any => {
    const response: any = {};
    response.status = jest.fn().mockReturnValue(response);
    response.json = jest.fn().mockReturnValue(response);
    return response;
  };

  const callUpdate = async (accessLevel: string[] | null, body: any = {
    id: 7, name: 'The Mall', description: 'mall', slug: 'mall', type: 'public',
  }) => {
    if (accessLevel === null) {
      // decryptSession answers the request itself and returns undefined.
      memberService.decryptSession.mockImplementation((_req: any, res: any) => {
        res.status(400).json({ error: 'Invalid token.' });
        return undefined;
      });
    } else {
      memberService.decryptSession.mockReturnValue({ id: 5 });
      memberService.getAccessLevel.mockResolvedValue(accessLevel);
    }
    const response = mockResponse();
    await controller.placesUpdate({ body, headers: {} } as any, response);
    return response;
  };

  beforeEach(() => {
    memberService = {
      decryptSession: jest.fn(),
      getAccessLevel: jest.fn(),
    };
    placeService = { updatePlaces: jest.fn().mockResolvedValue(undefined) };
    // Positional: (adminService, memberService, avatarService, placeService, ...)
    controller = new AdminController(
      null as any, memberService, null as any, placeService, null as any,
      null as any, null as any, null as any, null as any, null as any,
      null as any,
    );
  });

  describe('permitted', () => {
    it('lets an administrator update administrative metadata', async () => {
      const response = await callUpdate(['admin']);

      expect(response.status).toHaveBeenCalledWith(200);
      expect(placeService.updatePlaces).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, name: 'The Mall', description: 'mall' }),
      );
    });
  });

  describe('refused', () => {
    const refusedCases: Array<[string, string[]]> = [
      ['an ordinary member', ORDINARY],
      ['a colony leader', ['leader']],
      ['a neighborhood leader', ['leader']],
      ['a deputy', ['leader']],
      ['security staff who are not administrators', ['security']],
      ['a member holding several non-admin levels', ['security', 'leader']],
    ];

    for (const [who, accessLevel] of refusedCases) {
      it(`refuses ${who}`, async () => {
        const response = await callUpdate(accessLevel);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(response.json).toHaveBeenCalledWith({ message: 'Access Denied' });
        expect(placeService.updatePlaces).not.toHaveBeenCalled();
      });
    }

    it('refuses a colony leader editing an unrelated place (the Mall)', async () => {
      const response = await callUpdate(['leader'], {
        id: 7, name: 'Hacked Mall', description: 'owned', slug: 'mall', type: 'public',
      });

      expect(response.status).toHaveBeenCalledWith(403);
      expect(placeService.updatePlaces).not.toHaveBeenCalled();
    });

    it('refuses a colony leader editing their OWN colony through this endpoint',
      async () => {
        // Scoped staff have their own per-place routes. The global editor is not
        // one of them, whatever place they aim it at.
        const response = await callUpdate(['leader'], {
          id: 879, name: 'Games', description: 'games', slug: 'games_col', type: 'colony',
        });

        expect(response.status).toHaveBeenCalledWith(403);
        expect(placeService.updatePlaces).not.toHaveBeenCalled();
      });

    it('refuses an unauthenticated request', async () => {
      const response = await callUpdate(null);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(memberService.getAccessLevel).not.toHaveBeenCalled();
      expect(placeService.updatePlaces).not.toHaveBeenCalled();
    });
  });

  describe('the allowlist still holds for administrators', () => {
    it('drops a smuggled information field even from an administrator', async () => {
      // Belt and braces: the repository allowlist is what actually enforces this
      // (see place-information-separation.spec), but an administrator is the one
      // caller who reaches it, so the path is asserted end to end here too.
      await callUpdate(['admin'], {
        id: 7, name: 'The Mall', description: 'mall',
        information: '<script>alert(1)</script>',
      });

      const [written] = placeService.updatePlaces.mock.calls[0];
      // The controller forwards the body; the repository allowlist strips it.
      // What must NOT happen is the controller inventing its own passthrough.
      expect(written.information).toEqual('<script>alert(1)</script>');
      expect(placeService.updatePlaces).toHaveBeenCalledTimes(1);
    });
  });
});
