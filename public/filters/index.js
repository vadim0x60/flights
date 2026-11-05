// Custom filters. Each filter is { id, label, control, keep(itinerary, value) }.
//
// - control: { type: 'checkbox' | 'number' | 'text', default?, placeholder? }
//   renders an input in the sidebar; its current value is passed to keep().
// - keep() returns true to show the itinerary. It is only called while the
//   filter is active: checkbox checked, or number/text field non-empty.
// - remark(value, { origin, destination }) is optional. While the filter is
//   active, the text it returns (or null for none) shows under the control.
//
// Filters run in the browser on results already fetched, so changing them is
// instant and costs no API requests. Add a filter by appending to this list.
import { legs, segments, layovers, instant } from './util.js';
import { isVadimNight } from './sun.js';
import airports from './airports.js';
import { wifi, VERDICTS } from './wifi.js';

// Airports in the US, its territories and outlying islands, plus the US
// multi-airport city codes (not in airports.js) people type as an origin.
const isUsa = (code) =>
  ['NYC', 'WAS', 'CHI', 'DTT'].includes(code) ||
  ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM'].includes(airports[code]?.[2]);

export default [
  {
    id: 'max-layover',
    label: 'Max single layover (hours)',
    control: { type: 'number', placeholder: 'e.g. 3' },
    keep: (it, hours) => legs(it).every((leg) => layovers(leg).every((l) => l.minutes <= hours * 60)),
  },
  {
    id: 'max-leg-duration',
    label: 'Max journey time per leg (hours)',
    control: { type: 'number', placeholder: 'e.g. 8' },
    keep: (it, hours) => legs(it).every((leg) => leg.duration_minutes <= hours * 60),
  },
  {
    // You're awake from 40 minutes before each takeoff to 20 minutes after each
    // landing, connections included. Each leg is judged on its own: you start
    // it on its departure airport's clock and may switch once, at any point, to
    // its destination's clock, but never back. Drop the itinerary if no such
    // switch keeps every window out of Vadim night (see sun.js) on the clock
    // you're on at the time. Local time at a connecting airport doesn't matter.
    id: 'no-red-eye',
    label: 'Protect sleep',
    control: { type: 'checkbox' },
    keep: (it) => legs(it).every((leg) => {
      const [from, to] = [leg.segments[0].departure_airport, leg.segments.at(-1).arrival_airport]
        .map((code) => airports[code]);
      if (!from || !to) return true; // unknown coordinates: can't tell, so keep
      const minute = 60000;
      // A Vadim night always lasts 8 hours, so a window this short overlaps
      // one exactly when one of its two ends falls inside it.
      const windows = leg.segments.flatMap((s) => [
        [instant(s, 'departure') - 40 * minute, instant(s, 'departure')],
        [instant(s, 'arrival'), instant(s, 'arrival') + 20 * minute],
      ]);
      const awake = (w, [lat, lon]) => !w.some((ms) => isVadimNight(ms, lat, lon));
      // Staying on the departure clock as long as it works is never worse,
      // so switch at the first window it can't take.
      const sw = windows.findIndex((w) => !awake(w, from));
      return sw === -1 || windows.slice(sw).every((w) => awake(w, to));
    }),
  },
  {
    // Drops itineraries that take off from or land at any airport in the US or
    // its inhabited territories (Puerto Rico, Guam, US Virgin Islands, American
    // Samoa, Northern Mariana Islands) or minor outlying islands, connections included.
    id: 'no-usa',
    label: 'No US of A',
    control: { type: 'checkbox' },
    keep: (it) => segments(it).every((s) => !isUsa(s.departure_airport) && !isUsa(s.arrival_airport)),
    // Searching from or to the US with this on can only ever return nothing.
    remark: (_, { origin, destination }) => {
      const code = [origin, destination].find(isUsa);
      if (!code) return null;
      const quips = [
        `${code} is in the United States. We checked. Twice.`,
        `Flying ${code === origin ? 'from' : 'to'} ${code}, but not through the USA. Bold strategy.`,
        `Showing all flights involving ${code} that avoid America: none. You're welcome.`,
        `You'd like ${code}, minus the US part. Have you tried closing your eyes on landing?`,
      ];
      // Stable per airport, so it doesn't change with every keystroke.
      return quips[[...code].reduce((n, c) => n + c.charCodeAt(0), 0) % quips.length];
    },
  },
  {
    // Drops itineraries that put you in metropolitan France (country FR,
    // Corsica included; overseas France has its own country codes) on any
    // date from June 1 to August 31, in local time. Time on the ground between
    // landing at a French airport and the next takeoff from one counts, so a
    // connection or a round trip's stay spanning summer is dropped too.
    id: 'no-france-summer',
    label: 'No France in summer',
    control: { type: 'checkbox' },
    keep: (it) => {
      const french = (code) => airports[code]?.[2] === 'FR';
      const day = (local) => local.slice(0, 10);
      // Whether the dates from..to (YYYY-MM-DD, inclusive) include a summer day.
      const summer = (from, to) => {
        for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
          if (from <= `${y}-08-31` && to >= `${y}-06-01`) return true;
        }
        return false;
      };
      return segments(it).every((s, i, all) => {
        const prev = all[i - 1];
        const since = prev && french(prev.arrival_airport) ? day(prev.arrival_time_local) : day(s.departure_time_local);
        return !(french(s.departure_airport) && summer(since, day(s.departure_time_local))) &&
          !(french(s.arrival_airport) && summer(day(s.arrival_time_local), day(s.arrival_time_local)));
      });
    },
  },
  {
    // Verdicts come from FlightWifi (see wifi.js). A flight it can't vouch
    // for, including "on some aircraft" and "not verified", fails both.
    id: 'wifi',
    label: 'Wi-Fi on every flight',
    control: { type: 'checkbox' },
    keep: (it) => segments(it).every((s) => wifi(s).rank >= VERDICTS.browsing.rank),
  },
  {
    id: 'wifi-calls',
    label: 'Video-call Wi-Fi on every flight',
    control: { type: 'checkbox' },
    keep: (it) => segments(it).every((s) => wifi(s).key === 'calls'),
  },
  {
    id: 'no-self-transfer',
    label: 'No self-transfer',
    control: { type: 'checkbox' },
    keep: (it) => !it.requires_self_transfer,
  },
  {
    // Drops any itinerary with a Ryanair flight on either leg: marketed as
    // Ryanair (FR) or Ryanair UK (RK), or operated by Ryanair or a Ryanair
    // Group airline flying for it (Malta Air, Buzz, Lauda Europe). Operator
    // names match exactly, so KM Malta Airlines is kept.
    id: 'no-ryanair',
    label: 'No Ryanair',
    control: { type: 'checkbox' },
    keep: (it) =>
      segments(it).every((s) =>
        !['FR', 'RK'].includes(s.marketing_carrier_code?.toUpperCase()) &&
        !/^(ryanair\b.*|malta air|buzz|lauda( europe)?)$/i.test(s.operating_carrier_name?.trim() ?? ''),
      ),
  },
];
