import {Request, Response} from 'express';
import { PlaceService, MemberService, HomeService} from '../services';
import { Container } from 'typedi';

import * as badwords from 'badwords-list';
import { hasAccess } from '../libs/access-level';
import { Place } from 'models';
import { SessionInfo } from 'session-info.interface';

export class PlaceController {
  constructor(
    private placeService: PlaceService, 
    private memberService: MemberService,
    private homeService: HomeService,
  ) {}

  /** Get Admin status for the specific place's slug */
  public async canAdmin(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const { slug, id } = request.params;

    // Authenticate first. A missing or malformed/expired token is an authentication failure
    // (401), not a generic 400, and we never echo the token or the underlying error back.
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

  public async getLiveEventDestinations(request: Request, response: Response,): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    try {
      const destinations = await this.placeService.getLiveEventDestinations();
        response.status(200).json({ destinations });
      } catch (error) {
        console.log(error);
        response.status(400).json({ error });
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

  /**
   * Updates the virtual pet belonging to a place.
   *
   * Authorization is unchanged: the home's owner, or a member holding the
   * 'security' capability. The order below is deliberate -- authenticate,
   * parse, authorize, validate every behaviour, and only then write once and
   * answer once. The previous version ran validation, the authorization test,
   * the write and the response inside the behaviour loop, so a request could
   * write several times, answer several times, or (with no behaviours) never
   * answer at all.
   *
   * An empty behaviour list is valid: `pet_behaviours` is a free-form JSON blob
   * and the loop only ever existed to word-filter it, so "no behaviours" has
   * nothing to reject. Validation failures keep their existing 200-with-`error`
   * shape because `spa/src/pages/home/HomeVirtualPet.vue` reads the message off
   * a successful response. Malformed JSON is not reachable from that page and
   * gets a plain 400 rather than an uncaught parse exception.
   */
  public async updateVirtualPet(request: Request, response: Response): Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if(!session) return;
    const placeId = Number.parseInt(request.params.place_id);
    const body = request.body ?? {};
    if(
      body.name === undefined || body.name === null ||
      body.avatar === undefined || body.avatar === null ||
      body.voice === undefined || body.voice === null ||
      body.behaviours === undefined || body.behaviours === null
    ){
      response.status(400).json({ error: 'Missing pet name, avatar, voice or behaviours.' });
      return;
    }
    const name = body.name.toLocaleString();
    const avatar = body.avatar.toLocaleString();
    const active = body.active;
    const voice = Number.parseInt(body.voice.toLocaleString());
    const behaviours = body.behaviours.toLocaleString();

    const admin = await this.memberService.getAccessLevel(session.id);
    // A member who has not settled a home has no owner record at all, so this must be
    // optional: reaching for `owner.id` would throw inside the handler and leave the
    // request with no response, which is the failure mode this refactor exists to remove.
    const owner = await this.homeService.getHome(session.id);
    if(!hasAccess(admin, 'security') && owner?.id !== placeId){
      response.status(200).json({ error: 'You do not have access to update this.' });
      return;
    }

    let testBehaviours;
    try {
      testBehaviours = JSON.parse(behaviours);
    } catch (error) {
      response.status(400).json({ error: 'Pet behaviours are not valid JSON.' });
      return;
    }
    if(!Array.isArray(testBehaviours)){
      response.status(400).json({ error: 'Pet behaviours must be a list.' });
      return;
    }

    const bannedwords = badwords.regex;
    if(name.match(bannedwords)){
      response.status(200).json({ error: 'Pet name cannot contain a banned word.' });
      return;
    }
    const hasBannedBehaviour = testBehaviours.some(behaviour =>
      String(behaviour?.input ?? '').match(bannedwords) ||
      String(behaviour?.output ?? '').match(bannedwords));
    if(hasBannedBehaviour){
      response.status(200).json({ error: 'Pet input/output cannot contain a banned word.' });
      return;
    }

    try {
      await this.placeService
        .updateVirtualPet(placeId, name, avatar, active, voice, behaviours);
      response.status(200).json({ success: 'success' });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error});
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
}

const placeService = Container.get(PlaceService);
const memberService = Container.get(MemberService);
const homeService = Container.get(HomeService);
export const placeController = new PlaceController(
  placeService, memberService, homeService);
