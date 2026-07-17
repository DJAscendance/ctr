import { Service } from 'typedi';
import sharp from 'sharp';
const fs = require('fs');

import {
  PlaceRepository,
  MapLocationRepository,
  HomeDesignRepository,
  HomeRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
} from '../../repositories';
import { Place, HomeDesign, Home } from '../../types/models';

/** Maximum number of citizens who can be granted home chat access. */
const MAX_CHAT_GUESTS = 8;

/** Service for dealing with members */
@Service()
export class HomeService {

  constructor(
    private placeRepository: PlaceRepository,
    private mapLocationRespository: MapLocationRepository,
    private homeDesignRespository: HomeDesignRepository,
    private homeRepository: HomeRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
    private memberRepository: MemberRepository,
  ) {}


  /**
   * Get a place object for a member's home
   * @param memberId id of the member
   */
  public async getHome(memberId: number): Promise<Place> {
    const place = await this.placeRepository.findHomeByMemberId(memberId);
    return place;
  }

  /**
   * Finds which of the given member ids own a home, in a single query.
   * @param memberIds member ids to check
   */
  public async findMemberIdsWithHome(memberIds: number[]): Promise<Set<number>> {
    return this.placeRepository.findMemberIdsWithHome(memberIds);
  }

  /**
   * Gets the raw home record (place_id, home_design_id, image) for a settled home.
   * @param homePlaceId id of the home's place record
   */
  public async getHomeRecord(homePlaceId: number): Promise<Home> {
    return this.homeRepository.findById(homePlaceId);
  }

  public async getHomeBlock(homePlaceId: number): Promise<Place> {
    const mapLocation = await this.mapLocationRespository.findPlaceIdMapLocation(homePlaceId);
    const place = await this.placeRepository.findById(mapLocation.parent_place_id);
    return place;

  }

  public async getPlaceHomeDesign(memberId: number, homePlaceId: number): Promise<HomeDesign> {
    const homeInfo = await this.homeRepository.findById(homePlaceId);    
    return this.homeDesignRespository.find(homeInfo.home_design_id);
  }

  public async getHomeDesign(memberId: number, homeDesignId: string): Promise<HomeDesign> {
    return this.homeDesignRespository.find(homeDesignId);
  }

  public async createHome(
    memberId: number,
    firstName: string,
    lastName: string,
    blockId: number,
    location: number,
    houseName: string,
    houseDescription: string,
    icon2d: number|null,
    homeDesignId: string|null,
  ): Promise<void> {


    // check the space isn't already taken
    const mapLocation = await this.mapLocationRespository.findByParentPlaceIdAndLocation(
      blockId,
      location,
    );
    if(!mapLocation || !mapLocation.available) {
      throw new Error('Location is not available.');
    } else if (mapLocation.place_id > 0) {
      throw new Error('Location already taken.');
    }


    // create place
    const placeId = await this.placeRepository.create({
      type: 'home',
      member_id: memberId,
      name: houseName,
      description: houseDescription,
      map_icon_index: icon2d,
    });

    const claimed = await this.mapLocationRespository.claimLocation(
      blockId,
      location,
      placeId,
    );
    if (!claimed) {
      // roll back the place we just created so a lost race never leaves an orphaned home
      await this.placeRepository.removePlace(placeId);
      throw new Error('Location already taken.');
    }

    await this.homeRepository.create({
      place_id: placeId,
      home_design_id: homeDesignId,
    });
  }

