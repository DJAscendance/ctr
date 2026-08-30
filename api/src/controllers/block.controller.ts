import { Request, Response } from 'express';
import { Container } from 'typedi';

import { MemberService, BlockService, HoodService } from '../services';
import { INVALID_MAP_BACKGROUND_INDEX, parseMapBackgroundIndex } from '../libs';

export class BlockController {
  constructor(
    private memberService: MemberService,
    private blockService: BlockService,
    private hoodService: HoodService,
  ) {}

  public async getBlock(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    try {
      const block = await this.blockService.find(parseInt(id));
      const hood = await this.blockService.getHood(parseInt(id));
      const colony = await this.hoodService.getColony(hood.id);
      response.status(200).json({ block: block, hood: hood, colony: colony });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }

  public async getLocations(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    try {
      const locations = await this.blockService.getMapLocationAndPlaces(parseInt(id));
      response.status(200).json({ locations });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }
  public async getAccessInfoByUsername(request: Request, response: Response): Promise<any> {
    const { id } = request.params;
    try {
      const data = await this.blockService.getAccessInfoByUsername(parseInt(id));
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
      const access = await this.blockService.canManageAccess(parseInt(id), session.id);
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
      await this.blockService.postAccessInfo(parseInt(id), deputies, owner);
      response.status(200).json({success: true});
    } catch (error) {
      console.log(error);
    }
  }
  
  public async postLocations(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    const { apitoken } = request.headers;

    try {
      const session = this.memberService.decodeMemberToken(<string>apitoken);
      if (!session || !(await this.blockService.canAdmin(parseInt(id), session.id))) {
        response.status(400).json({
          error: 'Invalid or missing token.',
        });
      }

      const { availableLocations } = request.body;

      await this.blockService.resetMapLocationAvailability(parseInt(id));

      for (const location of availableLocations) {
        await this.blockService.setMapLocationAvailable(parseInt(id), location);
      }

      response.status(200).json({ status: 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }

  public async canAdmin(request: Request, response: Response): Promise<void> {
    const id = request.params.id;
    const { apitoken } = request.headers;

    try {
      const session = this.memberService.decodeMemberToken(<string>apitoken);
      if (!session) {
        response.status(400).json({
          error: 'Invalid or missing token or access denied.',
        });
        return;
      } else if (!(await this.blockService.canAdmin(Number.parseInt(id), session.id))) {
        response.status(403).json({ result: false });
        return;
      } else {
        response.status(200).json({result: true});
      }
    } catch (error) {
      console.error(error);
      response.status(400).json({ result: false });
    }
  }

  public async canManageAccess(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    const { apitoken } = request.headers;

    try {
      const session = this.memberService.decodeMemberToken(<string>apitoken);
      if (!session || !(await this.blockService.canManageAccess(parseInt(id), session.id))) {
        response.status(403).json({
          error: 'Invalid or missing token or access denied.',
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
   * Reports the block's current map background index plus every index its
   * theme offers. Read-only, so no authorization is required.
   */
  public async getMapBackgroundOptions(request: Request, response: Response): Promise<void> {
    const blockId = Number.parseInt(request.params.id, 10);
    if (!Number.isInteger(blockId)) {
      response.status(400).json({ error: 'Invalid block id.' });
      return;
    }

    try {
      const result = await this.blockService.getMapBackgroundOptions(blockId);
      if (!result) {
        response.status(404).json({ error: 'Block or its owning colony was not found.' });
        return;
      }
      response.status(200).json(result);
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: 'Unable to load map background options.' });
    }
  }

  /**
   * Sets the block's map background index. The server authorizes the member
   * first, then rejects any index the block's own theme does not offer.
   */
  public async putMapBackgroundSelection(request: Request, response: Response): Promise<void> {
    const blockId = Number.parseInt(request.params.id, 10);
    if (!Number.isInteger(blockId)) {
      response.status(400).json({ error: 'Invalid block id.' });
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
      if (!(await this.blockService.canAdmin(blockId, session.id))) {
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

      const result = await this.blockService.updateMapBackgroundSelection(blockId, index);
      if (result.status === 'not_found') {
        response.status(404).json({ error: 'Block or its owning colony was not found.' });
        return;
      }
      if (result.status === 'invalid') {
        response.status(400).json({
          error: 'Selected index is not available for this block.',
        });
        return;
      }
      response.status(200).json({ selectedIndex: result.selectedIndex });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: 'Unable to update map background selection.' });
    }
  }
}
const memberService = Container.get(MemberService);
const blockService = Container.get(BlockService);
const hoodService = Container.get(HoodService);
export const blockController = new BlockController(memberService, blockService, hoodService);
