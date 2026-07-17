import { Request, Response } from 'express';
import { Container } from 'typedi';
import validator from 'validator';
import * as badwords from 'badwords-list';

import {
  MemberService,
  HomeService,
} from '../services';

/**
 * Maximum size, in bytes, of an uploaded home image before it's resized. The final stored
 * file is always a small WebP thumbnail regardless of input size (see
 * HomeService.uploadHomeImage), so this only guards against oversized uploads, not final
 * disk usage - kept generous so normal smartphone photos aren't rejected.
 */
const IMAGE_FILESIZE_LIMIT = 5 * 1024 * 1024;

class HomeController {

  /**
   * Constructor.
   *
   * @param memberService service for interacting with member models
   */
  constructor(
    private memberService: MemberService,
    private homeService: HomeService,
  ) {}

  public async getHome(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    let userId = null;


    try {

      const { username } = request.params;

      if(username && username !== 'undefined') {
        const user = await this.memberService.find({
          username: username,
        });
        if(user) {
          userId = user.id;
        } else {
          throw new Error('Member not found');

        }
      } else {
        userId = session.id;

      }

      const homeData = await this.homeService.getHome(userId);

      if(homeData) {
        const blockData = await this.homeService.getHomeBlock(homeData.id);
        const homeDesignData = await this.homeService.getPlaceHomeDesign(userId, homeData.id);
        const homeRecord = await this.homeService.getHomeRecord(homeData.id);
        // Only expose the real image filename once it has been approved by moderation;
        // otherwise the client shows the "NOT CHECKED!" placeholder (for a pending image)
        // or the "No image uploaded yet!" text. This keeps unchecked images off the public
        // page for everyone, including the owner.
        const publicHomeRecord = homeRecord && {
          ...homeRecord,
          image: homeRecord.image_status === 'approved' ? homeRecord.image : null,
        };
        response.status(200).json({
          homeData: homeData,
          blockData: blockData,
          homeDesignData: homeDesignData,
          homeRecord: publicHomeRecord,
        });
      } else {
        response.status(200).json({
          homeData: null,
          blockData: null,
          homeDesignData: null,
          homeRecord: null,
        });
      }


    } catch (error) {
      console.error(error);
      response.status(400).json({
        error: 'A problem occurred during fetching home data.',
      });

    }

  }