  public async moveHome(
    memberId: number,
    blockId: number,
    location: number,
  ): Promise<void> {


    // check the space isn't already taken
    const mapLocation = await this.mapLocationRespository.findByParentPlaceIdAndLocation(
      blockId,
      location,
    );
    if(!mapLocation || !mapLocation.available) {
      throw new Error('Location is not available.');
    } else if (mapLocation.place_id > 0) {
      throw new Error('Location already taken.');
    }

    const place = await this.placeRepository.findHomeByMemberId(memberId);
    const currentMapLocation = await this.mapLocationRespository.findPlaceIdMapLocation(place.id);

    const claimed = await this.mapLocationRespository.claimLocation(
      blockId,
      location,
      place.id,
    );
    if (!claimed) {
      throw new Error('Location already taken.');
    }

    if (currentMapLocation) {
      await this.mapLocationRespository.unsetPlaceId(
        currentMapLocation.parent_place_id,
        currentMapLocation.location,
      );
    }
  }

  public async updateHome(
    memberId: number,
    houseName: string,
    icon2d: number|null,
    homeDesignId: string|null,
  ): Promise<void> {


    // update place
    const place = await this.placeRepository.updateHomeByMemberId(
      memberId,
      {
        name: houseName,
        map_icon_index: icon2d,
      }, true);

    // update home record
    await this.homeRepository.update(
      place.id,
      {home_design_id: homeDesignId},
    );

  }

  /**
   * Resets a member's home: moves it to a new block/lot (freeing the old one), and clears
   * the name, description, image, 3D design, and chat access guest list back to defaults.
   * This is atomic with the location change so the home is never left pointing at no lot.
   * @param memberId id of the home's owner
   * @param blockId id of the block to move the home to
   * @param location lot number within the block to move the home to
   */
  public async resetHome(memberId: number, blockId: number, location: number): Promise<void> {
    const mapLocation = await this.mapLocationRespository.findByParentPlaceIdAndLocation(
      blockId,
      location,
    );
    if (!mapLocation || !mapLocation.available) {
      throw new Error('Location is not available.');
    } else if (mapLocation.place_id > 0) {
      throw new Error('Location already taken.');
    }

    const place = await this.placeRepository.findHomeByMemberId(memberId);
    if (!place) {
      throw new Error('You don\'t have a home yet.');
    }

    const member = await this.memberRepository.findById(memberId);

    // claim the new lot first (guarding against a concurrent claim of the same lot),
    // then free the old one - so a failed claim never leaves the home lot-less
    const currentMapLocation = await this.mapLocationRespository.findPlaceIdMapLocation(place.id);

    const claimed = await this.mapLocationRespository.claimLocation(
      blockId,
      location,
      place.id,
    );
    if (!claimed) {
      throw new Error('Location already taken.');
    }

    if (currentMapLocation) {
      await this.mapLocationRespository.unsetPlaceId(
        currentMapLocation.parent_place_id,
        currentMapLocation.location,
      );
    }

    // delete any uploaded image (whether it was pending/private or approved/public)
    this.deleteHomeImageFiles(place.id);

    // clear customizations back to defaults
    await this.placeRepository.updateHomeByMemberId(memberId, {
      name: `${member.username}'s Home`,
      description: '',
      map_icon_index: 1,
    });
    await this.homeRepository.update(place.id, {
      home_design_id: null,
      image: null,
      image_status: 'none',
      image_checked_by: null,
      image_checked_at: null,
    });

    // clear the chat access guest list (unrestricted again)
    const guestRoleId = this.roleRepository.roleMap.HomeChatGuest;
    await this.roleAssignmentRepository.removeAllForPlaceAndRole(place.id, guestRoleId);
  }

  /**
   * Gets the description text a home's owner has set, for display to visitors via the
   * "Information" tool. Returns an empty string for non-home places or homes with no
   * description set.
   * @param placeId id of the home's place record
   */
  public async getHomeInformation(placeId: number): Promise<string> {
    const place = await this.placeRepository.findById(placeId);
    if (!place || place.type !== 'home') {
      return '';
    }
    return place.description || '';
  }

  /**
   * Updates the description shown on a member's home page.
   * @param memberId id of the home's owner
   * @param houseDescription new description text
   */
  public async updateHomeInformation(memberId: number, houseDescription: string): Promise<void> {
    const home = await this.placeRepository.findHomeByMemberId(memberId);
    if (!home) {
      throw new Error('You don\'t have a home yet.');
    }

    await this.placeRepository.updateHomeByMemberId(
      memberId,
      { description: houseDescription },
    );
  }

