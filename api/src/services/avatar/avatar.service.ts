import { Knex } from 'knex';
import crypto from 'crypto';
const fs = require('fs');
import { Service } from 'typedi';
import { Avatar } from 'models';

import { OUTLANDS_TEAM_AVATARS, OutlandsTeamAvatarView } from '../../libs';
import {
  AvatarRepository,
} from '../../repositories';

/**
 * What a moderation decision actually did to an avatar row.
 *
 * Returned rather than discarded because CTBL-0025 forbids an `allowed` audit event that
 * claims a change the database did not make. `previousStatus` is null when the id named no
 * avatar; `rowsUpdated` is zero when the row was already at the requested status.
 */
export interface AvatarModerationResult {
  previousStatus: number | null;
  rowsUpdated: number;
}

/** Service for dealing with avatars */
@Service()
export class AvatarService {
  constructor(
    private avatarRepository: AvatarRepository,
  ) {}

  public static readonly WRL_FILESIZE_LIMIT = 250000;
  public static readonly TEXTURE_FILESIZE_LIMIT = 250000;
  public static readonly IMAGE_FILESIZE_LIMIT = 250000;

  public static readonly STATUS_DELETED = 0;
  public static readonly STATUS_ACTIVE = 1;
  public static readonly STATUS_PENDING = 2;


  /**
   * Finds all avatars
   * @returns promise resolving all avatars object, or rejecting on error
   */
  public async findAll(): Promise<Avatar[]> {
    return await this.avatarRepository.findAll();
  }

  /**
   * Finds all avatars a member id can access
   * @returns promise resolving all avatars object, or rejecting on error
   */
  public async getResults(memberId : number): Promise<Avatar[]> {
    return await this.avatarRepository.findAllForMemberId(memberId);
  }

  /**
   * The four playable Outlands team avatars, with the side each one carries.
   *
   * This is the ONLY path that serves an Outlands system avatar to a citizen.
   * The rows are marked `private = 1` with no owner, so `getResults` -- the
   * ordinary avatar library -- cannot see them, and `MemberService.updateAvatar`
   * cannot wear one. The Game Master is left out here as well: it is a system
   * avatar the world may use, never a choice offered to a citizen.
   *
   * Only the four fields the Outlands runtime actually reads are returned. A
   * system row has no owner, no gestures and nothing a citizen may edit, so
   * `member_id`, `private` and `status` are internal bookkeeping and are not
   * part of the answer.
   *
   * The database stays authoritative. Nothing is invented when a row is
   * missing; the caller gets fewer than four choices and the entrance says so,
   * which is the same signal the missing-rows defect produced before.
   * @returns promise resolving in the playable rows, each carrying its team
   */
  public async getOutlandsTeamAvatars(): Promise<OutlandsTeamAvatarView[]> {
    const filenames = OUTLANDS_TEAM_AVATARS.map(entry => entry.filename);
    const rows = await this.avatarRepository.findSystemByFilenames(filenames);
    // Returned in the canonical order rather than the database's, so the
    // entrance draws the Red pair then the Blue pair however the rows arrive.
    return OUTLANDS_TEAM_AVATARS
      .map(entry => {
        const row = rows.find(candidate => candidate.filename === entry.filename);
        if (!row) return null;
        return {
          id: row.id,
          filename: row.filename,
          directory: row.directory,
          team: entry.team,
        };
      })
      .filter(row => row !== null);
  }

  public async removeAllAvatars(userId : number, trx?: Knex.Transaction): Promise<any> {
    await this.avatarRepository.removeAllAvatars(userId, trx);
  }

  /**
   * create an avatar (file upload and record)
   * @param wrlFile
   * @param imageFile
   * @param textureFile
   * @param name
   * @param gestures
   * @param privateStatus
   * @param memberId
   */
  public async create(wrlFile, imageFile, textureFile, name, gestures, privateStatus, memberId) {
    let uuid = crypto.randomUUID();
    let fileName = crypto.randomBytes(8).toString('hex');

    const assets = await this.uploadAvatarFiles(
      uuid,
      fileName,
      wrlFile,
      imageFile,
      textureFile ?? null,
    );

    this.avatarRepository.create(
      uuid,
      assets.filename,
      assets.image,
      name,
      gestures,
      privateStatus,
      memberId,
      AvatarService.STATUS_PENDING
    );
  }

  public async uploadAvatarFiles(
    directoryName,
    fileName,
    wrlFile,
    imageFile,
    textureFile?,
  ): Promise<any> {
    let uploadPath = process.env.ASSETS_DIR + '/avatars/' + directoryName;
    const response = {
      filename: null,
      image: null,
      texture: null,
    };

    fs.mkdirSync(uploadPath);
    wrlFile.mv(uploadPath + '/' + fileName + '.wrl');
    response.filename = fileName + '.wrl';

    let imageExtension = imageFile.name.split('.').pop();
    imageFile.mv(uploadPath + '/' + fileName + '.' + imageExtension);
    response.image = fileName + '.' + imageExtension;

    if (textureFile) {
      textureFile.mv(uploadPath + '/' + textureFile.name);
      response.texture = textureFile.name;
    }
    return response;
  }

  /**
   * Approves a pending avatar.
   *
   * Awaited to completion and reported on, because CTBL-0025 makes the moderator's audit
   * event part of what the decision owes: the caller has to know the write landed before
   * it may answer success, and has to know what it changed before it may record one.
   * @param id the avatar
   * @param trx optional transaction, so the decision and its audit event commit together
   * @returns promise resolving in what the update actually did
   */
  public async approve(id, trx?: Knex.Transaction): Promise<AvatarModerationResult> {
    return this.setModeratedStatus(id, AvatarService.STATUS_ACTIVE, trx);
  }

  /**
   * Rejects a pending avatar.
   *
   * Kept separate from `approve` rather than folded into one status setter with a flag:
   * the two are different decisions, they record different audit events, and a shared
   * entry point is one argument away from becoming the wrong one.
   * @param id the avatar
   * @param trx optional transaction, so the decision and its audit event commit together
   * @returns promise resolving in what the update actually did
   */
  public async reject(id, trx?: Knex.Transaction): Promise<AvatarModerationResult> {
    return this.setModeratedStatus(id, AvatarService.STATUS_DELETED, trx);
  }

  /**
   * Reads the status a moderation decision is about to replace, then replaces it.
   *
   * Both statements run on the caller's transaction when there is one, so the before-state
   * the audit row reports is the state the update acted on and not one another request
   * changed in between. Reading first is the only way to tell "the id named no avatar"
   * from "the avatar already had that status" -- both change zero rows, and neither is a
   * change an `allowed` audit event may claim.
   * @param id the avatar
   * @param status the status to set
   * @param trx optional transaction
   */
  private async setModeratedStatus(
    id,
    status: number,
    trx?: Knex.Transaction,
  ): Promise<AvatarModerationResult> {
    const before = await this.avatarRepository.findById(id, trx);
    const rowsUpdated = await this.avatarRepository.updateStatus(id, status, trx);
    return {
      previousStatus: before ? Number(before.status) : null,
      rowsUpdated: Number(rowsUpdated),
    };
  }
}
