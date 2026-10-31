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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

if (!API_KEY) console.warn('IGNAV_API_KEY is not set; API calls will fail.');

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (PROXIED.has(url.pathname)) {
    const body = req.method === 'POST' ? await new Response(req).text() : undefined;
    const upstream = await fetch(IGNAV + url.pathname + url.search, {
      method: req.method,
      headers: { 'X-Api-Key': API_KEY ?? '', 'Content-Type': 'application/json' },
      body,
    });
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    return res.end(await upstream.text());
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
}).listen(PORT, () => console.log(`Flights app on http://localhost:${PORT}`));
