import { Request } from 'express';
import { Service } from 'typedi';

import {
  BanRepository,
  BlockRepository,
  MemberRepository,
  MessageRepository,
  MessageboardRepository,
  RoleAssignmentRepository,
  RoleRepository,
  AvatarRepository,
  PlaceRepository,
  ObjectRepository,
  ObjectInstanceRepository,
  RoleNameRow,
  TransactionRepository,
  WalletRepository,
} from '../../repositories';
import { RoleAssignmentService } from '../role-assignment/role-assignment.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { AUDIT_EVENTS, AUDIT_TARGETS, AuditAuthority } from '../../libs/audit-event';

/**
 * What an admin route knows about its own caller, carried down to the audit write.
 *
 * Only two fields, and both come from the server: `actorMemberId` is the id
 * `MemberService.decryptSession` returned, and `authority` is the branch of the gate that
 * actually granted the request. Nothing here may be reconstructed from a request body --
 * see `AdminAuditService`.
 */
export interface AdminActionContext {
  actorMemberId: number;
  authority: AuditAuthority;
  request?: Request | null;
}

@Service()
export class AdminService {
  constructor(
   private banRepository: BanRepository,
   private blockRepository: BlockRepository,
   private memberRepository: MemberRepository,
   private messageRepository: MessageRepository,
   private messageboardRepository: MessageboardRepository,
   private roleAssignmentRepository: RoleAssignmentRepository,
   private roleRepository: RoleRepository,
   private avatarRespository: AvatarRepository,
   private placeRepository: PlaceRepository,
   private objectRepository: ObjectRepository,
   private objectInstanceRepository: ObjectInstanceRepository,
   private transactionRepository: TransactionRepository,
   private walletRepository: WalletRepository,
   private roleAssignmentService: RoleAssignmentService,
   private adminAuditService: AdminAuditService,
  ) {}
  
  /**
   * Issues a ban, and records that it was issued, as one unit.
   *
   * The ban row and its audit event commit together or not at all. Baseline section 11
   * makes the event part of what the action owes, so a ban that could not be recorded is
   * not a ban CTR is willing to have issued -- the insert throws, the transaction unwinds,
   * and the caller reports a failure instead of a silent unlogged sanction.
   *
   * `type` stays in the metadata verbatim: 'full' and 'jail' are two different sentences
   * with two different contracts, and a later reader must be able to tell which one was
   * handed down without inferring it from the ban table.
   *
   * @param context the authenticated caller; never reconstructed from the request body
   */
  public async addBan(
    ban_member_id,
    time_frame,
    type,
    assigner_member_id,
    reason,
    context: AdminActionContext,
  ): Promise<void> {
    const end_date = new Date();
    end_date.setTime(end_date.getTime() + time_frame * 24 * 60 * 60 * 1000);
    end_date.getUTCDate();
    await this.memberRepository.runInTransaction(async trx => {
      const inserted = await this.banRepository
        .addBan(ban_member_id, end_date, type, assigner_member_id, reason, trx);
      await this.adminAuditService.recordChange(trx, {
        event: AUDIT_EVENTS.BAN_ADD,
        actorMemberId: context.actorMemberId,
        authority: context.authority,
        targetType: AUDIT_TARGETS.MEMBER,
        targetId: Number(ban_member_id),
        targetMemberId: Number(ban_member_id),
        reason,
        request: context.request,
        metadata: {
          ban_type: typeof type === 'string' ? type : String(type),
          ban_id: Array.isArray(inserted) ? Number(inserted[0]) : null,
          time_frame_days: Number(time_frame),
          end_date_utc: end_date.toISOString(),
        },
      });
    });
  }
  
