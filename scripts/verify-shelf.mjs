// Verification harness for the offline shelf (My Library Round 2).
//
// Runs against a built out/ in a real Chrome, because every claim this round makes is a
// claim about browser behaviour: service worker lifecycle, Cache Storage, IndexedDB, and
// the drop-cap tagger's effect on real CMS prose. None of it is provable from source.
//
//   node scripts/verify-shelf.mjs [outDir]
//
// Sections:
//   A  DECORATED OPENER — the Phase C check, re-run after the verbatim dropcap extraction.
//   B  PROSE PARITY     — computed typography on the story page after the CSS extraction.
//   C  SAVE GESTURE     — the pill renders in back-link-row and touches nothing around it.
//   D  SERVICE WORKER   — registration, shell sealing, and the offline paths.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = resolve(process.argv[2] || 'out');
// chrome-headless-shell rather than the full chrome build: the full binary's Target domain
// is unusable in this container (Target.createTarget fails at newPage). The shell runs
// service workers, Cache Storage and IndexedDB, which is everything this harness needs.
const CHROME = process.env.CHROME_BIN
  || '/home/codespace/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };

async function tryFiles(urlPath) {
  const clean = urlPath.split('?')[0].replace(/\/$/, '');
  const candidates = [join(OUT, clean), join(OUT, clean + '.html'), join(OUT, clean, 'index.html')];
  if (clean === '' || clean === '/') candidates.unshift(join(OUT, 'index.html'));
  for (const c of candidates) { try { const s = await stat(c); if (s.isFile()) return c; } catch {} }
  return null;
}

const server = createServer(async (req, res) => {
  const file = await tryFiles(req.url);
  if (!file) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('not found'); return; }
  try {
    const body = await readFile(file);
    // Mirror public/_headers for the one file whose caching is load-bearing.
    const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream' };
    if (req.url.startsWith('/sw.js')) headers['cache-control'] = 'no-cache, must-revalidate';
    res.writeHead(200, headers);
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});

const PORT = 5052;
await new Promise((r) => server.listen(PORT, r));
const base = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
// One round-trip before the first newPage(). Without it, Target.createTarget intermittently
// comes back "Session with given id not found" in this container — launch() resolves as
// soon as the websocket is up, slightly before the browser target is addressable. Asking
// for the version forces that handshake to complete. Reproducible: remove this line and the
// first newPage() fails maybe half the time.
await browser.version();

// ── A. DECORATED OPENER ──────────────────────────────────────────────────────────────────
// The drop cap must land on the first paragraph that is actually the story, skipping
// content notes, epigraphs and dedications. Run across a spread of real stories rather
// than one, because the front-matter shapes are what the predicates exist for.
console.log('\nA. DECORATED OPENER — dropcap after the verbatim extraction');
const { readdir } = await import('node:fs/promises');
const slugs = (await readdir(join(OUT, 'stories')))
  .filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
const sample = slugs.filter((_, i) => i % Math.ceil(slugs.length / 24) === 0).slice(0, 24);

