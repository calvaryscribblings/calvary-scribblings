// THE MASTHEAD MIRROR — against the real static export.
//
// ── WHY THIS SUITE MEASURES INK AND NOT BOXES ─────────────────────────────────────────────
//
// The thing being moved IS the half-leading, and a box top/bottom includes it. A probe that
// read getBoundingClientRect() would report the change as zero by construction and pass
// forever. So this finds the first and last pixel ROW that carries ink for each line.
//
// ── AND WHY THE INK IS ISOLATED DIFFERENTIALLY ────────────────────────────────────────────
//
// The hero sits on a radial gradient under an animated grain. There is no flat ground to
// threshold against — an early version of this probe assumed #000 and read the entire clip as
// ink. So the frame is rendered twice, once with every masthead line hidden (visibility, not
// display, so nothing reflows), and the DIFFERENCE is the line. Same method R16 used to
// separate the contact shadow from the front face's own drop shadow.
//
// ── AND WHY "NOTHING BELOW MOVED" IS TESTABLE WITHOUT A BEFORE ────────────────────────────
//
// A standing suite has no yesterday to compare against, so it reconstructs one: the two
// margins are overridden to 0 in the live page, which IS the pre-fix lockup, and both states
// are measured in the same run. The assertion is then a property, not a screenshot number —
// the air above grows by exactly what the air below loses, and the colophon and edition lines
// do not move at all. If air is ever ADDED rather than TRANSFERRED, those two witnesses move
// and this fails however good the title looks.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PAGE_SRC = readFileSync(join(ROOT, 'app/bookstore/page.js'), 'utf8');
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');

const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports a single-quoted GATE_STORAGE_KEY.');
  return m[1];
})();

// The record, read out of the page rather than retyped here — a suite carrying its own copy
// of the number would agree with itself forever.
const AIR = (() => {
  const m = /export const HERO_LOCKUP_AIR = ([\s\S]*?)\n\};/.exec(PAGE_SRC);
  if (!m) throw new Error('app/bookstore/page.js no longer exports HERO_LOCKUP_AIR as a literal');
  return new Function(`return ${m[1]}\n};`)();
})();

const DSF = 3;
const LINES = ['.hero-the', '.hero-store', '.hero-colophon', '.hero-edition'];
// One pixel row at deviceScaleFactor 3 is .33px, and a glyph edge lands on a fractional row.
// A whole CSS pixel is the honest resolution of this instrument.
const TOL = 1;

