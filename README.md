# Flights

A small flight search and booking app built on the [Ignav API](https://ignav.com/docs). It's meant as a base for trying out custom filters.

```sh
IGNAV_API_KEY=... npm start   # http://localhost:3000, needs Node 20.11+, no dependencies
```

- `server.js` serves `public/` and forwards a few Ignav endpoints with your API key added, so the key stays out of the browser.
- `public/app.js` handles search (one-way, or round-trip when you set a return date), sorting, and booking links. Booking links come from `/api/fares/booking-links` using the itinerary's `ignav_id`.
- `public/filters/index.js` holds the list of custom filters. `public/filters/util.js` has helpers such as `legs`, `segments`, `layovers` and `hour`.

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

`keep` only runs while its control is active: a checked checkbox, or a number or text field that isn't empty. Filters run in the browser on results you've already fetched, so changing them doesn't make new API requests. Each search or booking-link lookup counts as one billable Ignav request.

Ignav also supports server-side filters (`max_stops`, `max_price`, `departure_time_range`, `airlines_include`/`airlines_exclude`, and bag minimums). See the [one-way docs](https://ignav.com/docs/one-way). To use them, add them to the request body in `app.js`.