let dropOk = 0, dropSkipped = 0, frontmatterSeen = 0;
const anomalies = [];
for (const slug of sample) {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/stories/${slug}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const r = await page.evaluate(async () => {
      // Poll for the TAG, not for a fixed delay. The story page hydrates, then refreshes
      // the record from the CMS, which can re-apply the body HTML and make the observer
      // re-tag; a fixed wait races that and reports a false negative.
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        const c = document.querySelector('.prose.has-dropcap');
        if (c && c.querySelector('p.dropcap-target')) break;
        await new Promise((r) => setTimeout(r, 80));
      }
      const c = document.querySelector('.prose.has-dropcap');
      if (!c) return { poetry: true };
      const paras = [...c.querySelectorAll('p')].filter((p) => (p.textContent || '').trim());
      const targets = [...c.querySelectorAll('p.dropcap-target')];
      const fm = [...c.querySelectorAll('p.story-frontmatter')];
      const idx = targets.length === 1 ? paras.indexOf(targets[0]) : -1;
      return {
        paras: paras.length, targets: targets.length, fm: fm.length, idx,
        size: targets[0] ? getComputedStyle(targets[0], '::first-letter').fontSize : null,
        color: targets[0] ? getComputedStyle(targets[0], '::first-letter').color : null,
        head: targets[0] ? (targets[0].textContent || '').trim().slice(0, 46) : null,
        fmHead: fm[0] ? (fm[0].textContent || '').trim().slice(0, 46) : null,
      };
    });
    if (r.poetry) { dropSkipped++; }
    else {
      const good = r.targets === 1 && r.idx === r.fm;
      if (good) dropOk++; else anomalies.push({ slug, ...r });
      if (r.fm > 0) frontmatterSeen++;
    }
  } catch (e) {
    // Reader-mode stories (novel / bookReader / readerMode) redirect themselves to
    // /reader/<slug> on mount — page-client does window.location.replace before the prose
    // ever renders — which destroys the execution context mid-evaluate. That is the story
    // page working as designed, not a dropcap failure.
    //
    // page.url() is polled rather than read once: at the instant evaluate() throws the
    // navigation is still in flight, so a single read still returns /stories/<slug> and
    // misclassifies the redirect as a failure.
    let isReader = false;
    if (/Execution context was destroyed|Target closed|frame was detached/i.test(e.message)) {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (page.url().includes('/reader/')) { isReader = true; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (isReader) dropSkipped++; else anomalies.push({ slug, error: e.message });
  }
  await page.close();
}
ok(`exactly one dropcap-target, after all tagged front-matter`, anomalies.length === 0,
  `${dropOk}/${sample.length - dropSkipped} prose stories, ${dropSkipped} verse (no has-dropcap), ${frontmatterSeen} with front-matter`);
if (anomalies.length) console.log('    anomalies:', JSON.stringify(anomalies.slice(0, 5), null, 2));

// ── B. PROSE PARITY ──────────────────────────────────────────────────────────────────────
console.log('\nB. PROSE PARITY — computed typography after the CSS extraction');
{
  const page = await browser.newPage();
  await page.goto(`${base}/stories/${sample[0]}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  const s = await page.evaluate(() => {
    const p = document.querySelector('.prose');
    const t = document.querySelector('.prose.has-dropcap p.dropcap-target');
    const cs = getComputedStyle(p);
    const fl = t ? getComputedStyle(t, '::first-letter') : null;
    const bq = document.createElement('blockquote'); p.appendChild(bq);
    const bqs = getComputedStyle(bq); const bql = bqs.borderLeftWidth; p.removeChild(bq);
    return {
      fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color,
      family: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      capSize: fl?.fontSize, capColor: fl?.color, capFloat: fl?.float, bqBorder: bql,
    };
  });
  // 1.15rem = 18.4px, line-height 1.85 → 34.04px, color #1a1a1a, dropcap 4.2em of 18.4 = 77.28px
  ok('.prose font-size 1.15rem', s.fontSize === '18.4px', s.fontSize);
  ok('.prose line-height 1.85', s.lineHeight === '34.04px', s.lineHeight);
  ok('.prose color #1a1a1a', s.color === 'rgb(26, 26, 26)', s.color);
  ok('.prose family Cormorant Garamond', s.family === 'Cormorant Garamond', s.family);
  ok('dropcap ::first-letter 4.2em', s.capSize === '77.28px', s.capSize);
  ok('dropcap gold #c9a84c', s.capColor === 'rgb(201, 168, 76)', s.capColor);
  ok('dropcap floats left', s.capFloat === 'left', s.capFloat);
  ok('.prose blockquote 4px rule', s.bqBorder === '4px', s.bqBorder);
  await page.close();
}

// ── C. SAVE GESTURE ──────────────────────────────────────────────────────────────────────
console.log('\nC. SAVE GESTURE — placement and non-interference');
{
  const page = await browser.newPage();
  await page.goto(`${base}/stories/${sample[0]}`, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(async () => {
    // The entrance is hidden → entering → settled over PROSE_ENTER_MS (650ms), gated on
    // fonts. Poll for the end state rather than sleeping past a guess.
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      if (document.querySelector('.story-body-wrap.prose-settled')) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    const row = document.querySelector('.back-link-row');
    const btn = [...(row?.querySelectorAll('button') || [])].find((b) => /save for offline|on your shelf|needs a connection/i.test(b.textContent));
    const prose = document.querySelector('.prose.has-dropcap');
    return {
      inRow: !!btn,
      insideProse: btn ? !!btn.closest('.prose') : null,
      insideWrap: btn ? !!btn.closest('.story-body-wrap') : null,
      label: btn?.textContent.trim(),
      targetsAfter: prose ? prose.querySelectorAll('p.dropcap-target').length : -1,
      wrapClass: document.querySelector('.story-body-wrap')?.className,
    };
  });
  ok('pill renders inside .back-link-row', r.inRow, r.label || '');
  ok('pill is OUTSIDE .prose (dropcap tagger cannot see it)', r.insideProse === false);
  ok('pill is INSIDE .story-body-wrap (inherits the prose entrance)', r.insideWrap === true);
  ok('prose entrance still reaches settled', /prose-settled/.test(r.wrapClass || ''), r.wrapClass);
  ok('still exactly one dropcap-target with the pill present', r.targetsAfter === 1, String(r.targetsAfter));
  await page.close();
}

// ── D. SERVICE WORKER ────────────────────────────────────────────────────────────────────
console.log('\nD. SERVICE WORKER — registration, sealing, and the offline paths');
{
  const page = await browser.newPage();
  await page.goto(`${base}/my-library`, { waitUntil: 'domcontentloaded' });

  const reg = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const r = await navigator.serviceWorker.getRegistration();
      if (r?.active) return { scope: r.scope, script: r.active.scriptURL };
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });
  ok('service worker registers at scope /', !!reg && reg.scope.endsWith('/'), reg ? reg.scope : 'no registration');

  const sealed = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const keys = await caches.keys();
      const shell = keys.find((k) => k.startsWith('cs-shell-v'));
      if (shell) {
        const c = await caches.open(shell);
        const urls = (await c.keys()).map((r) => new URL(r.url).pathname);
        const docs = urls.filter((u) => !u.startsWith('/_next/static/'));
        // Wait for the seal to be COMPLETE, not merely started: chunks are cached after
        // the documents, so requiring both documents avoids sampling mid-seal.
        if (urls.some((u) => u.startsWith('/_next/static/')) && docs.includes('/my-library/read')) {
          return { shell, total: urls.length, chunks: urls.filter((u) => u.startsWith('/_next/static/')).length, docs };
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  });
  ok('shelf shell sealed (documents + RSC + chunks)', !!sealed,
    sealed ? `${sealed.shell}: ${sealed.chunks} chunks, docs=[${sealed.docs.join(', ')}]` : 'never sealed');

  // The gateway fence, asserted rather than assumed: '/' must never be in the cache, which
  // is only true if respondWith was never called for it.
  const gatewayCached = await page.evaluate(async () => {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      for (const r of await c.keys()) { const p = new URL(r.url).pathname; if (p === '/' || p === '/index.html') return true; }
    }
    return false;
  });
  ok('gateway never cached (literal pass-through held)', gatewayCached === false);

  // Seed a shelf record so the offline story→reader redirect has something to find. The
  // worker's lookup is uid-blind by design, so a bare record is enough to exercise it.
  await page.evaluate((slug) => new Promise((res) => {
    const req = indexedDB.open('cs-shelf', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('shelf')) {
        const s = db.createObjectStore('shelf', { keyPath: 'id' });
        s.createIndex('kind', 'kind'); s.createIndex('savedAt', 'savedAt'); s.createIndex('uid_kind', ['uid', 'kind']);
      }
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction(['shelf'], 'readwrite');
      t.objectStore('shelf').put({ id: `story:${slug}`, kind: 'story', slug, uid: 'verify', title: 'Seeded', savedAt: Date.now(), content: '<p>seed</p>' });
      t.oncomplete = () => res();
      t.onerror = () => res();
    };
    req.onerror = () => res();
  }), sample[0]);

  // ── going offline, for real ────────────────────────────────────────────────────────────
  // NOT CDP's Network.emulateNetworkConditions. That is scoped to the page target, and a
  // service worker's own fetches run outside it — so an "offline" page can still be served
  // live bytes by its worker, and the test passes for the wrong reason. Closing the origin
  // server is unambiguous: there is nothing left to reach.
  await new Promise((r) => server.close(r));

  // D1 — the shelf itself, with no network.
  await page.goto(`${base}/my-library`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const shelfOffline = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const txt = document.body.innerText || '';
      if (/MY LIBRARY/i.test(txt) && txt.length > 60) return { text: txt.slice(0, 220), stuck: false };
      await new Promise((r) => setTimeout(r, 120));
    }
    return { text: (document.body.innerText || '').slice(0, 220), stuck: true };
  }).catch((e) => ({ text: e.message, stuck: true }));
  ok('/my-library renders with the origin down', !shelfOffline.stuck,
    shelfOffline.text.replace(/\n+/g, ' | ').slice(0, 110));

  // D2 — a saved story requested by its real URL redirects to the shelf reader.
  await page.goto(`${base}/stories/${sample[0]}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const landed = page.url();
  ok('offline /stories/<saved slug> redirects to the shelf reader',
    landed.includes('/my-library/read') && landed.includes(sample[0]), landed.replace(base, ''));

  // D3 — an UNSAVED story gets the worker's own page, not the browser's error.
  await page.goto(`${base}/stories/__definitely-not-saved__`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const fallback = await page.evaluate(() => ({
    text: (document.body.innerText || '').replace(/\n+/g, ' | ').slice(0, 160),
    hasLink: !!document.querySelector('a[href="/my-library"]'),
  })).catch((e) => ({ text: e.message, hasLink: false }));
  ok('offline unsaved story serves the synthesized offline page',
    fallback.hasLink && /shelf|offline|signal/i.test(fallback.text), fallback.text.slice(0, 110));

  // D4 — the gateway fence, at the moment it costs something. With the origin down the
  // worker COULD rescue '/' with the same offline page. It must not: the fence is literal.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  const gatewayOffline = await page.evaluate(() => (document.body.innerText || '').slice(0, 120)).catch(() => '');
  ok('gateway still un-intercepted with the origin down (no shelf page served)',
    !/GO TO MY LIBRARY/i.test(gatewayOffline), JSON.stringify(gatewayOffline.slice(0, 60)));

  await page.close();
}

// ── the manifest ─────────────────────────────────────────────────────────────────────────
console.log('\nE. MANIFEST');
{
  await new Promise((r) => server.listen(PORT, r)); // bring the origin back up
  const page = await browser.newPage();
  await page.goto(`${base}/my-library`, { waitUntil: 'domcontentloaded' });
  const m = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const r = await fetch(link.href);
    return { type: r.headers.get('content-type'), json: await r.json() };
  });
  ok('manifest linked and served', !!m, m ? m.type : 'missing');
  ok('start_url is the shelf', m?.json?.start_url === '/my-library', m?.json?.start_url);
  ok('night theme_color', m?.json?.theme_color === '#0b0716', m?.json?.theme_color);
  ok('maskable icons present', (m?.json?.icons || []).filter((i) => /maskable/.test(i.purpose || '')).length === 2);
  await page.close();
}

await browser.close();
try { server.close(); } catch {}
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
