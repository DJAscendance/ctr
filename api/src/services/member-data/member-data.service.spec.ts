import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { MemberDataService } from './member-data.service';
import { MemberDataRepository } from '../../repositories';

describe('MemberDataService', () => {
  const MEMBER = 11;
  let memberDataRepository: jest.Mocked<MemberDataRepository>;
  let service: MemberDataService;

  beforeEach(() => {
    memberDataRepository = createSpyObj(MemberDataRepository);
    Container.reset();
    Container.set(MemberDataRepository, memberDataRepository);
    service = Container.get(MemberDataService);
  });

  describe('isHidden', () => {
    it('is true only for the exact stored value "1"', async () => {
      memberDataRepository.get.mockResolvedValue('1');
      expect(await service.isHidden(MEMBER)).toBe(true);
    });
    it('is false when unset', async () => {
      memberDataRepository.get.mockResolvedValue(null);
      expect(await service.isHidden(MEMBER)).toBe(false);
    });
    /** A stray truthy value must not read as hidden -- '0' is the disabled state. */
    it('is false for "0"', async () => {
      memberDataRepository.get.mockResolvedValue('0');
      expect(await service.isHidden(MEMBER)).toBe(false);
    });
    it('is false without a member id, and does not query', async () => {
      expect(await service.isHidden(0)).toBe(false);
      expect(memberDataRepository.get).not.toHaveBeenCalled();
    });
  });

  describe('setHidden', () => {
    it('stores "1" when hiding', async () => {
      await service.setHidden(MEMBER, true);
      expect(memberDataRepository.set).toHaveBeenCalledWith(MEMBER, 'IMS', '1');
    });
    /** null so the repository deletes the row: "unset" keeps one representation. */
    it('clears the attribute when unhiding', async () => {
      await service.setHidden(MEMBER, false);
      expect(memberDataRepository.set).toHaveBeenCalledWith(MEMBER, 'IMS', null);
    });
  });

  describe('getBuddySlots', () => {
    it('always returns exactly ten slots', async () => {
      memberDataRepository.getByPrefix.mockResolvedValue({});
      const slots = await service.getBuddySlots(MEMBER);
      expect(slots).toHaveLength(10);
      expect(slots.every(s => s === null)).toBe(true);
    });

    /** The slot INDEX is part of the model: a gap must not shift later slots down. */
    it('keeps slots sparse rather than compacting them', async () => {
      memberDataRepository.getByPrefix.mockResolvedValue({ BU0: 'a', BU3: 'b', BU9: 'c' });
      const slots = await service.getBuddySlots(MEMBER);
      expect(slots[0]).toBe('a');
      expect(slots[1]).toBeNull();
      expect(slots[3]).toBe('b');
      expect(slots[9]).toBe('c');
    });

    /** Guards against an out-of-range stored name corrupting the array. */
    it('ignores names outside the ten-slot range', async () => {
      memberDataRepository.getByPrefix.mockResolvedValue({ BU0: 'a', BU10: 'x', BUxx: 'y' });
      const slots = await service.getBuddySlots(MEMBER);
      expect(slots).toHaveLength(10);
      expect(slots.filter(Boolean)).toEqual(['a']);
    });

    /**
     * The suffix must be exactly one digit, checked as text. Number() is far more permissive
     * than the slot names are: '' is 0, and '01' and '1e0' are both 1. getByPrefix matches on
     * prefix, so any of these can arrive from stored data or a future non-slot BU* attribute.
     */
    it('rejects prefix matches that are not single-digit slot names', async () => {
      memberDataRepository.getByPrefix.mockResolvedValue({
        BU: 'bare prefix, Number("") is 0',
        BU01: 'leading zero, Number() reads 1',
        BU1e0: 'exponent, Number() reads 1',
        BU2: 'the only real slot here',
      });
      const slots = await service.getBuddySlots(MEMBER);
      expect(slots[0]).toBeNull();
      expect(slots[1]).toBeNull();
      expect(slots[2]).toBe('the only real slot here');
      expect(slots.filter(Boolean)).toEqual(['the only real slot here']);
    });
  });

  describe('getBuddyNameSet', () => {
    it('lowercases for case-insensitive nickname matching', async () => {
      memberDataRepository.getByPrefix.mockResolvedValue({ BU0: 'HawK', BU1: 'scott99' });
      const set = await service.getBuddyNameSet(MEMBER);
      expect(set.has('hawk')).toBe(true);
      expect(set.has('scott99')).toBe(true);
    });
    it('drops empty slots', async () => {
      memberDataRepository.getByPrefix.mockResolvedValue({ BU0: 'a', BU1: null });
      expect((await service.getBuddyNameSet(MEMBER)).size).toBe(1);
    });
  });
});
