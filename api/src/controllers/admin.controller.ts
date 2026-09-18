import {Request, Response} from 'express';
import { Container } from 'typedi';

import { 
  AdminService, 
  MemberService, 
  AvatarService, 
  PlaceService, 
  RoleAssignmentService,
  ObjectInstanceService, 
  ObjectService,
  MessageService,
  InboxService,
  MessageboardService,
  ClubService,
  AdminAuditService,
} from '../services';
import * as badwordlist from 'badwords-list';
import { hasAccess } from '../libs/access-level';
import { isAssetDirectory, isAssetFilename } from '../libs/asset-identifier';
import {
  AUDIT_AUTHORITIES,
  AUDIT_EVENTS,
  AUDIT_RESULTS,
  AUDIT_TARGETS,
  AuditAuthority,
  AuditEventName,
  AuditTarget,
} from '../libs/audit-event';

/**
 * Admin-panel endpoints.
 *
 * Each gate below is the server-side statement of a capability the admin UI
 * already expresses, so that hiding a button and refusing the request agree.
 * The capability tags come from `MemberService.getAccessLevel()`; the UI source
 * of each rule is `spa/src/pages/admin/`:
 *
 * | endpoint                  | capability            | UI rule                     |
 * | ------------------------- | --------------------- | --------------------------- |
 * | getBanHistory             | admin/security/leader | Members screen              |
 * | getRoleList               | admin OR a security-  | roles.vue requires admin;   |
 * |                           | role manager          | SubMenu shows HIRE to both  |
 * | searchUsers               | admin/security/leader | Members screen              |
 * | getTransactions           | security              | Transactions screen         |
 * | getTransactionsByWalletId | security              | Transactions tab (SubMenu)  |
 * | searchUserChat            | security              | user/ChatMessages.vue       |
 * | places / searchAllPlaces  | admin/security/leader | Places screen               |
 * | findUserPlaces            | security              | Storage/Clubs tabs (SubMenu)|
 * | placesUpdate              | admin OR security     | Edit in place/search.vue    |
 * | getObjectInstances        | security              | User Objects screen         |
 * | getOwnedObjects           | admin                 | Objects tab (SubMenu)       |
 * | getCommunityData          | security              | Overview screen             |
 *
 * `hasAccess` fails closed, so a null, undefined or otherwise malformed access
 * level denies instead of throwing. See `libs/access-level.ts`.
 */
export class AdminController {
  constructor(
    private adminService: AdminService, 
    private memberService: MemberService, 
    private avatarService: AvatarService,
    private placeService: PlaceService,
    private roleAssignmentService: RoleAssignmentService,
    private objectInstanceService: ObjectInstanceService,
    private objectService: ObjectService,
    private messageService: MessageService,
    private inboxService: InboxService,
    private messageboardService: MessageboardService,
    private clubService: ClubService,
    private adminAuditService: AdminAuditService,
  ) {}

  /**
   * Records a refused administrative attempt.
   *
   * Baseline section 11: "Refusals are audited too. A denied administrative attempt is
   * exactly the event an operator most needs later." A refusal has no transaction to join
   * and must not acquire one -- `recordOutcome` never throws, so a 403 stays a 403 even
   * when the store is unreachable.
   *
   * `actorMemberId` is the session id and nothing else. A caller who reaches a denial has
   * still authenticated; it is only their authority that fell short, so the row names who
   * actually tried.
   */
  private async auditDenied(
    event: AuditEventName,
    session: { id: number },
    request: Request,
    target?: { type: AuditTarget; id: number | null; memberId?: number | null },
  ): Promise<void> {
    await this.adminAuditService.recordOutcome(AUDIT_RESULTS.DENIED, {
      event,
      actorMemberId: session.id,
      // The refused caller relied on the global layer by definition: every gate below
      // asks a community-wide question first, and a denial means that question said no.
      authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
      targetType: target ? target.type : null,
      targetId: target ? target.id : null,
      targetMemberId: target ? (target.memberId ?? null) : null,
      request,
    });
  }

