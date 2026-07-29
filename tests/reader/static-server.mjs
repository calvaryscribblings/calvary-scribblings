// The harness's static server.
//
// public/ is served AT THE ROOT, because that is how Cloudflare Pages serves it and
// reading-room.html imports the vendored foliate modules by absolute path
// (/vendor/foliate-js-main/view.js). Serving the repo root instead would 404 every import
// and the harness would be testing a blank page.
//
// tests/ is mounted at /__t/ so the stub page and the fixture EPUB share the reader's
// origin — the host's postMessage bridge is origin-locked, so a cross-origin fixture would
// be a different test entirely.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const TESTS_DIR = join(ROOT, 'tests');
const PORT = Number(process.env.HARNESS_PORT || 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.epub': 'application/epub+zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (clean.startsWith('/__t/')) return join(TESTS_DIR, clean.slice('/__t/'.length));
  return join(PUBLIC_DIR, clean);
}

createServer(async (req, res) => {
  try {
    const file = resolvePath(req.url || '/');
    const base = file.startsWith(TESTS_DIR) ? TESTS_DIR : PUBLIC_DIR;
    if (!file.startsWith(base)) { res.writeHead(403).end('forbidden'); return; }
    const info = await stat(file);
    if (info.isDirectory()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}).listen(PORT, () => console.log(`[harness] serving public/ and /__t/ on http://127.0.0.1:${PORT}`));
