import { Service } from 'typedi';

/*
 * City Time is the single civic clock Cybertown shows its citizens. The SPA
 * sidebar (spa/src/components/Clock.vue) has always rendered it as
 * `America/New_York`, so that zone -- including its daylight-saving shifts --
 * is the contract every other City Time consumer has to match.
 *
 * The historical 3D worlds asked http://www.cybertown.com/cgi-bin/games/vrmltime.pl
 * for the same value through Browser.createVrmlFromURL(). That host is gone, so
 * this service serves the replacement: a small VRML document whose single root
 * node carries `hour`, `min` and `sec`, which is exactly the shape the legacy
 * vrmlscript reads back as v[0].hour / v[0].min / v[0].sec.
 */

export const CITY_TIME_ZONE = 'America/New_York';

export interface CityTime {
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
}

@Service()
export class CityTimeService {

  // Read the wall-clock hour/minute/second in the City Time zone. Intl is used
  // rather than a fixed offset so that daylight saving is handled for us.
  getCityTime(now: Date = new Date()): CityTime {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CITY_TIME_ZONE,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now);

    const part = (type: string): number => {
      const found = parts.find((candidate) => candidate.type === type);
      return found ? Number(found.value) : 0;
    };

    // en-US formats midnight as hour 24 in some ICU builds; normalise to 0.
    const hour = part('hour') % 24;

    return {
      hour,
      minute: part('minute'),
      second: part('second'),
      timeZone: CITY_TIME_ZONE,
    };
  }

  /*
   * Render City Time as the VRML document the legacy clocks expect.
   *
   * createVrmlFromURL() hands the callback an MFNode of the file's root nodes,
   * so the values have to live on the FIRST root node as readable fields.
   */
  toVrml(time: CityTime): string {
    return [
      '#VRML V2.0 utf8',
      '# Cybertown City Time compatibility response.',
      `# Zone ${time.timeZone}. Replaces the retired vrmltime.pl service.`,
      'PROTO CityTime [',
      '  exposedField SFFloat hour 0',
      '  exposedField SFFloat min 0',
      '  exposedField SFFloat sec 0',
      '] {',
      '  Group { }',
      '}',
      `CityTime { hour ${time.hour} min ${time.minute} sec ${time.second} }`,
      '',
    ].join('\n');
  }
}
