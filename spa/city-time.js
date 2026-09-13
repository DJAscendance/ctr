/**
 * City Time, in the shape the Mall's own clocks ask for.
 *
 * shopping.wrl carries two Scripts -- PROTO DayNight (the sky) and PROTO
 * AnalogClock (the atrium clock) -- and both start with
 *
 *   Browser.createVrmlFromURL(scriptUrl, self, 'receive')
 *   function receive(v,t){ min = v[0].min; hour = v[0].hour + 2; ... }
 *
 * so the answer has to be VRML whose FIRST root node exposes `min` and `hour`.
 * The historical scriptUrl was cybertown.com/cgi-bin/games/vrmltime.pl. That
 * host is gone, the fetch fails, `receive` never runs, and on X_ITE 16.2.0 the
 * hands sit frozen at 12:00 while the sky never cycles.
 *
 * THE `+ 2`. The worlds are left as authored, including that addition, so this
 * module answers with City Time MINUS two hours and the Mall's own arithmetic
 * lands back on City Time. City Time is America/New_York -- the same definition
 * the page chrome uses (src/components/Clock.vue). One source, one answer, and
 * no second clock system.
 *
 * Plain CommonJS: server.js is run directly by node and is never compiled.
 */

const CITY_TIME_ZONE = "America/New_York";

/** What the world is asked to add back on. Authored into both Mall Scripts. */
const WORLD_HOUR_OFFSET = 2;

/** City Time right now, as whole hours 0-23 and whole minutes 0-59. */
function cityTime(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone: CITY_TIME_ZONE,
  }).formatToParts(now || new Date());
  const read = type => Number(parts.find(part => part.type === type).value);
  // hour12:false still reports midnight as "24" in some ICU builds.
  return { hour: read("hour") % 24, minute: read("minute") };
}

/**
 * The hour to put on the wire so the world's `+ 2` produces `cityHour`.
 * Kept as its own function because it is the whole contract with the world.
 */
function authoredHour(cityHour) {
  return (cityHour - WORLD_HOUR_OFFSET + 24) % 24;
}

/**
 * The VRML the Mall's Scripts parse. A PROTO instance rather than a bare Script
 * node, because VRML97 allows an exposedField on a PROTO interface and not on a
 * Script, and `v[0].min` has to read one.
 */
function cityTimeVrml(now) {
  const { hour, minute } = cityTime(now);
  return [
    "#VRML V2.0 utf8",
    "# CTR City Time. Generated per request by spa/server.js.",
    "PROTO CityTime [",
    "  exposedField SFFloat hour 0",
    "  exposedField SFFloat min 0",
    "] { Group {} }",
    `CityTime { hour ${authoredHour(hour)} min ${minute} }`,
    "",
  ].join("\n");
}

module.exports = {
  CITY_TIME_ZONE,
  WORLD_HOUR_OFFSET,
  cityTime,
  authoredHour,
  cityTimeVrml,
};
