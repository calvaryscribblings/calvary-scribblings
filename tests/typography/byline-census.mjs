// W11 — THE BYLINE DOT, census of every story's byline at 390, 402, 820 and 1180.
//
//   node tests/typography/byline-census.mjs --site http://127.0.0.1:4337 [--out file.json] [--slugs a,b]
//
// Serve out/ first (APP_PORT=4337 node tests/reader/app-server.mjs). Run it against the live site
// too (--site https://calvaryscribblings.co.uk) to see the fault it answers. Signed out, /api/hit
// aborted, nothing written anywhere.
//
// The fix (app/stories/[slug]/page-client.js, the app's A13): every item carries a leading
// separator of one fixed width, and the row is pulled left by exactly that width inside a
// clipping box. So, on every line of every byline:
//   · the first item's dot lies wholly left of the clip box: never drawn;
//   · every later item's dot lies wholly inside it: always drawn;
//   · the gap either side of every drawn dot is the same, and the same on every line.
// The old DOM (dots as flex items of their own) is measured too, so a run against the live
// site before deploy counts the lines that begin with a dot.
import { chromium } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'http://127.0.0.1:4337');
const OUT = arg('--out', null);
const WIDTHS = [[390, 844], [402, 874], [820, 1180], [1180, 820]];
const slugs = arg('--slugs', null)?.split(',')
  || readdirSync('out/stories').filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).filter((s) => s !== '_');

function measure() {
  const row = document.querySelector('.story-byline');
  if (!row) return { missing: true };
  const R = (el) => el.getBoundingClientRect();
  const union = (els) => {
    const rs = els.map(R).filter((r) => r.width > 0 || r.height > 0);
    return { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  };
  const hero = R(document.querySelector('.hero-content'));
  const titleBottom = R(document.querySelector('.story-title')).bottom;
  const text = (els) => els.map((e) => e.textContent.trim()).join(' ').replace(/\s+/g, ' ');
  const lineOf = (items) => {
    const lines = [];
    for (const it of items) {
      const cy = (it.box.top + it.box.bottom) / 2;
      let line = lines.find((l) => Math.abs(l.cy - cy) < 6);
      if (!line) { line = { cy, items: [] }; lines.push(line); }
      line.items.push(it);
    }
    lines.sort((a, b) => a.cy - b.cy);
    for (const l of lines) l.items.sort((a, b) => a.box.left - b.box.left);
    return lines;
  };
  const clipEl = document.querySelector('.story-byline-clip');
  if (!clipEl) {
    // THE OLD DOM: [by][author] dot [date] dot [time], each a flex item of the row.
    const kids = [...row.children].map((el) => ({ el, dot: el.classList.contains('byline-dot'), box: R(el) }));
    const lines = lineOf(kids);
    return {
      dom: 'old',
      lines: lines.map((l) => (l.items[0].dot ? '• ' : '') + text(l.items.filter((k) => !k.dot).map((k) => k.el))),
      startsWithDot: lines.filter((l) => l.items[0].dot).length,
      endsWithDot: lines.filter((l) => l.items[l.items.length - 1].dot).length,
      contentLefts: kids.filter((k) => !k.dot && !k.el.classList.contains('byline-by')).map((k) => +(k.box.left - hero.left).toFixed(2)),
      contentTops: kids.filter((k) => !k.dot && !k.el.classList.contains('byline-by')).map((k) => +(k.box.top - titleBottom).toFixed(2)),
    };
  }
  const clip = R(clipEl);
  const items = [...row.querySelectorAll(':scope > .byline-item')].map((el) => {
    const dot = el.querySelector(':scope > .byline-dot');
    const content = [...el.children].filter((c) => c !== dot);
    return { el, dot: R(dot), content: union(content), contentEls: content, box: R(el) };
  });
  const gap = parseFloat(getComputedStyle(row.querySelector('.byline-dot')).marginLeft);
  const lines = lineOf(items);
  const faults = [];
  const gaps = [];
  for (const [n, l] of lines.entries()) {
    const [first, ...rest] = l.items;
    if (!(first.dot.right <= clip.left + 0.01)) faults.push(`line ${n + 1} starts with a drawn dot`);
    if (Math.abs(first.content.left - clip.left) > 0.5 && !(n === 0 && first.content.left > clip.left)) faults.push(`line ${n + 1} text not flush (${(first.content.left - clip.left).toFixed(2)})`);
    let prev = first;
    for (const it of rest) {
      if (!(it.dot.left >= clip.left && it.dot.right <= clip.right)) faults.push(`line ${n + 1}: mid-line item without a drawn dot`);
      gaps.push(+(it.dot.left - prev.content.right).toFixed(2), +(it.content.left - it.dot.right).toFixed(2));
      prev = it;
    }
  }
  // Nothing may be cut off by the clip: every item's words end inside the box.
  for (const it of items) if (it.content.right > clip.right + 0.5) faults.push(`an item runs ${(it.content.right - clip.right).toFixed(1)}px past the clip`);
  const off = gaps.filter((g) => Math.abs(g - gap) > 0.5);
  if (off.length) faults.push(`unequal gaps: ${off.join(', ')} (expected ${gap})`);
  return {
    dom: 'new', gap,
    lines: lines.map((l) => l.items.map((it, i) => (i ? '• ' : '') + text(it.contentEls)).join(' ')),
    startsWithDot: lines.filter((l) => !(l.items[0].dot.right <= clip.left + 0.01)).length,
    gaps, faults,
    contentLefts: items.flatMap((it) => it.contentEls.filter((c) => !c.classList.contains('byline-by')).map((c) => +(R(c).left - hero.left).toFixed(2))),
    contentTops: items.flatMap((it) => it.contentEls.filter((c) => !c.classList.contains('byline-by')).map((c) => +(R(c).top - titleBottom).toFixed(2))),
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block' });
await ctx.route('**/api/hit**', (r) => r.abort());
await ctx.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
const page = await ctx.newPage();
const results = [];
for (const slug of slugs) {
  await page.setViewportSize({ width: WIDTHS[0][0], height: WIDTHS[0][1] });
  try {
    await page.goto(`${SITE}/stories/${slug}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('.story-byline', { state: 'attached', timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1400); // the hero's 1s rise, from 0.3s
  } catch (e) { results.push({ slug, error: e.message.split('\n')[0] }); continue; }
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(120);
    results.push({ slug, width: w, ...(await page.evaluate(measure)) });
  }
}
await browser.close();

const byWidth = {};
for (const r of results.filter((x) => x.width)) {
  const b = (byWidth[r.width] ||= { bylines: 0, lines: 0, startsWithDot: 0, faults: 0, gaps: new Set() });
  b.bylines++; b.lines += r.lines?.length || 0; b.startsWithDot += r.startsWithDot || 0; b.faults += r.faults?.length || 0;
  for (const g of r.gaps || []) b.gaps.add(g);
}
for (const [w, b] of Object.entries(byWidth)) console.log(`${w}px: ${b.bylines} bylines, ${b.lines} lines, ${b.startsWithDot} begin with a dot, ${b.faults} faults${b.gaps.size ? `, gaps ${[...b.gaps].join('/')}` : ''}`);
const errors = results.filter((r) => r.error);
if (errors.length) console.log('errors:', JSON.stringify(errors));
for (const r of results.filter((x) => x.startsWithDot || x.faults?.length)) console.log(`  ${r.slug} @${r.width}: ${JSON.stringify(r.lines)} ${(r.faults || []).join('; ')}`);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
process.exit(results.some((r) => r.faults?.length || (r.dom === 'new' && r.startsWithDot)) || errors.length ? 1 : 0);
