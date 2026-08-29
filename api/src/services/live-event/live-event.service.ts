import { Service } from 'typedi';

import {
  LiveEventRepository,
  PlaceRepository,
  RoleAssignmentRepository,
  RoleRepository,
} from '../../repositories';

@Service()
export class LiveEventService {
  constructor(
    private liveEventRepository: LiveEventRepository,
    private placeRepository: PlaceRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
  ) {}

  public async getCurrent(): Promise<any> {
    const liveEvent = await this.liveEventRepository.getCurrent();

    if (!liveEvent || !liveEvent.place_id) {
      return {
        enabled: false,
        place: null,
      };
    }

    const place = await this.placeRepository.findById(liveEvent.place_id);

    return {
      enabled: liveEvent.enabled,
      place,
      updatedBy: liveEvent.updated_by,
      updatedAt: liveEvent.updated_at,
    };
  }

  public async canManage(memberId: number): Promise<boolean> {
    const roleMap = await this.roleRepository.awaitRoleMap(
      'Admin',
      'CityMayor',
      'PlacesChief',
      'ColonyRepresentative',
    );
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);

    const allowedRoles = [
      roleMap.Admin,
      roleMap.CityMayor,
      roleMap.PlacesChief,
      roleMap.ColonyRepresentative,
    ];

    return !!roleAssignments.find(
      assignment => allowedRoles.includes(assignment.role_id),
    );
  }

  public async update(
    memberId: number,
    placeId: number | null,
    enabled: boolean,
  ): Promise<void> {
    await this.liveEventRepository.update(placeId, enabled, memberId);
  }
}