  public async addDonor(member_id: number, donor: string): Promise<void> {
    // awaitRoleMap, not a bare roleMap read -- same reason as MemberService.getDonorLevel:
    // these ids become query bindings, so an unpopulated map throws out of knex instead of
    // denying anything. `donor` is the caller's chosen level and is required too, so an
    // early snapshot that missed the donor seed is re-read rather than silently granting
    // nothing.
    const roleMap = await this.roleRepository.awaitRoleMap(
      'Supporter',
      'Advocate',
      'Devotee',
      'Champion',
      donor,
    );
    const donorId = {
      supporter: roleMap.Supporter,
      advocate: roleMap.Advocate,
      devotee: roleMap.Devotee,
      champion: roleMap.Champion,
      donorLevel: roleMap[donor],
    };
    try {
      await this.roleAssignmentRepository.addDonor(member_id, donorId);
    } catch (e) {
      console.log(e);
    }
  }
  
  /**
   * Withdraws a ban, and records the withdrawal, as one unit.
   *
   * The `before` facts are read inside the same transaction as the update, because after
   * it the old status is gone and the type is the only thing that still says whether a
   * full ban or a jail sentence was just lifted. A missing row reads as nulls rather than
   * throwing: the route accepts raw ids, and this lane does not change what it accepts.
   *
   * @param context the authenticated caller; never reconstructed from the request body
   */
  public async deleteBan(
    banId: number,
    updateReason: string,
    context: AdminActionContext,
  ): Promise<void>{
    await this.memberRepository.runInTransaction(async trx => {
      const before = await this.banRepository.findById(banId, trx);
      await this.banRepository.deleteBan(banId, updateReason, trx);
      await this.adminAuditService.recordChange(trx, {
        event: AUDIT_EVENTS.BAN_REMOVE,
        actorMemberId: context.actorMemberId,
        authority: context.authority,
        targetType: AUDIT_TARGETS.BAN,
        targetId: banId,
        targetMemberId: before ? Number(before.ban_member_id) : null,
        reason: updateReason,
        request: context.request,
        metadata: {
          ban_type: before ? String(before.type) : null,
          old_status: before ? Number(before.status) : null,
          new_status: 0,
        },
      });
    });
  }

