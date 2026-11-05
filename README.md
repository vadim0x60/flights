# Flights

A small flight search and booking app built on the [Ignav API](https://ignav.com/docs). It's meant as a base for trying out custom filters.

```sh
IGNAV_API_KEY=... npm start   # http://localhost:3000, needs Node 20.11+, no dependencies
```

- `server.js` serves `public/` and forwards a few Ignav endpoints with your API key added, so the key stays out of the browser.
- `public/dates.js` is the date picker. You toggle departure days and return days, which don't have to be consecutive, such as four Fridays. A round trip searches every pair where the return is on or after the departure, optionally limited to a min–max length of stay (say 2–3 nights for weekend trips only). Each pair is one search, and the picker stops at 12.
- `public/app.js` runs one search per date or date pair (one-way or round-trip), merges the results, and handles sorting and booking links. Booking links come from `/api/fares/booking-links` using the itinerary's `ignav_id`.
- `public/filters/index.js` holds the list of custom filters. `public/filters/util.js` has helpers such as `legs`, `segments`, `layovers` and `hour`.
- `public/filters/wifi.js` gives each flight a Wi-Fi verdict, such as "video calls work" or "no Wi-Fi", using the airline and aircraft type. The data comes from [FlightWifi's open registry](https://flightwifi.app/data.json) (CC BY 4.0), which the browser fetches when the page loads.

## Adding a filter

Add an object to the array in `public/filters/index.js`:

```js
{
  id: 'max-two-segments',
  label: 'At most one connection per leg',
  control: { type: 'checkbox' },          // or 'number' / 'text', with optional default and placeholder
  keep: (itinerary, value) => legs(itinerary).every((leg) => leg.segments.length <= 2),
}
```

`keep` only runs while its control is active: a checked checkbox, or a number or text field that isn't empty. An optional `remark: (value, { origin, destination }) => text or null` shows a note under the control while it's active; `no-usa` uses it to comment on US searches. Filters run in the browser on results you've already fetched, so changing them doesn't make new API requests. Each search or booking-link lookup counts as one billable Ignav request.

Ignav also supports server-side filters (`max_stops`, `max_price`, `departure_time_range`, `airlines_include`/`airlines_exclude`, and bag minimums). See the [one-way docs](https://ignav.com/docs/one-way). To use them, add them to the request body in `app.js`.
