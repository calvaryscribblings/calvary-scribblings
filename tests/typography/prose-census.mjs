// W15 — THE PROSE CENSUS: every paragraph of every story, measured, so a change to the prose
// rules can be shown to move exactly what it was meant to and nothing else.
//
//   node tests/typography/prose-census.mjs --site http://127.0.0.1:4337 --out FILE [--slugs a,b]
//   node tests/typography/prose-census.mjs --diff BEFORE.json AFTER.json
//
// Serve out/ first (APP_PORT=4337 node tests/reader/app-server.mjs). At 390 wide, for every <p>
// in .prose it records the first-line indent, the alignment, the colour, and, for a centred
// line, how far its ink sits from the true centre of its box. The ink is the text's own range
// less the letter-space the last glyph carries after it, which is the space a tracked centred
// line gives back (ruling of 26 Sep 2026, A16).
//
// --diff lists every paragraph whose indent or centring moved by more than 0.05px, and every
// colour that changed, with the reason the classifier gives for it. The DOM is the same before
// and after (only classes and CSS change), so paragraphs are matched by their index in .prose.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };

function measure() {
  const root = document.querySelector('.prose');
  if (!root) return null;
  const out = [];
  const ps = Array.from(root.querySelectorAll('p'));
  ps.forEach((p, i) => {
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    const cs = getComputedStyle(p);
    const rec = {
      i,
      text: text.slice(0, 48),
      cls: p.className || '',
      top: p.parentElement === root,
      prev: (() => { const e = p.previousElementSibling; return e ? (e.tagName.toLowerCase() + (e.className ? '.' + e.className.split(' ').join('.') : '')) : null; })(),
      indent: +parseFloat(cs.textIndent).toFixed(2),
      em: +parseFloat(cs.fontSize).toFixed(2),
      align: cs.textAlign,
      color: cs.color,
      verse: !!p.closest('.is-verse'),
      inlineIndent: /text-indent/.test(p.getAttribute('style') || ''),
    };
    if (['center', '-webkit-center'].includes(cs.textAlign) && text) {
      const r = document.createRange();
      r.selectNodeContents(p);
      const rects = Array.from(r.getClientRects()).filter((x) => x.width > 0);
      const box = p.getBoundingClientRect();
      const ls = parseFloat(cs.letterSpacing) || 0;
      if (rects.length) {
        // The first line box: its ink runs from the leftmost glyph to the right edge less the
        // trailing letter-space.
        const y = rects[0].top;
        const line = rects.filter((x) => Math.abs(x.top - y) < 2);
        const left = Math.min(...line.map((x) => x.left));
        const right = Math.max(...line.map((x) => x.right)) - ls;
        // The TRUE centre is the paragraph's own box, padding included: the give-back is
        // padding, so measuring against the padded content box would hide it.
        const centre = box.left + box.width / 2;
        rec.offCentre = +(((left + right) / 2) - centre).toFixed(2);
        rec.letterSpacing = +ls.toFixed(2);
      }
    }
    out.push(rec);
  });
  return out;
}

async function census() {
  const { chromium } = await import('@playwright/test');
  const SITE = arg('--site', 'http://127.0.0.1:4337');
  const OUT = arg('--out', null);
  const slugs = arg('--slugs', null)?.split(',')
    || readdirSync('out/stories').filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).filter((s) => s !== '_');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route('**/api/**', (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  const page = await ctx.newPage();
  const all = {};
  const errors = [];
  for (const slug of slugs) {
    try {
      await page.goto(`${SITE}/stories/${slug}`, { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector('.prose p', { state: 'attached', timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      all[slug] = await page.evaluate(measure);
    } catch (e) { errors.push(slug); }
  }
  await browser.close();
  if (OUT) writeFileSync(OUT, JSON.stringify(all));
  const paras = Object.values(all).reduce((n, a) => n + (a?.length || 0), 0);
  console.log(`${Object.keys(all).length} stories, ${paras} paragraphs${errors.length ? ` · ${errors.length} failed: ${errors.join(', ')}` : ''}`);
}

function diff(beforeFile, afterFile) {
  const A = JSON.parse(readFileSync(beforeFile, 'utf8'));
  const B = JSON.parse(readFileSync(afterFile, 'utf8'));
  const moved = [];
  let stories = 0, paras = 0;
  for (const slug of Object.keys(A)) {
    const a = A[slug] || [], b = B[slug];
    if (!b) { moved.push({ slug, what: 'missing after' }); continue; }
    stories++; paras += a.length;
    if (a.length !== b.length) { moved.push({ slug, what: `paragraph count ${a.length} → ${b.length}` }); continue; }
    a.forEach((x, k) => {
      const y = b[k];
      const d = [];
      if (Math.abs(x.indent - y.indent) > 0.05) d.push(`indent ${x.indent} → ${y.indent}px`);
      if ((x.offCentre ?? 0) !== (y.offCentre ?? 0) && Math.abs((x.offCentre ?? 0) - (y.offCentre ?? 0)) > 0.05) d.push(`off centre ${x.offCentre} → ${y.offCentre}px`);
      if (x.color !== y.color) d.push(`colour ${x.color} → ${y.color}`);
      if (x.align !== y.align) d.push(`align ${x.align} → ${y.align}`);
      if (d.length) moved.push({ slug, i: k, text: x.text, prev: x.prev, cls: x.cls, top: x.top, change: d.join(', ') });
    });
  }
  return { stories, paras, moved };
}

if (process.argv.includes('--diff')) {
  const i = process.argv.indexOf('--diff');
  const r = diff(process.argv[i + 1], process.argv[i + 2]);
  console.log(`${r.stories} stories, ${r.paras} paragraphs, ${r.moved.length} moved`);
  for (const m of r.moved) console.log(JSON.stringify(m));
} else {
  await census();
}
