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

// One line per event, UTC timestamp first; systemd's journal keeps stdout/stderr.
const log = (msg, err = false) => (err ? console.error : console.log)(`${new Date().toISOString()} ${msg}`);
const clip = (s, n = 2000) => (s.length > n ? s.slice(0, n) + '…' : s);
process.on('uncaughtException', (e) => {
  log(`crash: ${e.stack ?? e}`, true);
  process.exit(1);
});

if (!API_KEY) log('IGNAV_API_KEY is not set; API calls will fail.', true);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (PROXIED.has(url.pathname)) {
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
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        return res.end(text);
      } catch (e) {
        log(`ignav failed ${Date.now() - start}ms ${call} -> ${e.cause ?? e}${tag}`, true);
        if (!last) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Upstream request failed' } }));
      }
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
}).listen(PORT, () => log(`Flights app on http://localhost:${PORT}`));
