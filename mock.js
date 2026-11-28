// A fake Ignav for frontend work. With IGNAV_MOCK=1, server.js calls this
// instead of fetch, so searches cost nothing and need no API key. Responses
// follow Ignav's OpenAPI schema (ignav.com/api/openapi.json) and are
// deterministic: the same search gives the same flights and prices.
//
// - Routes: any airport in public/filters/airports.js, plus the metro codes in
//   CITIES. Unknown codes, the same airport at both ends, past dates and
//   round-trips without return_date get Ignav's 400 errors.
// - Results: directs from airlines based at either end (none beyond 14,500
//   km), one-stop trips through the hubs below, and, on longer routes, a
//   cheap two-stop trip on two airlines. Ryanair, easyJet and Vueling fly direct only.
// - Booking links: one airline link and two third-party links per booking.
//   A round trip with a different airline back is booked in two parts.
//   Two-stop itineraries have no links and get a 404, as Ignav does.
// - Failures, chosen with the Market field:
//     XF  every search fails twice with 424 unable_to_complete_request, then
//         succeeds, which exercises the retries in server.js
//     XD  every search always fails with that 424, so the server gives up after 5 tries
//     XP  only searches departing on an odd day of the month always fail,
//         so a multi-date search partly fails
//     XN  every call throws a network error, so the server answers 502
//   Departures more than 330 days ahead get 424 unsupported_search.
import coords from './public/filters/airports.js';

