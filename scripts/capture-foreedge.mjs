#!/usr/bin/env node
// R17.4 — THE PROOF THAT THE FORE-EDGE GOT THINNER, captured from the real static export.
//
// Writes docs/r17-foreedge/: a before/after pair at each of the four board sizes the shop
// actually renders, plus the measurements both frames were captioned from.
//
//   node scripts/capture-foreedge.mjs        # needs a build in out/ — `npm run build` first
//
// ── WHY BOTH FRAMES COME FROM ONE RUN, AND THE "BEFORE" IS INJECTED ───────────────────────
//
// The honest way to shoot a before/after is to shoot the same page twice and change one thing
// between the frames. So this does not check out the old commit: it renders the shipped page,
// then re-renders it with R17.4's rule OVERRIDDEN BY THE ONE IT REPLACED — `width:12px;
// right:-11px`, verbatim from da3b53d — and shoots that as "before". Everything else in the
// frame is identical by construction, which is what makes the pair readable as a difference.
//
// The override is written out here rather than imported, precisely because it no longer exists
// in the tree. If it is ever wrong, the measured "before" percentages stop matching the ones
// FORE_EDGE.measured records, and tests/bookstore/foreedge.test.mjs fails on that comparison.
//
// ── THE CAPTION IS PART OF THE PROOF, SO IT HAS TO FIT ───────────────────────────────────
//
// An earlier capture printed the caption at a fixed font size and the handset frame — the one
// size the whole round is accountable to — ran its percentage off the right-hand edge. A proof
// whose number is cropped is not a proof. The caption now sizes itself to the viewport and is
// asserted to fit before the shutter, so that failure is loud rather than visible only to
// somebody who opens the file.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'out');
const DOCS = join(ROOT, 'docs/r17-foreedge');

if (!existsSync(OUT)) {
  console.error('No static export in out/. Run `npm run build` first.');
  process.exit(1);
}

const GATE_STORAGE_KEY = /^export const GATE_STORAGE_KEY = '([^']*)';/m
  .exec(readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8'))[1];

// The rule R17.4 replaced, verbatim. See the note above on why it is transcribed and not read.
const BEFORE_RULE = '.bb-foreedge{width:12px!important;right:-11px!important}';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain' };

/** The four boards the shop draws, and where each one stands. */
const SIZES = [
  { key: 'window-190',  path: '/bookstore', viewport: { width: 1280, height: 900 }, sel: '.window-book .bb-persp' },
  { key: 'curated-170', path: '/bookstore', viewport: { width: 1280, height: 900 }, sel: '.curated-case-book .bb-persp' },
  { key: 'shelf-200',   path: '/bookstore', viewport: { width: 1600, height: 900 }, sel: '.catalogue-section .shelf-entry .bb-persp' },
  // The acceptance test. 390px is the iPhone the walk was done on.
  { key: 'shelf-106',   path: '/bookstore', viewport: { width: 390,  height: 844 }, sel: '.catalogue-section .shelf-entry .bb-persp' },
];

function serve() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    for (const cand of [join(OUT, url), join(OUT, url, 'index.html'), join(OUT, `${url}.html`)]) {
      try {
        const body = await readFile(cand);
        res.writeHead(200, { 'content-type': MIME[extname(cand)] || 'application/octet-stream' });
        return res.end(body);
      } catch { /* try the next candidate */ }
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, port: server.address().port })));
}

/** Measure the strip, its board, and everything the trim had to leave alone. */
const PROBE = (sel) => {
  const persp = document.querySelector(sel);
  const fe = persp.querySelector('.bb-foreedge');
  const cs = getComputedStyle(fe);
  const board = persp.getBoundingClientRect();
  const cover = persp.querySelector('.bb-front').getBoundingClientRect();
  const edge = fe.getBoundingClientRect();
  const r = (n) => Math.round(n * 100) / 100;
  return {
    bookW: r(board.width), bookH: r(board.height),
    cssWidth: cs.width, cssRight: cs.right, cssTop: cs.top, cssBottom: cs.bottom,
    radius: cs.borderRadius, shadow: cs.boxShadow, background: cs.backgroundImage.slice(0, 100),
    // PAINTED width and the fraction of the board it occupies — the number the round is about.
    edgeW: r(edge.width), pct: r((edge.width / board.width) * 1000) / 10,
    // The seam, and how far the strip stands proud of the cover. Both projected.
    tuckPx: r(cover.right - edge.left), protrudePx: r(edge.right - cover.right),
    // The 2.5% insets, answering the walk's question about the block reaching full height.
    edgeH: r(edge.height), heightPctOfBook: r((edge.height / board.height) * 1000) / 10,
  };
};

