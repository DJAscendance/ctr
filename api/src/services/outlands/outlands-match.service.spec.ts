/*
 * Importing the repository barrel eagerly constructs a real knex instance, and
 * this project ships no knex configuration for the test environment. These specs
 * only ever exercise mocked repositories, so the db module is stubbed out before
 * anything can pull the real one in.
 */
jest.mock('../../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mockDb } = require('@spec/mocks');
  return { db: mockDb, knex: mockDb.knex };
});

import bcrypt from 'bcrypt';
import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { OutlandsMatchService } from './outlands-match.service';
import {
  OutlandsMatchRepository,
  PlaceRepository,
  RoleAssignmentRepository,
} from '../../repositories';
import { Place } from '../../types/models';

/*
 * OUTLANDS-2B. The historical contract, from `ne_game/enter3Dpass.tmpl`:
 *
 *   T_pass == PASS1  ->  Blue Team,  vrmlmyavatar .../bluem|bluef.wrl?pass=...
 *   T_pass == PASS2  ->  Red  Team,  vrmlmyavatar .../redm|redf.wrl?pass=...
 *   neither          ->  3dscene .../boot.wrl, back to the entrance
 *
 * and the SET PASSWORDS form of `ne_game/passupdate.tmpl`, which was reachable
 * `#ifdef isAdmin`. Ryan's modern policy adds the Outlands Chief as the primary
 * Outlands authority; the Deputy gets nothing in this lane.
 *
 * Every password below is an obvious dummy. None of them is shipped anywhere.
 */
const BLUE_TEST_ONLY = 'BLUE_TEST_ONLY';
const RED_TEST_ONLY = 'RED_TEST_ONLY';
const WRONG_TEST_ONLY = 'WRONG_TEST_ONLY';

