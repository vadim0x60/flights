// Helpers for writing filters against Ignav itineraries.
//
// An itinerary looks like:
//   { price: { amount, currency }, outbound: Leg, inbound?: Leg, bags?, cabin_class,
//     requires_self_transfer, ignav_id }
// A Leg is { carrier, duration_minutes, segments: Segment[] } and a Segment has
//   marketing_carrier_code, flight_number, operating_carrier_name, aircraft,
//   departure_airport, departure_time_local, departure_time_utc,
//   arrival_airport, arrival_time_local, arrival_time_utc, duration_minutes.

/** Outbound and (if present) inbound legs. */
export const legs = (it) => [it.outbound, it.inbound].filter(Boolean);

/** All flight segments across all legs. */
export const segments = (it) => legs(it).flatMap((leg) => leg.segments);

/** Connections within one leg: where you wait, for how long, and when. */
export const layovers = (leg) =>
  leg.segments.slice(1).map((next, i) => {
    const prev = leg.segments[i];
    return {
      airport: next.departure_airport,
      minutes: (Date.parse(next.departure_time_utc) - Date.parse(prev.arrival_time_utc)) / 60000,
      arrivalLocal: prev.arrival_time_local,
      departureLocal: next.departure_time_local,
    };
  });

/** Local hour (0-23) of an ISO local time like "2026-11-20T17:25:00". */
export const hour = (localTime) => Number(localTime.slice(11, 13));
