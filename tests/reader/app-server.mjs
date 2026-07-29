// Serves out/ — the static export — the way Cloudflare Pages does: directory URLs resolve
// to index.html, and a missing extension is tried as .html. The reader route is
// /reader/{slug}, which the export emits as out/reader/{slug}/index.html.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'out');
const PORT = Number(process.env.APP_PORT || 4322);

if (!existsSync(join(OUT, 'reading-room.html'))) {
  console.error('[app-harness] out/ is missing or stale — run `npx next build` first.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.epub': 'application/epub+zip', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const base = join(OUT, clean);
  const candidates = extname(base)
    ? [base]
    : [join(base, 'index.html'), `${base.replace(/\/$/, '')}.html`, base];
  for (const c of candidates) {
    if (!c.startsWith(OUT)) continue;
    try {
      const info = await stat(c);
      if (info.isFile()) return c;
    } catch { /* next candidate */ }
  }
  return null;
}

createServer(async (req, res) => {
  const file = await resolveFile(req.url || '/');
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
  const body = await readFile(file);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}).listen(PORT, () => console.log(`[app-harness] serving out/ on http://127.0.0.1:${PORT}`));
