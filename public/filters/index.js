// Custom filters. Each filter is { id, label, control, keep(itinerary, value) }.
//
// - control: { type: 'checkbox' | 'number' | 'text', default?, placeholder? }
//   renders an input in the sidebar; its current value is passed to keep().
// - keep() returns true to show the itinerary. It is only called while the
//   filter is active: checkbox checked, or number/text field non-empty.
//
// Filters run in the browser on results already fetched, so changing them is
// instant and costs no API requests. Add a filter by appending to this list.
import { legs, segments, layovers, hour } from './util.js';

export default [
  {
    id: 'no-overnight-layover',
    label: 'No overnight layovers',
    control: { type: 'checkbox' },
    keep: (it) =>
      legs(it).every((leg) =>
        layovers(leg).every((l) => l.arrivalLocal.slice(0, 10) === l.departureLocal.slice(0, 10)),
      ),
  },
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
    id: 'no-red-eye',
    label: 'No departures 00:00–05:59',
    control: { type: 'checkbox' },
    keep: (it) => segments(it).every((s) => hour(s.departure_time_local) >= 6),
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
