import { Service } from 'typedi';

import {
  MemberRepository,
  PlaceRepository,
  ObjectInstanceRepository,
  RoleRepository,
  RoleAssignmentRepository,
  VirtualPetRepository,
  MessageRepository,
  InboxRepository,
  MessageboardRepository,
  VoteRepository,
  MapLocationRepository,
  HomeRepository,
  ClubMemberRepository,
} from '../../repositories';
import { Place, ObjectInstance } from '../../types/models';
import { RoleAssignmentService } from '../role-assignment/role-assignment.service';

/** Service for dealing with blocks */
@Service()
export class PlaceService {
  constructor(
    private memberRepository: MemberRepository,
    private placeRepository: PlaceRepository,
    private objectInstanceRepository: ObjectInstanceRepository,
    private roleRepository: RoleRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private virtualPetRepository: VirtualPetRepository,
    private messageRepository: MessageRepository,
    private inboxRepository: InboxRepository,
    private messageboardRepository: MessageboardRepository,
    private voteRepository: VoteRepository,
    private mapLocationRepository: MapLocationRepository,
    private homeRepository: HomeRepository,
    private clubMemberRepository: ClubMemberRepository,
    private roleAssignmentService: RoleAssignmentService,
  ) { }

  public async canAdmin(slug: string, placeId: number, memberId: number):
    Promise<boolean> {
    // One awaited barrier for the whole method. The slug-specific branches below each need
    // a different subset, so they are all named here rather than re-awaiting per branch.
    const roleMap = await this.roleRepository.awaitRoleMap(
      'Admin',
      'PlacesChief',
      'ClubOwner',
      'ClubAssistant',
      'CityCouncil',
      'SeniorCityGuide',
      'CityGuide',
    );
    const placeRoleId = await this.findRoleIdsBySlug(slug);
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);

    //check club admin ability
    if (slug === 'personalclub') {
      if (
        roleAssignments.find(assignment => {
          return (
            [
              roleMap.Admin,
            ].includes(assignment.role_id) ||
            ([
              roleMap.ClubOwner,
              roleMap.ClubAssistant,
              placeRoleId.deputy,
            ].includes(assignment.role_id) &&
              assignment.place_id === placeId)
          );
        })
      ) {
        return true;
      }
    }
    if (slug === 'cityhall') {
      if (
        roleAssignments.find(assignment => {
          return (
            [
              roleMap.CityCouncil,
            ].includes(assignment.role_id)
          );
        })) {
        return true;
      }
    }
    if (slug === 'newcomers') {
      if (
        roleAssignments.find(assignment => {
          return (
            [
              roleMap.SeniorCityGuide,
              roleMap.CityGuide,
            ].includes(assignment.role_id)
          );
        })) {
        return true;
      }
    }

    //check if admin even if there is no assigned roles for the place
    if (!placeRoleId) {
      if (
        roleAssignments.find(assignment => {
          return (
            [
              roleMap.Admin,
            ].includes(assignment.role_id)
          );
        })
      ) {
        return true;
      }
    }

