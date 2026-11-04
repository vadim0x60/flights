import filters from './filters/index.js';
import { legs, layovers } from './filters/util.js';
import { wifi } from './filters/wifi.js';
import { createDatePicker } from './dates.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const form = $('#search');
let itineraries = [];

// --- Route swap -----------------------------------------------------------

$('#swap')?.addEventListener('click', () => {
  const [o, d] = [form.elements.origin, form.elements.destination];
  [o.value, d.value] = [d.value, o.value];
});

// --- Filters sidebar ------------------------------------------------------

const values = {};
const inputs = new Map();
const resetBtn = $('#reset-filters');

const isActive = (v) => v !== null && v !== false;
const syncReset = () => {
  const activeCount = filters.filter((f) => isActive(values[f.id])).length;
  if (!resetBtn) return;
  resetBtn.hidden = activeCount === 0;
  resetBtn.textContent = activeCount ? `Reset (${activeCount})` : 'Reset';
};

for (const f of filters) {
  const input = Object.assign(document.createElement('input'), {
    type: f.control.type,
    placeholder: f.control.placeholder ?? '',
  });
  if (f.control.type === 'checkbox') input.checked = !!f.control.default;
  else input.value = f.control.default ?? '';
  const read = () => {
    values[f.id] =
      f.control.type === 'checkbox' ? input.checked
      : f.control.type === 'number' ? (input.value === '' ? null : Number(input.value))
      : input.value.trim() || null;
  };
  read();
  input.addEventListener('input', () => { read(); syncReset(); render(); });
  inputs.set(f.id, { input, read, def: f.control.default });
  const label = document.createElement('label');
  label.className = `filter filter-${f.control.type}`;
  const span = document.createElement('span');
  span.className = 'filter-label';
  span.textContent = f.label;
  if (f.control.type === 'checkbox') label.append(input, span);
  else label.append(span, input);
  $('#filters').append(label);
}
syncReset();

resetBtn?.addEventListener('click', () => {
  for (const f of filters) {
    const entry = inputs.get(f.id);
    if (f.control.type === 'checkbox') entry.input.checked = !!entry.def;
    else entry.input.value = entry.def ?? '';
    entry.read();
  }
  syncReset();
  render();
});

const applyFilters = (list) =>
  list.filter((it) => filters.every((f) => !isActive(values[f.id]) || f.keep(it, values[f.id])));

// --- Search ----------------------------------------------------------------

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? data.detail ?? res.statusText);
  return data;
}

const dates = createDatePicker($('.date-group'));
let searchRun = 0;
let searchNote = '';

// One request per date pair from the picker; results are merged as each one arrives.
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const trips = dates.trips();
  if (!trips) return;
  const q = Object.fromEntries(new FormData(form));
  const base = {
    origin: q.origin.toUpperCase(),
    destination: q.destination.toUpperCase(),
    adults: Number(q.adults),
    cabin_class: q.cabin_class,
    market: q.market.toUpperCase(),
  };
  const run = ++searchRun;
  let done = 0;
  const errors = [];
  itineraries = [];
  searchNote = '';
  $('#status').textContent = trips.length > 1 ? `Running ${trips.length} searches…` : 'Searching…';
  $('#results').replaceChildren();
  await Promise.all(trips.map(async (trip) => {
    try {
      const data = await api(`/api/fares/${trip.return_date ? 'round-trip' : 'one-way'}`, { ...base, ...trip });
      if (run !== searchRun) return;
      itineraries.push(...data.itineraries);
    } catch (err) {
      errors.push(`${trip.departure_date}${trip.return_date ? ` → ${trip.return_date}` : ''}: ${err.message}`);
    }
    if (run !== searchRun) return;
    done++;
    searchNote = [
      done < trips.length && `${done} of ${trips.length} searches done…`,
      errors.length && `${errors.length} search${errors.length > 1 ? 'es' : ''} failed (${errors.join('; ')})`,
    ].filter(Boolean).join(' · ');
    if (itineraries.length) render();
    else $('#status').textContent = done < trips.length ? `Searching… ${searchNote}`
      : errors.length ? `Search failed: ${errors.join('; ')}` : 'No itineraries found.';
  }));
});

// --- Sort ------------------------------------------------------------------

const sortSelect = $('#sort');
const syncSortPills = (val) => {
  for (const btn of $$('.sort-btn')) {
    btn.classList.toggle('active', btn.dataset.sort === val);
  }
};
sortSelect.addEventListener('change', () => {
  syncSortPills(sortSelect.value);
  render();
});
for (const btn of $$('.sort-btn')) {
  btn.addEventListener('click', () => {
    sortSelect.value = btn.dataset.sort;
    syncSortPills(btn.dataset.sort);
    render();
  });
}

// --- Results ---------------------------------------------------------------