test.describe('the masthead lockup', () => {
  test('the air is DERIVED from the face, not fitted — and the stylesheet carries what it derives', () => {
    // (1.211 - .9) / 2 = .1555. The record computes it; this checks the record's own arithmetic
    // so a hand-edited `em` cannot silently disagree with the two inputs above it.
    const derived = (AIR.naturalLineBoxEm - AIR.requestedLineHeight) / 2;
    expect(AIR.em).toBeCloseTo(derived, 4);

    const rule = new RegExp(`\\${AIR.selector}\\{[^}]*\\}`).exec(PAGE_SRC);
    expect(rule, `${AIR.selector} has no rule in the storefront stylesheet`).toBeTruthy();
    const mt = /margin-top:\s*(-?[\d.]+)em/.exec(rule[0]);
    const mb = /margin-bottom:\s*(-?[\d.]+)em/.exec(rule[0]);
    expect(mt, `${AIR.selector} no longer hands the air back with a margin-top`).toBeTruthy();
    expect(mb, `${AIR.selector} no longer pays for it with a margin-bottom`).toBeTruthy();
    expect(Number(mt[1])).toBeCloseTo(AIR.em, 4);
    // THE TRANSFER, as arithmetic: what is taken from below is exactly what is given above.
    expect(Number(mb[1])).toBeCloseTo(-AIR.em, 4);

    // em and not rem or px: .hero-store is a clamp(), so the air must be the display line's
    // own size at every viewport. A px value here would be right at one width and wrong at all
    // the others, and would need a media query to stay in step.
    expect(rule[0]).not.toMatch(/margin-(top|bottom):\s*-?[\d.]+(rem|px)/);
    // The app repo names this constant too — see the note at the record.
    expect(AIR.appConstant).toBe('HERO_LOCKUP_AIR');
  });

  test('the air is TRANSFERRED, not added — nothing below the masthead moves', async ({ page }) => {
    await page.addInitScript((k) => {
      try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
    }, GATE_STORAGE_KEY);
    await page.route('**/api/bookstore/region', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
    await page.goto('/bookstore');
    await expect(page.locator('.hero-store')).toBeVisible({ timeout: 30000 });
    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}.hero-lamp,.bookstore-grain{display:none!important}' });
    await page.evaluate(() => document.fonts.ready);

    // Georgia's metrics are not Cormorant's, and 1.211 is Cormorant's number. Measuring a
    // fallback face would produce a plausible, meaningless result — so refuse instead.
    const loaded = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.hero-store'));
      return document.fonts.check(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} "Cormorant Garamond"`);
    });
    expect(loaded, 'Cormorant Garamond did not load — the metrics would be the fallback face\'s').toBe(true);

    const clip = await page.evaluate((sels) => {
      const first = document.querySelector(sels[0]).getBoundingClientRect();
      const last = document.querySelector(sels[sels.length - 1]).getBoundingClientRect();
      return { x: 0, y: Math.max(0, Math.round(first.top + window.scrollY - 60)), width: 390, height: Math.round(last.bottom - first.top) + 120 };
    }, LINES);

    const shot = async (keep) => {
      await page.evaluate(({ sels, k }) => {
        for (const s of sels) document.querySelector(s).style.visibility = s === k ? 'visible' : 'hidden';
      }, { sels: LINES, k: keep });
      return sharp(await page.screenshot({ clip })).raw().toBuffer({ resolveWithObject: true });
    };

    /** First/last rows where the frame differs from the ground — where this line inks. */
    async function ink(sel, ground) {
      const { data, info } = await shot(sel);
      let top = null, bottom = null;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (info.width * y + x) * info.channels;
          const d = Math.abs(data[i] - ground.data[i]) + Math.abs(data[i + 1] - ground.data[i + 1]) + Math.abs(data[i + 2] - ground.data[i + 2]);
          if (d > 24) { if (top === null) top = y; bottom = y; break; }   // ~8/255 per channel
        }
      }
      expect(top, `no ink found for ${sel}`).not.toBeNull();
      return { top: clip.y + top / DSF, bottom: clip.y + (bottom + 1) / DSF };
    }

    async function measure() {
      const ground = await shot(null);
      const out = {};
      for (const sel of LINES) out[sel] = await ink(sel, ground);
      await page.evaluate((sels) => { for (const s of sels) document.querySelector(s).style.visibility = 'visible'; }, LINES);
      return out;
    }

    // ── The pre-fix lockup, reconstructed in the live page ──
    const neutralise = await page.addStyleTag({ content: `${AIR.selector}{margin-top:0!important;margin-bottom:0!important}` });
    const before = await measure();
    await neutralise.evaluate((el) => el.remove());
    const after = await measure();

    const fontPx = await page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize), AIR.selector);
    const airPx = AIR.em * fontPx;
    expect(airPx).toBeGreaterThan(4);   // a transfer too small to see is not a fix

    const above = (m) => m['.hero-store'].top - m['.hero-the'].bottom;
    const below = (m) => m['.hero-colophon'].top - m['.hero-store'].bottom;

    // THE DISPLAY LINE COMES DOWN by exactly the half-leading the compression took…
    expect(above(after) - above(before)).toBeCloseTo(airPx, 0);
    // …and it is paid for from underneath, not added to the page.
    expect(below(before) - below(after)).toBeCloseTo(airPx, 0);

    // ── THE WITNESSES. This is the assertion the fix actually stands on. ──
    for (const sel of ['.hero-colophon', '.hero-edition']) {
      expect(Math.abs(after[sel].top - before[sel].top),
        `${sel} MOVED — the air was added rather than transferred`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(after[sel].bottom - before[sel].bottom),
        `${sel} MOVED — the air was added rather than transferred`).toBeLessThanOrEqual(TOL);
    }
    // And the line ABOVE the display line does not move either: the air goes between them.
    expect(Math.abs(after['.hero-the'].top - before['.hero-the'].top)).toBeLessThanOrEqual(TOL);
  });
});
