// Onboard Wi-Fi verdicts per flight segment, from FlightWifi's open registry
// (https://flightwifi.app, CC BY 4.0). The registry has one entry per airline
// with rules that tie aircraft types to a Wi-Fi system and its satellite orbit.
// Rule choice and orbit classification follow FlightWifi's own extension, so
// verdicts here match the ones its site shows.

export const SOURCE = 'https://flightwifi.app';

// Fetched once when the page loads. If FlightWifi is unreachable, every flight
// reads "Not verified" instead of the app failing to start.
const registry = await fetch(`${SOURCE}/data.json`, { signal: AbortSignal.timeout(5000) })
  .then((res) => res.json())
  .then((data) => data.airlines)
  .catch(() => ({}));

// Ignav names the operating airline but gives a code only for the marketing
// one, so find the operator by name: "Delta" must meet "Delta", "TAP Air
// Portugal" must meet "Tap Air Portugal". A short name shared by two airlines
// matches neither.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const short = (s) => norm(s.replace(/\s+(air lines|airlines|airways|airline|air|aviation)$/i, ''));
const byName = {};
for (const [code, { airline }] of Object.entries(registry)) byName[norm(airline)] = code;
for (const [code, { airline }] of Object.entries(registry)) {
  const key = short(airline);
  if (key.length < 4 || byName[key] === code) continue;
  byName[key] = key in byName ? null : code;
}
const operatorCode = (s) => {
  if (!s.operating_carrier_name) return s.marketing_carrier_code;
  return byName[norm(s.operating_carrier_name)] ?? byName[short(s.operating_carrier_name)] ?? null;
};

// Worst to best. 'partial': some planes of this type have no Wi-Fi at all.
// 'varies': every plane has Wi-Fi, but only some have the fast system.
export const VERDICTS = {
  unknown: { rank: 0, label: 'Wi-Fi not verified' },
  none: { rank: 1, label: 'No Wi-Fi' },
  partial: { rank: 2, label: 'Wi-Fi on some aircraft' },
  browsing: { rank: 3, label: 'Wi-Fi: email & browsing' },
  varies: { rank: 4, label: 'Wi-Fi: speed varies' },
  calls: { rank: 5, label: 'Wi-Fi: video calls work' },
};

const classify = (orbit) => {
  if (!orbit || orbit === 'UNKNOWN') return 'unknown';
  if (orbit === 'NONE') return 'none';
  if (orbit === 'A2G') return 'browsing';
  if (orbit.startsWith('mixed') && /none/i.test(orbit)) return 'partial';
  if (orbit.startsWith('mixed') || (orbit.includes('LEO') && orbit.includes('GEO'))) return 'varies';
  if (orbit.includes('MEO') || orbit.startsWith('LEO')) return 'calls';
  return 'browsing';
};

const WIDEBODY = /A3[358]0|A340|747|767|777|787/;

/** Wi-Fi verdict for one segment: { key, label, rank, airline?, provider?, access? }. */
export function wifi(segment) {
  const entry = registry[operatorCode(segment)];
  const aircraft = segment.aircraft ?? '';
  let rule = null;
  if (entry) {
    // When several type rules match, the most cautious one wins.
    const typed = aircraft ? entry.rules.filter((r) => r.types && new RegExp(r.types).test(aircraft)) : [];
    const fleet = aircraft ? (WIDEBODY.test(aircraft) ? 'widebody' : 'narrowbody') : null;
    rule = typed.length
      ? typed.reduce((a, b) => (VERDICTS[classify(a.orbit)].rank <= VERDICTS[classify(b.orbit)].rank ? a : b))
      : entry.rules.find((r) => !r.types && r.fleet === fleet)
        ?? entry.rules.find((r) => !r.types && ['all', 'most', 'rollout'].includes(r.fleet));
  }
  const key = classify(rule?.orbit);
  return { key, ...VERDICTS[key], airline: entry?.airline, provider: rule?.provider, access: entry?.access_short ?? entry?.access };
}
