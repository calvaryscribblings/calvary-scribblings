// R32 — THE CARD DOES NOT MOVE. Measured, not asserted from a screenshot.
//
// ⚠⚠ THE RULING THIS EXISTS FOR. "A trailer quote wraps to two, three or four lines depending
// on the story; a comment abridges to two. If either block's height is free, the other moves
// with it — and a card whose parts shift as the carousel turns is the same defect as the
// opening-lines switcher shoving the page, which the 27 August ruling settled: a stage owns a
// FIXED height and nothing below it ever moves."
//
// So this suite renders the REAL card — the project's real globals.css, the real class names,
// the real Google Fonts, the real quote-word DOM with its non-breaking spaces — at five real
// widths, over the LIVE pool, and asserts the height is the same number every time.
//
// ── WHY IT IS A HARNESS PAGE AND NOT THE APP ────────────────────────────────────────────
//
// Every other surface suite in this project drives out/. This one cannot yet: a trailer step
// is only emitted for a story that has a SCREENED voice, and until the backfill has run
// against a live Anthropic key there are none, so driving the app would assert nothing and
// pass. The harness mounts the same CSS and the same markup from the same files, which is the
// part the ruling is about; what the app does with them is asserted by tests/voices/
// voices.test.mjs, whose eighteen mutations were each run and each observed red.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { livePool } from './live-pool.mjs';

// The real modules are shipped into the page as source, so the browser runs THE REAL
// FUNCTIONS. A suite that re-implements the thing it is testing proves only that somebody
// can write the same bug twice.
function moduleSource(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/^export /gm, '');
}
const ABRIDGER = moduleSource('../../app/lib/trailerVoices.js');
const PINNER = moduleSource('../../app/lib/pinQuoteStage.js');

const CSS = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

const VIEWPORTS = [
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'phone 430', width: 430, height: 932 },
  { name: 'tablet 768', width: 768, height: 1024 },
  { name: 'laptop 1024', width: 1024, height: 768 },
  { name: 'desktop 1440', width: 1440, height: 900 },
];

