import { Request, Response} from 'express';
import {Container} from 'typedi';
import validator from 'validator';

import { isClientId, isOutlandsTeamAvatar } from '../libs';
import {
  AvatarService,
  MemberService
} from '../services';


class AvatarController {

  constructor(
    private avatarService: AvatarService,
    private memberService: MemberService,
  ) {}

  /**
   * Returns an ordered list of all avatars.
   */
  public async getResults(request: Request, response: Response): Promise<void> {
    try {
      const { apitoken } = request.headers;
      const session = this.memberService.decodeMemberToken(<string>apitoken);
      if (!session) {
        response.status(400).json({
          error: 'Invalid or missing token.',
        });
        return;
      }
      const avatars = await this.avatarService.getResults(session.id);
      response.status(200).json({ avatars });
    } catch (error) {
      console.error(error);
      response.status(400).json({
        error: 'A problem occurred while trying to fetch avatars.',
      });
    }
  }

  /**
   * The four playable Outlands team avatars.
   *
   * The Outlands entrance used to read the ordinary avatar library, which
   * forced the five system avatars to be public. They are not citizen avatars:
   * they carry a weapon, they decide a side, and the Game Master's was never a
   * choice at all. So they are hidden from the library and served here instead,
   * to an authenticated citizen only, which is the same expectation entering
   * Outlands already carries.
   */
  public async getOutlandsTeamAvatars(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    try {
      const avatars = await this.avatarService.getOutlandsTeamAvatars();
      response.status(200).json({ avatars });
    } catch (error) {
      console.error(error);
      response.status(400).json({
        error: 'A problem occurred while trying to fetch the Outlands team avatars.',
      });
    }
  }

  /**
   * Validates one of the four team avatars for this visit to Outlands.
   *
   * Nothing is written and no token is issued. `member.avatar_id` is untouched,
   * so the avatar the citizen chose for themselves is still theirs, and the
   * normal authentication token they are holding is still exactly the token
   * they logged in with. The answer is the validated gameplay row alone: the
   * Outlands runtime keeps it in tab-local state for the length of the visit,
   * and a reload simply returns them to the entrance to choose again.
   */
  public async wearOutlandsTeamAvatar(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    /*
     * The id is taken as it arrived, not as it coerces. A JSON body can carry
     * an array, an object, a string or a boolean where a number belongs, and
     * `Number([13])` is `13` -- so the coercing comparison this replaces let
     * `[13]` be answered with a real Outlands avatar. `isClientId` refuses
     * every shape but a primitive, safe, positive integer, before the rows are
     * even fetched.
     */
    const { avatarId } = request.body;
    if (!isClientId(avatarId)) {
      response.status(400).json({
        error: 'Please pass an avatar id.',
      });
      return;
    }
    try {
      const avatars = await this.avatarService.getOutlandsTeamAvatars();
      /*
       * The id is checked against the rows this endpoint itself serves, not
       * against the avatar table. An id that is not one of the four playable
       * Outlands avatars is refused here, so this path cannot become a second
       * way to put on an arbitrary avatar -- including the Game Master's.
       */
      const chosen = avatars.find(
        avatar => avatar.id === avatarId && isOutlandsTeamAvatar(avatar.filename),
      );
      if (!chosen) {
        response.status(400).json({
          error: 'That is not an Outlands team avatar.',
        });
        return;
      }
      response.status(200).json({
        message: 'Success',
        avatar: chosen,
      });
    } catch (error) {
      console.error(error);
      response.status(400).json({
        error: 'That avatar could not be worn.',
      });
    }
  }

  public async removeAllAvatars(request: Request, response: Response):  Promise<void>{
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;
    try {
      await this.avatarService.removeAllAvatars(session.id);
      response.status(200).json({ status: 'success' });
    } catch {
      response.status(400).json({error: 'Error remvoing avatars.'});
    }
  }

   public async add(request, response: Response): Promise<void> {
    let fileExtension;
    const { apitoken } = request.headers;
    const session = this.memberService.decodeMemberToken(<string>apitoken);
    if (!session) {
      response.status(400).json({
        error: 'Invalid or missing token.',
      });
      return;
    }

    if (validator.isEmpty(request.body.name)) {
      response.status(400).json({
        error: 'Avatar name is required.',
      });
      return;
    }

    if (!request.files) {
      response.status(400).json({
        error: 'VRML file is required',
      });
      return;
    }

    if (
      typeof request.files.wrlFile === 'undefined' ||
      validator.isEmpty(request.files.wrlFile.name)
    ) {
      response.status(400).json({
        error: 'VRML file is required',
      });
      return;
    }
    fileExtension = request.files.wrlFile.name.split('.').pop();
    if (
      fileExtension !== 'wrl' ||
      !['application/octet-stream', 'model/vrml', 'x-world/x-vrml', 'application/x-world'].includes(
        request.files.wrlFile.mimetype,
      )
    ) {
      response.status(400).json({
        error: 'VRML file must be a .wrl file',
      });
      return;
    }

    if (request.files.wrlFile.size > AvatarService.WRL_FILESIZE_LIMIT) {
      response.status(400).json({
        error: 'VRML file must less than 250kb',
      });
      return;
    }

    if (
      typeof request.files.textureFile !== 'undefined' &&
      !validator.isEmpty(request.files.textureFile.name)
    ) {
      fileExtension = request.files.textureFile.name.split('.').pop();
      if (
        !['jpeg', 'jpg'].includes(fileExtension) ||
        !['image/jpeg', 'image/pjpeg'].includes(request.files.textureFile.mimetype)
      ) {
        response.status(400).json({
          error: 'Texture file must be a .jpeg or .jpg file'
        });
        return;
      }
      if (request.files.textureFile.size > AvatarService.TEXTURE_FILESIZE_LIMIT) {
        response.status(400).json({
          error: 'Texture file must less than 250kb',
        });
        return;
      }
    }

    if (
      typeof request.files.imageFile === 'undefined' ||
      validator.isEmpty(request.files.imageFile.name)
    ) {
      response.status(400).json({
        error: 'Thumbnail file is required.',
      });
      return;
    }

    fileExtension = request.files.imageFile.name.split('.').pop();
    if (
      !['jpeg', 'jpg'].includes(fileExtension) ||
      !['image/jpeg', 'image/pjpeg'].includes(request.files.imageFile.mimetype)
    ) {
      response.status(400).json({
        error: 'Thumbnail file must be a .jpeg or .jpg file',
      });
      return;
    }
    if (request.files.imageFile.size > AvatarService.IMAGE_FILESIZE_LIMIT) {
      response.status(400).json({
        error: 'Thumbnail file must less than 250kb',
      });
      return;
    }

    let gesturesString = "";
    if (
      typeof request.body.gestures !== 'undefined'|| 
      !validator.isEmpty(request.body.gestures)
    ) {
      gesturesString = JSON.stringify(request.body.gestures.split(","));
    }

    if (
      typeof request.body.private === 'undefined'|| 
      validator.isEmpty(request.body.private)
    ) {
      response.status(400).json({
        error: 'Usage access is required',
      });
      return;
    }

    try {
      await this.avatarService.create(
        request.files.wrlFile,
        request.files.imageFile,
        request.files.textureFile ?? null,
        request.body.name,
        gesturesString,
        parseInt(request.body.private),
        session.id,
      );
    } catch (e) {
      response.status(400).json({
        error: e,
      });
      return;
    }

    response.status(200).json({
      status: 'success',
    });
  }
}
const avatarService = Container.get(AvatarService);
const memberService = Container.get(MemberService);
export const avatarController = new AvatarController(avatarService, memberService);
