import { Request, Response} from 'express';
import validator from 'validator';
import { Container } from 'typedi';

import { MemberService, MessageService, HomeService, JailService } from '../services';

const badwords = require('badwords-list');

interface QueryParams {
  limit: string,
  order: string,
  orderDirection: string,
}

// Exported so the Jail privacy rules can be tested against the class directly, the way
// PlaceController already is. The singleton below stays the only thing routes use.
export class MessageController {

  constructor(
    private memberService: MemberService,
    private messageService: MessageService,
    private homeService: HomeService,
    private jailService: JailService,
  ) {}

  /**
   * The member ids whose stored messages this caller may not read in this place.
   *
   * Empty everywhere but the Jail, so no other room changes behaviour or pays for a ban
   * lookup. Empty for an inmate or for Jail/Security staff, who are entitled to the whole
   * record.
   */
  private async jailChatExclusions(request: Request, placeId: number): Promise<number[]> {
    if (!(await this.jailService.isJailPlace(placeId))) return [];

    const { apitoken } = request.headers;
    const session = apitoken
      ? this.memberService.decodeMemberToken(<string> apitoken)
      : null;
    if (session && session.id) {
      const standing = await this.jailService.getStanding(session.id);
      if (standing.staff || standing.inmate) return [];
    }

    return this.jailService.findEverJailedMemberIds();
  }

  /** Handles storing a user message to the database */
  public async addMessage(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const session = this.memberService.decodeMemberToken(<string> apitoken);
    if(!session) {
      response.status(400).json({
        error: 'Invalid or missing token.',
      });
      return;
    }

    if(Number.parseInt(request.params.placeId) <= 0) {
      response.status(400).json({
        error: 'placeId is required.',
      });
      return;
    }

    if(validator.isEmpty(request.body.body)) {
      response.status(400).json({
        error: 'Message body is required.',
      });
      return;
    }

    const placeId = Number.parseInt(request.params.placeId);
    try {
      const chatAccess = await this.homeService.getChatAccessStatusByPlaceId(placeId);
      if (chatAccess.restricted) {
        const member = await this.memberService.find({ id: session.id });
        if (!member || !chatAccess.allowedUsernames.includes(member.username)) {
          response.status(403).json({
            error: 'You don\'t have chat access at this home.',
          });
          return;
        }
      }
    } catch (error) {
      console.error(error);
      response.status(400).json({
        error: 'A problem occurred creating message.',
      });
      return;
    }

    /*
     * Inmate speech in the Jail is never written down.
     *
     * This is the write half of the privacy rule, and it is the half that cannot be
     * undone by a later mistake: a line that was never stored cannot be served by a read
     * path, recovered by a refresh, found by a search, or exposed by a query somebody
     * writes next year. The socket server delivers it live to Security and the Jail staff
     * and to nobody else; there is no second copy.
     *
     * Only the Jail, and only an inmate. A visitor's Jail chat is ordinary public chat and
     * is stored exactly as before, because the requirement is inmate privacy, not silence.
     *
     * A null id goes back so the client still emits the realtime event. The message has no
     * row, so it has nothing for a moderator to delete later -- which is the cost of not
     * keeping it, and is accepted deliberately.
     */
    try {
      if (await this.jailService.isJailPlace(placeId)
        && await this.jailService.isInmate(session.id)) {
        response.status(200).json({ messageId: null });
        return;
      }
    } catch (error) {
      console.error(error);
      response.status(400).json({
        error: 'A problem occurred creating message.',
      });
      return;
    }

    const bannedwords = badwords.regex;
    if (bannedwords.test(request.body.body)) {
      try {
        const { id } = session;
        const { body } = request.body;

        const messageId = await this.messageService.create(
          id,
          placeId,
          body,
          2,
        );

        response.status(200).json({ messageId });
      } catch (error) {
        console.error(error);
        response.status(400).json({
          error: 'A problem occurred creating message.',
        });
      }
    }
    else{
      try {
        const { id } = session;
        const { body } = request.body;
        const messageId = await this.messageService.create(
          id,
          placeId,
          body,
          1,
        );
        response.status(200).json({ messageId });
      } catch (error) {
        console.error(error);
        response.status(400).json({
          error: 'A problem occurred creating message.',
        });
      }
    }
  }
  
public async removeAllMessages(request: Request, response: Response):  Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    try {
      await this.messageService.removeAllMessages(session.id);
      response.status(200).json({ status: 'success' });
    } catch {
      response.status(400).json({error: 'Error remvoing messages.'});
    }
  }

  /** delete a message from the chat **/
  public async deleteMessage(request: Request, response: Response): Promise<void> {
    const { apitoken } = request.headers;
    const session = this.memberService.decodeMemberToken(<string> apitoken);
    if(!session) {
      response.status(400).json({
        error: 'Invalid or missing token.',
      });
      return;
    }
    
    const messageId = Number.parseInt(request.params.messageid);
  
    if(messageId <= 0) {
      response.status(400).json({
        error: 'messageId is required.',
      });
      return;
    }
  
    try {
      // Check if the member has permission to delete the message
      const admin = await this.memberService.canAdmin(session.id);
      if (!admin) {
        response.status(403).json({
          error: 'You do not have permission to delete this message.',
        });
        return;
      }
  
      await this.messageService.deleteMessage(messageId);
      response.status(200).json({ success: true });
    } catch (error) {
      console.error(error);
      response.status(400).json({
        error: 'A problem occurred while trying to delete the message.',
      });
    }
  }

  /**
   * Provides an ordered list of messages for the given place.
   *
   * For the Jail, the answer depends on who is asking. Stored rows carry no record of the
   * author's standing when they were written, so the only rule that cannot leak is to
   * withhold Jail history written by anyone who has ever been jailed -- see
   * `BanRepository.findEverJailedMemberIds`. That reaches only rows written before inmate
   * speech stopped being stored at all; nothing new joins the set.
   *
   * Inmates and Jail/Security staff get the unfiltered Jail history. Everyone else --
   * including an unauthenticated caller, which this endpoint still accepts for every other
   * place -- gets the visitor view. Standing is read from the token's member id on the
   * server; a caller who sends no token, a forged one, or somebody else's username is an
   * ordinary visitor here by construction.
   */
  public async getResults(request: Request, response: Response): Promise<void> {
    const placeId = Number.parseInt(request.params.placeId);
    if(placeId <= 0) {
      response.status(400).json({
        error: 'placeId is required.',
      });
      return;
    }
    const { limit, order, orderDirection }: QueryParams = (<QueryParams> (<unknown> request.query));
    const parsedLimit = Number.parseInt(limit);
    try {
      const excludeMemberIds = await this.jailChatExclusions(request, placeId);

      const messages = await this.messageService.getResults(
        placeId,
        order,
        orderDirection,
        parsedLimit,
        excludeMemberIds,
      );
      response.status(200).json({ messages });
    } catch (error) {
      console.error(error);
      response.status(400).json({
        error: 'A problem occurred while trying to fetch messages.',
      });
    }
  }
}
const memberService = Container.get(MemberService);
const messageService = Container.get(MessageService);
const homeService = Container.get(HomeService);
const jailService = Container.get(JailService);
export const messageController = new MessageController(
  memberService, messageService, homeService, jailService);