  /** Uploaded home images are normalized to at most this many pixels per side. */
  public static readonly IMAGE_MAX_DIMENSION = 200;

  /**
   * Uploads and sets the image shown on a member's home page. The image is converted to
   * WebP and downscaled to fit within IMAGE_MAX_DIMENSION x IMAGE_MAX_DIMENSION (preserving
   * aspect ratio, never upscaling) regardless of the source format. Replaces any previously
   * uploaded image - each home only ever has one image on disk, named by its place id so
   * re-uploads simply overwrite the old file.
   * @param memberId id of the home's owner
   * @param imageFile the uploaded file (from express-fileupload)
   */
  public async uploadHomeImage(memberId: number, imageFile): Promise<void> {
    const home = await this.placeRepository.findHomeByMemberId(memberId);
    if (!home) {
      throw new Error('You don\'t have a home yet.');
    }

    const pendingDir = this.getPendingImageDir();
    if (!fs.existsSync(pendingDir)) {
      fs.mkdirSync(pendingDir, { recursive: true });
    }

    // Replacing any previous image: remove it from both the public and private directories
    // so a freshly uploaded (unchecked) image never coexists with - or is served in place
    // of - a previously approved one.
    this.deleteHomeImageFiles(home.id);

    const filename = `${home.id}.webp`;
    await sharp(imageFile.data)
      .resize(HomeService.IMAGE_MAX_DIMENSION, HomeService.IMAGE_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp()
      .toFile(`${pendingDir}/${filename}`);

    // New uploads are held for moderation in the PRIVATE directory - hidden from the public
    // behind a "NOT CHECKED!" placeholder until a Block Leader / Deputy / admin approves.
    await this.homeRepository.update(home.id, {
      image: filename,
      image_status: 'pending',
      image_checked_by: null,
      image_checked_at: null,
    });
  }

  /**
   * Removes the uploaded image from a member's home, if any, reverting the home page back
   * to the "No image uploaded yet!" placeholder.
   * @param memberId id of the home's owner
   */
  public async removeHomeImage(memberId: number): Promise<void> {
    const home = await this.placeRepository.findHomeByMemberId(memberId);
    if (!home) {
      throw new Error('You don\'t have a home yet.');
    }

    this.deleteHomeImageFiles(home.id);
    await this.homeRepository.update(home.id, {
      image: null,
      image_status: 'none',
      image_checked_by: null,
      image_checked_at: null,
    });
  }

  /**
   * Directory that publicly visible (approved) home images live in. Served by nginx under
   * /assets/homes-uploads, so ONLY approved images may ever be placed here.
   */
  private getPublicImageDir(): string {
    return `${process.env.ASSETS_DIR}/homes-uploads`;
  }

  /**
   * Private directory that pending (unapproved) home images live in. Deliberately kept
   * outside ASSETS_DIR and every nginx-served path so an unchecked image cannot be fetched
   * directly - moderators preview it only through the authenticated
   * /home/moderation/:placeId/image endpoint. Configurable via PRIVATE_UPLOADS_DIR.
   */
  private getPendingImageDir(): string {
    return `${process.env.PRIVATE_UPLOADS_DIR || '/usr/src/app/private-uploads'}/homes-pending`;
  }

  /**
   * Moves a file, falling back to copy+unlink when source and destination are on different
   * filesystems (the public and private image directories may be separate mounts, which
   * makes a plain rename fail with EXDEV). Prefers an atomic rename when they share a device.
   */
  private moveFile(sourcePath: string, destPath: string): void {
    try {
      fs.renameSync(sourcePath, destPath);
    } catch (error) {
      if (error.code === 'EXDEV') {
        fs.copyFileSync(sourcePath, destPath);
        fs.unlinkSync(sourcePath);
      } else {
        throw error;
      }
    }
  }

  /**
   * Deletes a home's image file from BOTH the public and private directories. The filename
   * is derived solely from the numeric place id (images are always stored as
   * "<placeId>.webp"), so this can never traverse outside those directories. Missing files
   * are ignored, so it is safe to call regardless of the image's current state.
   */
  private deleteHomeImageFiles(placeId: number): void {
    const filename = `${placeId}.webp`;
    for (const dir of [this.getPublicImageDir(), this.getPendingImageDir()]) {
      const filePath = `${dir}/${filename}`;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  /**
   * Gets the citizens explicitly granted chat access at the given member's home. An empty
   * list means the home is unrestricted - everyone may chat there.
   * @param memberId id of the home's owner
   */
  public async getChatAccess(memberId: number): Promise<{ guests: string[] }> {
    const home = await this.placeRepository.findHomeByMemberId(memberId);
    if (!home) {
      throw new Error('You don\'t have a home yet.');
    }

    const guestRoleId = this.roleRepository.roleMap.HomeChatGuest;
    const guests = await this.roleAssignmentRepository.getUsernamesByRoleAndPlace(
      home.id,
      guestRoleId,
    );

    return { guests: guests.map(guest => guest.username) };
  }

  /**
   * Replaces the list of citizens granted chat access at the given member's home. Passing
   * an empty list removes the restriction entirely (everyone may chat there again).
   * Unknown usernames are silently ignored, matching the block/hood access rights UX.
   * @param memberId id of the home's owner
   * @param guestUsernames up to 8 usernames to grant chat access to
   */
  public async updateChatAccess(memberId: number, guestUsernames: string[]): Promise<void> {
    const home = await this.placeRepository.findHomeByMemberId(memberId);
    if (!home) {
      throw new Error('You don\'t have a home yet.');
    }

    const guestRoleId = this.roleRepository.roleMap.HomeChatGuest;

    await this.roleAssignmentRepository.removeAllForPlaceAndRole(home.id, guestRoleId);

    const uniqueUsernames = [...new Set(
      (guestUsernames || [])
        .filter(username => typeof username === 'string' && username.trim().length > 0)
        .map(username => username.trim()),
    )].slice(0, MAX_CHAT_GUESTS);

    for (const username of uniqueUsernames) {
      const matches = await this.memberRepository.findIdByUsername(username);
      if (Array.isArray(matches) && matches.length > 0 && matches[0].id) {
        await this.roleAssignmentRepository.addIdToAssignment(
          home.id,
          matches[0].id,
          guestRoleId,
        );
      }
    }
  }

  /**
   * Gets the chat restriction status for a place, for use by the realtime chat server.
   * Non-home places, and homes with no chat guests configured, are always unrestricted.
   * @param placeId id of the place to check
   */
  public async getChatAccessStatusByPlaceId(
    placeId: number,
  ): Promise<{ restricted: boolean; allowedUsernames: string[] }> {
    const place = await this.placeRepository.findById(placeId);
    if (!place || place.type !== 'home') {
      return { restricted: false, allowedUsernames: [] };
    }

    const guestRoleId = this.roleRepository.roleMap.HomeChatGuest;
    const guests = await this.roleAssignmentRepository.getUsernamesByRoleAndPlace(
      place.id,
      guestRoleId,
    );

    if (guests.length === 0) {
      return { restricted: false, allowedUsernames: [] };
    }

    const owner = await this.memberRepository.findById(place.member_id);

    return {
      restricted: true,
      allowedUsernames: [
        ...(owner ? [owner.username] : []),
        ...guests.map(guest => guest.username),
      ],
    };
  }

  /**
   * Lists home images awaiting moderation, for the CHECK queue shown to Block Leaders /
   * Deputies / admins. Each entry carries the owner's username, the block name, and the
   * public image URL so the moderator can preview it before approving or rejecting.
   */
  public async getPendingImageHomes(): Promise<Array<{
    placeId: number;
    ownerUsername: string;
    homeName: string;
    blockName: string;
    imageUrl: string;
  }>> {
    const rows = await this.homeRepository.findPendingImageHomes();
    return rows.map(row => ({
      placeId: row.placeId,
      ownerUsername: row.ownerUsername,
      homeName: row.homeName,
      blockName: row.blockName,
      // The pending image is private; moderators load it through the authenticated preview
      // endpoint (relative to /api), never a public static URL.
      imageUrl: `/home/moderation/${row.placeId}/image`,
    }));
  }

  /**
   * Resolves the on-disk path of a home's pending image for an authenticated moderator
   * preview, or null if there is no pending image or its file is missing. The path is
   * derived solely from the numeric place id, never from client input, so it cannot be used
   * to traverse the filesystem.
   * @param homePlaceId id of the home's place record
   */
  public async getPendingImagePath(homePlaceId: number): Promise<string | null> {
    const home = await this.homeRepository.findById(homePlaceId);
    if (!home || !home.image || home.image_status !== 'pending') {
      return null;
    }
    const filePath = `${this.getPendingImageDir()}/${homePlaceId}.webp`;
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return filePath;
  }

  /**
   * Approves a home's pending image, making it publicly visible. Records who checked it
   * and when.
   * @param homePlaceId id of the home's place record
   * @param checkerMemberId id of the moderator approving the image
   */
  public async approveHomeImage(homePlaceId: number, checkerMemberId: number): Promise<void> {
    const home = await this.homeRepository.findById(homePlaceId);
    if (!home || !home.image || home.image_status !== 'pending') {
      throw new Error('No pending image to approve.');
    }

    const filename = `${homePlaceId}.webp`;
    const pendingPath = `${this.getPendingImageDir()}/${filename}`;
    const publicDir = this.getPublicImageDir();
    const publicPath = `${publicDir}/${filename}`;

    if (!fs.existsSync(pendingPath)) {
      throw new Error('Pending image file is missing.');
    }
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    // Atomically claim the pending -> approved transition. Only one caller can match
    // image_status = 'pending', so concurrent/duplicate approvals can never both proceed and
    // clobber each other. The image is only moved into the public directory AFTER the claim
    // succeeds, so it can never be served while still marked pending. If the move then fails
    // we revert to pending so we never claim "approved" without a published file; the
    // transient window (approved record, file not yet public) merely shows the placeholder.
    const claimed = await this.homeRepository.approveIfPending(homePlaceId, checkerMemberId);
    if (!claimed) {
      throw new Error('No pending image to approve.');
    }
    try {
      this.moveFile(pendingPath, publicPath);
    } catch (error) {
      await this.homeRepository.update(homePlaceId, {
        image_status: 'pending',
        image_checked_by: null,
        image_checked_at: null,
      });
      throw new Error('Could not publish the approved image.');
    }
  }

  /**
   * Rejects a home's pending image: deletes the file from disk and clears the image so the
   * owner must upload a new one. Records who checked it and when.
   * @param homePlaceId id of the home's place record
   * @param checkerMemberId id of the moderator rejecting the image
   */
  public async rejectHomeImage(homePlaceId: number, checkerMemberId: number): Promise<void> {
    const home = await this.homeRepository.findById(homePlaceId);
    if (!home || !home.image || home.image_status !== 'pending') {
      throw new Error('No pending image to reject.');
    }
    // Atomically claim the rejection so concurrent rejects can't both process the same image.
    const claimed = await this.homeRepository.rejectIfPending(homePlaceId, checkerMemberId);
    if (!claimed) {
      throw new Error('No pending image to reject.');
    }
    // Delete the private pending file (and defensively any public copy). Tolerates a missing
    // file. The owner may upload a replacement afterwards.
    this.deleteHomeImageFiles(homePlaceId);
  }
}
