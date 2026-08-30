import { Request, Response } from 'express';
import { HoodService, MemberService } from '../services';
import { Container } from 'typedi';
import { INVALID_MAP_BACKGROUND_INDEX, parseMapBackgroundIndex, parseRouteId } from '../libs';

export class HoodController {
  constructor(private hoodService: HoodService, private memberService: MemberService) {}

  public async getHood(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    try {
      const hood = await this.hoodService.find(parseInt(id));
      const colony = await this.hoodService.getColony(parseInt(id));

      response.status(200).json({ hood: hood, colony: colony });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }

  public async getBlocks(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    try {
      const blocks = await this.hoodService.getBlocks(parseInt(id));
      response.status(200).json({ blocks });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }
  
  public async getAccessInfoByUsername(request: Request, response: Response): Promise<any> {
    const { id } = request.params;
    try {
      const data = await this.hoodService.getAccessInfoByUsername(parseInt(id));
      response.status(200).json({ data });
    } catch (error) {
      console.log(error);
      response.status(400).json({ error });
    }
  }
  
  public async postAccessInfo(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const session = this.memberService.decodeMemberToken(<string> apitoken);
    if(!session) {
      response.status(400).json({
        error: 'Invalid or missing token.',
      });
      return;
    }
    const { id } = request.params;
    try {
      const access = await this.hoodService.canManageAccess(parseInt(id), session.id);
      if (!access) {
        response.status(403).json({error: 'Access Denied'});
        return;
      }
    } catch (error) {
      console.log(error);
    }
    const deputies = request.body.deputies;
    const owner = request.body.owner;
    try {
      await this.hoodService.postAccessInfo(parseInt(id), deputies, owner);
      response.status(200).json({success: true});
    } catch (error) {
      console.log(error);
    }
  }

  public async canAdmin(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    const { apitoken } = request.headers;

    try {
      const session = this.memberService.decodeMemberToken(<string>apitoken);
      if (!session) {
        response.status(400).json({
          error: 'Invalid or missing token.',
        });
        return;
      } else if (!(await this.hoodService.canAdmin(parseInt(id), session.id))) {
        response.status(403).json({result: false});
      } else {
        response.status(200).json({result: true});
      }
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }
  
  public async canManageAccess(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    const { apitoken } = request.headers;

    try {
      const session = this.memberService.decodeMemberToken(<string>apitoken);
      if (!session || !(await this.hoodService.canManageAccess(parseInt(id), session.id))) {
        response.status(400).json({
          error: 'Invalid or missing token.',
        });
        return;
      }
      response.status(200).json({ isOwner: true });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }

  /**
   * Reports the hood's current map background index plus every index its
   * theme offers. Read-only, so no authorization is required.
   */
  public async getMapBackgroundOptions(request: Request, response: Response): Promise<void> {
    const hoodId = parseRouteId(request.params.id);
    if (hoodId === null) {
      response.status(400).json({ error: 'Invalid hood id.' });
      return;
    }

    try {
      const result = await this.hoodService.getMapBackgroundOptions(hoodId);
      if (!result) {
        response.status(404).json({ error: 'Hood or its owning colony was not found.' });
        return;
      }
      response.status(200).json(result);
    } catch (error) {
      console.error(error);
      // Everything the client can get wrong is answered above, so anything
      // reaching here is a server-side fault. The message is fixed so no
      // filesystem path from the underlying error reaches the response.
      response.status(500).json({ error: 'Unable to load map background options.' });
    }
  }

  /**
   * Sets the hood's map background index. The server authorizes the member
   * first, then rejects any index the hood's own theme does not offer.
   */
  public async putMapBackgroundSelection(request: Request, response: Response): Promise<void> {
    const hoodId = parseRouteId(request.params.id);
    if (hoodId === null) {
      response.status(400).json({ error: 'Invalid hood id.' });
      return;
    }

    const { apitoken } = request.headers;
    let session;
    try {
      session = this.memberService.decodeMemberToken(<string>apitoken);
    } catch (error) {
      session = undefined;
    }
    if (!session) {
      response.status(401).json({ error: 'Invalid or missing token.' });
      return;
    }

    try {
      if (!(await this.hoodService.canAdmin(hoodId, session.id))) {
        response.status(403).json({ error: 'Access denied.' });
        return;
      }

      const index = parseMapBackgroundIndex(request.body);
      if (index === INVALID_MAP_BACKGROUND_INDEX) {
        response.status(400).json({
          error: 'index must be a non-negative integer, or null to reset.',
        });
        return;
      }

      const result = await this.hoodService.updateMapBackgroundSelection(hoodId, index);
      if (result.status === 'not_found') {
        response.status(404).json({ error: 'Hood or its owning colony was not found.' });
        return;
      }
      if (result.status === 'invalid') {
        response.status(400).json({
          error: 'Selected index is not available for this hood.',
        });
        return;
      }
      response.status(200).json({ selectedIndex: result.selectedIndex });
    } catch (error) {
      console.error(error);
      // As above: an invalid index or body already returned 400, so this is a
      // server-side fault and must not be reported as a bad request.
      response.status(500).json({ error: 'Unable to update map background selection.' });
    }
  }
}
const hoodService = Container.get(HoodService);
const memberService = Container.get(MemberService);
export const hoodController = new HoodController(hoodService, memberService);