// code: [name, city, country, time zone]. Other airports get a time zone from their longitude.
const AIRPORTS = {
  LHR: ['Heathrow Airport', 'London', 'GB', 'Europe/London'],
  LGW: ['Gatwick Airport', 'London', 'GB', 'Europe/London'],
  STN: ['Stansted Airport', 'London', 'GB', 'Europe/London'],
  LTN: ['Luton Airport', 'London', 'GB', 'Europe/London'],
  LCY: ['London City Airport', 'London', 'GB', 'Europe/London'],
  DUB: ['Dublin Airport', 'Dublin', 'IE', 'Europe/Dublin'],
  CDG: ['Charles de Gaulle Airport', 'Paris', 'FR', 'Europe/Paris'],
  ORY: ['Orly Airport', 'Paris', 'FR', 'Europe/Paris'],
  NCE: ["Nice Côte d'Azur Airport", 'Nice', 'FR', 'Europe/Paris'],
  AMS: ['Amsterdam Airport Schiphol', 'Amsterdam', 'NL', 'Europe/Amsterdam'],
  FRA: ['Frankfurt Airport', 'Frankfurt', 'DE', 'Europe/Berlin'],
  MUC: ['Munich Airport', 'Munich', 'DE', 'Europe/Berlin'],
  BER: ['Berlin Brandenburg Airport', 'Berlin', 'DE', 'Europe/Berlin'],
  ZRH: ['Zurich Airport', 'Zurich', 'CH', 'Europe/Zurich'],
  VIE: ['Vienna International Airport', 'Vienna', 'AT', 'Europe/Vienna'],
  CPH: ['Copenhagen Airport', 'Copenhagen', 'DK', 'Europe/Copenhagen'],
  ARN: ['Stockholm Arlanda Airport', 'Stockholm', 'SE', 'Europe/Stockholm'],
  MAD: ['Adolfo Suárez Madrid–Barajas Airport', 'Madrid', 'ES', 'Europe/Madrid'],
  BCN: ['Josep Tarradellas Barcelona–El Prat Airport', 'Barcelona', 'ES', 'Europe/Madrid'],
  LIS: ['Humberto Delgado Airport', 'Lisbon', 'PT', 'Europe/Lisbon'],
  FCO: ['Leonardo da Vinci–Fiumicino Airport', 'Rome', 'IT', 'Europe/Rome'],
  MXP: ['Milan Malpensa Airport', 'Milan', 'IT', 'Europe/Rome'],
  LIN: ['Milan Linate Airport', 'Milan', 'IT', 'Europe/Rome'],
  BUD: ['Budapest Ferenc Liszt International Airport', 'Budapest', 'HU', 'Europe/Budapest'],
  IST: ['Istanbul Airport', 'Istanbul', 'TR', 'Europe/Istanbul'],
  DOH: ['Hamad International Airport', 'Doha', 'QA', 'Asia/Qatar'],
  DXB: ['Dubai International Airport', 'Dubai', 'AE', 'Asia/Dubai'],
  SIN: ['Singapore Changi Airport', 'Singapore', 'SG', 'Asia/Singapore'],
  HND: ['Tokyo Haneda Airport', 'Tokyo', 'JP', 'Asia/Tokyo'],
  NRT: ['Narita International Airport', 'Tokyo', 'JP', 'Asia/Tokyo'],
  SYD: ['Sydney Kingsford Smith Airport', 'Sydney', 'AU', 'Australia/Sydney'],
  JFK: ['John F. Kennedy International Airport', 'New York', 'US', 'America/New_York'],
  EWR: ['Newark Liberty International Airport', 'New York', 'US', 'America/New_York'],
  BOS: ['Boston Logan International Airport', 'Boston', 'US', 'America/New_York'],
  IAD: ['Washington Dulles International Airport', 'Washington', 'US', 'America/New_York'],
  ORD: ["Chicago O'Hare International Airport", 'Chicago', 'US', 'America/Chicago'],
  LAX: ['Los Angeles International Airport', 'Los Angeles', 'US', 'America/Los_Angeles'],
  SFO: ['San Francisco International Airport', 'San Francisco', 'US', 'America/Los_Angeles'],
};
// Metro codes: [city, country, airports].
const CITIES = {
  LON: ['London', 'GB', ['LHR', 'LGW', 'STN', 'LTN', 'LCY']],
  PAR: ['Paris', 'FR', ['CDG', 'ORY']],
  ROM: ['Rome', 'IT', ['FCO']],
  MIL: ['Milan', 'IT', ['MXP', 'LIN']],
  TYO: ['Tokyo', 'JP', ['HND', 'NRT']],
  NYC: ['New York', 'US', ['JFK', 'EWR']],
};
// Short-haul and long-haul aircraft; an airline without one doesn't fly that distance.
const CARRIERS = [
  { code: 'BA', name: 'British Airways', hub: 'LHR', short: 'Airbus A320neo', long: 'Boeing 777-300ER' },
  { code: 'AF', name: 'Air France', hub: 'CDG', short: 'Airbus A220-300', long: 'Boeing 777-300ER' },
  { code: 'KL', name: 'KLM', hub: 'AMS', short: 'Boeing 737-800', long: 'Boeing 787-9' },
  { code: 'LH', name: 'Lufthansa', hub: 'FRA', short: 'Airbus A321neo', long: 'Airbus A350-900' },
  { code: 'IB', name: 'Iberia', hub: 'MAD', short: 'Airbus A320neo', long: 'Airbus A350-900' },
  { code: 'AZ', name: 'ITA Airways', hub: 'FCO', short: 'Airbus A220-100', long: 'Airbus A330-900' },
  { code: 'TK', name: 'Turkish Airlines', hub: 'IST', short: 'Airbus A321neo', long: 'Boeing 777-300ER' },
  { code: 'QR', name: 'Qatar Airways', hub: 'DOH', short: 'Airbus A320', long: 'Boeing 777-300ER' },
  { code: 'EK', name: 'Emirates', hub: 'DXB', short: 'Boeing 777-300ER', long: 'Airbus A380-800' },
  { code: 'SQ', name: 'Singapore Airlines', hub: 'SIN', short: 'Boeing 737 MAX 8', long: 'Airbus A350-900' },
  { code: 'QF', name: 'Qantas', hub: 'SYD', short: 'Boeing 737-800', long: 'Boeing 787-9' },
  { code: 'AA', name: 'American Airlines', hub: 'JFK', short: 'Airbus A321', long: 'Boeing 777-200' },
  { code: 'FR', name: 'Ryanair', hub: 'STN', short: 'Boeing 737 MAX 8-200 Passenger', budget: true },
  { code: 'U2', name: 'easyJet', hub: 'LGW', short: 'Airbus A320neo', budget: true },
  { code: 'VY', name: 'Vueling', hub: 'BCN', short: 'Airbus A320', budget: true },
];
const OTAS = ['Trip.com', 'Kiwi.com'];
const EUROZONE = ['AT', 'BE', 'DE', 'ES', 'FI', 'FR', 'GR', 'IE', 'IT', 'NL', 'PT'];
const CABIN = { economy: 1, premium_economy: 1.7, business: 3.8, first: 6.5 };
const LONG_HAUL_KM = 4000;
const MAX_KM = 14500;

const flaky = new Map(); // request -> failures so far, for market XF

