// Tiny zero-dependency server: serves ./public and proxies a whitelist of
// Ignav endpoints, adding the API key so it never reaches the browser.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.IGNAV_API_KEY;
const IGNAV = 'https://ignav.com';
const PUBLIC = join(import.meta.dirname, 'public');
const PROXIED = new Set([
  '/api/fares/one-way',
  '/api/fares/round-trip',
  '/api/fares/booking-links',
  '/api/airports',
]);
const RETRIES = 4; // after the first try; backoff 0.5s, 1s, 2s, 4s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// Spending guard. Ignav bills every 200 response on this key and has no rate
// limit of its own, and the site is public. The box's router doesn't pass the
// visitor's IP, so the limits are global rather than per visitor.
const DAILY_LIMIT = Number(process.env.IGNAV_DAILY_LIMIT) || 500; // billable calls per UTC day; 500 is $1
const MAX_IN_FLIGHT = 24; // proxied calls at once, two picker clicks' worth; caps sockets held by retries
let inFlight = 0;
let usage = { day: '', billed: 0 }; // in memory, so a restart or deploy resets it

// One line per event, UTC timestamp first; systemd's journal keeps stdout/stderr.
const log = (msg, err = false) => (err ? console.error : console.log)(`${new Date().toISOString()} ${msg}`);
const clip = (s, n = 2000) => (s.length > n ? s.slice(0, n) + '…' : s);
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
};
process.on('uncaughtException', (e) => {
  log(`crash: ${e.stack ?? e}`, true);
  process.exit(1);
});

if (!API_KEY) log('IGNAV_API_KEY is not set; API calls will fail.', true);

async function handle(req, res) {
  if (!URL.canParse(req.url, 'http://localhost')) return res.writeHead(400).end('Bad request');
  const url = new URL(req.url, 'http://localhost');

  if (PROXIED.has(url.pathname)) {
    const day = new Date().toISOString().slice(0, 10);
    if (usage.day !== day) usage = { day, billed: 0 };
    // Calls in flight may all be billed, so they count against today's budget too.
    const refusal =
      usage.billed + inFlight >= DAILY_LIMIT ? `This site's daily limit of ${DAILY_LIMIT} searches is used up. It resets at midnight UTC.`
      : inFlight >= MAX_IN_FLIGHT ? 'Too many searches are running at once. Try again in a minute.'
      : null;
    if (refusal) {
      log(`refused ${req.method} ${url.pathname}: ${refusal}`, true);
      return json(res, 429, { error: { type: 'rate_limit', code: 'flights_limit', message: refusal } });
    }
    inFlight++;
    try {
      const body = req.method === 'POST' ? await new Response(req).text() : undefined;
      // The request body holds the search parameters (route, dates, market), enough to reproduce a call.
      const call = `${req.method} ${url.pathname}${url.search}${body ? ' ' + clip(body) : ''}`;
      // Ignav's 424 unable_to_complete_request is a transient upstream failure that
      // often clears on the next try; failed calls aren't billed, so retry those
      // and network errors with exponential backoff (ignav.com/docs/production-checklist).
      for (let attempt = 1; ; attempt++) {
        const start = Date.now();
        const tag = attempt > 1 ? ` (try ${attempt})` : '';
        const last = attempt === RETRIES + 1;
        try {
          const upstream = await fetch(IGNAV + url.pathname + url.search, {
            method: req.method,
            headers: { 'X-Api-Key': API_KEY ?? '', 'Content-Type': 'application/json' },
            body,
          });
          const text = await upstream.text();
          const ok = upstream.ok;
          log(`ignav ${upstream.status} ${Date.now() - start}ms ${call}${ok ? '' : ' -> ' + clip(text)}${tag}`, !ok);
          if (!last && upstream.status === 424 && text.includes('"unable_to_complete_request"')) {
            await sleep(500 * 2 ** (attempt - 1));
            continue;
          }
          if (upstream.status === 200) usage.billed++;
          return json(res, upstream.status, text);
        } catch (e) {
          log(`ignav failed ${Date.now() - start}ms ${call} -> ${e.cause ?? e}${tag}`, true);
          if (!last) {
            await sleep(500 * 2 ** (attempt - 1));
            continue;
          }
          return json(res, 502, { error: { message: 'Upstream request failed' } });
        }
      }
    } finally {
      inFlight--;
    }
  }

  const path = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(PUBLIC)) return res.writeHead(403).end();
  try {
    const file = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

// A bug or an aborted upload fails that one request, not the whole server.
createServer((req, res) =>
  handle(req, res).catch((e) => {
    log(`error ${req.method} ${req.url} -> ${e.stack ?? e}`, true);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }),
).listen(PORT, () => log(`Flights app on http://localhost:${PORT}`));
