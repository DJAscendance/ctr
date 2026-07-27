import { randomBytes } from 'crypto';

import { Service } from 'typedi';
import sharp from 'sharp';
import * as fs from 'fs';

import {
  PlaceRepository,
  MapLocationRepository,
  HomeDesignRepository,
  HomeRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
  TransactionRepository,
} from '../../repositories';
import { Place, HomeDesign, Home } from '../../types/models';
import { MemberService } from '../member/member.service';
import { BlockService } from '../block/block.service';

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
    private transactionRepository: TransactionRepository,
    private memberService: MemberService,
    private blockService: BlockService,
  ) {}


  /**
   * Get a place object for a member's home
   * @param memberId id of the member
   */
  public async getHome(memberId: number): Promise<Place> {
    const place = await this.placeRepository.findHomeByMemberId(memberId);
    return place;
  }

  public async getHomeBlock(homePlaceId: number): Promise<Place> {
    const mapLocation = await this.mapLocationRespository.findPlaceIdMapLocation(homePlaceId);
    const place = await this.placeRepository.findById(mapLocation.parent_place_id);
    return place;

  }

  public async getHomeRecord(homePlaceId: number): Promise<Home> {
    return this.homeRepository.findById(homePlaceId);
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

    await this.homeRepository.create({
      place_id: placeId,
      home_design_id: homeDesignId,
    });

    await this.mapLocationRespository.create({
      ...mapLocation,
      place_id: placeId,
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
    await this.mapLocationRespository.unsetPlaceId(
      currentMapLocation.parent_place_id,
      currentMapLocation.location,
    );

    await this.mapLocationRespository.create({
      ...mapLocation,
      place_id: place.id,
    });

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

  /** 2D map icon a home returns to when it is reset. */
  public static readonly DEFAULT_MAP_ICON_INDEX = 1;

  /**
   * Resets a member's home: moves it to a chosen free lot and clears the customisations
   * back to defaults, refunding the paid 3D design if there was one.
   *
   * Everything below happens in ONE transaction, so a failure anywhere leaves the home,
   * lot, wallet, design and image state exactly as they were. Lock order is fixed and
   * request-independent - `home`, then the affected `map_location` rows in primary-key
   * order, then `wallet` - so two concurrent resets can never each hold what the other
   * needs.
   *
   * Exactly-once refund, without an idempotency column on the ledger: the decision to refund
   * is made from `home_design_id` read under the home's row lock, and the SAME transaction
   * clears that column and writes the ledger row. A duplicate submit, a client retry, a
   * transaction retry or a second concurrent reset therefore all observe an already-null
   * design and refund nothing. A crash mid-flight rolls back, leaving the design intact, so
   * a retry is still correct.
   *
   * Image state uses the PR #410 model unchanged - the record moves to ('none', null) under
   * the same row lock every other image mutation takes, and files are cleaned up after the
   * commit through the existing revision-specific, state-guarded helpers. Nothing here
   * deletes by wildcard, and a cleanup failure cannot invalidate the committed reset.
   *
   * @param memberId id of the home's owner, from the authenticated session
   * @param blockId id of the block to place the home in
   * @param location lot number within that block
   */
  public async resetHome(memberId: number, blockId: number, location: number): Promise<void> {
    const home = await this.placeRepository.findHomeByMemberId(memberId);
    if (!home) {
      throw new Error('You don\'t have a home yet.');
    }

    // The requested lot must belong to an actual block - otherwise a caller could name any
    // place id and reset their home onto a colony, a hood, or another member's home.
    const block = await this.placeRepository.findById(blockId);
    if (!block || block.type !== 'block') {
      throw new Error('Location is not available.');
    }

    const member = await this.memberRepository.findById(memberId);
    if (!member) {
      throw new Error('Member not found.');
    }

    // Champion donors were charged nothing for the champion home, so they are owed nothing
    // back. Identical rule to updateHome, deliberately - the two refund paths must agree.
    const donor = await this.memberService.getDonorLevel(memberId);
    const donorLevel = donor ? Object.values(donor).toString() : null;

    let clearedRevision: string | undefined;

    await this.homeRepository.runInTransaction(async trx => {
      // 1. home row - the serialisation point shared with every image mutation.
      const lockedHome = await this.homeRepository.lockHome(trx, home.id);
      if (!lockedHome) {
        throw new Error('You don\'t have a home yet.');
      }
      clearedRevision = lockedHome.image_revision;

      // 2. map_location rows, in primary-key order (see lockLocationsWithin).
      const currentLocation = await this.mapLocationRespository
        .findPlaceLocationWithin(trx, home.id);
      const lotKeys = [{ parentPlaceId: blockId, location }];
      if (currentLocation) {
        lotKeys.push({
          parentPlaceId: currentLocation.parent_place_id,
          location: currentLocation.location,
        });
      }
      await this.mapLocationRespository.lockLocationsWithin(trx, lotKeys);

      const stayingPut = !!currentLocation
        && currentLocation.parent_place_id === blockId
        && currentLocation.location === location;

      if (!stayingPut) {
        // The claim proves the lot was still free through its own WHERE clause; a prior
        // read plus an unconditional update would leave a window for a concurrent claim.
        const claimed = await this.mapLocationRespository
          .claimLocationWithin(trx, blockId, location, home.id);
        if (!claimed) {
          throw new Error('Location already taken.');
        }
        if (currentLocation) {
          await this.mapLocationRespository.releaseLocationWithin(
            trx,
            currentLocation.parent_place_id,
            currentLocation.location,
            home.id,
          );
        }
      }

      // Clear the visible customisations back to a freshly-settled home.
      await this.placeRepository.updateHomeByMemberIdWithin(trx, memberId, {
        name: `${member.username}'s Home`,
        description: '',
        map_icon_index: HomeService.DEFAULT_MAP_ICON_INDEX,
      });

      // Clear the design and move image state to ('none', null) - exactly the state the
      // PR #410 cleanup contract documents for a reset.
      await this.homeRepository.updateWithin(trx, home.id, {
        home_design_id: null,
        image: null,
        image_status: 'none',
        image_revision: null,
        image_checked_by: null,
        image_checked_at: null,
      });

      // 3. wallet - last in the lock order, and only when a design was actually cleared.
      if (lockedHome.home_design_id) {
        const design = this.homeDesignRespository.find(lockedHome.home_design_id);
        let refund = design ? design.price : 0;
        if (donorLevel === 'Champion' && lockedHome.home_design_id === 'championhome') {
          refund = 0;
        }
        if (refund > 0) {
          await this.transactionRepository
            .createHomeRefundTransactionWithin(trx, member.wallet_id, refund);
        }
      }
    });

    // Committed. Clean up the files this reset orphaned, through the same guarded helpers
    // removeHomeImage uses: the private file is addressed by the exact revision captured
    // under the lock, and the public file is removed only while the record still reads
    // ('none', null) - so an upload or approval that committed in the gap keeps its image.
    // Best-effort by design: the reset and refund are already durable and a stale file is
    // recoverable, so a failed unlink must not report the reset as failed.
    try {
      this.deletePendingRevisionFile(home.id, clearedRevision);
      await this.deletePublicImageIfState(home.id, 'none', null);
    } catch (error) {
      console.error('home reset: image cleanup failed', error);
    }
  }

  /**
   * Maximum length of the description a member may set for their home. Enforced
   * server-side; the SPA's textarea maxlength is a convenience, not the boundary.
   */
  public static readonly INFORMATION_MAX_LENGTH = 1000;

  /**
   * Gets the description a home's owner has set, for display to visitors through the
   * "Information" tool. Returns an empty string for a place that does not exist or is not
   * a home, so a caller can never use this endpoint to read a club's or block's
   * description through the home route.
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
   * Updates the description shown on a member's home page. The home is resolved from the
   * authenticated member id - never from a client-supplied place or member id - so a
   * caller can only ever edit their own home, and a member without a home is rejected
   * rather than silently updating nothing.
   * @param memberId id of the home's owner
   * @param houseDescription new description text (an empty string is a valid, intentional
   *   value that clears the description)
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

    // Each upload gets its own revision token and its own private filename, so a replacement
    // upload NEVER overwrites the file an in-flight approval is reading. The processed image
    // is written before we take the row lock (below) to keep the lock window short - it is
    // uniquely named, so it is harmless if the transaction then fails.
    const revision = this.generateRevision();
    const filename = this.publicImageFilename(home.id);
    await sharp(imageFile.data)
      .resize(HomeService.IMAGE_MAX_DIMENSION, HomeService.IMAGE_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp()
      .toFile(this.pendingImagePath(home.id, revision));

    // Record the new pending revision under the home's row lock, serialized against any
    // concurrent approval/reject/upload for this home. New uploads are held for moderation in
    // the PRIVATE directory - hidden from the public behind a "NOT CHECKED!" placeholder until
    // a Block Leader / Deputy / admin approves the exact revision.
    let previousRevision: string | undefined;
    try {
      await this.homeRepository.runInTransaction(async trx => {
        const locked = await this.homeRepository.lockHome(trx, home.id);
        previousRevision = locked && locked.image_revision;
        await this.homeRepository.updateWithin(trx, home.id, {
          image: filename,
          image_status: 'pending',
          image_revision: revision,
          image_checked_by: null,
          image_checked_at: null,
        });
      });
    } catch (error) {
      // The record was not updated: drop the orphaned pending file we just wrote.
      this.deletePendingRevisionFile(home.id, revision);
      throw error;
    }

    // Committed. Now clean up the superseded artifacts. Both operations only ever remove bytes
    // that are no longer current: the OLD pending revision's private file (immutable and
    // uniquely named, so deleting exactly it can never touch a concurrent upload's file), and
    // any previously-approved public copy - but the latter goes through the state-guarded
    // helper, which re-locks and only deletes while this home is still pending THIS revision.
    // That prevents an upload whose transaction has already committed from deleting a public
    // image a concurrent approval published in the gap. Best-effort: a stale leftover is at
    // worst an already-approved image or an orphan, and must not fail the request.
    try {
      if (previousRevision && previousRevision !== revision) {
        this.deletePendingRevisionFile(home.id, previousRevision);
      }
      await this.deletePublicImageIfState(home.id, 'pending', revision);
    } catch (error) {
      console.error('home image upload: cleanup of superseded files failed', error);
    }
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

    // Clear the image record under the row lock (serialized with any in-flight moderation),
    // capturing the exact revision being removed so cleanup targets only that immutable file.
    let removedRevision: string | undefined;
    await this.homeRepository.runInTransaction(async trx => {
      const locked = await this.homeRepository.lockHome(trx, home.id);
      removedRevision = locked && locked.image_revision;
      await this.homeRepository.updateWithin(trx, home.id, {
        image: null,
        image_status: 'none',
        image_revision: null,
        image_checked_by: null,
        image_checked_at: null,
      });
    });
    // Delete only the captured revision's private file (never a wildcard, which could wipe a
    // concurrent upload's freshly-written file) and, via the state guard, the public copy only
    // while the home is still cleared - so a later upload/approval's files are never touched.
    try {
      this.deletePendingRevisionFile(home.id, removedRevision);
      await this.deletePublicImageIfState(home.id, 'none', null);
    } catch (error) {
      console.error('home image remove: cleanup failed', error);
    }
  }

  /**
   * Directory that publicly visible (approved) home images live in. Served by nginx under
   * /assets/homes-uploads, so ONLY approved images may ever be placed here. The public file
   * is always the canonical "<placeId>.webp" (no revision in the name), so the public URL is
   * stable across re-uploads.
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

  /** Canonical public filename for a home's approved image (no revision - stable URL). */
  private publicImageFilename(placeId: number): string {
    return `${placeId}.webp`;
  }

  /**
   * Private filename for a specific pending revision. Each upload gets a fresh revision, so
   * a replacement upload never overwrites the file an in-flight approval is reading - the
   * root cause of the moderation-bypass race. Derived solely from the numeric place id and a
   * hex revision token, so it can never traverse outside the pending directory.
   */
  private pendingImageFilename(placeId: number, revision: string): string {
    return `${placeId}-${revision}.webp`;
  }

  private publicImagePath(placeId: number): string {
    return `${this.getPublicImageDir()}/${this.publicImageFilename(placeId)}`;
  }

  private pendingImagePath(placeId: number, revision: string): string {
    return `${this.getPendingImageDir()}/${this.pendingImageFilename(placeId, revision)}`;
  }

  /** Generates a fresh, unguessable revision token for a newly uploaded image. */
  private generateRevision(): string {
    return randomBytes(16).toString('hex');
  }

  /** An error that maps to HTTP 409 Conflict (the reviewed image changed underneath us). */
  private conflict(message: string): Error {
    return Object.assign(new Error(message), { status: 409 });
  }

  /** Deletes the home's canonical public (approved) image file, if present. */
  private deletePublicImageFile(placeId: number): void {
    const filePath = this.publicImagePath(placeId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /** Deletes a single pending revision's private file, if present. No-op for a null token. */
  private deletePendingRevisionFile(placeId: number, revision?: string | null): void {
    if (!revision) {
      return;
    }
    const filePath = this.pendingImagePath(placeId, revision);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * Deletes the canonical public image file, but only after RE-ACQUIRING the home's row lock
   * and confirming the record still has the exact (status, revision) the caller produced.
   *
   * The row lock only protects work done while its transaction is open; a filesystem cleanup
   * performed after the caller's own transaction commits is no longer serialized. Without this
   * guard, a request whose transaction has already committed could delete a public file that a
   * newer operation (which committed in the gap) is now responsible for - e.g. an upload's
   * cleanup deleting an image a concurrent approval just published. Re-checking the state under
   * a fresh lock makes the post-commit timing irrelevant: if a later operation has changed the
   * status or revision, the public file is left untouched. The delete itself runs while the
   * lock is held, so it is serialized with every other image mutation, across processes.
   *
   * Callers pass the state THEY committed:
   *   - upload                       -> ('pending', theirRevision)
   *   - remove / reset               -> ('none', null)
   *   - reject                       -> ('rejected', null)
   *   - approve rollback compensation-> ('pending', reviewedRevision)
   * It is never correct to call this expecting 'approved': an approved public file must survive.
   */
  private async deletePublicImageIfState(
    placeId: number,
    expectedStatus: string,
    expectedRevision: string | null,
  ): Promise<void> {
    await this.homeRepository.runInTransaction(async trx => {
      const home = await this.homeRepository.lockHome(trx, placeId);
      if (!home) {
        return;
      }
      const currentRevision = home.image_revision || null;
      if (home.image_status !== expectedStatus || currentRevision !== expectedRevision) {
        // A later operation now owns this home's image; leave its public file alone.
        return;
      }
      this.deletePublicImageFile(placeId);
    });
  }

  /**
   * Publishes an approved revision into the canonical public file. The bytes are copied from
   * the private pending file into a temp file IN the public directory and then atomically
   * renamed into place, so nginx never sees a half-written image and the canonical file only
   * ever flips from one complete approved image to another. The cross-directory copy also
   * tolerates the public and private dirs being on separate mounts (EXDEV). Throws on any
   * failure, leaving the canonical file untouched, so the caller can keep the image pending.
   */
  private publishApprovedImage(placeId: number, revision: string): void {
    const sourcePath = this.pendingImagePath(placeId, revision);
    const publicDir = this.getPublicImageDir();
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    // Remove any leftover temp files for this home from an earlier approval that was killed
    // between the copy and the rename (the rename is the atomic publish point). Approvals for a
    // home are serialized by its row lock, so at most one such temp can exist at a time.
    this.deletePublicTempFiles(placeId);
    const tempPath = `${publicDir}/.tmp-${this.pendingImageFilename(placeId, revision)}`;
    try {
      fs.copyFileSync(sourcePath, tempPath);
      fs.renameSync(tempPath, this.publicImagePath(placeId));
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  }

  /**
   * Removes any leftover ".tmp-<placeId>-*.webp" staging files from the public directory (a
   * process killed between the copy and rename in publishApprovedImage can strand one). The
   * match is anchored to the numeric "<placeId>-" segment, so it can only touch this home's
   * temp files, never another home's or the canonical public image.
   */
  private deletePublicTempFiles(placeId: number): void {
    const publicDir = this.getPublicImageDir();
    if (!fs.existsSync(publicDir)) {
      return;
    }
    const prefix = `.tmp-${placeId}-`;
    for (const entry of fs.readdirSync(publicDir)) {
      if (entry.startsWith(prefix) && entry.endsWith('.webp')) {
        fs.unlinkSync(`${publicDir}/${entry}`);
      }
    }
  }

  /**
   * The single server-side authorization decision for home-image moderation. A member may
   * moderate a home's image when they are a global administrator (Admin or a security role)
   * OR they hold block-administration authority over the block the home sits in.
   *
   * Block authority reuses the repository's established convention -
   * BlockService.canAdmin(blockId, memberId) - which is the same predicate that gates the
   * CHECK button (GET /block/:id/can_admin) and other Block Tools. It grants a member the
   * block scoped to their BlockLeader/BlockDeputy assignment, plus the block's hierarchical
   * superiors scoped to the containing hood/colony; it does NOT grant unrelated staff roles.
   *
   * The block is derived from server-side data (map_location), never from a client-supplied
   * block id, so a member cannot claim authority over a block by passing its id. Returns
   * false (deny) if the home or its block cannot be resolved.
   * @param homePlaceId id of the home's place record
   * @param memberId id of the member requesting to moderate
   */
  public async canModerateHome(homePlaceId: number, memberId: number): Promise<boolean> {
    if (await this.memberService.canAdmin(memberId)) {
      return true;
    }
    let block: Place;
    try {
      block = await this.getHomeBlock(homePlaceId);
    } catch (error) {
      return false;
    }
    if (!block) {
      return false;
    }
    return this.blockService.canAdmin(block.id, memberId);
  }

  /**
   * Lists home images awaiting moderation for the CHECK queue, filtered server-side to only
   * the homes the requesting moderator is authorized to review. A global administrator
   * receives the complete pending queue; any other moderator receives only pending homes in
   * the block(s) they administer (block authority is deduped per block id so a queue spanning
   * many homes in one block resolves that block's hierarchy once). Each entry carries the
   * owner's username, the block name, and the authenticated preview URL so the moderator can
   * view the image before approving or rejecting. A member never receives a pending row for a
   * block they cannot moderate.
   * @param memberId id of the moderator loading the queue
   */
  public async getModerationQueue(memberId: number): Promise<Array<{
    placeId: number;
    ownerUsername: string;
    homeName: string;
    blockName: string;
    imageUrl: string;
    revision: string;
  }>> {
    const rows = await this.homeRepository.findPendingImageHomes();
    const isAdmin = await this.memberService.canAdmin(memberId);
    let visibleRows = rows;
    if (!isAdmin) {
      // Resolve block authority once per distinct block, then keep only rows the moderator is
      // authorized for. Rows whose block cannot be resolved (blockId null) are never visible
      // to a non-admin.
      const decisionByBlock = new Map<number, boolean>();
      const allowed: any[] = [];
      for (const row of rows) {
        if (row.blockId === null || typeof row.blockId === 'undefined') {
          continue;
        }
        if (!decisionByBlock.has(row.blockId)) {
          decisionByBlock.set(
            row.blockId,
            await this.blockService.canAdmin(row.blockId, memberId),
          );
        }
        if (decisionByBlock.get(row.blockId)) {
          allowed.push(row);
        }
      }
      visibleRows = allowed;
    }
    return visibleRows.map(row => ({
      placeId: row.placeId,
      ownerUsername: row.ownerUsername,
      homeName: row.homeName,
      blockName: row.blockName,
      // The pending image is private; moderators load it through the authenticated preview
      // endpoint (relative to /api), never a public static URL.
      imageUrl: `/home/moderation/${row.placeId}/image`,
      // Bound to the moderator's approve/reject so it acts on the exact revision reviewed.
      revision: row.revision,
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
    if (!home || !home.image || home.image_status !== 'pending' || !home.image_revision) {
      return null;
    }
    const filePath = this.pendingImagePath(homePlaceId, home.image_revision);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return filePath;
  }

  /**
   * Approves a home's pending image, making it publicly visible - but ONLY the exact
   * revision the moderator reviewed. The whole check runs under the home's row lock, so it is
   * serialized against any concurrent upload/reject/reset. If the owner has replaced the
   * image since the moderator loaded the queue (the current revision no longer matches the
   * reviewed one), the approval is refused with a 409 conflict and nothing is published, so a
   * moderator can never inadvertently publish an unreviewed image. The reviewed revision's
   * bytes are published into the canonical public file with an atomic rename; the private
   * copy is removed only after the transaction commits.
   * @param homePlaceId id of the home's place record
   * @param checkerMemberId id of the moderator approving the image
   * @param reviewedRevision revision token the moderator reviewed (from the queue listing)
   */
  public async approveHomeImage(
    homePlaceId: number,
    checkerMemberId: number,
    reviewedRevision: string,
  ): Promise<void> {
    if (typeof reviewedRevision !== 'string' || reviewedRevision.length === 0) {
      throw this.conflict('Refresh the image queue and check this image again.');
    }

    let approvedRevision: string;
    try {
      await this.homeRepository.runInTransaction(async trx => {
        const home = await this.homeRepository.lockHome(trx, homePlaceId);
        if (!home || !home.image || home.image_status !== 'pending' || !home.image_revision) {
          throw new Error('No pending image to approve.');
        }
        if (home.image_revision !== reviewedRevision) {
          throw this.conflict('This image changed since you reviewed it. Refresh and re-check.');
        }
        if (!fs.existsSync(this.pendingImagePath(homePlaceId, home.image_revision))) {
          throw new Error('Pending image file is missing.');
        }

        // Publish the reviewed revision, then record the approval. Publishing writes the public
        // file before the DB commit and the filesystem is not transactional, so if the update
        // or commit then fails we must remove that published file (see the catch below) - it
        // would otherwise be served while the record is still pending.
        this.publishApprovedImage(homePlaceId, home.image_revision);
        await this.homeRepository.updateWithin(trx, homePlaceId, {
          image_status: 'approved',
          image_checked_by: checkerMemberId,
          image_checked_at: new Date(),
        });
        approvedRevision = home.image_revision;
      });
    } catch (error) {
      // The approval did not commit. If publishing had already written the public file, the
      // rollback left it live while the row is still pending - remove it, but only while the
      // home is still pending exactly this revision so a concurrent op's file is never touched.
      await this.deletePublicImageIfState(homePlaceId, 'pending', reviewedRevision).catch(
        cleanupError => console.error('home image approve: rollback cleanup failed', cleanupError),
      );
      throw error;
    }

    // Committed: the reviewed revision is public. Remove its now-redundant private copy.
    // Best-effort - the approval already succeeded, so a failed unlink must not report an error.
    try {
      this.deletePendingRevisionFile(homePlaceId, approvedRevision);
    } catch (error) {
      console.error('home image approve: removing published private copy failed', error);
    }
  }

  /**
   * Rejects a home's pending image: clears the image record and deletes the file so the
   * owner must upload a new one. Runs under the home's row lock and is bound to the exact
   * revision the moderator reviewed, so a rejection of one image can never clear or delete a
   * different image the owner uploaded in the meantime (that returns a 409 conflict instead).
   * @param homePlaceId id of the home's place record
   * @param checkerMemberId id of the moderator rejecting the image
   * @param reviewedRevision revision token the moderator reviewed (from the queue listing)
   */
  public async rejectHomeImage(
    homePlaceId: number,
    checkerMemberId: number,
    reviewedRevision: string,
  ): Promise<void> {
    if (typeof reviewedRevision !== 'string' || reviewedRevision.length === 0) {
      throw this.conflict('Refresh the image queue and check this image again.');
    }

    let rejectedRevision: string;
    await this.homeRepository.runInTransaction(async trx => {
      const home = await this.homeRepository.lockHome(trx, homePlaceId);
      if (!home || !home.image || home.image_status !== 'pending' || !home.image_revision) {
        throw new Error('No pending image to reject.');
      }
      if (home.image_revision !== reviewedRevision) {
        throw this.conflict('This image changed since you reviewed it. Refresh and re-check.');
      }
      rejectedRevision = home.image_revision;
      await this.homeRepository.updateWithin(trx, homePlaceId, {
        image: null,
        image_status: 'rejected',
        image_revision: null,
        image_checked_by: checkerMemberId,
        image_checked_at: new Date(),
      });
    });

    // Committed: delete the rejected private file (immutable, revision-specific) and, via the
    // state guard, any public copy - but only while the home is still rejected, so a later
    // upload/approval's public file is never removed. Best-effort so cleanup can't fail the call.
    try {
      this.deletePendingRevisionFile(homePlaceId, rejectedRevision);
      await this.deletePublicImageIfState(homePlaceId, 'rejected', null);
    } catch (error) {
      console.error('home image reject: cleanup failed', error);
    }
  }
}
