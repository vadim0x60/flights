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
    id: 'avoid-airports',
    label: 'Avoid airports (comma-separated)',
    control: { type: 'text', placeholder: 'e.g. LHR, CDG' },
    keep: (it, text) => {
      const avoid = text.toUpperCase().split(/[\s,]+/).filter(Boolean);
      return segments(it).every((s) => !avoid.includes(s.departure_airport) && !avoid.includes(s.arrival_airport));
    },
  },
  {
    id: 'no-self-transfer',
    label: 'No self-transfer',
    control: { type: 'checkbox' },
    keep: (it) => !it.requires_self_transfer,
  },
];
