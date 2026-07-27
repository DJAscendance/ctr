import {Request, Response} from 'express';
import {
  PlaceService,
  MemberService,
  HomeService,
  PlaceInformationService,
  PlaceUpdateHubService,
} from '../services';
import { Container } from 'typedi';

import * as badwords from 'badwords-list';
import { Place } from 'models';
import { SessionInfo } from 'session-info.interface';

export class PlaceController {
  constructor(
    private placeService: PlaceService, 
    private memberService: MemberService,
    private homeService: HomeService,
    private placeInformationService: PlaceInformationService,
    private placeUpdateHubService: PlaceUpdateHubService,
  ) {}

  /**
   * Get Admin status for the specific place's slug.
   *
   * The response contract, by condition:
   *   missing / malformed / expired token -> 401 { error }
   *   missing or non-string slug          -> 400 { error }
   *   non-numeric explicit place id       -> 400 { error }
   *   slug matches no place               -> 404 { error }
   *   authenticated, not an admin         -> 200 { result: false }
   *   authenticated administrator         -> 200 { result: true }
   *   repository / database failure       -> 500 { error }
   *
   * Three things this deliberately does NOT do. It does not answer 400 for an
   * authentication problem - that is a 401, and the two are not interchangeable to a
   * caller deciding whether to re-authenticate. It does not collapse an internal failure
   * into `result: false`, which would silently present an outage as "you are not an
   * admin" and hide it from monitoring. And it does not put the caught error in the body:
   * the previous `json({ error })` serialized whatever was thrown, which for a knex
   * failure can carry the SQL and connection details.
   *
   * Only the HTTP contract changes here. Who counts as an admin is decided entirely by
   * PlaceService.canAdmin, which is untouched, so Block, Neighborhood, Colony, Mall,
   * security and home scoping all behave exactly as before.
   */
  public async canAdmin(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const { slug, id } = request.params;

    // Authenticate first: a missing or bad token is an authentication failure regardless of
    // whether the rest of the request is well-formed, and nothing about the token is echoed.
    if (!apitoken || typeof apitoken !== 'string') {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }
    let session: SessionInfo;
    try {
      session = this.memberService.decodeMemberToken(apitoken);
    } catch (error) {
      response.status(401).json({ error: 'Invalid or expired token.' });
      return;
    }
    if (!session) {
      response.status(401).json({ error: 'Invalid or expired token.' });
      return;
    }

    if (!slug || typeof slug !== 'string') {
      response.status(400).json({ error: 'invalid or missing place slug' });
      return;
    }

    try {
      // the following is needed to make sure shops find the mall's place id
      let place_id: number;
      if (id === undefined) {
        const place = await this.placeService.findBySlug(slug);
        if (!place) {
          response.status(404).json({ error: 'Place not found.' });
          return;
        }
        place_id = place.id;
      } else {
        place_id = Number.parseInt(id);
        if (Number.isNaN(place_id)) {
          response.status(400).json({ error: 'invalid place id' });
          return;
        }
      }
      const result = await this.placeService.canAdmin(slug, place_id, session.id);
      response.status(200).json({ result });
    } catch (error) {
      console.error('place.canAdmin failed', error);
      response.status(500).json({ error: 'Unable to determine admin status.' });
    }
  }