// TWO LINES, not one. The handset frame is 390px wide and the full sentence cannot fit across
// it at a legible size — the first attempt cropped the percentage, which is the number the
// whole round is accountable to. Splitting it keeps every figure and lets each line be checked
// for fit on its own.
const caption = (key, m) => [
  `${key}  ·  board ${Math.round(m.bookW)}px`,
  `fore-edge ${m.edgeW.toFixed(2)}px = ${m.pct.toFixed(2)}% of the board`,
];

async function run() {
  await mkdir(DOCS, { recursive: true });
  const { server, port } = await serve();
  const browser = await chromium.launch();
  const out = { before: [], after: [] };

  for (const label of ['before', 'after']) {
    for (const size of SIZES) {
      const ctx = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: 3 });
      const page = await ctx.newPage();
      await page.addInitScript((k) => {
        try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
      }, GATE_STORAGE_KEY);
      await page.route('**/api/bookstore/region', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));

      await page.goto(`http://127.0.0.1:${port}${size.path}`);
      await page.locator(size.sel).first().waitFor({ state: 'visible', timeout: 30000 });
      await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
      if (label === 'before') await page.addStyleTag({ content: BEFORE_RULE });
      // Centre the book in the frame, so there is room below it for the caption. Without this
      // the caption clamps to the viewport floor, lands ABOVE the book, and the clip inverts.
      await page.locator(size.sel).first().scrollIntoViewIfNeeded();
      await page.evaluate((sel) => document.querySelector(sel)
        .scrollIntoView({ block: 'center', behavior: 'instant' }), size.sel);
      await page.waitForTimeout(300);

      const m = await page.evaluate(PROBE, size.sel);
      out[label].push({ key: size.key, ...m, label });

      // The caption, sized to the frame so the number can never be cropped — see the header.
      const lines = caption(size.key, m);
      const fits = await page.evaluate(({ lines, sel }) => {
        const persp = document.querySelector(sel);
        const box = persp.getBoundingClientRect();
        const bar = document.createElement('div');
        bar.id = 'fe-caption';
        // Sized off the viewport, not a constant: the handset frame is a third the laptop's width.
        bar.style.cssText = `position:fixed;left:2vw;right:2vw;top:${
          Math.round(box.bottom + 24)}px;z-index:2147483647;
          font:600 min(3.6vw,19px)/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
          color:#f2ead6;background:rgba(8,8,10,.94);border:1px solid #c9a84c;
          border-radius:4px;padding:9px 12px;text-align:center;letter-spacing:.01em`;
        for (const t of lines) {
          const row = document.createElement('div');
          row.style.cssText = 'white-space:nowrap;overflow:hidden';
          row.textContent = t;
          bar.appendChild(row);
        }
        document.body.appendChild(bar);
        // Did every line actually fit? scrollWidth > clientWidth means a figure is cropped.
        return [...bar.children].every((row) => row.scrollWidth <= row.clientWidth + 1);
      }, { lines, sel: size.sel });

      if (!fits) throw new Error(`caption cropped at ${size.key} (${label}) — the proof would hide its own number`);

      // Frame the book and its caption, not the whole page.
      const clip = await page.evaluate((sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        const c = document.getElementById('fe-caption').getBoundingClientRect();
        const pad = 60;
        const left = Math.max(0, b.left - pad), top = Math.max(0, b.top - pad);
        return {
          x: left, y: top,
          width: Math.min(window.innerWidth - left, Math.max(b.right + pad, c.right) - left),
          height: Math.min(window.innerHeight - top, c.bottom + 16 - top),
        };
      }, size.sel);

      await page.screenshot({ path: join(DOCS, `${size.key}-${label}.png`), clip });
      await ctx.close();
      console.log(`${label.padEnd(6)} ${size.key.padEnd(12)} ${m.edgeW.toFixed(2)}px = ${m.pct.toFixed(2)}%  (board ${m.bookW}px, height ${m.heightPctOfBook}%)`);
    }
  }

  await browser.close();
  server.close();
  for (const label of ['before', 'after']) {
    await writeFile(join(DOCS, `measurements-${label}.json`), `${JSON.stringify(out[label], null, 2)}\n`);
  }
  console.log(`\nWrote ${DOCS}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
