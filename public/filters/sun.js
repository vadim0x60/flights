// Sun position (NOAA solar calculator equations) and Vadim night.
//
// Natural night runs from civil dusk (sun sinks below -6°) to sunrise (upper
// limb clears the horizon, -0.833° with refraction). Vadim night is the last
// 8 hours of natural night when it is longer than 8 hours, otherwise the
// 8 hours from its start.
//
// Each night is solved within one solar day, solar noon to solar noon. Near the
// poles, where dusk or sunrise doesn't happen that day, the sun's lowest point
// stands in for a missing dusk and its highest point for a missing sunrise.
// So under the midnight sun Vadim night is the 8 hours after solar midnight,
// and in polar night it's the 8 hours before solar noon.

const DAY = 864e5;
const HOUR = 36e5;
const rad = Math.PI / 180;
const DUSK = -6;
const SUNRISE = -0.833;

/** Sun's hour angle (degrees, -180..180, 0 at solar noon) and elevation (degrees) at time `ms`. */
function sun(ms, lat, lon) {
  const T = (ms / DAY + 2440587.5 - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps =
    23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 +
    0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = // minutes
    (4 / rad) *
    (y * Math.sin(2 * L0 * rad) -
      2 * e * Math.sin(M * rad) +
      4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
      0.5 * y * y * Math.sin(4 * L0 * rad) -
      1.25 * e * e * Math.sin(2 * M * rad));
  const minutes = (((ms % DAY) + DAY) % DAY) / 6e4;
  const hourAngle = ((((minutes + eqTime + 4 * lon) / 4) % 360) + 360) % 360 - 180;
  const elevation =
    90 -
    Math.acos(
      Math.min(1, Math.max(-1,
        Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle * rad))),
    ) / rad;
  return { hourAngle, elevation };
}

const elevation = (ms, lat, lon) => sun(ms, lat, lon).elevation;

/** Last solar noon at or before `ms`. */
function noonBefore(ms, lat, lon) {
  let noon = ms;
  for (let i = 0; i < 3; i++) noon -= (sun(noon, lat, lon).hourAngle / 360) * DAY;
  return noon > ms ? noon - DAY : noon;
}

/** When elevation crosses `angle` between `a` and `b`, given it is monotonic there. */
function crossing(a, b, angle, lat, lon) {
  const rising = elevation(b, lat, lon) > elevation(a, lat, lon);
  while (b - a > 1000) {
    const mid = (a + b) / 2;
    if (elevation(mid, lat, lon) > angle === rising) b = mid;
    else a = mid;
  }
  return a;
}

/** [start, end) in ms of the Vadim night that begins after solar noon `noon`. */
function vadimNightAfter(noon, lat, lon) {
  const midnight = noon + DAY / 2;
  const nextNoon = noon + DAY;
  const dusk =
    elevation(noon, lat, lon) <= DUSK ? noon
    : elevation(midnight, lat, lon) >= DUSK ? midnight
    : crossing(noon, midnight, DUSK, lat, lon);
  const sunrise =
    elevation(midnight, lat, lon) >= SUNRISE ? midnight
    : elevation(nextNoon, lat, lon) <= SUNRISE ? nextNoon
    : crossing(midnight, nextNoon, SUNRISE, lat, lon);
  return sunrise - dusk > 8 * HOUR ? [sunrise - 8 * HOUR, sunrise] : [dusk, dusk + 8 * HOUR];
}

/** Whether the instant `ms` falls in Vadim night at (lat, lon). */
export function isVadimNight(ms, lat, lon) {
  // A night starting after a given noon ends by the next noon, so only the
  // night that began after the latest noon can contain `ms`.
  const [start, end] = vadimNightAfter(noonBefore(ms, lat, lon), lat, lon);
  return start <= ms && ms < end;
}