const sorters = {
  price: (a, b) => a.price.amount - b.price.amount,
  duration: (a, b) => totalMinutes(a) - totalMinutes(b),
  departure: (a, b) =>
    a.outbound.segments[0].departure_time_utc.localeCompare(b.outbound.segments[0].departure_time_utc),
};
const totalMinutes = (it) => legs(it).reduce((sum, leg) => sum + leg.duration_minutes, 0);
const money = ({ amount, currency }) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
const hm = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const time = (local) => local.slice(11, 16);
const legDate = (local) => new Date(`${local.slice(0, 10)}T00:00:00Z`)
  .toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const dayShift = (from, to) => {
  const days = (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 864e5;
  return days ? `<sup>+${days}</sup>` : '';
};

function render() {
  if (!itineraries.length) return;
  const shown = applyFilters(itineraries).sort(sorters[sortSelect.value]);
  $('#status').textContent = `${shown.length} of ${itineraries.length} itineraries${searchNote ? ` · ${searchNote}` : ''}`;
  $('#results').replaceChildren(...shown.map(card));
}

// One row per flight, with the connection wait between consecutive flights.
// Day markers (+1) count from the leg's first departure.
function legHtml(name, leg) {
  const first = leg.segments[0];
  const last = leg.segments.at(-1);
  const shift = (local) => dayShift(first.departure_time_local, local);
  const stops = layovers(leg);
  const stopBadge = stops.length
    ? `<span class="badge badge-stops">${stops.length} stop${stops.length > 1 ? 's' : ''}</span>`
    : `<span class="badge badge-direct">Direct</span>`;
  const rows = leg.segments.map((s, i) => {
    const conn = i
      ? `<div class="connection"><span class="conn-pill">${hm(stops[i - 1].minutes)} connection in <b>${stops[i - 1].airport}</b></span></div>`
      : '';
    const aircraft = s.aircraft ? `<span class="aircraft"> · ${s.aircraft.replace(/ Passenger$/i, '')}</span>` : '';
    return `${conn}
      <div class="flight">
        <span class="flight-no">${s.marketing_carrier_code} ${s.flight_number}</span>
        <span class="time">${time(s.departure_time_local)}${shift(s.departure_time_local)} <span class="iata">${s.departure_airport}</span></span>
        <span class="flight-arrow" aria-hidden="true">→</span>
        <span class="time">${time(s.arrival_time_local)}${shift(s.arrival_time_local)} <span class="iata">${s.arrival_airport}</span></span>
        <span class="duration">${hm(s.duration_minutes)}</span>
        <span class="operator">${s.operating_carrier_name ?? ''}${aircraft}</span>
        ${wifiHtml(s)}
      </div>`;
  }).join('');
  return `
    <div class="leg">
      <div class="leg-head">
        <b>${name}</b>
        <span class="leg-date">${legDate(first.departure_time_local)}</span>
        <span class="leg-route">${first.departure_airport} → ${last.arrival_airport}</span>
        ${stopBadge}
        <span class="leg-total">${hm(leg.duration_minutes)} total</span>
      </div>
      <div class="segments">${rows}</div>
    </div>`;
}

// FlightWifi's verdict for the flight; hover for the system and how to get on it.
const escape = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
function wifiHtml(s) {
  const w = wifi(s);
  const details = [w.airline && `${w.airline}${s.aircraft ? ` ${s.aircraft}` : ''}: ${w.provider ?? 'no rule for this aircraft'}`,
    w.access, 'Source: FlightWifi'].filter(Boolean).join('\n');
  return `<span class="wifi wifi-${w.key}" title="${escape(details)}">${w.label}</span>`;
}

function card(it) {
  const li = document.createElement('li');
  li.className = 'card';
  const cabinLabel = (it.cabin_class ?? 'economy').replace('_', ' ');
  li.innerHTML = `
    <div class="legs">
      ${legHtml('Out', it.outbound)}
      ${it.inbound ? legHtml('Back', it.inbound) : ''}
    </div>
    <div class="buy">
      <div class="price-group">
        <strong>${money(it.price)}</strong>
        <span class="price-meta">${cabinLabel}${it.requires_self_transfer ? ' · self-transfer' : ''}</span>
      </div>
      <button type="button" class="book-btn">Book</button>
    </div>
    <div class="links"></div>`;
  li.querySelector('.book-btn').addEventListener('click', (e) => showBookingLinks(it, li, e.currentTarget));
  return li;
}

async function showBookingLinks(it, li, button) {
  const box = li.querySelector('.links');
  button.disabled = true;
  box.textContent = 'Fetching booking options…';
  try {
    const data = await api('/api/fares/booking-links', { ignav_id: it.ignav_id });
    box.innerHTML = data.booking_options.map((opt) => `
      <div class="option">
        ${data.booking_options.length > 1 ? `<span class="covers">${opt.legs.join(' + ')}</span>` : '<span class="covers">Book via</span>'}
        ${opt.links.map((l) => `
          <a class="${l.provider_type === 'airline' ? 'is-airline' : ''}" href="${l.url}" target="_blank" rel="noopener">
            <span>${l.provider_name}${l.provider_type === 'airline' ? ' ✈' : ''}${l.fare_name ? ` (${l.fare_name})` : ''}</span>
            ${l.price ? `<b>${money(l.price)}</b>` : ''}
          </a>`).join('')}
      </div>`).join('') || 'No booking options available.';
  } catch (err) {
    box.textContent = `Could not get booking links: ${err.message}`;
    button.disabled = false;
  }
}
