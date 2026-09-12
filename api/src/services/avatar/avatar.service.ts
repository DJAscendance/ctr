import crypto from 'crypto';
const fs = require('fs');
import { Service } from 'typedi';
import { Avatar } from 'models';

import { OUTLANDS_TEAM_AVATARS } from '../../libs';
import {
  AvatarRepository,
} from '../../repositories';

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
   * The database stays authoritative. Nothing is invented when a row is
   * missing; the caller gets fewer than four choices and the entrance says so,
   * which is the same signal the missing-rows defect produced before.
   * @returns promise resolving in the playable rows, each carrying its team
   */
  public async getOutlandsTeamAvatars(): Promise<(Avatar & { team: number })[]> {
    const filenames = OUTLANDS_TEAM_AVATARS.map(entry => entry.filename);
    const rows = await this.avatarRepository.findSystemByFilenames(filenames);
    // Returned in the canonical order rather than the database's, so the
    // entrance draws the Red pair then the Blue pair however the rows arrive.
    return OUTLANDS_TEAM_AVATARS
      .map(entry => {
        const row = rows.find(candidate => candidate.filename === entry.filename);
        return row ? { ...row, team: entry.team } : null;
      })
      .filter(row => row !== null);
  }

  public async removeAllAvatars(userId : number): Promise<any> {
    await this.avatarRepository.removeAllAvatars(userId);
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

  public async approve(id): Promise<any> {
    await this.avatarRepository.updateStatus(id,AvatarService.STATUS_ACTIVE);
  }
  public async reject(id): Promise<any> {
    await this.avatarRepository.updateStatus(id,AvatarService.STATUS_DELETED);
  }
}