export default async function mockFetch(href, { method = 'GET', body } = {}) {
  const url = new URL(href);
  let q = {};
  try {
    q = body ? JSON.parse(body) : {};
  } catch {
    return reply(400, error('invalid_request', 'invalid_request_body', 'Request body is not valid JSON.'));
  }
  const market = String(q.market ?? '').toUpperCase();
  await sleep(url.pathname === '/api/airports' ? 80 : 300 + Math.random() * 900);
  if (market === 'XN') throw new TypeError('fetch failed', { cause: new Error('mock: connect ECONNREFUSED (market XN)') });
  if (url.pathname === '/api/airports' && method === 'GET') return airports(url.searchParams);
  if (url.pathname === '/api/fares/booking-links' && method === 'POST') return bookingLinks(q);
  const trip = url.pathname.match(/^\/api\/fares\/(one-way|round-trip)$/)?.[1];
  if (!trip || method !== 'POST') return reply(404, error('not_found', 'route_not_found', 'The requested API route does not exist.'));

  const upstreamFailure = reply(424, error('upstream_error', 'unable_to_complete_request',
    'An upstream error occurred. Retry the request or try different parameters.'));
  if (market === 'XD' || (market === 'XP' && Number(String(q.departure_date).slice(8, 10)) % 2)) return upstreamFailure;
  if (market === 'XF') {
    const key = url.pathname + body;
    const failures = flaky.get(key) ?? 0;
    if (failures < 2) return flaky.set(key, failures + 1), upstreamFailure;
    flaky.delete(key);
  }
  const result = search(q, trip === 'round-trip');
  if (result.error) return reply(result.status, result);
  return reply(200, result);
}

// --- Fare search ------------------------------------------------------------