  public async createHome(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const {
      blockId,
      location,
      houseName,
      houseDescription,
      firstName,
      lastName,
      icon2d,
      home3d,
    } = request.body;


    try {
      if (!validator.isInt(blockId)) {
        throw new Error('blockId must be passed');
      }

      if (!validator.isInt(location)) {
        throw new Error('location must be passed');
      }

      if (validator.isEmpty(houseName)) {
        throw new Error('Home name is required');
      }

      if (icon2d === null) {
        throw new Error('2D house is required');
      }

      const bannedwords = badwords.regex;
      if(houseName.match(bannedwords) || 
      houseDescription.match(bannedwords) ||
      firstName.match(bannedwords) ||
      lastName.match(bannedwords)){
        throw new Error('This language can not be used on CTR!');
      } 

      // check they don't already have a home
      const homeInfo = await this.homeService.getHome(session.id);
      if(homeInfo) {
        console.log(homeInfo);
        throw new Error('Home already exists.');
      } else {

        // check if they have enough for the home
        const memberInfo = await this.memberService.getMemberInfo(session.id);
        const donor = await this.memberService.getDonorLevel(session.id);
        let donorLevel = null;
        if(donor){
          donorLevel = Object.values(donor).toString();
        }
        let purchaseAmount = 0;
        if(home3d) {
          // check they have enough in their wallet to buy the 3d home
          // this is optional (if not null)
          const homeDesignInfo = await this.homeService.getHomeDesign(session.id, home3d);
          if(donorLevel === 'Champion' && home3d === 'championhome'){
            purchaseAmount = 0;
          } else {
            if(homeDesignInfo.price > memberInfo.walletBalance) {
              throw new Error('Not enough funds to purchase house.');
            }
            purchaseAmount = homeDesignInfo.price;
          }
        }

        await this.homeService.createHome(
          session.id,
          firstName,
          lastName,
          blockId,
          location,
          houseName,
          houseDescription,
          icon2d,
          home3d,
        );

        if(purchaseAmount > 0) {
          await this.memberService.performHomePurchaseTransaction(session.id, purchaseAmount);
        }

        await this.memberService.updateName(session.id, firstName, lastName);

        response.status(200).json({ 'status': 'success' });

      }

    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async moveHome(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const {
      blockId,
      location,
    } = request.body;


    try {
      if (!validator.isInt(blockId)) {
        throw new Error('blockId must be passed');
      }

      if (!validator.isInt(location)) {
        throw new Error('location must be passed');
      }

      const homeInfo = await this.homeService.getHome(session.id);
      if(!homeInfo) {
        throw new Error('You don\'t have a home yet.');
      } else {

        await this.homeService.moveHome(
          session.id,
          blockId,
          location,
        );

        response.status(200).json({ 'status': 'success' });

      }

    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async updateHome(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const {
      homeName,
      icon2d,
      home3d,
    } = request.body;


    try {

      if (validator.isEmpty(homeName)) {
        throw new Error('Home name is required');
      }

      if (icon2d === null) {
        throw new Error('2D house is required');
      }

      const bannedwords = badwords.regex;
      if(homeName.match(bannedwords)){
        throw new Error('This language can not be used on CTR!');
      } 

      // check they already have a home
      const homeInfo = await this.homeService.getHome(session.id);
      if(!homeInfo) {
        throw new Error('You don\'t have a home yet.');
      } else {
        const donor = await this.memberService.getDonorLevel(session.id);
        let donorLevel = null;
        if(donor){
          donorLevel = Object.values(donor).toString();
        }
        const currentHomeDesign = await this
          .homeService
          .getPlaceHomeDesign(session.id, homeInfo.id);
        let refund = 0;
        let currentHomeDesignId = null;
        if(currentHomeDesign) {
          if(donorLevel === 'Champion' && currentHomeDesign.id === 'championhome'){
            refund = 0;
          } else {
            refund = currentHomeDesign.price;
          }
          currentHomeDesignId = currentHomeDesign.id;
        }

        // check if they have enough for the home
        const memberInfo = await this.memberService.getMemberInfo(session.id);
        let purchaseAmount = 0;
        if(home3d
          && home3d !== currentHomeDesignId
        ) {
          // check they have enough in their wallet to buy the 3d home
          // this is optional (if not null)
          const homeDesignInfo = await this.homeService.getHomeDesign(session.id, home3d);
          if(typeof homeDesignInfo.id === 'undefined') {
            throw new Error('Home design not found.');
          }

          if(donorLevel === 'Champion' && home3d === 'championhome'){
            purchaseAmount = 0;
          } else {
            if(homeDesignInfo.price > (memberInfo.walletBalance + refund)) {
              throw new Error('Not enough funds to purchase house.');
            }
            purchaseAmount = homeDesignInfo.price;
          }
        }

        await this.homeService.updateHome(
          session.id,
          homeName,
          icon2d,
          home3d,
        );

        if(home3d !== currentHomeDesignId) {
          if(refund > 0) {
            await this.memberService
              .performHomeRefundTransaction(session.id, refund);
          }

          if(purchaseAmount > 0) {
            await this.memberService.performHomePurchaseTransaction(session.id, purchaseAmount);
          }
        }

        response.status(200).json({ 'status': 'success' });

      }

    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async resetHome(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const { blockId, location } = request.body;

    try {
      if (!validator.isInt(blockId)) {
        throw new Error('blockId must be passed');
      }

      if (!validator.isInt(location)) {
        throw new Error('location must be passed');
      }

      const homeInfo = await this.homeService.getHome(session.id);
      if (!homeInfo) {
        throw new Error('You don\'t have a home yet.');
      }

      const donor = await this.memberService.getDonorLevel(session.id);
      let donorLevel = null;
      if (donor) {
        donorLevel = Object.values(donor).toString();
      }
      const currentHomeDesign = await this.homeService.getPlaceHomeDesign(
        session.id,
        homeInfo.id,
      );
      let refund = 0;
      if (currentHomeDesign) {
        if (donorLevel === 'Champion' && currentHomeDesign.id === 'championhome') {
          refund = 0;
        } else {
          refund = currentHomeDesign.price;
        }
      }

      await this.homeService.resetHome(session.id, parseInt(blockId), parseInt(location));

      if (refund > 0) {
        await this.memberService.performHomeRefundTransaction(session.id, refund);
      }

      response.status(200).json({ 'status': 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async getHomeInformation(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const { placeId } = request.params;

    try {
      if (!validator.isInt(placeId)) {
        throw new Error('placeId must be passed');
      }

      const description = await this.homeService.getHomeInformation(parseInt(placeId));
      response.status(200).json({ description });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async updateHomeInformation(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const { houseDescription } = request.body;

    try {
      if (houseDescription && houseDescription.length > 1000) {
        throw new Error('Description must be 1000 characters or fewer.');
      }

      const bannedwords = badwords.regex;
      if (houseDescription && houseDescription.match(bannedwords)) {
        throw new Error('This language can not be used on CTR!');
      }

      await this.homeService.updateHomeInformation(session.id, houseDescription || '');

      response.status(200).json({ 'status': 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async uploadImage(request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    if (
      typeof request.files?.imageFile === 'undefined' ||
      validator.isEmpty(request.files.imageFile.name)
    ) {
      response.status(400).json({
        error: 'Image file is required.',
      });
      return;
    }

    const imageFile = request.files.imageFile;
    if (!imageFile.mimetype.startsWith('image/')) {
      response.status(400).json({
        error: 'File must be an image.',
      });
      return;
    }
    if (imageFile.size > IMAGE_FILESIZE_LIMIT) {
      response.status(400).json({
        error: 'Image file must be less than 5MB',
      });
      return;
    }

    try {
      // Converted to WebP and downscaled to a max of 200x200 server-side, regardless of
      // the source format/dimensions - see HomeService.uploadHomeImage.
      await this.homeService.uploadHomeImage(session.id, imageFile);
      response.status(200).json({ 'status': 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async removeImage(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    try {
      await this.homeService.removeHomeImage(session.id);
      response.status(200).json({ 'status': 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async getChatAccess(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    try {
      const chatAccess = await this.homeService.getChatAccess(session.id);
      response.status(200).json(chatAccess);
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  public async updateChatAccess(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const { guests } = request.body;

    try {
      if (!Array.isArray(guests)) {
        throw new Error('guests must be a list of usernames.');
      }

      await this.homeService.updateChatAccess(session.id, guests);

      response.status(200).json({ 'status': 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  /**
   * Public endpoint used by the realtime chat server to determine whether a room (place)
   * restricts chat to a specific citizen list. No session required - this is a
   * server-to-server call and returns no personally identifying data beyond usernames
   * the owner has already chosen to publish via the access list.
   */
  public async getChatAccessStatus(request: Request, response: Response): Promise<void> {
    const { placeId } = request.params;

    try {
      if (!validator.isInt(placeId)) {
        throw new Error('placeId must be passed');
      }

      const status = await this.homeService.getChatAccessStatusByPlaceId(parseInt(placeId));
      response.status(200).json(status);
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  /**
   * Confirms the session belongs to a moderator (Block Leader / Deputy or admin) allowed
   * to check home images. Sends a 403 and returns null if not. v1 grants any staff/admin
   * the ability to check any pending image; block-scoping can be layered on later.
   */
  private async requireImageModerator(session): Promise<boolean> {
    const allowed = await this.memberService.canStaff(session.id)
      || await this.memberService.canAdmin(session.id);
    return allowed;
  }

  /**
   * Returns the queue of home images awaiting a check. Moderators only.
   */
  public async getImageModerationQueue(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    try {
      if (!(await this.requireImageModerator(session))) {
        response.status(403).json({ 'error': 'Not authorized to check home images.' });
        return;
      }
      const queue = await this.homeService.getPendingImageHomes();
      response.status(200).json({ queue });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  /**
   * Approves a pending home image, making it publicly visible. Moderators only.
   */
  public async approveImage(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const { placeId } = request.params;

    try {
      if (!(await this.requireImageModerator(session))) {
        response.status(403).json({ 'error': 'Not authorized to check home images.' });
        return;
      }
      if (!validator.isInt(placeId)) {
        throw new Error('placeId must be passed');
      }
      await this.homeService.approveHomeImage(parseInt(placeId), session.id);
      response.status(200).json({ 'status': 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

  /**
   * Rejects a pending home image, deleting it. Moderators only.
   */
  public async rejectImage(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const { placeId } = request.params;

    try {
      if (!(await this.requireImageModerator(session))) {
        response.status(403).json({ 'error': 'Not authorized to check home images.' });
        return;
      }
      if (!validator.isInt(placeId)) {
        throw new Error('placeId must be passed');
      }
      await this.homeService.rejectHomeImage(parseInt(placeId), session.id);
      response.status(200).json({ 'status': 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ 'error': error.message });
    }
  }

}
const memberService = Container.get(MemberService);
const homeService = Container.get(HomeService);
export const homeController = new HomeController(memberService, homeService);
