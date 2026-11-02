// Custom filters. Each filter is { id, label, control, keep(itinerary, value) }.
//
// - control: { type: 'checkbox' | 'number' | 'text', default?, placeholder? }
//   renders an input in the sidebar; its current value is passed to keep().
// - keep() returns true to show the itinerary. It is only called while the
//   filter is active: checkbox checked, or number/text field non-empty.
//
// Filters run in the browser on results already fetched, so changing them is
// instant and costs no API requests. Add a filter by appending to this list.
import { legs, segments, layovers, instant } from './util.js';
import { isVadimNight } from './sun.js';
import airports from './airports.js';

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
    // landing, connections included. Drop the itinerary if any of those windows
    // touches Vadim night (see sun.js) at both the trip's origin and its
    // destination. Local time at a connecting airport doesn't matter.
    id: 'no-red-eye',
    label: 'Protect sleep',
    control: { type: 'checkbox' },
    keep: (it) => {
      const ends = [it.outbound.segments[0].departure_airport, it.outbound.segments.at(-1).arrival_airport]
        .map((code) => airports[code]);
      if (!ends.every(Boolean)) return true; // unknown coordinates: can't tell, so keep
      const minute = 60000;
      // A Vadim night always lasts 8 hours, so a window this short overlaps
      // one exactly when one of its two ends falls inside it.
      const windows = segments(it).flatMap((s) => [
        [instant(s, 'departure') - 40 * minute, instant(s, 'departure')],
        [instant(s, 'arrival'), instant(s, 'arrival') + 20 * minute],
      ]);
      return windows.every((w) => !ends.every(([lat, lon]) => w.some((ms) => isVadimNight(ms, lat, lon))));
    },
  },
  {
    // Drops itineraries that take off from or land at any airport in the US or
    // its inhabited territories (Puerto Rico, Guam, US Virgin Islands, American
    // Samoa, Northern Mariana Islands) or minor outlying islands, connections included.
    id: 'no-usa',
    label: 'No US of A',
    control: { type: 'checkbox' },
    keep: (it) => {
      const usa = ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM'];
      return segments(it).every((s) =>
        [s.departure_airport, s.arrival_airport].every((code) => !usa.includes(airports[code]?.[2])));
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