  /** Get if user can manage access rights */
  public async canManageAccess(request: Request, response: Response): Promise<void> {
    const { id } = request.params;
    const { apitoken } = request.headers;
    const { slug } = request.params;

    if (!slug || typeof slug !== 'string') {
      response.status(400).json({ error: 'invalid or missing place slug' });
    }

    try {
      const session = this.memberService.decodeMemberToken(<string>apitoken);
      if (!session || !(await this.placeService.canManageAccess(slug, parseInt(id), session.id))) {
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

  /** get users that are assigned access to the place */
  public async getAccessInfoByUsername(request: Request, response: Response): Promise<any> {
    const { id } = request.params;
    const { apitoken } = request.headers;
    const { slug } = request.params;
    try {
      const session = this.memberService.decodeMemberToken(<string>apitoken);
      if (!session) {
        response.status(400).json({
          error: 'Invalid or missing token.',
        });
        return;
      }
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
    try {
      const data = await this.placeService.getAccessInfoByUsername(slug, parseInt(id));
      response.status(200).json({ data });
    } catch (error) {
      console.log(error);
      response.status(400).json({ error });
    }
  }

  public async getSecurityInfo(request: Request, response: Response): Promise<any> {
    const { apitoken } = request.headers;
    const session = this.memberService.decodeMemberToken(<string> apitoken);
    if (!session) {
      response.status(400).json({
        error: 'Invalid or missing token.',
      });
      return;
    }
    const securityInfo = await this.placeService.getSecurityInfo();
    response.status(200).json({ securityInfo });
  }

  /** Provides data about the place with the given slug */
  public async getPlace(request: Request, response: Response): Promise<void> {
    const { slug } = request.params;
    try {
      const place = await this.placeService.findBySlug(slug);
      response.status(200).json({ place });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }

  public async getPlaceById(request: Request, response: Response): Promise<Place[]> {
    const session = this.memberService.decryptSession(request, response);
    if(!session) return;
    try {
      const place = await this.placeService.findById(parseInt(request.params.id));
      response.status(200).json({ place });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error });
    }
  }

  /** Provides data about objects present in the place with the given slug */
  public async getPlaceObjects(request: Request, response: Response): Promise<void> {
    const { placeId } = request.params;
    try {
      const objects = await this.placeService.getPlaceObjects(parseInt(placeId));
      response.status(200).json({ object_instance: objects });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error.message });
    }
  }

  public async addStorage(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if(!session) return;
    try {
      let storageName = request.body.name.toString();
      storageName = storageName.replace(/[^0-9a-zA-Z \-[\]/()]/g, '');
      const bannedwords = badwords.regex;
      if(storageName.match(bannedwords)){
        throw new Error('You can not use this language on CTR!');  
      }
      await this.placeService.addStorage(storageName, session.id);
      response.status(200).json({status: 'success'});
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error.message });
    }
  }

  public async removeAccount(request: Request, response: Response):  Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    try {
      const places = await this.placeService.getOwnedPlaces(session.id);
      if(places.length >= 1) {
        const home = places.find(place => place.type === 'home');
        if(home){
          await this.placeService.removeVirtualPet(home.id);
        }
        
        places.forEach(place => {
          this.placeService.removePlace(place.id);
        });
      }
      response.status(200).json({ status: 'success' });
    } catch {
      response.status(400).json({error: 'Error remvoing places.'});
    }
  }

  public async deleteStorage(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if(!session) return;
    try {
      const unitID = request.body.id;
      const place = await this.placeService.findById(unitID);
      if(place.member_id === session.id){
        await this.placeService.deleteStorage(unitID);
        response.status(200).json({status: 'success'});
      }
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error.message });
    }
  }

  public async postAccessInfo(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const { slug } = request.params;
    const session = this.memberService.decodeMemberToken(<string> apitoken);
    if(!session) {
      response.status(400).json({
        error: 'Invalid or missing token.',
      });
      return;
    }
    const { id } = request.params;
    try {
      const access = await this.placeService.canManageAccess(slug, parseInt(id), session.id);
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
      await this.placeService.postAccessInfo(slug, parseInt(id), deputies, owner);
      response.status(200).json({success: true});
    } catch (error) {
      console.log(error.message);
      response.status(400).json({ error: error.message });
    }
  }

  public async addVirtualPet(request: Request, response: Response): Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if(!session) return;
    try {
      const placeId = Number.parseInt(request.params.place_id);
      const petAdded = await this.placeService.addVirtualPet(placeId);
      response.status(200).json({ success: petAdded });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error});
    }
  }

  public async updateVirtualPet(request: Request, response: Response): Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if(!session) return;
    const placeId = Number.parseInt(request.params.place_id);
    const name = request.body.name.toLocaleString();
    const avatar = request.body.avatar.toLocaleString();
    const active = request.body.active;
    const voice = Number.parseInt(request.body.voice.toLocaleString());
    const behaviours = request.body.behaviours.toLocaleString();
    const admin = await this.memberService.getAccessLevel(session.id);
    const bannedwords = badwords.regex;
    const testBehaviours = JSON.parse(behaviours);
    const owner = await this.homeService.getHome(session.id);
    //if(!admin.includes('security') || owner.id !== placeId) return;
    if(name.match(bannedwords)){
      response.status(200).json({ error: 'Pet name cannot contain a banned word.' });
    } else {
      for(let i = 0; i < testBehaviours.length; i++){
        if(
          testBehaviours[i].input.match(bannedwords) ||
          testBehaviours[i].output.match(bannedwords)
        ){
          response.status(200).json({ error: 'Pet input/output cannot contain a banned word.' });
        } else {
          if(admin.includes('security') || owner.id === placeId){
            try {
              await this.placeService
                .updateVirtualPet(placeId, name, avatar, active, voice, behaviours);
              response.status(200).json({ success: 'success' });
            } catch (error) {
              console.error(error);
              response.status(400).json({ error: error});
            }
          } else {
            response.status(200).json({ error: 'You do not have access to update this.' });
          }
        }
      }
    }
  }

  public async getVirtualPet(request: Request, response: Response): Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if(!session) return;
    try {
      const placeId = Number.parseInt(request.params.place_id);
      const virtualPet = await this.placeService.getVirtualPet(placeId);
      response.status(200).json({ data: virtualPet });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error});
    }
  }
  /**
   * Public read of a place's staff-authored information.
   *
   * The stored value was sanitized on write, so it is safe to render as HTML.
   * No authentication is required: this is the same text the place's Information
   * window shows to every visitor, exactly as the original did.
   */
  public async getInformation(request: Request, response: Response): Promise<void> {
    const placeId = Number.parseInt(request.params.placeId, 10);
    if (Number.isNaN(placeId)) {
      response.status(400).json({ error: 'invalid place id' });
      return;
    }
    try {
      const information = await this.placeInformationService.getInformation(placeId);
      if (!information) {
        response.status(404).json({ error: 'Place not found.' });
        return;
      }
      response.status(200).json(information);
    } catch (error) {
      console.error('place.getInformation failed', error);
      response.status(500).json({ error: 'Unable to load place information.' });
    }
  }

  /**
   * Whether the caller may edit this place's information. Used by the SPA to
   * decide whether to offer the editor; it is NOT the security boundary - the
   * update endpoint re-checks independently.
   */
  public async canEditInformation(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const placeId = Number.parseInt(request.params.placeId, 10);
    if (Number.isNaN(placeId)) {
      response.status(400).json({ error: 'invalid place id' });
      return;
    }
    const session = this.authenticate(apitoken, response);
    if (!session) {
      return;
    }
    try {
      const place = await this.placeService.findById(placeId);
      if (!place) {
        response.status(404).json({ error: 'Place not found.' });
        return;
      }
      const result = PlaceInformationService.isSupportedType(place.type)
        && await this.placeInformationService.canEdit(place, session.id);
      response.status(200).json({ result });
    } catch (error) {
      console.error('place.canEditInformation failed', error);
      response.status(500).json({ error: 'Unable to determine admin status.' });
    }
  }

  /**
   * Updates a place's staff-authored information.
   *
   * The place type - and therefore which scoped staff check applies - is read
   * from the stored row inside PlaceInformationService. Nothing the client sends
   * can steer that choice.
   */
  public async updateInformation(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const placeId = Number.parseInt(request.params.placeId, 10);
    if (Number.isNaN(placeId)) {
      response.status(400).json({ error: 'invalid place id' });
      return;
    }
    const session = this.authenticate(apitoken, response);
    if (!session) {
      return;
    }

    const { description } = request.body;
    if (typeof description !== 'undefined'
      && description !== null
      && typeof description !== 'string') {
      response.status(400).json({ error: 'invalid information' });
      return;
    }

    try {
      const result = await this.placeInformationService.updateInformation(
        placeId,
        session.id,
        description || '',
      );
      switch (result.status) {
      case 'success':
        response.status(200).json({ description: result.description });
        return;
      case 'not_found':
        response.status(404).json({ error: 'Place not found.' });
        return;
      case 'unsupported':
        // Same shape as a refusal: an unsupported place type must not be
        // distinguishable from one the caller simply may not edit.
        response.status(403).json({ error: 'You may not update this place.' });
        return;
      case 'forbidden':
        response.status(403).json({ error: 'You may not update this place.' });
        return;
      case 'too_long':
        response.status(400).json({
          error: 'Information must be '
            + `${PlaceInformationService.INFORMATION_MAX_LENGTH} characters or fewer.`,
        });
        return;
      }
    } catch (error) {
      console.error('place.updateInformation failed', error);
      response.status(500).json({ error: 'Unable to update place information.' });
    }
  }

  /**
   * Capability set for a place's scoped Update hub.
   *
   * The response contract, by condition:
   *   missing / malformed / expired token -> 401 { error }
   *   non-numeric place id                -> 400 { error }
   *   place does not exist                -> 404 { error }
   *   type has no hub, or no capability   -> 403 { error }
   *   at least one capability granted     -> 200 { hub }
   *   repository / database failure       -> 500 { error }
   *
   * "Type has no hub" and "you hold no capability here" deliberately answer the
   * same 403 with the same body. Distinguishing them would let an unauthorized
   * caller enumerate which places have scoped administration.
   *
   * The only client input is the place id. Type, slug and the parent chain are
   * read from the stored row inside PlaceUpdateHubService, so nothing the client
   * sends can steer which scoped check runs. This endpoint is advisory for
   * rendering only: every tool it advertises is independently authorized by its
   * own endpoint, and hiding a tile is never the access control.
   */
  public async getUpdateHub(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const placeId = Number.parseInt(request.params.placeId, 10);
    if (Number.isNaN(placeId)) {
      response.status(400).json({ error: 'invalid place id' });
      return;
    }
    const session = this.authenticate(apitoken, response);
    if (!session) {
      return;
    }
    try {
      const result = await this.placeUpdateHubService.getHub(placeId, session.id);
      switch (result.status) {
      case 'success':
        response.status(200).json({ hub: result.hub });
        return;
      case 'not_found':
        response.status(404).json({ error: 'Place not found.' });
        return;
      case 'unsupported':
      case 'forbidden':
        response.status(403).json({ error: 'You may not administer this place.' });
        return;
      }
    } catch (error) {
      console.error('place.getUpdateHub failed', error);
      response.status(500).json({ error: 'Unable to determine place capabilities.' });
    }
  }

  /**
   * Shared token gate. Writes the 401 and returns null when authentication
   * fails, so callers can `if (!session) return;`.
   */
  private authenticate(apitoken: unknown, response: Response): SessionInfo | null {
    if (!apitoken || typeof apitoken !== 'string') {
      response.status(401).json({ error: 'Authentication required.' });
      return null;
    }
    let session: SessionInfo;
    try {
      session = this.memberService.decodeMemberToken(apitoken);
    } catch (error) {
      response.status(401).json({ error: 'Invalid or expired token.' });
      return null;
    }
    if (!session) {
      response.status(401).json({ error: 'Invalid or expired token.' });
      return null;
    }
    return session;
  }
}

const placeService = Container.get(PlaceService);
const memberService = Container.get(MemberService);
const homeService = Container.get(HomeService);
const placeInformationService = Container.get(PlaceInformationService);
const placeUpdateHubService = Container.get(PlaceUpdateHubService);
export const placeController = new PlaceController(
  placeService, memberService, homeService, placeInformationService, placeUpdateHubService);
