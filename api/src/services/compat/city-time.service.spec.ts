import { CityTimeService, CITY_TIME_ZONE } from './city-time.service';

describe('CityTimeService', () => {

  const service = new CityTimeService();

  describe('getCityTime', () => {

    it('reports the wall clock in the City Time zone, not UTC', () => {
      // 2026-07-04T16:30:45Z is 12:30:45 in New York (EDT, UTC-4).
      const time = service.getCityTime(new Date('2026-07-04T16:30:45Z'));
      expect(time).toEqual({
        hour: 12,
        minute: 30,
        second: 45,
        timeZone: CITY_TIME_ZONE,
      });
    });

    it('follows daylight saving into standard time', () => {
      // Same UTC instant in January is 11:30 in New York (EST, UTC-5).
      const time = service.getCityTime(new Date('2026-01-04T16:30:45Z'));
      expect(time.hour).toBe(11);
      expect(time.minute).toBe(30);
    });

    it('reports midnight as hour 0, never hour 24', () => {
      // 05:00Z on a July day is 01:00 EDT; 04:00Z is midnight EDT.
      const time = service.getCityTime(new Date('2026-07-04T04:00:00Z'));
      expect(time.hour).toBe(0);
    });

    it('keeps the whole day inside the 0-23 hour range', () => {
      for (let offset = 0; offset < 24; offset += 1) {
        const at = new Date(Date.UTC(2026, 6, 4, offset, 0, 0));
        const time = service.getCityTime(at);
        expect(time.hour).toBeGreaterThanOrEqual(0);
        expect(time.hour).toBeLessThanOrEqual(23);
      }
    });

    it('defaults to the current instant', () => {
      const time = service.getCityTime();
      const expected = service.getCityTime(new Date());
      expect(time.hour).toBe(expected.hour);
    });
  });

  describe('toVrml', () => {

    const time = { hour: 12, minute: 30, second: 45, timeZone: CITY_TIME_ZONE };

    it('produces a VRML 2.0 document', () => {
      expect(service.toVrml(time).startsWith('#VRML V2.0 utf8')).toBe(true);
    });

    /*
     * The legacy clocks read v[0].hour / v[0].min / v[0].sec off the first root
     * node, so the field names and their placement are the contract.
     */
    it('carries hour, min and sec on the single root node', () => {
      expect(service.toVrml(time)).toContain('CityTime { hour 12 min 30 sec 45 }');
    });

    it('declares the fields as readable exposedFields', () => {
      const vrml = service.toVrml(time);
      expect(vrml).toContain('exposedField SFFloat hour');
      expect(vrml).toContain('exposedField SFFloat min');
      expect(vrml).toContain('exposedField SFFloat sec');
    });

    it('names no dead host', () => {
      expect(service.toVrml(time)).not.toContain('cybertown.com');
    });

    it('round-trips whatever getCityTime reports', () => {
      const now = service.getCityTime(new Date('2026-07-04T16:30:45Z'));
      expect(service.toVrml(now)).toContain(`hour ${now.hour} min ${now.minute} sec ${now.second}`);
    });
  });
});
