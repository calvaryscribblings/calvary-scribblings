// W11 — PARAGRAPHS: indented, with no extra space between them (Ikenna's ruling 15, 26 Sep 2026).
//
//   node tests/typography/paragraph-census.mjs --site http://127.0.0.1:4337 [--epubs DIR] [--slugs a,b]
//
// Serve out/ first (APP_PORT=4337 node tests/reader/app-server.mjs). Two surfaces:
//   · every story page (short stories, flash, inspiring, news, poetry): .prose, proseCSS.js;
//   · the Series reader: public/reading-room.html rendering each instalment's EPUB. Pass --epubs
//     a folder of <instalmentId>.epub files (downloaded read-only; they are not in the repo).
// For every pair of adjacent paragraphs it records the gap between them and the second one's
// first-line indent, and names each exception (verse, a centred line, the drop-cap opener...).
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'http://127.0.0.1:4337');
const EPUBS = arg('--epubs', null);
const slugs = arg('--slugs', null)?.split(',')
  || readdirSync('out/stories').filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).filter((s) => s !== '_');

// Runs in the document that holds the paragraphs.
function pairs(rootSel) {
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return null;
  const out = { pairs: 0, gaps: {}, indents: {}, exceptions: {} };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const p of root.querySelectorAll('p')) {
    const prev = p.previousElementSibling;
    if (!prev || prev.tagName.toUpperCase() !== 'P') continue; // XHTML (an EPUB) keeps tag names lower-case
    const a = prev.getBoundingClientRect(), b = p.getBoundingClientRect();
    if (!a.height || !b.height) continue;
    // A section break or front matter is a deliberate pause, not a paragraph: its own space is
    // the design. Named, and kept out of the paragraph-to-paragraph figures.
    const brk = [prev, p].find((x) => /section-break|scene-break|story-frontmatter|intro-note|editorial-note|subtitle|author|timestamp|letter|end-mark|rights|tbc|\bby\b/.test(x.className));
    if (brk) { bump(out.exceptions, `beside a ${brk.className.split(' ')[0]} (${(b.top - a.bottom).toFixed(1)}px)`); continue; }
    out.pairs++;
    bump(out.gaps, (b.top - a.bottom).toFixed(1));
    const cs = getComputedStyle(p);
    const em = parseFloat(cs.fontSize);
    const ind = parseFloat(cs.textIndent);
    bump(out.indents, `${(ind / em).toFixed(2)}em`);
    if (ind === 0) {
      const why = p.closest('.is-verse') ? 'verse'
        : ['center', 'right', 'end'].includes(cs.textAlign) ? `centred (${p.className || 'no class'})`
        : p.className ? `class ${p.className}` : !p.textContent.trim() ? 'empty' : 'plain';
      bump(out.exceptions, why);
    }
  }
  return out;
}

const merge = (into, r) => {
  into.pages++; into.pairs += r.pairs;
  for (const k of ['gaps', 'indents', 'exceptions']) for (const [v, n] of Object.entries(r[k])) into[k][v] = (into[k][v] || 0) + n;
};
const blank = () => ({ pages: 0, pairs: 0, gaps: {}, indents: {}, exceptions: {} });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await ctx.route('**/api/hit**', (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
const page = await ctx.newPage();
const byCat = {};
for (const slug of slugs) {
  try {
    await page.goto(`${SITE}/stories/${slug}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('.prose p', { state: 'attached', timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
  } catch (e) { (byCat.errors ||= []).push(slug); continue; }
  const cat = (await page.locator('.nav-meta').first().textContent().catch(() => '?'))?.trim() || '?';
  const r = await page.evaluate(pairs, '.prose');
  if (r) merge((byCat[cat] ||= blank()), r);
}

if (EPUBS) {
  for (const f of readdirSync(EPUBS).filter((x) => x.endsWith('.epub'))) {
    const body = readFileSync(join(EPUBS, f));
    await page.route(`**/w11-epub/${f}`, (r) => r.fulfill({ status: 200, contentType: 'application/epub+zip', body }));
    await page.goto(`${SITE}/reading-room.html?url=${encodeURIComponent(`${SITE}/w11-epub/${f}`)}&flow=scrolled`, { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    const series = (byCat[`Series · ${f.replace(/\.epub$/, '')}`] = blank());
    // Walk the book: each section is its own blob: document; measure each one once.
    const seen = new Set();
    for (const fraction of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.99]) {
      await page.evaluate((x) => window.postMessage({ type: 'goToFraction', fraction: x }, location.origin), fraction);
      await page.waitForTimeout(1200);
      for (const fr of page.frames()) {
        if (fr === page.mainFrame() || seen.has(fr.url())) continue;
        const r = await fr.evaluate(pairs, null).catch((e) => { if (process.env.DEBUG) console.log(e.message.slice(0, 200)); return null; });
        // Only a section with paragraphs counts as measured: a frame caught mid-load has none yet.
        if (r && r.pairs) { seen.add(fr.url()); merge(series, r); }
      }
    }
    series.pages = seen.size;
  }
}
await browser.close();
for (const [cat, b] of Object.entries(byCat)) {
  if (cat === 'errors') { console.log('errors:', b.join(', ')); continue; }
  console.log(`${cat}: ${b.pages} pages, ${b.pairs} paragraph pairs · gaps ${JSON.stringify(b.gaps)} · indents ${JSON.stringify(b.indents)}${Object.keys(b.exceptions).length ? ` · unindented ${JSON.stringify(b.exceptions)}` : ''}`);
}
