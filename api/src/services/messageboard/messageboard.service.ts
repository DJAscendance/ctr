import { Service } from 'typedi';

import {
  MessageboardRepository,
  ColonyRepository,
} from '../../repositories';
import { sanitizeUserHtml } from '../../libs';
import {forEach} from "lodash";

/** Service for dealing with messages on message boards */
@Service()
export class MessageboardService {
  public static readonly MAX_QUERY_LIMIT = 1000;
  public static readonly VALID_ORDERS = ['id','date'];
  public static readonly VALID_ORDER_DIRECTIONS = ['asc', 'desc'];
  
  constructor(
   private messageboardRepository: MessageboardRepository,
  ) {}
  
  public async changeMessageboardIntro(
    placeId,
    Intro,
  ): Promise<any> {
    console.log(`Service${  placeId}`);
    return await this.messageboardRepository.changeMessageboardIntro(placeId, Intro);
  }
  public async deleteMessageboardMessage(
    messageId,
  ): Promise<any> {
    return await this
      .messageboardRepository
      .deleteMessageboardMessage(messageId);
  }

  public async removeAllMessages(userId: number): Promise<any> {
    await this.messageboardRepository.removeAllMessages(userId);
  }
  
  public async getAdminInfo(
    placeId,
    memberId,
  ): Promise<any> {
    return await this.messageboardRepository.getAdminInfo(placeId, memberId);
  }
  public async getInfo(
    placeId: number,
  ): Promise<any> {
    return await this.messageboardRepository.getInfo(placeId);
  }
  
  public async getMessageboardMessages(
    placeId: number,
  ): Promise<any> {
    return await this.messageboardRepository.getMessageboardMessages(placeId);
  }
  
  public async postMessageboardMessage(
    memberId: number,
    placeId: number,
    subject: string,
    message: string,
  ): Promise<any> {
    return await this
      .messageboardRepository
      .postMessageboardMessage(memberId, placeId, subject, message);
  }
  
  public async postMessageAllMessage(
    memberId: number,
    locations: object,
    subject: string,
    message: string,
  ): Promise<any> {
    forEach(locations, async (id) => {
      await this
        .messageboardRepository
        .postMessageboardMessage(memberId, id, subject, message);
    });
    return;
  }
  
  public async postMessageboardReply(
    memberId: number,
    placeId: number,
    subject: string,
    message: string,
    parentId: number,
  ): Promise<any>{
    return await this
      .messageboardRepository
      .postMessageboardReply(memberId, placeId, subject, message, parentId);
  }
  
  /**
   * Cleans a post body against the shared user-HTML allowlist.
   *
   * The policy itself now lives in libs/sanitize-user-html.ts. It used to be
   * restated here and, character for character, again in InboxService - two
   * copies of one security decision. The allowlist is unchanged by that move.
   */
  public async sanitize(
    uncleanInfo: string,
  ): Promise<any>{
    return sanitizeUserHtml(uncleanInfo);
  }
  public async getMessage(
    messageId: number,
  ): Promise<void>{
    return await this
      .messageboardRepository
      .getMessage(messageId);
    console.log('Service');
  }
}
