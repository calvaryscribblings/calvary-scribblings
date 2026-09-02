// End-to-end browser trace of the four surfaces (Phase C, item 4).
//
//   node scripts/trace-surfaces.mjs <out-dir> <label>
//
// Serves a built static export, drives real Chrome (puppeteer-core + the cached
// binary), and measures navigation → content-ready for gateway / public-library /
// a category page / a story page, at full speed AND Fast 3G (CDP network
// emulation). Content-ready = when the surface's real content is in the DOM:
//   gateway      — the baked door is static HTML → paint of the door element
//   public-lib   — first story-card link appears (after the RTDB read)
//   category     — first story-card link appears (after the RTDB read)
//   story page   — #story-content carries prose (now inlined in the HTML)
//
// Prints a table. Run once per built tree to get a before/after comparison.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = resolve(process.argv[2] || 'out');
const LABEL = process.argv[3] || 'after';
const CHROME = '/home/codespace/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';

// DevTools "Fast 3G": 1.6 Mbit/s * 0.9 down, 562.5 ms RTT.
const FAST_3G = { downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8, uploadThroughput: (0.75 * 1024 * 1024 * 0.9) / 8, latency: 562.5, offline: false };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };

async function tryFiles(urlPath) {
  const clean = urlPath.split('?')[0].replace(/\/$/, '');
  const candidates = [ join(OUT, clean), join(OUT, clean + '.html'), join(OUT, clean, 'index.html') ];
  if (clean === '' || clean === '/') candidates.unshift(join(OUT, 'index.html'));
  for (const c of candidates) {
    try { const s = await stat(c); if (s.isFile()) return c; } catch {}
  }
  return join(OUT, '404.html');
}

const server = createServer(async (req, res) => {
  const file = await tryFiles(req.url);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});

const PORT = 5051;
await new Promise((r) => server.listen(PORT, r));
const base = `http://localhost:${PORT}`;

const SURFACES = [
  { name: 'gateway',        url: '/',                marker: `document.querySelectorAll('a[href^="/public-library"], a[href^="/stories/"]').length > 0 || /\\d/.test(document.body.innerText)` },
  { name: 'public-library', url: '/public-library',  marker: `document.querySelectorAll('a[href^="/stories/"]').length > 0` },
  { name: 'category/short', url: '/short',           marker: `document.querySelectorAll('a[href^="/stories/"]').length > 0` },
  { name: 'story/1967',     url: '/stories/1967',    marker: `(document.querySelector('#story-content')?.innerText || '').length > 120` },
];

async function measure(page, surface, throttle) {
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttle) await client.send('Network.emulateNetworkConditions', throttle);

  let bytes = 0;
  client.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });

  await page.goto(base + surface.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ready = null;
  try {
    ready = await page.evaluate(async (markerExpr) => {
      const start = performance.now();
      const test = new Function('return (' + markerExpr + ')');
      while (performance.now() - start < 45000) {
        try { if (test()) return performance.now(); } catch {}
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    }, surface.marker);
  } catch {}
  await client.detach();
  return { ready, bytes };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const rows = [];
for (const surface of SURFACES) {
  for (const [mode, throttle] of [['full', null], ['fast3g', FAST_3G]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    let r;
    try { r = await measure(page, surface, throttle); } catch (e) { r = { ready: null, bytes: 0, err: e.message }; }
    await page.close();
    rows.push({ surface: surface.name, mode, ...r });
    console.log(`[${LABEL}] ${surface.name.padEnd(16)} ${mode.padEnd(7)} ready=${r.ready ? (r.ready / 1000).toFixed(2) + 's' : 'TIMEOUT'}  bytes=${(r.bytes / 1024).toFixed(0)}KB${r.err ? '  ERR ' + r.err : ''}`);
  }
}
await browser.close();
server.close();
console.log('\nJSON', JSON.stringify({ label: LABEL, rows }));
process.exit(0);
