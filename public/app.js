import filters from './filters/index.js';
import { legs, layovers } from './filters/util.js';

const $ = (sel) => document.querySelector(sel);
const form = $('#search');
let itineraries = [];

// --- Filters sidebar ------------------------------------------------------

const values = {};
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
  input.addEventListener('input', () => { read(); render(); });
  const label = document.createElement('label');
  label.className = `filter filter-${f.control.type}`;
  label.append(input, ' ', f.label);
  $('#filters').append(label);
}

const isActive = (v) => v !== null && v !== false;
const applyFilters = (list) =>
  list.filter((it) => filters.every((f) => !isActive(values[f.id]) || f.keep(it, values[f.id])));

// --- Search ----------------------------------------------------------------

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? data.detail ?? res.statusText);
  return data;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = Object.fromEntries(new FormData(form));
  const body = {
    origin: q.origin.toUpperCase(),
    destination: q.destination.toUpperCase(),
    departure_date: q.departure_date,
    adults: Number(q.adults),
    cabin_class: q.cabin_class,
    market: q.market.toUpperCase(),
  };
  if (q.return_date) body.return_date = q.return_date;
  $('#status').textContent = 'Searching…';
  $('#results').replaceChildren();
  try {
    const data = await api(`/api/fares/${q.return_date ? 'round-trip' : 'one-way'}`, body);
    itineraries = data.itineraries;
    render();
  } catch (err) {
    itineraries = [];
    $('#status').textContent = `Search failed: ${err.message}`;
  }
});

$('#sort').addEventListener('change', render);

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
const dayShift = (from, to) => {
  const days = (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 864e5;
  return days ? `<sup>+${days}</sup>` : '';
};
function render() {
  if (!itineraries.length) return;
  const shown = applyFilters(itineraries).sort(sorters[$('#sort').value]);
  $('#status').textContent = `${shown.length} of ${itineraries.length} itineraries`;
  $('#results').replaceChildren(...shown.map(card));
}

// One row per flight, with the connection wait between consecutive flights.
// Day markers (+1) count from the leg's first departure.
function legHtml(name, leg) {
  const first = leg.segments[0];
  const last = leg.segments.at(-1);
  const shift = (local) => dayShift(first.departure_time_local, local);
  const stops = layovers(leg);
  const rows = leg.segments.map((s, i) => `
    ${i ? `<div class="connection">${hm(stops[i - 1].minutes)} connection in ${stops[i - 1].airport}</div>` : ''}
    <div class="flight">
      <span class="flight-no">${s.marketing_carrier_code} ${s.flight_number}</span>
      <span class="time">${time(s.departure_time_local)}${shift(s.departure_time_local)} ${s.departure_airport}</span>
      <span class="time">${time(s.arrival_time_local)}${shift(s.arrival_time_local)} ${s.arrival_airport}</span>
      <span class="duration">${hm(s.duration_minutes)}</span>
      <span class="operator">${s.operating_carrier_name ?? ''}</span>
    </div>`).join('');
  return `
    <div class="leg">
      <div class="leg-head">
        <b>${name}</b> ${first.departure_airport} → ${last.arrival_airport} ·
        ${stops.length ? `${stops.length} stop${stops.length > 1 ? 's' : ''}` : 'Direct'} · ${hm(leg.duration_minutes)} total
      </div>
      ${rows}
    </div>`;
}

function card(it) {
  const li = document.createElement('li');
  li.className = 'card';
  li.innerHTML = `
    <div class="legs">
      ${legHtml('Out', it.outbound)}
      ${it.inbound ? legHtml('Back', it.inbound) : ''}
    </div>
    <div class="buy">
      <strong>${money(it.price)}</strong>
      <button>Book</button>
    </div>
    <div class="links"></div>`;
  li.querySelector('button').addEventListener('click', (e) => showBookingLinks(it, li, e.target));
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
        ${data.booking_options.length > 1 ? `<span class="covers">${opt.legs.join(' + ')}</span>` : ''}
        ${opt.links.map((l) => `
          <a href="${l.url}" target="_blank" rel="noopener">
            ${l.provider_name}${l.provider_type === 'airline' ? ' ✈' : ''}${l.fare_name ? ` (${l.fare_name})` : ''}${l.price ? ` · ${money(l.price)}` : ''}
          </a>`).join('')}
      </div>`).join('') || 'No booking options available.';
  } catch (err) {
    box.textContent = `Could not get booking links: ${err.message}`;
    button.disabled = false;
  }
}