// The harness: the hero box the carousel really draws into, and the trailer's real markup.
function harness(css) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=block">
<style>html,body{margin:0;background:#0c0918}${css}</style></head>
<body><section id="hero" style="position:relative;height:88vh;min-height:600px;overflow:hidden">
  <div id="block" style="position:absolute;left:4%;right:4%;bottom:34%;max-width:640px;z-index:1">
    <div id="kick" style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:26px">
      <span style="width:34px;height:1px;background:rgba(201,168,76,0.55)"></span>
      <span style="font-family:'Cinzel',serif;font-size:0.7rem;letter-spacing:0.32em;color:#c9a84c;white-space:nowrap">STORY TRAILER</span>
      <span style="width:34px;height:1px;background:rgba(201,168,76,0.55)"></span>
    </div>
    <div id="stage" class="trailer-stage"><p id="quote" class="trailer-quote"></p></div>
    <div class="trailer-rule" style="width:88px;animation:none"></div>
    <div id="attr" class="trailer-attr" style="animation:none"></div>
  </div>
  <div id="zone" class="tv-zone" style="animation:none">
    <div class="tv-kicker">A Reader Said</div>
    <p class="tv-line"><q id="line"></q></p>
    <div class="tv-id">
      <span style="width:22px;height:22px;border-radius:50%;flex-shrink:0;background:rgba(107,47,173,0.22);border:1px solid rgba(107,47,173,0.3)"></span>
      <span id="who" style="font-family:'Cormorant Garamond',serif;font-size:0.78rem;color:rgba(245,240,232,0.9);white-space:nowrap"></span>
      <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#d4941a"/></svg>
    </div>
    <p class="tv-line tv-probe" id="probe"></p>
  </div>
  <div id="dots" style="position:absolute;bottom:5%;left:4%;display:flex;align-items:center;gap:24px">
    <div style="display:flex;gap:6.4px;align-items:center">${'<span style="width:6px;height:4px;background:#fff;border-radius:2px"></span>'.repeat(10)}</div>
    <div style="display:flex;gap:8px">
      <span style="width:36px;height:36px;border-radius:50%;background:#333"></span>
      <span style="width:36px;height:36px;border-radius:50%;background:#333"></span>
    </div>
  </div>
</section></body></html>`;
}

let pool;
test.beforeAll(async () => { pool = await livePool(); });

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('the pin holds: every quote in the live pool renders at exactly one stage height', async ({ page }) => {
      await page.setContent(harness(CSS));
      await page.evaluate(async () => {
        await Promise.all([
          document.fonts.load('500 24px "Cormorant Garamond"'),
          document.fonts.load('italic 400 15px "Cormorant Garamond"'),
          document.fonts.load('400 15px "Cormorant Garamond"'),
          document.fonts.load('600 12px "Cinzel"'),
        ]);
        await document.fonts.ready;
      });
      // Real faces, or the whole measurement is of Georgia.
      expect(await page.evaluate(() => document.fonts.check('500 24px "Cormorant Garamond"'))).toBe(true);

      const result = await page.evaluate(({ quotes, pinner }) => {
        const stage = document.getElementById('stage');
        const quote = document.getElementById('quote');
        const M = new Function(pinner + '; return { measureQuotePin, paintQuoteWords };')();
        const paint = (text) => M.paintQuoteWords(quote, text);
        // ⭑ THE PAGE'S OWN FUNCTION, not a copy of it.
        stage.style.height = '';
        const pin = M.measureQuotePin(quotes);
        stage.style.height = `${pin}px`;
        // …and now every quote, pinned. Nothing may differ.
        const heights = new Set();
        let overflowed = 0;
        for (const q of quotes) {
          paint(q);
          heights.add(Math.round(stage.getBoundingClientRect().height));
          if (quote.getBoundingClientRect().height > pin + 0.5) overflowed++;
        }
        return { pin, distinct: [...heights], overflowed, n: quotes.length };
      }, { quotes: pool.quotes, pinner: PINNER });

      expect(result.n).toBeGreaterThan(50);
      expect(result.overflowed, 'a quote taller than the pin it was measured from').toBe(0);
      expect(result.distinct, `the stage took ${result.distinct.length} different heights`).toHaveLength(1);
      expect(result.distinct[0]).toBe(result.pin);
      console.log(`  ${vp.name}: pin ${result.pin}px over ${result.n} live quotes`);
    });

    test('every live comment abridges to exactly two lines, and never more', async ({ page }) => {
      await page.setContent(harness(CSS));
      await page.evaluate(async () => {
        await Promise.all([document.fonts.load('400 15px "Cormorant Garamond"')]);
        await document.fonts.ready;
      });

      const abridged = await page.evaluate((texts) => {
        const probe = document.getElementById('probe');
        probe.textContent = 'x';
        const oneLine = probe.getBoundingClientRect().height;
        const cap = oneLine * 2 + 1;
        return { oneLine, cap, fits: texts.map((t) => {
          // fit decisions are made in the browser; the abridger itself runs in node below
          return null;
        }) };
      }, pool.comments);
      expect(abridged.oneLine).toBeGreaterThan(0);

      // Run the real abridger with the browser as its ruler, then measure what it produced
      // inside the real two-line box.
      const out = await page.evaluate(({ texts, source }) => {
        const probe = document.getElementById('probe');
        const line = document.getElementById('line');
        const box = line.parentElement;
        probe.textContent = 'x';
        const cap = probe.getBoundingClientRect().height * 2 + 1;
        const fits = (t) => { probe.textContent = t; return probe.getBoundingClientRect().height <= cap; };
        const abridge = new Function('fits', 'texts', source + '; return texts.map(t => abridgeToFit(t, fits));');
        const results = abridge(fits, texts);
        probe.textContent = '';
        const boxH = new Set();
        let over = 0;
        const modes = { whole: 0, sentence: 0, ellipsis: 0 };
        results.forEach((r, i) => {
          modes[r.mode]++;
          line.textContent = r.text;
          const h = box.getBoundingClientRect().height;
          boxH.add(Math.round(h));
          // the words themselves, unclipped, must be within two lines
          probe.textContent = r.text;
          if (probe.getBoundingClientRect().height > cap) over++;
          probe.textContent = '';
        });
        // The longest comment in the pool cannot possibly fit two lines at any width;
        // if it comes back untouched, the ruler is broken.
        let longest = 0;
        texts.forEach((t, i) => { if (t.length > texts[longest].length) longest = i; });
        const longestWasCut = results[longest].text.length < texts[longest].length;
        return { boxHeights: [...boxH], over, modes, n: results.length, longestWasCut };
      }, { texts: pool.comments, source: ABRIDGER });

      expect(out.n).toBeGreaterThan(50);
      expect(out.over, `${out.over} comments overran the two-line box`).toBe(0);
      // ⚠ THE ASSERTION THAT CAUGHT THE PROBE BUG. The live pool contains comments of
      // well over a thousand characters; if NONE of them was abridged, `fits` answered
      // yes to everything and the probe is not measuring — which is exactly what a
      // media query re-clamping .tv-probe's height did at phone widths. A suite that
      // only checked the box height would have passed while the card clipped mid-word.
      expect(out.modes.whole, 'every comment came back whole — the fit probe is not measuring')
        .toBeLessThan(out.n);
      expect(out.longestWasCut, 'the longest comment in the live pool was returned untouched')
        .toBe(true);
      expect(out.boxHeights, 'the comment box changed height between comments').toHaveLength(1);
      // Ruling 3: ellipsise only when a single sentence overruns.
      expect(out.modes.ellipsis / out.n, 'the abridger is reaching for the ellipsis too often').toBeLessThan(0.15);
      console.log(`  ${vp.name}: ${out.n} comments → whole ${out.modes.whole}, sentence ${out.modes.sentence}, ellipsis ${out.modes.ellipsis}; box ${out.boxHeights[0]}px`);
    });

    test('the whole card is the same height for every quote/comment pairing', async ({ page }) => {
      await page.setContent(harness(CSS));
      await page.evaluate(async () => {
        await Promise.all([
          document.fonts.load('500 24px "Cormorant Garamond"'),
          document.fonts.load('italic 400 15px "Cormorant Garamond"'),
          document.fonts.load('400 15px "Cormorant Garamond"'),
          document.fonts.load('600 12px "Cinzel"'),
        ]);
        await document.fonts.ready;
      });

      const geo = await page.evaluate(({ quotes, attributions, comments, source, pinner }) => {
        const hero = document.getElementById('hero');
        const stage = document.getElementById('stage');
        const quote = document.getElementById('quote');
        const attr = document.getElementById('attr');
        const zone = document.getElementById('zone');
        const dots = document.getElementById('dots');
        const line = document.getElementById('line');
        const probe = document.getElementById('probe');
        const who = document.getElementById('who');
        const M = new Function(pinner + '; return { measureQuotePin, paintQuoteWords };')();
        const paint = (text) => M.paintQuoteWords(quote, text);
        stage.style.height = '';
        const pin = M.measureQuotePin(quotes);
        stage.style.height = `${pin}px`;

        probe.textContent = 'x';
        const cap = probe.getBoundingClientRect().height * 2 + 1;
        const fits = (t) => { probe.textContent = t; return probe.getBoundingClientRect().height <= cap; };
        const abridge = new Function('fits', 'texts', source + '; return texts.map(t => abridgeToFit(t, fits).text);');
        const lines = abridge(fits, comments);
        probe.textContent = '';

        // The longest name in the pool, so the identity row is at its widest.
        who.textContent = 'Stanley Princewill McDaniels';

        const R = (el) => { const r = el.getBoundingClientRect(); const h = hero.getBoundingClientRect(); return { top: r.top - h.top, bottom: r.bottom - h.top, left: r.left - h.left, right: r.right - h.left }; };
        const blockTops = new Set(), blockBottoms = new Set(), kickTops = new Set();
        const zoneTops = new Set(), zoneBottoms = new Set();
        let attrWrapped = 0, collisions = 0, overflowTop = 0, minClearance = 1e9;
        const oneAttr = (() => { attr.textContent = 'x'; return attr.getBoundingClientRect().height; })();
        const block = document.getElementById('block');
        const kick = document.getElementById('kick');

        // Every pairing that can occur: each quote against a rotating comment, and each
        // comment against a rotating quote, so both axes are exercised across the pool.
        const n = Math.max(quotes.length, lines.length);
        for (let i = 0; i < n; i++) {
          paint(quotes[i % quotes.length]);
          attr.textContent = attributions[i % attributions.length];
          line.textContent = lines[i % lines.length];
          if (attr.getBoundingClientRect().height > oneAttr + 1) attrWrapped++;
          const b = R(block), z = R(zone), d = R(dots), k = R(kick);
          blockTops.add(Math.round(b.top)); blockBottoms.add(Math.round(b.bottom));
          kickTops.add(Math.round(k.top));
          zoneTops.add(Math.round(z.top)); zoneBottoms.add(Math.round(z.bottom));
          if (b.top < 0) overflowTop++;
          const clearance = d.top - z.bottom;
          minClearance = Math.min(minClearance, clearance);
          if (clearance < 0 && z.left < d.right) collisions++;
        }
        return {
          n, pin,
          blockTops: [...blockTops], blockBottoms: [...blockBottoms], kickTops: [...kickTops],
          zoneTops: [...zoneTops], zoneBottoms: [...zoneBottoms],
          attrWrapped, collisions, overflowTop, minClearance,
        };
      }, { quotes: pool.quotes, attributions: pool.attributions, comments: pool.comments, source: ABRIDGER, pinner: PINNER });

      // ⭑ THE RULING. Not one piece of the card's furniture may take two positions.
      expect(geo.kickTops, 'the STORY TRAILER kicker moved between pairings').toHaveLength(1);
      expect(geo.blockTops, 'the quote block changed height').toHaveLength(1);
      expect(geo.blockBottoms, 'the quote block moved').toHaveLength(1);
      expect(geo.zoneTops, 'the reader zone moved').toHaveLength(1);
      expect(geo.zoneBottoms, 'the reader zone changed height').toHaveLength(1);
      // The attribution wrap this round fixed — 11 of 157 quotes wrapped at 390px before.
      expect(geo.attrWrapped, 'the attribution wrapped to a second line').toBe(0);
      // And it must not run into the furniture that was already there.
      expect(geo.collisions, 'the reader zone hit the dots and arrows').toBe(0);
      expect(geo.overflowTop, 'the card ran off the top of the hero').toBe(0);
      expect(geo.minClearance).toBeGreaterThan(0);
      console.log(`  ${vp.name}: pin ${geo.pin}px, ${geo.n} pairings, clearance to controls ${Math.round(geo.minClearance)}px`);
    });
  });
}