function search(q, roundTrip) {
  const origin = String(q.origin ?? '').toUpperCase();
  const destination = String(q.destination ?? '').toUpperCase();
  const from = resolve(origin);
  const to = resolve(destination);
  const today = new Date().toISOString().slice(0, 10);
  const daysAhead = (date) => (Date.parse(date) - Date.parse(today)) / 864e5;
  const fail = (status, type, code, message, field) => ({ status, ...error(type, code, message, field) });
  if (!from) return fail(400, 'invalid_request', 'invalid_airport_code', 'origin must be a supported 3-letter airport or metro IATA code.', 'origin');
  if (!to) return fail(400, 'invalid_request', 'invalid_airport_code', 'destination must be a supported 3-letter airport or metro IATA code.', 'destination');
  if (from.some((a) => to.includes(a))) return fail(400, 'invalid_request', 'duplicate_route_airports', 'Origin and destination must be different locations.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.departure_date ?? '')) return fail(400, 'invalid_request', 'invalid_request_body', 'departure_date must be a date (YYYY-MM-DD).', 'departure_date');
  if (q.departure_date < today) return fail(400, 'invalid_request', 'departure_date_in_past', 'Departure date is earlier than today.', 'departure_date');
  if (roundTrip && !q.return_date) return fail(400, 'invalid_request', 'missing_return_date', 'Round-trip searches need a return_date.', 'return_date');
  if (roundTrip && q.return_date < q.departure_date) return fail(400, 'invalid_request', 'invalid_date_range', 'Return date is earlier than departure.', 'return_date');
  if ((q.adults ?? 1) + (q.children ?? 0) > 9) return fail(400, 'invalid_request', 'too_many_passengers', 'Total passenger count exceeds 9.');
  if (daysAhead(q.departure_date) > 330 || (roundTrip && daysAhead(q.return_date) > 330))
    return fail(424, 'upstream_error', 'unsupported_search', 'Requested travel dates are outside the available search range. Try earlier dates.');

  const cabin = CABIN[q.cabin_class] ? q.cabin_class : 'economy';
  const passengers = (q.adults ?? 1) + (q.children ?? 0);
  const [currency, rate] = q.market === 'US' ? ['USD', 1.27] : EUROZONE.includes(q.market) ? ['EUR', 1.17] : ['GBP', 1];
  const rnd = random([origin, destination, q.departure_date, q.return_date, cabin, passengers, q.market].join());
  const outPlans = plans(from, to);
  const pairs = outPlans.map((p) => [p, roundTrip && reverse(p)]);
  // One round trip that comes back on a different airline, so it's booked in two parts.
  const other = outPlans.find((p) => p.length === 1 && p[0][2] !== outPlans[0]?.[0][2]);
  if (roundTrip && outPlans[0]?.length === 1 && other) pairs.push([outPlans[0], reverse(other)]);

  const itineraries = pairs.map(([out, back], i) => {
    const outbound = leg(out, q.departure_date, rnd);
    const inbound = back && leg(back, q.return_date, rnd);
    const segs = [outbound, inbound].filter(Boolean).flatMap((l) => l.segments);
    const km = segs.reduce((sum, s) => sum + distance(s.departure_airport, s.arrival_airport), 0);
    const stops = Math.max(out.length, back?.length ?? 0) - 1;
    const budget = [out, back].filter(Boolean).flat().every(([, , c]) => c.budget);
    const price = (25 + km * 0.07) * CABIN[cabin] * (budget ? 0.55 : 1) * [1.2, 1, 0.8][stops] * (0.8 + rnd() * 0.5) * passengers * rate;
    return {
      price: { amount: Math.round(price), currency, status: 'verified' },
      outbound,
      ...(inbound && { inbound }),
      cabin_class: cabin,
      bags: { carry_on: budget ? 0 : 1, checked: km > 2 * LONG_HAUL_KM && !budget ? 1 : 0 },
      has_mixed_carriers: [outbound, inbound].some((l) => l && new Set(l.segments.map((s) => s.marketing_carrier_code)).size > 1),
      ignav_id: `mock_${Buffer.from(JSON.stringify({ ...q, roundTrip, i })).toString('base64url')}`,
    };
  });
  return {
    origin, destination, departure_date: q.departure_date,
    ...(roundTrip && { return_date: q.return_date }),
    itineraries,
    observed_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  };
}

// Each plan is a list of flights [from, to, carrier].
function plans(from, to) {
  const D = distance(from[0], to[0]);
  const flies = (c, a, b) => { const km = distance(a, b); return km <= MAX_KM && (km > LONG_HAUL_KM ? c.long : c.short); };
  const end = (set, c) => (set.includes(c.hub) ? c.hub : set[0]);
  const country = (code) => coords[code]?.[2];
  const result = [];
  for (const c of CARRIERS) {
    const based = from.includes(c.hub) || to.includes(c.hub)
      || (c.budget && D < 2500 && [country(from[0]), country(to[0])].includes(country(c.hub)));
    const [a, b] = [end(from, c), end(to, c)];
    if (based && flies(c, a, b)) result.push([[a, b, c]]);
  }
  const hubs = CARRIERS.filter((c) => !c.budget && !from.includes(c.hub) && !to.includes(c.hub)
    && distance(from[0], c.hub) + distance(c.hub, to[0]) <= 1.35 * D + 800
    && flies(c, from[0], c.hub) && flies(c, c.hub, to[0]));
  for (const c of hubs.slice(0, 5)) result.push([[from[0], c.hub, c], [c.hub, to[0], c]]);
  if (D > 1500) {
    const [x, y] = hubs.length >= 2 ? hubs.slice(-2) : [];
    if (x && distance(from[0], x.hub) + distance(x.hub, y.hub) + distance(y.hub, to[0]) <= 1.6 * D + 1500
      && flies(x, x.hub, y.hub)) result.push([[from[0], x.hub, x], [x.hub, y.hub, x], [y.hub, to[0], y]]);
  }
  return result;
}

const reverse = (plan) => plan.toReversed().map(([a, b, c]) => [b, a, c]);

function leg(plan, date, rnd) {
  let t;
  const segments = plan.map(([from, to, c], i) => {
    t = i === 0
      ? utc(date, 6 + Math.floor(rnd() * 17), 5 * Math.floor(rnd() * 12), zone(from))
      : t + (50 + 5 * Math.floor(rnd() * 40)) * 60000; // a 50 min to 4 h connection
    while (Number(parts(t, zone(from)).hour) < 6) t += 3600000; // or overnight: nothing leaves before 6:00
    const km = distance(from, to);
    const minutes = 5 * Math.round((35 + (km / 820) * 60) / 5);
    const [dep, arr] = [t, t + minutes * 60000];
    t = arr;
    return {
      marketing_carrier_code: c.code,
      flight_number: String(10 + (hash(c.code + from + to) % 1980)),
      operating_carrier_name: c.name,
      departure_airport: from,
      departure_time_local: local(dep, zone(from)),
      departure_timezone: zone(from),
      departure_time_utc: iso(dep),
      arrival_airport: to,
      arrival_time_local: local(arr, zone(to)),
      arrival_timezone: zone(to),
      arrival_time_utc: iso(arr),
      duration_minutes: minutes,
      aircraft: km > LONG_HAUL_KM ? c.long : c.short,
    };
  });
  const names = new Set(plan.map(([, , c]) => c.name));
  return {
    carrier: names.size > 1 ? 'Multiple airlines' : [...names][0],
    duration_minutes: (Date.parse(segments.at(-1).arrival_time_utc) - Date.parse(segments[0].departure_time_utc)) / 60000,
    segments,
  };
}

// --- Booking links ----------------------------------------------------------

function bookingLinks({ ignav_id }) {
  let q;
  try {
    q = JSON.parse(Buffer.from(String(ignav_id).replace(/^mock_/, ''), 'base64url').toString());
  } catch {
    return reply(400, error('invalid_request', 'invalid_booking_request', 'ignav_id is not a mock itinerary ID.', 'ignav_id'));
  }
  const it = search(q, q.roundTrip).itineraries?.[q.i];
  if (!it) return reply(400, error('invalid_request', 'invalid_booking_request', 'ignav_id is not a mock itinerary ID.', 'ignav_id'));
  const legs = [['outbound', it.outbound], ['inbound', it.inbound]].filter(([, l]) => l);
  if (legs.some(([, l]) => l.segments.length > 2))
    return reply(404, error('not_found', 'booking_links_not_found', 'No usable booking links are available for this itinerary.'));
  const carrier = ([, l]) => l.segments[0].marketing_carrier_code;
  const parts = legs.length === 2 && carrier(legs[0]) !== carrier(legs[1]) ? legs.map((l) => [l]) : [legs];
  const rnd = random(ignav_id);
  const { ignav_id: _, ...itinerary } = it;
  return reply(200, {
    itinerary,
    booking_options: parts.map((part) => {
      const share = it.price.amount / parts.length;
      const flights = part.flatMap(([, l]) => l.segments.map((s) => s.marketing_carrier_code + s.flight_number)).join(',');
      const seg = part[0][1].segments[0];
      const link = (provider_name, provider_type, factor, fare_name) => ({
        provider_name, provider_type,
        specificity: provider_type === 'airline' ? 'exact_flight' : 'search_results',
        fare_name,
        price: { amount: Math.round(share * factor), currency: it.price.currency, status: 'verified' },
        url: `https://example.com/mock-booking/${provider_name.replace(/\W/g, '').toLowerCase()}?flights=${flights}`,
      });
      return {
        legs: part.map(([name]) => name),
        links: [
          link(seg.operating_carrier_name, 'airline', 1, it.cabin_class === 'economy' ? 'Economy Light' : null),
          ...OTAS.map((name) => link(name, 'third_party', 0.94 + rnd() * 0.12, null)),
        ],
      };
    }),
  });
}

// --- Airport search ---------------------------------------------------------

function airports(params) {
  const q = (params.get('q') ?? '').trim().toLowerCase();
  if (q.length < 2) return reply(400, error('invalid_request', 'invalid_airport_query', 'Airport search query must be at least 2 characters.', 'q'));
  const limit = Math.min(20, Math.max(1, Number(params.get('limit')) || 10));
  const all = [
    ...Object.entries(CITIES).map(([code, [city, country]]) => ({ code, name: `${city} (all airports)`, city, country })),
    ...Object.entries(AIRPORTS).map(([code, [name, city, country]]) => ({ code, name, city, country })),
  ];
  const score = (a) => (a.code.toLowerCase() === q ? 0 : a.city.toLowerCase().startsWith(q) ? 1
    : `${a.name} ${a.city}`.toLowerCase().includes(q) ? 2 : 3);
  return reply(200, all.filter((a) => score(a) < 3).sort((a, b) => score(a) - score(b)).slice(0, limit));
}

// --- Helpers ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const error = (type, code, message, field) => ({ error: { type, code, message, ...(field && { field }) } });
const resolve = (code) => CITIES[code]?.[2] ?? (coords[code] ? [code] : null);
const zone = (code) => AIRPORTS[code]?.[3] ?? `Etc/GMT${(n => (n > 0 ? '-' : '+') + Math.abs(n))(Math.round(coords[code][1] / 15))}`;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

function distance(a, b) {
  const [[lat1, lon1], [lat2, lon2]] = [coords[a], coords[b]].map(([lat, lon]) => [lat * Math.PI / 180, lon * Math.PI / 180]);
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Wall-clock parts of an instant in a time zone.
const parts = (ms, timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  .formatToParts(ms).map((x) => [x.type, x.value]));
const local = (ms, tz) => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`; };
// The instant when it's hour:minute on date in a time zone.
function utc(date, hour, minute, tz) {
  const wall = Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60000;
  const offset = (ms) => Date.parse(`${local(ms, tz)}Z`) - ms;
  return wall - offset(wall - offset(wall));
}

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
// mulberry32, seeded, so a search always gives the same flights.
function random(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