  /**
   * Takes a role away, reconciles the member's displayed role, and records it, as one unit.
   *
   * Remove first, then reconcile. The previous version inspected primary_role_id
   * before deleting the assignment, deciding against state it was about to change --
   * and it only cleared the column when the fired role happened to be the displayed
   * one, leaving a member who still held other roles with no display role at all.
   *
   * All three steps now share a transaction. That is not only for the audit event: the
   * removal and the reconciliation were already two writes that had to agree, and a
   * failure between them left a member displaying a role they no longer held.
   *
   * @param context the authenticated caller, including WHICH gate granted this -- a global
   *   Admin and a security-role manager both reach here, and baseline section 4 requires
   *   the two to stay distinguishable afterwards
   */
  public async fireRole(
    member_id: number,
    role_id: number,
    place_id: number,
    context: AdminActionContext,
  ): Promise<void> {
    await this.memberRepository.runInTransaction(async trx => {
      const removed = await this.roleAssignmentRepository
        .removeIdFromAssignment(place_id, member_id, role_id, trx);
      await this.roleAssignmentService.reconcilePrimaryRole(member_id, trx);
      await this.adminAuditService.recordChange(trx, {
        event: AUDIT_EVENTS.ROLE_FIRE,
        actorMemberId: context.actorMemberId,
        authority: context.authority,
        targetType: AUDIT_TARGETS.ROLE,
        targetId: role_id,
        targetMemberId: member_id,
        request: context.request,
        metadata: {
          role_id: Number(role_id),
          place_id: place_id === null || place_id === undefined ? null : Number(place_id),
          assignments_removed: Number(removed),
        },
      });
    });
    return;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
  public async getBanHistory(ban_member_id: number): Promise<any> {
    return await this.banRepository.getBanHistory(ban_member_id);
  }
  
  public async getDonor(member_id: number): Promise<RoleNameRow | undefined> {
    // Same awaited donor barrier as addDonor above. `await someObject.property` awaited a
    // NUMBER, which resolves immediately and waits for nothing, so on a freshly bootstrapped
    // database all four of these were undefined and getDonor's `whereIn` reached knex as
    // `whereIn('role_id', [undefined, undefined, undefined, undefined])` -- a thrown
    // "Undefined binding(s) detected", not a denial.
    const roleMap = await this.roleRepository.awaitRoleMap(
      'Supporter',
      'Advocate',
      'Devotee',
      'Champion',
    );
    const donorId = {
      supporter: roleMap.Supporter,
      advocate: roleMap.Advocate,
      devotee: roleMap.Devotee,
      champion: roleMap.Champion,
    };
    try {
      return await this.roleAssignmentRepository.getDonor(member_id, donorId);
    } catch (e) {
      console.log(e);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
  public async getRoleList(): Promise<any> {
    return this.roleRepository.findAll();
  }

  /**
   * Grants a role, and records that it was granted, as one unit.
   *
   * The assignment row and its audit event commit together or not at all, on the same
   * contract as `fireRole` above. Before CTBL-0025 Phase B this method did not await the
   * insert at all: the route answered 200 while the write was still in flight, a rejected
   * write could not reach the handler's catch block, and there was no committed mutation
   * for an audit row to commit with. Both defects are the same missing `await`.
   *
   * `place_id` is null by design -- this route grants global roles only, and the scoped
   * grants go through `RoleAssignmentService`. It is recorded anyway so the row has the
   * same shape as the `admin.role.fire` row a reviewer will read next to it.
   *
   * No reason is recorded: this route's request carries none. Collecting and enforcing
   * operator reasons is CTBL-0025 Phase C; inventing one here would put a sentence in the
   * store that no operator wrote.
   *
   * @param context the authenticated caller, including WHICH gate granted this -- a global
   *   Admin and a security-role manager both reach here, and baseline section 4 requires
   *   the two to stay distinguishable afterwards
   */
  public async hireRole(
    member_id: number,
    role_id: number,
    context: AdminActionContext,
  ): Promise<void> {
    await this.memberRepository.runInTransaction(async trx => {
      const inserted = await this.roleAssignmentRepository
        .addIdToAssignment(null, member_id, role_id, trx);
      await this.adminAuditService.recordChange(trx, {
        event: AUDIT_EVENTS.ROLE_HIRE,
        actorMemberId: context.actorMemberId,
        authority: context.authority,
        targetType: AUDIT_TARGETS.ROLE,
        targetId: role_id,
        targetMemberId: member_id,
        request: context.request,
        metadata: {
          role_id: Number(role_id),
          place_id: null,
          assignment_id: Array.isArray(inserted) ? Number(inserted[0]) : null,
        },
      });
    });
    return;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
  public async searchUsers(search: string, limit: number, offset: number): Promise<any> {
    const users = await this.memberRepository.searchUsers(search, limit, offset);
    const total = await this.memberRepository.getTotal(search);
    return {
      users: users,
      total: total,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
  public async getTransactions(type: string, limit: number, offset: number): Promise<any> {
    const transactions = await this.transactionRepository
      .getTransactions(type, limit, offset);
    const total = await this.transactionRepository.getTotal(type);
    return {
      transactions: transactions,
      total: total,
    };
  }

  public async getTransactionsByWalletId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
    id: number, limit: number, offset: number): Promise<any> {
    const transactions = await this.transactionRepository
      .getTransactionsByWalletId(id, limit, offset);
    const total = await this.transactionRepository.getWalletTotal(id);
    return {
      transactions: transactions,
      total: total,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
  public async getCommunityData(): Promise<any> {
    const second = 1000;
    const minute = 60 * second;
    const hour = 60 * minute;
    const day = 24 * hour;
    const past30Min = new Date(Date.now() - .5 * hour);
    const pastHour = new Date(Date.now() - hour);
    const pastDay = new Date(Date.now() - day);
    const pastWeek = new Date(Date.now() - 7 * day);
    const thisWeek = new Date(Date.now() + 7 * day);
    const pastMonth = new Date(Date.now() - 30 * day);
    const pastYear = new Date(Date.now() - 365 * day);

    // User Activity
    const usersDaily = await this.memberRepository.countByDuration(pastDay);
    const usersWeekly = await this.memberRepository.countByDuration(pastWeek);
    const usersMonthly = await this.memberRepository.countByDuration(pastMonth);
    const newWeekly = await this.memberRepository.countNewUsers(pastWeek);
    const newMonthly = await this.memberRepository.countNewUsers(pastMonth);
    const newYearly = await this.memberRepository.countNewUsers(pastYear);

    // Security Data
    const recentBan = await this.banRepository.getRecentBan(pastWeek);
    const recentJail = await this.banRepository.getRecentJail(pastWeek);
    const banEnding = await this.banRepository.getUnbannedSoon(thisWeek);
    const totalBanned = await this.banRepository.getBannedTotal();
    const totalJailed = await this.banRepository.getJailedTotal() ;

    // Place Data
    const colonies = await this.placeRepository.totalByType(['colony']);
    const hoods =  await this.placeRepository.totalByType(['hood']);
    const blocks = await this.placeRepository.totalByType(['block']);
    const freeSpots = await this.blockRepository.totalFreeSpots();
    const homes = await this.placeRepository.totalByType(['home']);
    const clubs = await this.placeRepository.totalByType(['club']);
    const storages = await this.placeRepository.totalByType(['storage']);
    const privatePlaces = await this.placeRepository.totalByType(['private']);

    // Member Data
    const members = await this.memberRepository.getMemberTotal();
    const newestMembers = await this.memberRepository.getNewestMembers();

    // Money Data
    const walletData = await this.walletRepository.getWalletData();
    const averageBalance = await this.walletRepository.getAverageBalance();
    const totalBalance = await this.walletRepository.getTotalBalance();
    const topBalance = walletData[0].balance;
    const latestTransactions = await this.transactionRepository.getLatestTransactions(pastHour);
    const addUsernameToTransactions = [];
    for(const user of latestTransactions){
      let recipient_username = [{username: 'System'}];
      let sender_username = [{username: 'System'}];
      if(user.recipient_wallet_id){
        recipient_username = await this.memberRepository.findByWalletId(user.recipient_wallet_id);
      }
      if(user.sender_wallet_id){
        sender_username = await this.memberRepository.findByWalletId(user.sender_wallet_id);
      }
      user.recipient_username = recipient_username;
      user.sender_username = sender_username;
      addUsernameToTransactions.push(user);
    }

    // Role Data
    const latestHiring = await this.roleAssignmentRepository.getLatest();

    // Object Data
    //// Object Instances
    const totalUserObjects = await this.objectInstanceRepository.totalCount();
    const totalForSale = await this.objectInstanceRepository.findForSale();
    const averagePrice = await this.objectInstanceRepository.averageForSale();
    const highestPrice = await this.objectInstanceRepository.highestForSale();
    //// Mall Objects
    const mallAveragePrice = await this.objectRepository.getAverageMallPrice();
    const mallHighestPrice = await this.objectRepository.getHighestMallPrice();
    const totalMallObjects = await this.objectRepository.getAcceptedTotal();
    const totalStocked = await this.objectRepository.getTotalByStatus(1);
    const totalUploaded = await this.objectRepository.getUploadTotal();

    // Message Data
    const latestChat = await this.messageRepository.getActiveChats(past30Min);
    const latestMB = await this.messageboardRepository.getActiveMB(past30Min);

    return {
      activity: {
        totalDaily: usersDaily, 
        totalWeekly: usersWeekly, 
        totalMonthly: usersMonthly,
        newWeekly: newWeekly,
        newMonthly: newMonthly,
        newYearly: newYearly,
      },
      security: {
        recentBan: recentBan, 
        recentJail: recentJail, 
        banEnding: banEnding, 
        totalBanned: totalBanned, 
        totalJailed: totalJailed,
      },
      place: {
        totalColonies: colonies,
        totalHoods: hoods,
        totalBlocks: blocks,
        totalFreeSpots: freeSpots,
        totalHomes: homes,
        totalStorages: storages,
        totalClubs: clubs,
        totalPrivate: privatePlaces,
      },
      member: {
        totalMembers: members,
        newestMembers: newestMembers,
      },
      money: {
        wealthiestUsers: walletData,
        averageBalance: averageBalance,
        totalBalance: totalBalance,
        topBalance: topBalance,
        latestTransactions: addUsernameToTransactions,
      },
      object: {
        instances: {
          totalUserObjects: totalUserObjects,
          totalForSale: totalForSale,
          averageUserPrice: averagePrice,
          highestUserPrice: highestPrice,
        },
        mall: {
          averagePrice: mallAveragePrice,
          highestPrice: mallHighestPrice,
          totalMallObjects: totalMallObjects,
          totalStocked: totalStocked,
          totalUploaded: totalUploaded,
        },
      },
      messages: {
        chat: latestChat,
        messageboard: latestMB,
      },
      hiring: {
        latestRoleHire: latestHiring,
      },
    };
  }
  
  public async searchUserChat(
    search: string,
    user: number,
    limit: number,
    offset: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
  ): Promise<any> {
    const messages = await this.messageRepository.searchUserChat(search, user, limit, offset);
    const total = await this.messageRepository.getChatTotal(search, user);
    return {
      messages: messages,
      total: total,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
  public async searchAvatars(status: number, limit: number, offset: number): Promise<any> {
    const avatars = await this.avatarRespository.findByStatus(status, limit, offset);
    const total = await this.avatarRespository.totalByStatus(status);
    return {
      avatars: avatars,
      total: total,
    };
  }

  /**
   * Edits a mall object, and records the edit, as one unit.
   *
   * The object row and its audit event commit together or not at all. Before CTBL-0025
   * Phase B the controller did not await this call, so the route answered 200 with the
   * write still in flight and a rejected write could not reach its catch block.
   *
   * `rows_updated` is recorded rather than assumed: the route accepts a raw id, so an id
   * that names no object changes nothing, and an `allowed` event may not claim a change
   * the database did not make. The CTBL-0032 directory and filename rules are enforced
   * before this method is reached and are untouched here.
   *
   * @param context the authenticated caller; never reconstructed from the request body
   */
  public async updateObjects(
    id: number,
    name: string,
    directory: string,
    filename: string,
    image: string,
    price: number,
    limit: number,
    quantity: number,
    status: number,
    context: AdminActionContext,
  ): Promise<void> {
    await this.memberRepository.runInTransaction(async trx => {
      const rowsUpdated = await this.objectRepository
        .update(id, {
          name: name,
          directory: directory,
          filename: filename,
          image: image,
          price: price,
          limit: limit,
          quantity: quantity,
          status: status,
        }, trx);
      await this.adminAuditService.recordChange(trx, {
        event: AUDIT_EVENTS.OBJECT_UPDATE,
        actorMemberId: context.actorMemberId,
        authority: context.authority,
        targetType: AUDIT_TARGETS.OBJECT,
        targetId: id,
        request: context.request,
        metadata: {
          rows_updated: Number(rowsUpdated),
          object_status: Number(status),
          price: Number(price),
          directory: String(directory),
          filename: String(filename),
        },
      });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing, out of scope
  public async searchPlaces(type: string[], limit: number, offset: number): Promise<any> {
    const places = await this.placeRepository.findByType(type, limit, offset, [0,1], 'id');
    const total = await this.placeRepository.totalByType(type);
    return {
      places: places,
      total: total,
    };
  }
}