    //check if worker or admin with an assigned roles for the place
    if (placeRoleId) {
      if (
        roleAssignments.find(assignment => {
          return (
            [
              roleMap.Admin,
              roleMap.PlacesChief,
            ].includes(assignment.role_id) ||
            ([
              placeRoleId.owner,
              placeRoleId.deputy,
            ].includes(assignment.role_id) &&
              assignment.place_id === placeId)
          );
        })
      ) {
        return true;
      }
    }
    return false;
  }

  public async canManageAccess(slug: string, placeId: number, memberId: number): Promise<boolean> {
    const roleMap = await this.roleRepository.awaitRoleMap('Admin', 'PlacesChief');
    const placeRoleId = await this.findRoleIdsBySlug(slug);
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);
    //if no roles assignable, access rights is closed to all
    if (!placeRoleId) return false;

    if (
      roleAssignments.find(assignment => {
        return (
          [
            roleMap.Admin,
            roleMap.PlacesChief,
          ].includes(assignment.role_id) ||
          ([placeRoleId.owner].includes(assignment.role_id) &&
            assignment.place_id === placeId)
        );
      })
    ) {
      return true;
    }
    return false;
  }

  public async findById(placeId: number): Promise<Place> {
    return await this.placeRepository.findById(placeId);
  }

  public async findBySlug(slug: string): Promise<Place> {
    return await this.placeRepository.findBySlug(slug);
  }

  public async getPlaceObjects(placeId: number): Promise<ObjectInstance[]> {
    return await this.objectInstanceRepository.findByPlaceId(placeId);
  }

  public async getOwnedPlaces(userId: number): Promise<any> {
    return await this.placeRepository.findByUserId(userId);
  }

  public async getLiveEventDestinations(): Promise<any[]> {
    return this.placeRepository.findLiveEventDestinations();
}

  public async removeVirtualPet(id: number): Promise<any> {
    await this.virtualPetRepository.removeVirtualPet(id);
  }

  public async removePlace(id: number): Promise<any> {
    await this.clubMemberRepository.removeAllMembers(id);
    await this.roleAssignmentRepository.removeRoleAssignment(id);
    await this.messageRepository.removeAllPlaceMessages(id);
    await this.inboxRepository.removeAllPlaceMessages(id);
    await this.messageboardRepository.removeAllPlaceMessages(id);
    await this.voteRepository.removePlace(id);
    await this.placeRepository.removePlace(id);
    await this.homeRepository.removePlace(id);
    await this.mapLocationRepository.removePlace(id);
  }

  public async getAccessInfoByUsername(slug: string, placeId: number): Promise<object> {
    const placeRoleId = await this.findRoleIdsBySlug(slug);
    return await this
      .roleAssignmentRepository
      .getAccessInfoByUsername(placeId, placeRoleId.owner, placeRoleId.deputy);
  }

  public async getSecurityInfo(): Promise<object> {
    const SecurityInfo = {};
    const securityRoles = [
      { mapName: 'SecurityChief', roleName: 'Security Chief' },
      { mapName: 'DeputySecurityChief', roleName: 'Deputy Security Chief' },
      { mapName: 'SecurityCaptain', roleName: 'Security Captain' },
      { mapName: 'SecurityLieutenant', roleName: 'Security Lieutenant' },
      { mapName: 'SecuritySergeant', roleName: 'Security Sergeant' },
      { mapName: 'SecurityOfficer', roleName: 'Security Officer' },
      { mapName: 'JailGuard', roleName: 'Jail Guard' },
    ];
    try {
      // Every mapName is named as required, so a snapshot taken between the role seeds is
      // re-read rather than resolving a security office to undefined -- which
      // getUsernamesByRoleId would then send to knex as an undefined binding.
      const roleMap = await this.roleRepository.awaitRoleMap(
        ...securityRoles.map(role => role.mapName),
      );
      for (const role of securityRoles) {
        const roleCode = roleMap[role.mapName];
        const response = await this.roleAssignmentRepository.getUsernamesByRoleId(roleCode);
        const users = [];

        response.forEach(row => {
          users.push(row.username);
        });
        SecurityInfo[role.roleName] = users;
      }
    } catch (error) {
      console.error(error);
    }
    return SecurityInfo;
  }

  public async addStorage(name: string, memberId: number): Promise<any> {
    await this.placeRepository.create({ name: name, type: 'storage', member_id: memberId });
  }

  public async deleteStorage(id: number): Promise<any> {
    await this.placeRepository.deleteStorageArea(id);
  }

  public async postAccessInfo(
    slug: string,
    placeId: number,
    givenDeputies: any,
    givenOwner: string): Promise<void> {
    const placeRoleId = await this.findRoleIdsBySlug(slug);
    /**
     * old is coming from database
     * new is coming from access rights page
     */
    const deputyCode = placeRoleId.deputy;
    const ownerCode = placeRoleId.owner;
    let oldOwner = null;
    let newOwner = 0;
    const data = await this
      .roleAssignmentRepository
      .getAccessInfoByID(placeId, ownerCode, deputyCode);
    if (data.owner.length > 0) {
      oldOwner = data.owner[0].member_id;
    } else {
      oldOwner = 0;
    }
    if (givenOwner !== null && givenOwner !== '') {
      const result = await this.memberRepository.findIdByUsername(givenOwner);
      if (Array.isArray(result) && result.length > 0 && result[0].id) {
        newOwner = result[0].id;
      }
    }
    // 'jail' and 'cityhall' have an owner role but no deputy role, so findRoleIdsBySlug
    // returns deputy: undefined for them. Resolving deputies for such a place is pointless
    // work, and syncPlaceAccess skips the deputy half when no deputy role is given -- but it
    // still performs the owner swap and the reconciliation, which those places do need.
    const hasDeputyRole = deputyCode !== undefined && deputyCode !== null;
    const oldDeputyIds = hasDeputyRole ? data.deputies.map(deputy => deputy.member_id) : [];
    const newDeputyIds: number[] = [];
    if (hasDeputyRole) {
      for (const givenDeputy of givenDeputies) {
        newDeputyIds.push(await this.updateDeputyId(givenDeputy));
      }
    }
    // Owner swap, deputy set and reconciliation are one sequence whose ORDER matters, so it
    // lives in RoleAssignmentService rather than being re-implemented per place type.
    await this.roleAssignmentService.syncPlaceAccess({
      placeId,
      ownerRoleId: ownerCode,
      deputyRoleId: deputyCode,
      oldOwnerId: oldOwner,
      newOwnerId: newOwner,
      oldDeputyIds,
      newDeputyIds,
    });
  }

  public async updatePlaces(placeinfo: any): Promise<void> {
    return await this.placeRepository.updatePlaces(placeinfo);
  }

  /**
   * The office roles that own and deputise each place slug, as NAMES.
   *
   * Names rather than ids because ids come from auto-increment insert order in
   * roles_data.json, and because names are what awaitRoleMap needs in order to tell a role
   * that does not exist from one the seeds have not inserted yet.
   *
   * `deputy` is absent, not undefined, where a slug genuinely has no deputy office: 'jail'
   * and 'cityhall' have an owner role only. The old signature promised a number for every
   * slug, which is how an undefined deputy role reached a role_assignment write.
   */
  private static readonly OFFICE_NAMES_BY_SLUG:
    Record<string, { owner: string, deputy?: string }> = {
      bank: { owner: 'BankManager', deputy: 'BankCashier' },
      clubdir: { owner: 'ClubsChief', deputy: 'ClubsDeputy' },
      employment: { owner: 'EmploymentChief', deputy: 'EmploymentDeputy' },
      eplex: { owner: 'ePlexChief', deputy: 'ePlexDeputy' },
      fleamarket: { owner: 'FleaMarketChief', deputy: 'FleaMarketDeputy' },
      mall: { owner: 'MallManager', deputy: 'MallDeputy' },
      outlands: { owner: 'OutlandsChief', deputy: 'OutlandsDeputy' },
      postoffice: { owner: 'PostOfficeManager', deputy: 'PostOfficeDeputy' },
      beach: { owner: 'SunsetBeachChief', deputy: 'SunsetBeachDeputy' },
      waterpark: { owner: 'WaterParkChief', deputy: 'WaterParkDeputy' },
      themepark: { owner: 'ThemeParkChief', deputy: 'ThemeParkDeputy' },
      theatre: { owner: 'TheatreChief', deputy: 'TheatreDeputy' },
      pool: { owner: 'PoolChief', deputy: 'PoolDeputy' },
      blackmarket: { owner: 'BlackMarketChief', deputy: 'BlackMarketDeputy' },
      jail: { owner: 'SecurityChief' },
      personalclub: { owner: 'ClubOwner', deputy: 'ClubAssistant' },
      newcomers: { owner: 'SeniorCityGuide', deputy: 'CityGuide' },
      funpark: { owner: 'FunParkChief', deputy: 'FunParkDeputy' },
      cityhall: { owner: 'CityCouncil' },
    };

  /**
   * Resolves a slug's office roles to ids, or undefined for a slug with no offices at all.
   *
   * Undefined is a real answer here and all four callers already test for it -- `canAdmin`
   * treats it as "no place-specific roles, global Admin only". It is in the signature so
   * that stays visible.
   *
   * This is the single place every slug's role codes are resolved, so the awaited barrier
   * here is what keeps all four callers off the unpopulated map. Only the one slug's own
   * offices are named as required, which is both cheaper and more precise than demanding
   * the whole table for a lookup that returns one row of it.
   */
  private async findRoleIdsBySlug(slug: string):
    Promise<{ owner: number, deputy?: number } | undefined> {
    const names = PlaceService.OFFICE_NAMES_BY_SLUG[slug];
    if (!names) return undefined;

    const roleMap = await this.roleRepository.awaitRoleMap(
      ...(names.deputy ? [names.owner, names.deputy] : [names.owner]),
    );
    return names.deputy
      ? { owner: roleMap[names.owner], deputy: roleMap[names.deputy] }
      : { owner: roleMap[names.owner] };
  }

  private async updateDeputyId(deputy: any): Promise<number> {
    let newDeputies = 0;
    if (deputy.username !== null && deputy.username !== '') {
      const result = await this.memberRepository.findIdByUsername(deputy.username);
      if (Array.isArray(result) && result.length > 0 && result[0].id) {
        newDeputies = result[0].id;
      }
    }
    return newDeputies;
  }

  public async findUserPlaces(id: number, type: string): Promise<any> {
    let returnPlaces = [];
    const places = await this.placeRepository.findUserPlaces(id, type);
    returnPlaces = places;
    const total = await this.placeRepository.getUserPlaceTotal(id, type);
    return {
      places: returnPlaces,
      total: total,
    };
  }

  public async searchAllPlaces(
    search: string,
    compare: string,
    type: string,
    limit: number,
    offset: number): Promise<any> {
    const ownerRequired = ['home', 'club', 'storage'];
    let returnPlaces = [];
    const places = await this.placeRepository.searchAllPlaces(
      search, compare, type, limit, offset);
    if (ownerRequired.includes(type)) {
      for (const place of places) {
        const user = await this.memberRepository.findById(place.member_id);
        place.username = user.username;
        returnPlaces.push(place);
      }
    } else {
      returnPlaces = places;
    }
    const total = await this.placeRepository.getSearchTotal(search, compare, type);
    return {
      places: returnPlaces,
      total: total,
    };
  }

  public async addVirtualPet(placeId: number): Promise<any> {
    const name = 'VirtualPet';
    const avatar = '/assets/pets/dog/dog.wrl';
    const behaviours = [
      {
        id: 0, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 1, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 2, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 3, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 4, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 5, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 6, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 7, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 8, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
      {
        id: 9, match: 'exact', directly: false, input: '',
        whisper: false, beam: false, output: '',
      },
    ];
    return await this.virtualPetRepository
      .addVirtualPet(placeId, name, avatar, JSON.stringify(behaviours));
  }

  public async getVirtualPet(placeId: number): Promise<any> {
    const virtualPet = await this.virtualPetRepository.getVirtualPet(placeId);
    return virtualPet;
  }

  public async updateVirtualPet(
    placeId: number,
    name: string,
    avatar: string,
    active: boolean,
    voice: number,
    behaviours: string): Promise<any> {
    await this.virtualPetRepository.updateVirtualPet(
      placeId,
      name,
      avatar,
      active,
      voice,
      behaviours);
  }
}
