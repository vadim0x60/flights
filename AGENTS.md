# Flights: notes for agents

A zero-dependency Node app: `server.js` serves `public/` and forwards four Ignav endpoints with the API key added. The README lists what each file does: `public/app.js` runs searches and renders the result cards, `public/style.css` styles them, `public/dates.js` is the date picker and `public/filters/` holds the filters.

## Run it

- `npm run mock` runs the app on http://localhost:3000 against a fake Ignav, with no API key needed and no quota spent. Use it for all UI work.
- `IGNAV_API_KEY=... npm run dev` runs it against live Ignav, where every successful search is billed. Use it only to check something the mock can't show.
- In an orb, `amp orb services ensure` starts the `web` service from `.amp/services.yaml` in mock mode on port 3000 and prints its portal URL.
- Needs Node 20.11 or newer. There is no build step.
- There are no tests, no CI and no linter. To check a change, run the app and use the page, for example with agent-browser. Scratch scripts are fine but don't commit them.

## Mock mode

With `IGNAV_MOCK=1`, `server.js` sends Ignav calls to `mock.js` instead of `fetch`. Everything else in the server runs as normal: retries, limits and logging. Its log lines start with `mock` instead of `ignav`. The header comment in `mock.js` documents what it does.

- **Routes.** Any airport in `public/filters/airports.js` works, as do the metro codes LON, PAR, ROM, MIL, TYO and NYC.
- **Results.** You get directs, one-stop trips through the big hubs, and a two-stop trip on longer routes. Times are local with real time zones, and prices are in the market's currency. Ryanair, easyJet and Vueling appear, so the airline and Wi-Fi filters have something to act on.
- **Deterministic.** The same search always returns the same itineraries.
- **Booking links.** Each one-way or same-airline round trip gets one booking with an airline link and two third-party links. A round trip that comes back on another airline is booked in two parts. Two-stop itineraries get a 404, which tests the "Could not get booking links" state.
- **Errors.** Unknown airport codes, the same city at both ends, past dates and a round trip without a return date get Ignav's 400 errors. Departures more than 330 days ahead get 424 `unsupported_search`.
- **Failures on demand.** Set these in the Market field:
  - `XF` fails each search twice with 424 `unable_to_complete_request`, then succeeds, which exercises the server's retries.
  - `XD` always fails with that 424, so the server gives up after 5 tries (about 10 s).
  - `XP` fails only searches that depart on an odd day of the month, so a multi-date search partly fails. Search LON→BCN for two Fridays and the Sundays after them to see results next to a failure message in `#status`.
  - `XN` throws a network error, so the server answers 502.

