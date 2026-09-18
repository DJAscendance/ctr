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
  AUDIT_REASON_MAX,
  AUDIT_RESULTS,
  AUDIT_TARGETS,
  AuditAuthority,
  AuditEventName,
  AuditTarget,
  validateOperatorReason,
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
 *
 * Three of the reads above also owe an ACCESS event under baseline section 11, because
 * they return another member's private content: `searchUserChat`, `getTransactions` and
 * `getTransactionsByWalletId`. The rest are ordinary administrative reads and owe nothing
 * -- `findUserPlaces`, `getObjectInstances` and `getOwnedObjects` return world-entity rows
 * whose equivalents a citizen can already reach (`GET /api/club/search`, and
 * `GET /api/place/:placeId/object_instance`, which needs no session at all). The full
 * classification and its evidence is section 9 of `docs/ADMIN_AUDIT_TRAIL.md`.
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
   * The operator's reason, or a 400 and nothing else.
   *
   * Baseline section 11 makes a reason part of what a ban, a role change and an account
   * removal owe. An obligation the server does not enforce is a suggestion, so this
   * refuses the action outright rather than storing a blank, a placeholder or a sentence
   * CTR wrote on the operator's behalf. No reason, no state change.
   *
   * Called AFTER the authorization gate, never before. A caller without authority must
   * still receive the 403 and its denied event -- turning their refusal into a
   * validation 400 would both mislead them and lose the row that refusal owes. Nothing is
   * audited here: an authorised operator who mistyped a form has attempted no
   * administrative action, and Phase B QA classified controller validation 400s as
   * outside the authorization-denial contract.
   *
   * @param field the request-body field the route reads the reason from
   * @returns the trimmed reason, or null when the response has already been sent
   */
  private requireReason(
    request: Request,
    response: Response,
    field: string,
  ): string | null {
    const reason = validateOperatorReason(request.body?.[field]);
    if (reason === null) {
      response.status(400).json({
        message:
          `A reason is required, 1 to ${AUDIT_REASON_MAX} characters.`,
      });
      return null;
    }
    return reason;
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
  
  /**
   * Records a private-content read, and says whether the content may now be disclosed.
   *
   * Baseline section 11: an ordinary administrative read owes nothing, but "reads of
   * another member's private content -- chat history above all -- owe an access event".
   * There is no business transaction to be atomic with here, so the ordering is what
   * carries the guarantee: the read has already succeeded when this runs, so the row is
   * never a claim about a read that did not happen, and the handler may not answer with
   * the content until this has returned true.
   *
   * On an audit-store failure this refuses the disclosure. That is the opposite of
   * `recordOutcome`'s fail-soft rule, and deliberately so: a refusal that goes unrecorded
   * still refused, whereas private content handed over unrecorded is exactly the
   * disclosure the event exists to make answerable. A 500 here is an outage, not a denial,
   * and leaves the caller's authority untouched.
   *
   * `metadata` names facts ABOUT the read -- how many rows, which page -- never anything
   * out of them, and never the search string, which is operator input that can itself
   * carry private content. `redactMetadata` drops a content-bearing key anyway, as the net
   * under this rule rather than a substitute for it.
   *
   * @returns true when the event was written and the caller may respond with the content
   */
  private async auditAccess(
    response: Response,
    event: AuditEventName,
    session: { id: number },
    request: Request,
    target: { type: AuditTarget | null; id: number | null; memberId: number | null },
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<boolean> {
    try {
      await this.adminAuditService.recordAccess({
        event,
        actorMemberId: session.id,
        authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
        targetType: target.type,
        targetId: target.id,
        targetMemberId: target.memberId,
        request,
        metadata,
      });
      return true;
    } catch (error) {
      console.error(`Audit access event ${event} could not be written:`, error);
      response.status(500).json({message: 'Access could not be recorded.'});
      return false;
    }
  }

  /**
   * Applies a moderator's avatar decision and records it, as one unit.
   *
   * The transaction is opened here rather than inside `AvatarService` because the audit
   * store is an admin concern and `AvatarService` is a domain service with citizen-facing
   * callers -- the same reason `removeAccount` below orchestrates its own transaction
   * across several services. `recordChange` runs inside it and throws on failure, so the
   * status change unwinds with the event it could not record.
   *
   * The before-status is read in the same transaction as the update, because afterwards it
   * is gone and it is the only thing that separates "the id named no avatar" (null) from
   * "the avatar already had that status" (`rows_updated` zero). Neither is refused: this
   * route has always accepted a raw id and answered 200, and CTBL-0025 records what
   * happened rather than changing what the route accepts.
   *
   * @param event `admin.avatar.approve` or `admin.avatar.reject`, never merged into one --
   *   they are different decisions and a reviewer must be able to query them apart
   * @param avatarId the avatar, as the request named it
   * @param session the authenticated operator
   * @param request read only for its origin address
   */
  private async moderateAvatar(
    event: typeof AUDIT_EVENTS.AVATAR_APPROVE | typeof AUDIT_EVENTS.AVATAR_REJECT,
    avatarId: number,
    session: { id: number },
    request: Request,
  ): Promise<void> {
    await this.memberService.runInTransaction(async trx => {
      const result = event === AUDIT_EVENTS.AVATAR_APPROVE
        ? await this.avatarService.approve(avatarId, trx)
        : await this.avatarService.reject(avatarId, trx);
      await this.adminAuditService.recordChange(trx, {
        event,
        actorMemberId: session.id,
        authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
        targetType: AUDIT_TARGETS.AVATAR,
        targetId: avatarId,
        request,
        metadata: {
          old_status: result.previousStatus,
          new_status: event === AUDIT_EVENTS.AVATAR_APPROVE
            ? AvatarService.STATUS_ACTIVE
            : AvatarService.STATUS_DELETED,
          rows_updated: result.rowsUpdated,
        },
      });
    });
  }

  public async addBan(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.canAdmin(session.id);
    if (admin) {
      // After the gate, before the mutation: an unauthorised caller keeps their 403 and
      // its denied event, and an authorised one with no reason changes nothing.
      const reason = this.requireReason(request, response, 'reason');
      if (reason === null) return;
      try {
        // `session.id` is the actor, here and in the audit row the service writes. The
        // request body names only the SUBJECT of the ban; a body field claiming to be the
        // actor is never read, so a caller cannot sign someone else's name to a sanction.
        await this.adminService.addBan(
          request.body.ban_member_id,
          request.body.time_frame,
          request.body.type,
          session.id,
          reason,
          {
            actorMemberId: session.id,
            authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
            request,
            reason,
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
      const reason = this.requireReason(request, response, 'banReason');
      if (reason === null) return;
      try {
        const banId = Number(request.body.banId);
        const deleteBy = await this.memberService.getMemberInfoPublic(session.id);
        // Two different strings from here on, and keeping them apart is the point. The
        // ban history keeps its existing "(Deleted by <username>)" suffix so the members
        // screen reads as it always has; the audit row gets `reason` on its own, because
        // baseline section 11's `reason` means what the OPERATOR wrote and the actor is
        // already its own column.
        const updateReason = `${reason} (Deleted by ${deleteBy.username})`;
        await this.adminService.deleteBan(banId, updateReason, {
          actorMemberId: session.id,
          authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
          request,
          reason,
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
      const reason = this.requireReason(request, response, 'reason');
      if (reason === null) return;
      try {
        await this.adminService.fireRole(
          parseInt(member_id),
          roleId,
          place_id,
          {actorMemberId: session.id, authority, request, reason},
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
    // Which of the two independent paths granted this, recorded rather than inferred --
    // the same distinction `fireRole` above makes, for the same reason: baseline section 4
    // keeps the global role and the security-role manager's scoped right apart, and role
    // holdings change, so the actor's id alone cannot answer it later.
    const globalGrant = hasAccess(accessLevel, 'admin');
    const canManageRole =
      globalGrant ||
      (canManageSecurityRoles &&
        await this.memberService.canSecurityManageRole(roleId));
    const authority = globalGrant
      ? AUDIT_AUTHORITIES.GLOBAL_ROLE
      : AUDIT_AUTHORITIES.RESOURCE_SCOPED;
    if (canManageRole) {
      const reason = this.requireReason(request, response, 'reason');
      if (reason === null) return;
      try {
        // Awaited, so the 200 below cannot be sent before the assignment row commits. The
        // service writes the `allowed` event inside that same transaction.
        await this.adminService.hireRole(
          parseInt(member_id),
          roleId,
          {actorMemberId: session.id, authority, request, reason},
        );
        response.status(200).json({message: 'Role hired successfully'});
      } catch(e) {
        console.log(e);
        await this.auditFailed(
          AUDIT_EVENTS.ROLE_HIRE, session, request, authority,
          {type: AUDIT_TARGETS.ROLE, id: roleId, memberId: parseInt(member_id)},
        );
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

  /**
   * Reads the community ledger, and records that it was read.
   *
   * Classified alongside `getTransactionsByWalletId` below and for the same evidence: a
   * transaction row is a member's own financial history, and `GET /api/bank/account` --
   * the only citizen-facing view of it -- returns the caller's own and nothing else. This
   * route is the unscoped form of that private read, so auditing the per-member one and
   * not this one would leave an operator a way to read everyone's ledger unrecorded.
   *
   * `target_member_id` is null because this read names no member. `scope` says so in the
   * row rather than leaving a later reader to infer it from an absent column.
   */
  public async getTransactions(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    const returnResults = [];
    const rebuild = [];
    if (!hasAccess(admin, 'security')) {
      await this.auditDenied(AUDIT_EVENTS.TRANSACTION_READ, session, request);
      response.status(403).json({message: 'Access Denied'});
      return;
    }
    let limit: number;
    let offset: number;
    try {
      let results = null;
      let findUsername = null;
      limit = Number.parseInt(request.query.limit.toString());
      offset = Number.parseInt(request.query.offset.toString());
      results = await this.adminService.getTransactions(
        request.query.type.toString(),
        limit,
        offset,
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
    } catch (error) {
      console.log(error);
      await this.auditFailed(
        AUDIT_EVENTS.TRANSACTION_READ, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
      );
      response.status(400).json({error});
      return;
    }
    const recorded = await this.auditAccess(
      response, AUDIT_EVENTS.TRANSACTION_READ, session, request,
      {type: null, id: null, memberId: null},
      {
        capability: 'security',
        scope: 'community',
        rows_returned: rebuild.length,
        limit,
        offset,
      },
    );
    if (!recorded) return;
    response.status(200).json({returnResults});
  }

  /**
   * Reads one member's financial history, and records that it was read.
   *
   * Private content by the API's own evidence: `GET /api/bank/account` resolves the
   * account from the session and from nothing else, so no citizen can see another
   * member's ledger anywhere in CTR. Baseline section 11's access-event rule therefore
   * covers it, and the row names the member whose history was opened.
   *
   * No amount, counterparty or transaction line reaches the row -- only how many rows came
   * back and which page they were on.
   */
  public async getTransactionsByWalletId(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    const returnResults = [];
    const rebuild = [];
    const walletTarget = {
      type: AUDIT_TARGETS.MEMBER as AuditTarget | null,
      id: Number(request.params?.id),
      memberId: Number(request.params?.id),
    };
    if (!hasAccess(admin, 'security')) {
      await this.auditDenied(AUDIT_EVENTS.TRANSACTION_READ, session, request, {
        type: AUDIT_TARGETS.MEMBER, id: walletTarget.id, memberId: walletTarget.memberId,
      });
      response.status(403).json({message: 'Access Denied'});
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the service is untyped
    let results: any = null;
    let limit: number;
    let offset: number;
    try {
      let findUsername = null;
      const memberId = request.params.id;
      const user = await this.memberService.find({ id: Number.parseInt(memberId) });
      limit = Number.parseInt(request.query.limit.toString());
      offset = Number.parseInt(request.query.offset.toString());
      results = await this.adminService.getTransactionsByWalletId(
        user.wallet_id,
        limit,
        offset,
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
    } catch (error) {
      console.log(error);
      await this.auditFailed(
        AUDIT_EVENTS.TRANSACTION_READ, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
        {type: AUDIT_TARGETS.MEMBER, id: walletTarget.id, memberId: walletTarget.memberId},
      );
      response.status(400).json({error});
      return;
    }
    const recorded = await this.auditAccess(
      response, AUDIT_EVENTS.TRANSACTION_READ, session, request, walletTarget,
      {
        capability: 'security',
        scope: 'member',
        rows_returned: rebuild.length,
        limit,
        offset,
      },
    );
    if (!recorded) return;
    response.status(200).json({results});
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
  
  /**
   * Reads one member's chat history, and records that it was read.
   *
   * The one read surface baseline section 11 names outright: "reads of another member's
   * private content -- chat history above all -- owe an access event". The rows returned
   * carry `message.body`, which is the member's own words, and no citizen can obtain
   * another member's chat history anywhere else in the API.
   *
   * What the row records is the operator, the member whose chat was read, the capability
   * that allowed it, the page read and how many lines came back. What it never records is
   * a single one of those lines, or the search string -- section 12 forbids the first and
   * the second is operator input that can carry private content of its own.
   */
  public async searchUserChat(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    const admin = await this.memberService.getAccessLevel(session.id);
    const chatTarget = {
      type: AUDIT_TARGETS.MEMBER as AuditTarget | null,
      id: Number(request.query?.user),
      memberId: Number(request.query?.user),
    };
    if (!hasAccess(admin, 'security')) {
      await this.auditDenied(AUDIT_EVENTS.CHAT_READ, session, request, {
        type: AUDIT_TARGETS.MEMBER, id: chatTarget.id, memberId: chatTarget.memberId,
      });
      response.status(403).json({message: 'Access Denied'});
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the service is untyped
    let results: any;
    let limit: number;
    let offset: number;
    try {
      limit = Number.parseInt(request.query.limit.toString());
      offset = Number.parseInt(request.query.offset.toString());
      results = await this.adminService.searchUserChat(
        request.query.search.toString(),
        Number.parseInt(request.query.user.toString()),
        limit,
        offset,
      );
    } catch (error) {
      console.log(error);
      // A read that never produced anything discloses nothing, so it owes no access event.
      // It is still an authorised attempt, and `failed` is the existing name for that.
      await this.auditFailed(
        AUDIT_EVENTS.CHAT_READ, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
        {type: AUDIT_TARGETS.MEMBER, id: chatTarget.id, memberId: chatTarget.memberId},
      );
      response.status(400).json({error});
      return;
    }
    const recorded = await this.auditAccess(
      response, AUDIT_EVENTS.CHAT_READ, session, request, chatTarget,
      {
        capability: 'security',
        rows_returned: Array.isArray(results?.messages) ? results.messages.length : null,
        limit,
        offset,
      },
    );
    if (!recorded) return;
    response.status(200).json({results});
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
    // Parsed inside the try, where it has always been: a body with no `id` throws on
    // `.toString()` and this route has always answered that with a 400, not a crash.
    let avatarId: number = null;
    try {
      avatarId = parseInt(request.body.id.toString());
      await this.moderateAvatar(AUDIT_EVENTS.AVATAR_APPROVE, avatarId, session, request);
      response.status(200).json({'status':'success'});
    } catch (error) {
      console.log(error);
      await this.auditFailed(
        AUDIT_EVENTS.AVATAR_APPROVE, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
        {type: AUDIT_TARGETS.AVATAR, id: avatarId},
      );
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
    // Parsed inside the try, where it has always been: a body with no `id` throws on
    // `.toString()` and this route has always answered that with a 400, not a crash.
    let avatarId: number = null;
    try {
      avatarId = parseInt(request.body.id.toString());
      await this.moderateAvatar(AUDIT_EVENTS.AVATAR_REJECT, avatarId, session, request);
      response.status(200).json({'status':'success'});
    } catch (error) {
      console.log(error);
      await this.auditFailed(
        AUDIT_EVENTS.AVATAR_REJECT, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
        {type: AUDIT_TARGETS.AVATAR, id: avatarId},
      );
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

    const placeId = Number(placeinfo.id);
    try {
      // Awaited inside a transaction the audit event joins, so the 200 below cannot be
      // sent before the row commits, and the row cannot commit without its event.
      // `rows_updated` is recorded rather than assumed: this route accepts a raw id, and
      // an id that names no place changes nothing. The validation above is unchanged.
      await this.memberService.runInTransaction(async trx => {
        const rowsUpdated = await this.placeService.updatePlaces(placeinfo, trx);
        await this.adminAuditService.recordChange(trx, {
          event: AUDIT_EVENTS.PLACE_UPDATE,
          actorMemberId: session.id,
          authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
          targetType: AUDIT_TARGETS.PLACE,
          targetId: placeId,
          request,
          metadata: {
            rows_updated: Number(rowsUpdated),
            place_type: typeof placeinfo.type === 'string' ? placeinfo.type : null,
          },
        });
      });
      response.status(200).json({status: 'success'});
    } catch (error) {
      console.log(error);
      await this.auditFailed(
        AUDIT_EVENTS.PLACE_UPDATE, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
        {type: AUDIT_TARGETS.PLACE, id: placeId},
      );
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
          // Awaited, so the 200 below cannot be sent before the row commits. The service
          // writes the `allowed` event inside the same transaction as the update. The
          // CTBL-0032 directory and filename check above is untouched and still runs
          // first, before any path resolution or database write.
          await this.adminService.updateObjects(
            id,
            name,
            directory,
            filename,
            image,
            price,
            limit,
            quantity,
            status,
            {
              actorMemberId: session.id,
              authority: AUDIT_AUTHORITIES.GLOBAL_ROLE,
              request,
            },
          );
        } else {
          throw new Error ('Some details are blank. Please complete the form');
        }
        response.status(200).json({status: 'success'});
      } catch (error) {
        console.log(error);
        await this.auditFailed(
          AUDIT_EVENTS.OBJECT_UPDATE, session, request, AUDIT_AUTHORITIES.GLOBAL_ROLE,
          {type: AUDIT_TARGETS.OBJECT, id},
        );
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
      // Validated before the destructive transaction is opened, not inside it: the
      // cheapest place to refuse an unrecordable removal is before any row is locked.
      const reason = this.requireReason(request, response, 'reason');
      if (reason === null) return;
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
            reason,
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
