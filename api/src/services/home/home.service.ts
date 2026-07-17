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
} from '../../repositories';
import { Place, HomeDesign, Home } from '../../types/models';

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

    const uploadDir = `${process.env.ASSETS_DIR}/homes-uploads`;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    await this.deleteExistingHomeImage(home.id, uploadDir);

    const filename = `${home.id}.webp`;
    await sharp(imageFile.data)
      .resize(HomeService.IMAGE_MAX_DIMENSION, HomeService.IMAGE_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp()
      .toFile(`${uploadDir}/${filename}`);

    await this.homeRepository.update(home.id, { image: filename });
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

    await this.deleteExistingHomeImage(home.id, `${process.env.ASSETS_DIR}/homes-uploads`);
    await this.homeRepository.update(home.id, { image: null });
  }

  /** Deletes the home's currently uploaded image file from disk, if one exists. */
  private async deleteExistingHomeImage(placeId: number, uploadDir: string): Promise<void> {
    const existingHome = await this.homeRepository.findById(placeId);
    if (existingHome?.image) {
      const existingPath = `${uploadDir}/${existingHome.image}`;
      if (fs.existsSync(existingPath)) {
        fs.unlinkSync(existingPath);
      }
    }
  }
}
