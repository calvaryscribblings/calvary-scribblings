// UNRELEASED-1 — out/ served as Cloudflare Pages serves it (a missing file is out/404.html, status
// 404), plus the REAL /api/story Pages Function, run in-process against the database emulator.
//
// The function is functions/api/story.js itself, not a stand-in: its only outside calls are the
// OAuth token mint and the database, and this process's fetch answers the first with an emulator
// admin token ("owner") and points the second at 127.0.0.1:9000 with the emulator's namespace.
// Anything else it tries to reach (but this machine) is refused, so it cannot touch production.
//
// /api/hit is recorded rather than run: the suite asserts the page COUNTS a read (it sends the
// hit), and the hit's own arithmetic has its own suites (tests/reads).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { EMU, NS } from './fixture.mjs';

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600, token_type: 'Bearer' }), { headers: { 'content-type': 'application/json' } });
  }
  if (url.startsWith(EMU)) {
    const u = new URL(url);
    u.searchParams.set('ns', NS);
    return realFetch(u.toString(), init);
  }
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return realFetch(input, init);   // the suite reaching this harness
  throw new Error(`[unreleased harness] refused an outside call to ${new URL(url).host}`);
};

const { onRequest } = await import('../../functions/api/story.js');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'emulator',
  FIREBASE_CLIENT_EMAIL: 'harness@emulator.invalid',
  FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  FIREBASE_DATABASE_URL: EMU,
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

async function resolveFile(out, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const base = join(out, clean);
  const candidates = extname(base) ? [base] : [join(base, 'index.html'), `${base.replace(/\/$/, '')}.html`, base];
  for (const c of candidates) {
    if (!c.startsWith(out)) continue;
    try { if ((await stat(c)).isFile()) return c; } catch { /* next */ }
  }
  return null;
}

/** Serve `out` on `port`. Resolves to { url, hits, storyCalls, close }. */
export function serve(out, port = 0) {
  const hits = [];
  const storyCalls = [];
  const srv = createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path === '/api/story') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString('utf8');
      const r = await onRequest({ request: new Request('http://harness/api/story', { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? body : undefined }), env: ENV, waitUntil: () => {} });
      storyCalls.push({ slug: (() => { try { return JSON.parse(body).slug; } catch { return null; } })(), status: r.status });
      res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (path === '/api/hit') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { hits.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { hits.push({}); }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ count: hits.length }));
      return;
    }
    if (path.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not in this harness"}'); return; }
    const file = await resolveFile(out, req.url || '/');
    if (!file) {
      const body = await readFile(join(out, '404.html'));
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${srv.address().port}`, hits, storyCalls, close: () => new Promise((r) => srv.close(r)),
  })));
}