describe('OutlandsMatchService', () => {
  const OUTLANDS_ID = 7;
  const OTHER_PLACE_ID = 8;
  const MEMBER_ID = 500;

  let outlandsMatchRepository: jest.Mocked<OutlandsMatchRepository>;
  let placeRepository: jest.Mocked<PlaceRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let service: OutlandsMatchService;

  /** Store real bcrypt hashes, so the comparison under test is the real one. */
  const givenPasswords = async (blue: string | null, red: string | null): Promise<void> => {
    outlandsMatchRepository.findHashesByPlaceId.mockResolvedValue({
      blue: blue === null ? null : await bcrypt.hash(blue, 10),
      red: red === null ? null : await bcrypt.hash(red, 10),
    });
  };

  /** Points the member's role assignments at the given list for this test. */
  const givenRoles = (roles: Array<{ name: string; place_id: number | null }>): void => {
    roleAssignmentRepository.getRoleNameAndIdByMemberId.mockResolvedValue(roles);
  };

  beforeEach(() => {
    outlandsMatchRepository = createSpyObj(OutlandsMatchRepository);
    placeRepository = createSpyObj(PlaceRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);

    placeRepository.findBySlug.mockResolvedValue({ id: OUTLANDS_ID, slug: 'outlands' } as Place);
    outlandsMatchRepository.findHashesByPlaceId.mockResolvedValue({ blue: null, red: null });
    outlandsMatchRepository.saveHashes.mockResolvedValue(undefined);
    givenRoles([]);

    Container.reset();
    Container.set(OutlandsMatchRepository, outlandsMatchRepository);
    Container.set(PlaceRepository, placeRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    service = Container.get(OutlandsMatchService);
  });

  describe('resolveTeam', () => {
    it('gives Blue for PASS1 and Red for PASS2', async () => {
      await givenPasswords(BLUE_TEST_ONLY, RED_TEST_ONLY);

      await expect(service.resolveTeam(OUTLANDS_ID, BLUE_TEST_ONLY)).resolves.toBe('blue');
      await expect(service.resolveTeam(OUTLANDS_ID, RED_TEST_ONLY)).resolves.toBe('red');
    });

    it('refuses a password that matches neither', async () => {
      await givenPasswords(BLUE_TEST_ONLY, RED_TEST_ONLY);

      await expect(service.resolveTeam(OUTLANDS_ID, WRONG_TEST_ONLY)).resolves.toBeNull();
    });

    it('refuses a blank, absent or oversized password', async () => {
      await givenPasswords(BLUE_TEST_ONLY, RED_TEST_ONLY);

      await expect(service.resolveTeam(OUTLANDS_ID, '')).resolves.toBeNull();
      await expect(service.resolveTeam(OUTLANDS_ID, null as any)).resolves.toBeNull();
      await expect(service.resolveTeam(OUTLANDS_ID, undefined as any)).resolves.toBeNull();
      await expect(service.resolveTeam(OUTLANDS_ID, 'x'.repeat(129))).resolves.toBeNull();
    });

    it('is case sensitive and does not accept a prefix', async () => {
      await givenPasswords(BLUE_TEST_ONLY, RED_TEST_ONLY);

      await expect(service.resolveTeam(OUTLANDS_ID, 'blue_test_only')).resolves.toBeNull();
      await expect(service.resolveTeam(OUTLANDS_ID, 'BLUE_TEST')).resolves.toBeNull();
      await expect(service.resolveTeam(OUTLANDS_ID, `${BLUE_TEST_ONLY} `)).resolves.toBeNull();
    });

    it('refuses everything when no match is scheduled', async () => {
      await givenPasswords(null, null);

      await expect(service.resolveTeam(OUTLANDS_ID, BLUE_TEST_ONLY)).resolves.toBeNull();
      await expect(service.resolveTeam(OUTLANDS_ID, '')).resolves.toBeNull();
    });

    it('still resolves the team that is set when the other is not', async () => {
      await givenPasswords(null, RED_TEST_ONLY);

      await expect(service.resolveTeam(OUTLANDS_ID, RED_TEST_ONLY)).resolves.toBe('red');
      await expect(service.resolveTeam(OUTLANDS_ID, BLUE_TEST_ONLY)).resolves.toBeNull();
    });

    it('compares both teams even when the first already matched', async () => {
      // The work done must not depend on which password was typed, or a refusal
      // becomes a timing oracle for "that was the Blue one".
      await givenPasswords(BLUE_TEST_ONLY, RED_TEST_ONLY);
      const spy = jest.spyOn(bcrypt, 'compare');

      await service.resolveTeam(OUTLANDS_ID, BLUE_TEST_ONLY);

      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it('still costs a comparison when a team has no password', async () => {
      await givenPasswords(null, null);
      const spy = jest.spyOn(bcrypt, 'compare');

      await service.resolveTeam(OUTLANDS_ID, WRONG_TEST_ONLY);

      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    it('refuses rather than throwing when a stored hash is malformed', async () => {
      outlandsMatchRepository.findHashesByPlaceId.mockResolvedValue({
        blue: 'not-a-bcrypt-hash',
        red: null,
      });

      await expect(service.resolveTeam(OUTLANDS_ID, BLUE_TEST_ONLY)).resolves.toBeNull();
    });
  });

  describe('getStatus', () => {
    it('reports which teams are configured, and never a value', async () => {
      await givenPasswords(BLUE_TEST_ONLY, null);

      const status = await service.getStatus(OUTLANDS_ID);

      expect(status).toEqual({ blueSet: true, redSet: false });
      expect(JSON.stringify(status)).not.toContain(BLUE_TEST_ONLY);
      expect(JSON.stringify(status)).not.toContain('$2b$');
    });
  });

  describe('setPasswords', () => {
    it('stores a hash, never the typed password', async () => {
      await service.setPasswords(OUTLANDS_ID, MEMBER_ID, { blue: BLUE_TEST_ONLY });

      const [, hashes] = outlandsMatchRepository.saveHashes.mock.calls[0];
      expect(hashes.blue).not.toBe(BLUE_TEST_ONLY);
      expect(hashes.blue).toMatch(/^\$2[aby]\$/);
      await expect(bcrypt.compare(BLUE_TEST_ONLY, hashes.blue as string)).resolves.toBe(true);
    });

    it('leaves a team alone when its value is absent', async () => {
      await givenPasswords(BLUE_TEST_ONLY, RED_TEST_ONLY);
      const before = await outlandsMatchRepository.findHashesByPlaceId(OUTLANDS_ID);

      await service.setPasswords(OUTLANDS_ID, MEMBER_ID, { red: RED_TEST_ONLY });

      const [, hashes] = outlandsMatchRepository.saveHashes.mock.calls[0];
      expect(hashes.blue).toBe(before.blue);
    });

    it('clears a team when its value is null or empty - the match stands down', async () => {
      await givenPasswords(BLUE_TEST_ONLY, RED_TEST_ONLY);

      const status = await service.setPasswords(
        OUTLANDS_ID, MEMBER_ID, { blue: null, red: '' });

      const [, hashes] = outlandsMatchRepository.saveHashes.mock.calls[0];
      expect(hashes).toEqual({ blue: null, red: null });
      expect(status).toEqual({ blueSet: false, redSet: false });
    });

    it('records who made the change', async () => {
      await service.setPasswords(OUTLANDS_ID, MEMBER_ID, { blue: BLUE_TEST_ONLY });

      const [placeId, , memberId] = outlandsMatchRepository.saveHashes.mock.calls[0];
      expect(placeId).toBe(OUTLANDS_ID);
      expect(memberId).toBe(MEMBER_ID);
    });

    it('produces a different hash for the same password each time', async () => {
      await service.setPasswords(OUTLANDS_ID, MEMBER_ID, { blue: BLUE_TEST_ONLY });
      await service.setPasswords(OUTLANDS_ID, MEMBER_ID, { blue: BLUE_TEST_ONLY });

      const first = outlandsMatchRepository.saveHashes.mock.calls[0][1].blue;
      const second = outlandsMatchRepository.saveHashes.mock.calls[1][1].blue;
      expect(first).not.toBe(second);
    });
  });

  describe('canAdministerMatch', () => {
    it('allows the Outlands Chief at the Outlands place', async () => {
      givenRoles([{ name: 'Outlands Chief', place_id: OUTLANDS_ID }]);

      await expect(service.canAdministerMatch(MEMBER_ID, OUTLANDS_ID)).resolves.toBe(true);
    });

    it('allows a global Admin', async () => {
      givenRoles([{ name: 'Admin', place_id: null }]);

      await expect(service.canAdministerMatch(MEMBER_ID, OUTLANDS_ID)).resolves.toBe(true);
    });

    it('refuses the Outlands Deputy - OUTLANDS-2B defines no Deputy powers', async () => {
      givenRoles([{ name: 'Outlands Deputy', place_id: OUTLANDS_ID }]);

      await expect(service.canAdministerMatch(MEMBER_ID, OUTLANDS_ID)).resolves.toBe(false);
    });

    it('refuses an Outlands Chief assigned somewhere else', async () => {
      givenRoles([{ name: 'Outlands Chief', place_id: OTHER_PLACE_ID }]);

      await expect(service.canAdministerMatch(MEMBER_ID, OUTLANDS_ID)).resolves.toBe(false);
    });

    it('refuses a member with no roles, and every other role', async () => {
      givenRoles([]);
      await expect(service.canAdministerMatch(MEMBER_ID, OUTLANDS_ID)).resolves.toBe(false);

      givenRoles([
        { name: 'PlacesChief', place_id: OUTLANDS_ID },
        { name: 'Mall Manager', place_id: OUTLANDS_ID },
        { name: 'Colony Representative', place_id: null },
        { name: 'Security Chief', place_id: OUTLANDS_ID },
      ]);
      await expect(service.canAdministerMatch(MEMBER_ID, OUTLANDS_ID)).resolves.toBe(false);
    });

    it('refuses a malformed member id, place id or assignment row', async () => {
      givenRoles([{ name: 'Outlands Chief', place_id: OUTLANDS_ID }]);

      await expect(service.canAdministerMatch(0, OUTLANDS_ID)).resolves.toBe(false);
      await expect(service.canAdministerMatch(-1, OUTLANDS_ID)).resolves.toBe(false);
      await expect(service.canAdministerMatch(MEMBER_ID, 0)).resolves.toBe(false);
      await expect(service.canAdministerMatch(MEMBER_ID, NaN)).resolves.toBe(false);

      roleAssignmentRepository.getRoleNameAndIdByMemberId.mockResolvedValue(null as any);
      await expect(service.canAdministerMatch(MEMBER_ID, OUTLANDS_ID)).resolves.toBe(false);

      givenRoles([null as any, { name: undefined as any, place_id: OUTLANDS_ID }]);
      await expect(service.canAdministerMatch(MEMBER_ID, OUTLANDS_ID)).resolves.toBe(false);
    });
  });

  describe('findOutlandsPlaceId', () => {
    it('resolves the place by its slug', async () => {
      await expect(service.findOutlandsPlaceId()).resolves.toBe(OUTLANDS_ID);
      expect(placeRepository.findBySlug).toHaveBeenCalledWith('outlands');
    });

    it('returns null when the place is missing rather than guessing an id', async () => {
      placeRepository.findBySlug.mockResolvedValue(undefined as any);

      await expect(service.findOutlandsPlaceId()).resolves.toBeNull();
    });
  });
});