  /**
   * Records an authorised attempt that then errored.
   *
   * Written outside any transaction, because the mutation's own transaction has already
   * rolled back by the time this runs. It records that an operator tried and the change
   * did not land -- it is never evidence that anything committed. Only `recordChange`,
   * which runs inside the mutation's transaction, can produce an `allowed` row.
   */
  private async auditFailed(
    event: AuditEventName,
    session: { id: number },
    request: Request,
    authority: AuditAuthority,
    target?: { type: AuditTarget; id: number | null; memberId?: number | null },
  ): Promise<void> {
    await this.adminAuditService.recordOutcome(AUDIT_RESULTS.FAILED, {
      event,
      actorMemberId: session.id,
      authority,
      targetType: target ? target.type : null,
      targetId: target ? target.id : null,
      targetMemberId: target ? (target.memberId ?? null) : null,
      request,
    });
  }
  
  public async addBan(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (admin) {
      try {
        // `session.id` is the actor, here and in the audit row the service writes. The
        // request body names only the SUBJECT of the ban; a body field claiming to be the
        // actor is never read, so a caller cannot sign someone else's name to a sanction.
        await this.adminService.addBan(
          request.body.ban_member_id,
          request.body.time_frame,
          request.body.type,
          session.id,
          request.body.reason,
          {
            actorMemberId: session.id,
            authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
            request,
          },
        );
        response.status(200).json({message: 'Ban added successfully'});
      } catch (error) {
        console.log(error);
        await this.auditFailed(
          AUDIT_EVENTS.BAN_ADD, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
          {type: AUDIT_TARGETS.MEMBER, id: Number(request.body.ban_member_id)},
        );
        response.status(400).json({error});
      }
    } else {
      await this.auditDenied(AUDIT_EVENTS.BAN_ADD, session, request,
        {type: AUDIT_TARGETS.MEMBER, id: Number(request.body.ban_member_id)});
      response.status(403).json({message: 'Access Denied'});
    }
  }
  
