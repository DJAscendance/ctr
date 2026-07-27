import { Service } from 'typedi';

import { InboxRepository } from '../../repositories';
import { sanitizeUserHtml } from '../../libs';

/** Service for dealing with messages on message boards */
@Service()
export class InboxService {

  constructor(private inboxRepository: InboxRepository) { }

  public async changeInboxIntro(placeId, Intro): Promise<any> {
    console.log(`Service${placeId}`);
    return await this.inboxRepository.changeInboxIntro(placeId, Intro);
  }

  public async deleteInboxMessages(
    messageIds: number[],
    placeId: number,
  ): Promise<any> {
    return this.inboxRepository.deleteInboxMessages(messageIds, placeId);
  }

 public async removeAllMessages(userId: number): Promise<any> {
   return this.inboxRepository.removeAllMessages(userId);
 }

  public async getAdminInfo(placeId, memberId): Promise<any> {
    return await this.inboxRepository.getAdminInfo(placeId, memberId);
  }
  public async getInfo(placeId: number): Promise<any> {
    return await this.inboxRepository.getInfo(placeId);
  }

  public async getInboxMessages(placeId: number): Promise<any> {
    return await this.inboxRepository.getInboxMessages(placeId);
  }

  public async postInboxMessage(
    memberId: number,
    placeId: number,
    subject: string,
    message: string,
  ): Promise<any> {
    return await this.inboxRepository.postInboxMessage(memberId, placeId, subject, message);
  }

  public async postInboxAllMessage(
    memberId: number,
    locations: number[],
    subject: string,
    message: string,
  ): Promise<void> {
    await Promise.all(
      locations.map(id =>
        this.inboxRepository.postInboxMessage(memberId, id, subject, message),
      ),
    );
  }


  public async postInboxReply(
    senderMemberId: number,
    receiverMemberId: number,
    subject: string,
    message: string,
    parentId: number,
  ): Promise<any> {
    const [placeId] = await this.inboxRepository.getHomeId(receiverMemberId);
    if (placeId === undefined) {
      throw Error('User does not have an inbox setup.');
    }
    return await this.inboxRepository.postInboxReply(
      senderMemberId,
      placeId.id,
      subject,
      message,
      parentId,
    );
  }

  /**
   * Cleans a message body against the shared user-HTML allowlist.
   *
   * The policy itself now lives in libs/sanitize-user-html.ts, where
   * MessageboardService reads it from too. The allowlist is unchanged by that
   * move.
   */
  public async sanitize(uncleanInfo: string): Promise<any> {
    return sanitizeUserHtml(uncleanInfo);
  }
  public async getMessage(messageId: number): Promise<any> {
    return await this.inboxRepository.getMessage(messageId);
  }
}