Don't inject fetch stubs into the page. If the mock lacks a case, add it to `mock.js` and keep its responses within Ignav's schema (https://ignav.com/api/openapi.json). `mock.js` isn't listed in the `artifacts` in `.amp/box.yaml`, so it never ships to production.

## Production and deploying

- **Where it runs.** https://flights.vadim.me is the Amp Box deployment `flights` on the box `vadimdotme/thebox`, configured by `.amp/box.yaml` and `.amp/box-deploy.json`. It's public. It runs plain `./runtime/node server.js` (a pinned Node 26.13.1) under systemd, which restarts it when it exits. `IGNAV_API_KEY` is a secret on that deployment. Set it with `manage_amp`, topic `secrets`, scope `box`; `amp secrets set` is refused inside an orb.
- **Deploying.** Ask Vadim before deploying; pushing to master needs his go-ahead too.
  1. Check the change in mock mode (`npm run mock`, http://localhost:3000).
  2. Commit and push to master. The `Deploy to box` workflow (`.github/workflows/deploy.yml`) then runs `amp boxes deploy` with Vadim's personal Amp API key from the `AMP_API_KEY` repository secret. No flags are needed because the target is saved in `.amp/box-deploy.json`. To deploy by hand instead, run `amp boxes deploy` from a clean checkout of master.
  3. Check the workflow run in GitHub Actions.
  4. `amp boxes deployments vadimdotme/thebox` should show `"status": "ready"` and the pushed commit as `deployedCommitSHA`. Then load https://flights.vadim.me/.
- **Logs.** They're in the box's journal: `amp boxes exec vadimdotme/thebox 'sudo journalctl -u amp-box-deploy-37298324-760e-49e4-a781-142cf5c24e7c-svc-web.service -n 200 --no-pager'`. Every Ignav call has had a log line since 2026-11-04T13:09:54Z. The box's log starts 2026-11-24.
- **History.** Until 2026-11-24 the site ran as the `web` service of the Deploy Orb thread (T-01a19e35-1e4c-7164-9990-e5298c53644e), and deploying meant asking that thread to pull master and run `amp orb service restart web`. That service is stopped and no longer serves the site. The thread still holds the deploy history.

## Spending limits in server.js

The site is public and every search is billed to Vadim's key, so the server refuses Ignav calls with a 429 in two cases. The page shows the 429's message as a failed search.

- **Daily limit.** Successful calls plus calls in flight may not exceed `IGNAV_DAILY_LIMIT` per UTC day. The default is 500, which is $1 a day.
- **Concurrency.** At most 24 proxied calls run at once, which is two full picker clicks. This also limits sockets held open by retries.

Both limits are global, not per visitor, because the app doesn't learn the visitor's IP. A request through an orb portal arrived with no `X-Forwarded-For`, and the Box router's source says forwarding headers are stripped. The daily count is kept in memory, so a restart or deploy resets it. The picker's limit of 12 searches per click (`MAX_SEARCHES` in `public/dates.js`) is enforced only in the browser.

## Ignav facts

- **Billing.** Only HTTP 200 responses are billed: fare searches, booking-link lookups and airport searches. Failed calls (4xx and 5xx), including the retried 424s, are never billed (see ignav.com/docs/faq and ignav.com/docs/production-checklist). The first 1,000 requests are a one-time free allowance. After that it's $2 per 1,000. Ignav has no rate limit of its own. An optional monthly spending limit in the dashboard returns 429 `monthly_spend_limit_reached`.
- **Intermittent 424s.** Ignav often returns 424 `upstream_error` / `unable_to_complete_request`. On the first try, 11 of 39 round trips and 3 of 22 one-ways failed this way. Some round trips (LON→SYD, LON→BCN, LON→ROM, LON→PAR) failed all 5 tries, then worked on their own 2–5 minutes later. `server.js` retries these and network errors 4 times, after 0.5, 1, 2 and 4 s. A stuck search therefore costs 5 upstream calls and about 10–27 s. The other 424, `unsupported_search` (dates out of range), fails every time, so the server doesn't retry it.
- **Caching.** Ignav caches identical searches for up to 30 minutes. A repeat returns 200 in about 0.1 s even if the same search just failed. When testing error handling, use the mock or fresh routes and dates, or the test will seem to pass.
- **No logs on Ignav's side.** Ignav has no request-log or usage endpoint, and a 424 carries no request ID. The two-leg `/api/fares/search` endpoint fails the same way, so it's no workaround for failing round trips.
- **Not reported.** Nobody has told Ignav (gus@ignav.com) about the round trips that keep failing.

## Where knowledge lives

vadim0x60/flights has no GitHub issues or PRs. Known work and findings live only in Amp threads, and thread search can't be limited to one project. Commits made by Amp have an `Amp-Thread-ID` trailer, so `git log` leads to the thread behind a change. Useful threads:

- T-01a19e35-1e4c-7164-9990-e5298c53644e: the Deploy Orb, covering hosting, the domain and the move to the Box.
- T-01a1a6c6-16e8-771b-becc-bbf4841f6d40: the Ignav 424 investigation and the retries.
- T-01a1a6a6-761a-7400-8b7c-5c4143bbcbe6: the multi-date picker.
- T-01a1a24a-dca5-7112-8627-f801bc63ff23: anonymous public access.

## Conventions

- Branch `master`.
- Log timestamps in UTC.
- No dependencies: anything added must work with plain `node`.