  public async addDonor(request: Request, response: Response): Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const accessLevel = await this.memberService.getAccessLevel(session.id);
    // Pre-existing: `getAccessLevel` returns a list of levels, so this
    // comparison has never been true and this branch has never run.
    // Deliberately left inert -- turning it into `.includes(...)` would
    // newly enable an access-gated path, which is not a change to make
    // while fixing types. Raised separately for a decision.
    if ((accessLevel as unknown as string) === 'admin') {
      try {
        await this.adminService.addDonor(
          request.body.member_id,
          request.body.level,
        );
        response.status(200).json({message: 'Donor added successfully'});
      } catch (e) {
        console.log(e);
        response.status(400).json({error: 'Error adding donor'});
      }
    } else {
      response.status(403).json({error: 'Access Denied'});
    }
  }
  
  public async getBanHistory(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'admin', 'security', 'leader')) {
      try {
        const banHistory = await this.adminService
          .getBanHistory(Number(request.query.ban_member_id.toString()));
        response.status(200).json({banHistory});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }
  
  public async deleteBan(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (admin) {
      try {
        const banId = Number(request.body.banId);
        const reason = request.body.banReason;
        const deleteBy = await this.memberService.getMemberInfoPublic(session.id);
        const updateReason = `${reason} (Deleted by ${deleteBy.username})`;
        await this.adminService.deleteBan(banId, updateReason, {
          actorMemberId: session.id,
          authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
          request,
        });
        response.status(200).json({message: 'Ban deleted successfully'});
      } catch (error) {
        console.log(error);
        await this.auditFailed(
          AUDIT_EVENTS.BAN_REMOVE, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
          {type: AUDIT_TARGETS.BAN, id: Number(request.body.banId)},
        );
        response.status(400).json({error});
      }
    } else {
      await this.auditDenied(AUDIT_EVENTS.BAN_REMOVE, session, request,
        {type: AUDIT_TARGETS.BAN, id: Number(request.body.banId)});
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async fireRole(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const { member_id, role_id } = request.body;
    let { place_id } = request.body;
    if (place_id !== null) {
      place_id = parseInt(place_id);
    }
    const accessLevel = await this.memberService.getAccessLevel(session.id);
    const roleId = parseInt(role_id);
    const canManageSecurityRoles =
      await this.memberService.canManageSecurityRoles(session.id);
    // Which of the two independent paths granted this, recorded rather than inferred.
    // Baseline section 4 keeps the global role and the security-role manager's scoped
    // right apart on purpose, and "on what basis was this allowed" is unanswerable later
    // from the actor's id alone, because role holdings change.
    const globalGrant = hasAccess(accessLevel, 'admin');
    const canManageRole =
      globalGrant ||
      (canManageSecurityRoles &&
        await this.memberService.canSecurityManageRole(roleId));
    const authority = globalGrant
      ? AUDIT_AUTHORITIES.GLOBAL_ROLE
      : AUDIT_AUTHORITIES.RESOURCE_SCOPED;
    if (canManageRole) {
      try {
        await this.adminService.fireRole(
          parseInt(member_id),
          roleId,
          place_id,
          {actorMemberId: session.id, authority, request},
        );
        response.status(200).json({message: 'Role fired successfully'});
      } catch(e) {
        console.log(e);
        await this.auditFailed(
          AUDIT_EVENTS.ROLE_FIRE, session, request, authority,
          {type: AUDIT_TARGETS.ROLE, id: roleId, memberId: parseInt(member_id)},
        );
        response.status(500).json({error: 'Internal Server Error'});
      }
    } else {
      await this.auditDenied(AUDIT_EVENTS.ROLE_FIRE, session, request,
        {type: AUDIT_TARGETS.ROLE, id: roleId, memberId: parseInt(member_id)});
      response.status(403).json({error: 'Access Denied'});
    }
  }

  public async getDonor(request: Request, response: Response): Promise<string> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const accessLevel = await this.memberService.getAccessLevel(session.id);
    // Pre-existing: `getAccessLevel` returns a list of levels, so this
    // comparison has never been true and this branch has never run.
    // Deliberately left inert -- turning it into `.includes(...)` would
    // newly enable an access-gated path, which is not a change to make
    // while fixing types. Raised separately for a decision.
    if ((accessLevel as unknown as string) === 'admin') {
      const currentLevel = await this
        .adminService
        .getDonor(Number(request.query.memberId));
      response.status(200).json({donorLevel: currentLevel});
    } else {
      response.status(403).json({error: 'Access Denied'});
    }
  }

  public async getRoleList(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    const canManageSecurityRoles =
      await this.memberService.canManageSecurityRoles(session.id);
    if (hasAccess(admin, 'admin') || canManageSecurityRoles) {
      try {
        const returnRoles = [];
        const roleList = await this.adminService.getRoleList();
        for(const role of roleList) {
          const count = await this.roleAssignmentService.countByAssigned(role.id);
          role.total = count;
          returnRoles.push(role);
        }
        response.status(200).json({roles: returnRoles});
      } catch (e) {
        console.log(e);
        response.status(500).json({error: 'Internal Server Error'});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async hireRole(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const accessLevel = await this.memberService.getAccessLevel(session.id);
    const {member_id, role_id} = request.body;
    const roleId = parseInt(role_id);
    const canManageSecurityRoles =
      await this.memberService.canManageSecurityRoles(session.id);
    const canManageRole =
      hasAccess(accessLevel, 'admin') ||
      (canManageSecurityRoles &&
        await this.memberService.canSecurityManageRole(roleId));
    if (canManageRole) {
      try {
        // No `allowed` audit event here, deliberately. `AdminService.hireRole` does not
        // await `addIdToAssignment`, so this handler answers 200 before the insert has
        // resolved and there is no committed write for an audit row to commit WITH.
        // Auditing it correctly means awaiting that promise, which is a change to the
        // write contract and its own item -- see `docs/ADMIN_AUDIT_TRAIL.md`. Recording
        // the success from here anyway would produce the one row this store must never
        // hold: an `allowed` event for a mutation nobody checked.
        await this.adminService.hireRole(
          parseInt(member_id),
          roleId,
        );
        response.status(200).json({message: 'Role hired successfully'});
      } catch(e) {
        console.log(e);
        response.status(500).json({error: 'Internal Server Error'});
      }
    } else {
      await this.auditDenied(AUDIT_EVENTS.ROLE_HIRE, session, request,
        {type: AUDIT_TARGETS.ROLE, id: roleId, memberId: parseInt(member_id)});
      response.status(403).json({error: 'Access Denied'});
    }
  }
  
  public async searchUsers(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'admin', 'security', 'leader')) {
      try {
        const results = await this.adminService.searchUsers(
          request.query.search.toString(),
          Number.parseInt(request.query.limit.toString()),
          Number.parseInt(request.query.offset.toString()),
        );
        response.status(200).json({results});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async getTransactions(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    const returnResults = [];
    const rebuild = [];
    if (hasAccess(admin, 'security')) {
      try {
        let results = null;
        let findUsername = null;
        results = await this.adminService.getTransactions(
          request.query.type.toString(),
          Number.parseInt(request.query.limit.toString()),
          Number.parseInt(request.query.offset.toString()),
        );
        findUsername = results.transactions;
        for(const res of findUsername) {
          let sender = [{username: 'System'}];
          let receiver = [{username: 'System'}];
          if(res.sender_wallet_id){
            sender = await this.memberService
              .getMemberByWalletId(res.sender_wallet_id);
          }
          if(res.recipient_wallet_id){
            receiver = await this.memberService
              .getMemberByWalletId(res.recipient_wallet_id);
          }
          res.sender = sender;
          res.receiver = receiver;
          res.sender_wallet_id = null;
          res.recipient_wallet_id = null;
          rebuild.push(res);
        }
        returnResults.push(rebuild);
        returnResults.push(results.total);
        response.status(200).json({returnResults});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async getTransactionsByWalletId(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    const returnResults = [];
    const rebuild = [];
    if (hasAccess(admin, 'security')) {
      try {
        let results = null;
        let findUsername = null;
        const memberId = request.params.id;
        const user = await this.memberService.find({ id: Number.parseInt(memberId) });
        results = await this.adminService.getTransactionsByWalletId(
          user.wallet_id,
          Number.parseInt(request.query.limit.toString()),
          Number.parseInt(request.query.offset.toString()),
        );
        findUsername = results.transactions;
        for(const res of findUsername) {
          let sender = [{username: 'System'}];
          let receiver = [{username: 'System'}];
          if(res.sender_wallet_id){
            sender = await this.memberService
              .getMemberByWalletId(res.sender_wallet_id);
          }
          if(res.recipient_wallet_id){
            receiver = await this.memberService
              .getMemberByWalletId(res.recipient_wallet_id);
          }
          res.sender = sender;
          res.receiver = receiver;
          res.sender_wallet_id = null;
          res.recipient_wallet_id = null;
          rebuild.push(res);
        }
        returnResults.push(rebuild);
        returnResults.push(results.total);
        response.status(200).json({results});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async getObjectInstances(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'security')) {
      try {
        let returnResults = [];
        let results = null;
        results = await this.objectInstanceService.findAllObjectInstances(
          Number.parseInt(request.query.limit.toString()),
          Number.parseInt(request.query.offset.toString()),
        );
        returnResults = results;
        response.status(200).json({returnResults});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async getOwnedObjects(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'admin')) {
      try {
        const id = request.params.id;
        const results = await this.objectInstanceService.getOwnedObjects(
          Number.parseInt(id),
          Number.parseInt(request.query.limit.toString()),
          Number.parseInt(request.query.offset.toString()),
        );
        response.status(200).json({results});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }
  
  public async searchUserChat(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'security')) {
      try {
        const results = await this.adminService.searchUserChat(
          request.query.search.toString(),
          Number.parseInt(request.query.user.toString()),
          Number.parseInt(request.query.limit.toString()),
          Number.parseInt(request.query.offset.toString()),
        );
        response.status(200).json({results});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async getCommunityData(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'security')) {
      try {
        const results = await this.adminService.getCommunityData();
        response.status(200).json({results});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async avatars(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (admin) {
      try {
        const results = await this.adminService.searchAvatars(
          parseInt(request.query.status.toString()),
          parseInt(request.query.limit.toString()),
          parseInt(request.query.offset.toString()),
        );
        response.status(200).json({results});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async avatarApprove(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (!admin) {
      await this.auditDenied(AUDIT_EVENTS.AVATAR_APPROVE, session, request,
        {type: AUDIT_TARGETS.AVATAR, id: Number(request.body?.id)});
      response.status(403).json({message: 'Access Denied'});
      return;
    }
    try {
      // No `allowed` audit event here, deliberately: the call below is not awaited, so
      // the 200 is sent before the write resolves. See the note in `hireRole`.
      this.avatarService.approve(
        parseInt(request.body.id.toString()),
      );
      response.status(200).json({'status':'success'});
    } catch (error) {
      console.log(error);
      response.status(400).json({error});
    }
  }
  public async avatarReject(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (!admin) {
      await this.auditDenied(AUDIT_EVENTS.AVATAR_REJECT, session, request,
        {type: AUDIT_TARGETS.AVATAR, id: Number(request.body?.id)});
      response.status(403).json({message: 'Access Denied'});
      return;
    }
    try {
      // No `allowed` audit event here, deliberately: the call below is not awaited, so
      // the 200 is sent before the write resolves. See the note in `hireRole`.
      this.avatarService.reject(
        parseInt(request.body.id.toString()),
      );
      response.status(200).json({'status':'success'});
    } catch (error) {
      console.log(error);
      response.status(400).json({error});
    }
  }

  public async places(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'admin', 'security', 'leader')) {
      try {
        const results = await this.adminService.searchPlaces(
          [request.query.type.toString()],
          parseInt(request.query.limit.toString()),
          parseInt(request.query.offset.toString()),
        );
        
        response.status(200).json({results});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async searchAllPlaces(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'admin', 'security', 'leader')) {
      try {
        const compareValues = ['=', '!=', '>', '<', '>=', '<='];
        const search = request.query.search.toString().replace(/[^0-9a-zA-Z \-[\]/()]/g, '');
        const compare = request.query.compare.toString();
        const type = request.query.type.toString();

        if(compareValues.includes(compare)){
          const results = await this.placeService.searchAllPlaces(
            search,
            compare,
            type,
            Number.parseInt(request.query.limit.toString()),
            Number.parseInt(request.query.offset.toString()),
          );
          response.status(200).json({results});
        }
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async findUserPlaces(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (hasAccess(admin, 'security')) {
      const types = ['club', 'storage'];
      const type = request.query.type.toString();
      const id = request.query.id.toString();
      try {
        if(types.includes(type)) {
          const results = await this.placeService.findUserPlaces(parseInt(id), type);
          response.status(200).json({results});
        } 
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      response.status(403).json({message: 'Access Denied'});
    }
  }

  public async placesUpdate(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    if (!hasAccess(admin, 'admin', 'security')) {
      await this.auditDenied(AUDIT_EVENTS.PLACE_UPDATE, session, request,
        {type: AUDIT_TARGETS.PLACE, id: Number(request.body?.id)});
      response.status(403).json({message: 'Access Denied'});
      return;
    }
    
    const  placeinfo = request.body;

    // Check for blank required fields based on type
    const blankFields = [];
    
    // Name is always required
    console.log(placeinfo.name);
    if (!placeinfo.name || placeinfo.name.trim() === '') {
      blankFields.push('Name');
    }
    else if (placeinfo.name.match(badwordlist.regex)) {
      response.status(400).json({error: 'Inappropriate language detected in name'});
    }

    // Description is required for specific types
    if (['public', 'shop', 'colony', 'home', 'club', 'private'].includes(placeinfo.type)) {
      if (!placeinfo.description || placeinfo.description.trim() === '') {
        blankFields.push('Description');
      }
      else if (placeinfo.description.match(badwordlist.regex)) {
        response.status(400).json({error: 'Inappropriate language detected in description'});
      }
    }
    
    // Slug is required for specific types
    if (['public', 'shop', 'colony', 'private'].includes(placeinfo.type)) {
      if (!placeinfo.slug || placeinfo.slug.trim() === '') {
        blankFields.push('Slug');
      }
      else if (placeinfo.slug.match(badwordlist.regex)) {
        response.status(400).json({error: 'Inappropriate language detected in slug'});
      }
    }
    
    if (blankFields.length > 0) {
      const fieldList = blankFields.join(', ');
      response.status(400).json({error: `These fields cannot be blank: ${fieldList}`});
      return;
    }

    try {
      // No `allowed` audit event here, deliberately: the call below is not awaited, so
      // the 200 is sent before the write resolves. See the note in `hireRole`.
      this.placeService.updatePlaces(placeinfo);
      response.status(200).json({status: 'success'});
    } catch (error) {
      console.log(error);
      response.status(400).json({error: 'An error occurred while updating the place'});
      return;
    }
  }

  public async objectssUpdate(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (admin) {
      const id = parseInt(request.body.id);
      const name = request.body.name;
      const directory = request.body.directory;
      const filename = request.body.filename;
      // Prohibition 4: these name one asset directory and one basename inside
      // it, never a filesystem path. Refused here, before the service resolves
      // a path or writes a row. See `docs/ADMIN_SECURITY_BASELINE.md`.
      if (!isAssetDirectory(directory) || !isAssetFilename(filename)) {
        response.status(400).json({
          error: 'Directory and filename must each be a single asset identifier.',
        });
        return;
      }
      const image = request.body.thumbnail;
      const price = request.body.price;
      let limit;
      if(request.body.limit === '' ||
        request.body.limit === null ||
        request.body.limit === 'undefined'
      ){
        limit = 0;
      } else {
        limit = request.body.limit;
      }
      const quantity = request.body.quantity;
      const status = request.body.status;
      try {
        if(id && name && directory && filename && image && 
          price >= 0 && limit >= 0 && quantity >= 0 && status >= 0){
          // No `allowed` audit event here, deliberately: the call below is not awaited,
          // so the 200 is sent before the write resolves. See the note in `hireRole`.
          // The CTBL-0032 directory and filename check above is untouched.
          this.adminService.updateObjects(
            id,
            name,
            directory,
            filename,
            image,
            price,
            limit,
            quantity,
            status,
          );
        } else {
          throw new Error ('Some details are blank. Please complete the form');
        }
        response.status(200).json({status: 'success'});
      } catch (error) {
        console.log(error);
        response.status(400).json({error});
      }
    } else {
      await this.auditDenied(AUDIT_EVENTS.OBJECT_UPDATE, session, request,
        {type: AUDIT_TARGETS.OBJECT, id: Number(request.body?.id)});
      response.status(403).json({message: 'Access Denied'});
    }
  }

  /**
   * Permanently removes an account and everything filed against it.
   *
   * The whole sequence runs inside ONE database transaction: either every write below
   * commits, or none of them does. Before the transaction it was a run of independent
   * statements, so a failure part way through left an account half deleted - and the last
   * step failing left the member row gone while the caller was told the removal had failed.
   *
   * The target member row is locked first, so two removals of the same member serialize
   * instead of interleaving, and so a removal aimed at an id that is not a member refuses
   * before any destructive write rather than after several.
   *
   * What is removed is unchanged: objects are preserved and disowned, places the member
   * owns are deleted with their contents, and the member's wallet and ledger go with the
   * member, exactly as before.
   */
  public async removeAccount(request: Request, response: Response):  Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (admin) {
      const id = request.body.id;
      try {
        await this.memberService.runInTransaction(async trx => {
          const member = await this.memberService.lockForRemoval(id, trx);
          if (!member) {
            throw new Error(`No member ${id} to remove.`);
          }
          await this.objectInstanceService.moveAllObjects(id, trx);
          await this.objectService.removeAccount(id, trx);
          await this.messageService.removeAllMessages(id, trx);
          await this.inboxService.removeAllMessages(id, trx);
          await this.messageboardService.removeAllMessages(id, trx);
          await this.avatarService.removeAllAvatars(id, trx);
          await this.clubService.removeAccount(id, trx);
          const places = await this.placeService.getOwnedPlaces(id, trx);
          if(places.length >= 1) {
            const home = places.find(place => place.type === 'home');
            if(home){
              await this.placeService.removeVirtualPet(home.id, trx);
            }
            // Awaited in order: a rejected removal has to abort the sequence, and the
            // floating promises this replaced could not.
            for (const place of places) {
              await this.placeService.removePlace(place.id, trx);
            }
          }
          await this.memberService.removeAccount(id, trx);
          // Last, and inside the same transaction: the removal and its record commit
          // together or neither does. The member row this names has just been deleted,
          // which is exactly why `admin_audit_event` carries no foreign key to it -- see
          // the migration. The username is kept because after the delete the id alone
          // identifies nobody.
          await this.adminAuditService.recordChange(trx, {
            event: AUDIT_EVENTS.ACCOUNT_REMOVE,
            actorMemberId: session.id,
            authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
            targetType: AUDIT_TARGETS.MEMBER,
            targetId: Number(id),
            targetMemberId: Number(id),
            reason: request.body?.reason,
            request,
            metadata: {
              username: member.username,
              owned_places_removed: places.length,
            },
          });
        });
        response.status(200).json({ status: 'success' });
      } catch (error) {
        // The transaction has already rolled back. The original failure is kept in the
        // server log, where an operator can read it; the client gets one flat refusal with
        // no database detail in it.
        console.error(`Account removal for member ${id} failed:`, error);
        // The transaction rolled back, so any `allowed` row written inside it is gone with
        // it. This records the attempt on the ordinary connection; it is evidence that an
        // operator tried, never evidence that anything committed.
        await this.auditFailed(
          AUDIT_EVENTS.ACCOUNT_REMOVE, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
          {type: AUDIT_TARGETS.MEMBER, id: Number(id), memberId: Number(id)},
        );
        response.status(400).json({error: 'Account removal failed.'});
      }
    } else {
      await this.auditDenied(AUDIT_EVENTS.ACCOUNT_REMOVE, session, request,
        {type: AUDIT_TARGETS.MEMBER, id: Number(request.body?.id),
          memberId: Number(request.body?.id)});
      response.status(403).json({message: 'Access Denied'});
    }
  }
}

const adminService = Container.get(AdminService);
const memberService = Container.get(MemberService);
const avatarService = Container.get(AvatarService);
const placeService = Container.get(PlaceService);
const roleAssignmentService = Container.get(RoleAssignmentService);
const objectInstanceService = Container.get(ObjectInstanceService);
const objectService = Container.get(ObjectService);
const messageService = Container.get(MessageService);
const inboxService = Container.get(InboxService);
const messageboardService = Container.get(MessageboardService);
const clubService = Container.get(ClubService);
export const adminController = new AdminController(
  adminService, 
  memberService, 
  avatarService, 
  placeService, 
  roleAssignmentService, 
  objectInstanceService,
  objectService,
  messageService,
  inboxService,
  messageboardService,
  clubService,
  Container.get(AdminAuditService),
);
