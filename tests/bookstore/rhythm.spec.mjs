// ═══════════════════════════════════════════════════════════════════════════════════════════
// R25 — THE STOREFRONT'S VERTICAL RHYTHM, AND WHAT HOLDS IT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:rhythm
//
// Ikenna's ruling, 27 August 2026: the web storefront has black voids between its elements,
// and it is to be brought to the app's rhythm — the app being the approved reference.
//
// ── WHAT THE VOIDS WERE, MEASURED ON THE BUILT EXPORT ──────────────────────────────────────
//
//   currency line → IN THE WINDOW    283.06 at 402x874, 228.80 at 1280x800   (app: ~40)
//   the Window → the rail            104 at both  ("~105 above the quote")
//   the rail → FICTION               104 at both  ("~105 below the quote")
//   FICTION → NON-FICTION             96 phone / 128 laptop
//
// The first one was not a section gap at all: `.hero` carried min-height:88vh with
// align-items:center, so half the leftover viewport sat under the currency line — 219.06px at
// 402x874, 126.67 at 390x664, 208.80 at 1440x900. A void whose size is a function of the
// device. On top of it sat .the-window's own 64px.
//
// Every one of those paddings dates from `e1e8baf7` (14 Jul 2026), when the shop stood on a
// violet gradient, later a grain. R22.1 made the ground flat #070707 on the MORNING of 27 Aug.
// The intervals were never retuned for it.
//
// ── WHAT THIS SUITE REFUSES TO BE ──────────────────────────────────────────────────────────
//
// Eight tests in this project could not fail. The trap here is specific and would have been
// easy to fall into: if this suite derived its expectations FROM SHOP_RHYTHM, then changing a
// constant would change the expectation with it and the suite would agree with any value.
//
// So the ruled figures are LITERALS below, and they are asserted in two directions:
//
//   1. SHOP_RHYTHM must equal the ruled literals — change a constant and this goes red.
//   2. The BUILT PAGE must measure the ruled literals — so a rule that stopped reading the
//      token, or a stray padding somewhere else, goes red too even though the record is fine.
//
// And every assertion has a twin that injects a defect and requires it to invert: the pre-R25
// hero restored, a section's padding overridden, and — the brief's own case — a CONSTANT
// CHANGED, done by overriding the custom property at :root, which is precisely what editing
// SHOP_RHYTHM does to the page.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOP_RHYTHM } from '../../app/bookstore/components/shopVernacular.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports GATE_STORAGE_KEY as a single-quoted string.');
  return m[1];
})();

// ── THE RULED FIGURES ──────────────────────────────────────────────────────────────────────
// Literals, on purpose. These are the app's measured values, not a restatement of the source.
const RULED = {
  // The masthead sits down onto the first case. Ikenna's app figure, exactly.
  headClosePx: 40,
  // Between two standing sections. The app's button-to-heading figure is ~75 once the stage's
  // own reserved slot is set aside; 72 is the nearest value on the shop's 0.25rem scale, and
  // it is used at EVERY join above the shelf so there is one interval and not four.
  sectionJoinPx: 72,
  // The masthead's air above, over the 68px fixed navigation bar. ⚠ A WEB JUDGEMENT CALL —
  // the app witnesses phone and tablet and gives no figure for it, and the web never had a
  // chosen number either (it was half of whatever the viewport had spare). Flagged in
  // SHOP_RHYTHM and in the round's commit; pinned here so it cannot drift unnoticed.
  headTopPx: 148,
  // ⛔ NOT THIS ROUND'S. R22.1B's stage: the gap between the quote zone and the controls zone.
  // Asserted so that a rhythm token cannot be let into the stage by a later hand.
  stageGapPx: 28.8,
};

const rem = (v) => Math.round(parseFloat(v) * 16 * 100) / 100;

// Restores the masthead exactly as it stood before R25 — the reserved viewport and the
// centring that put half of it under the currency line.
const PRE_R25_HERO = '.hero{min-height:88vh!important;align-items:center!important}';
// A section that stopped reading the token and went back to its R4b padding.
const PRE_R25_RAIL = '.rail{padding-block:3.5rem!important}';
// ⭑ THE BRIEF'S OWN CASE: a constant changed. Overriding the custom property at :root is
// exactly what editing SHOP_RHYTHM.sectionAir does to every rule that reads it.
const A_CONSTANT_CHANGED = ':root{--shop-section-air:3.5rem!important}';
const HEAD_CONSTANT_CHANGED = ':root{--shop-head-close:1rem!important}';

const MEASURE = () => {
  const px = (v) => Math.round(parseFloat(v) * 100) / 100;
  const main = document.querySelector('main');
  const kids = [...main.children];
  const shelfSection = document.querySelector('#fiction') || kids[kids.length - 1];
  const upto = kids.indexOf(shelfSection);

  // A join between two adjacent sections. These sections carry NO vertical margins — the join
  // is the previous one's bottom padding plus the next one's top padding — so the measurement
  // records both the paddings and the raw distance, and a margin appearing anywhere would show
  // up as the two disagreeing.
  const joins = [];
  for (let i = 0; i < Math.min(upto, kids.length - 1); i++) {
    const a = kids[i], b = kids[i + 1];
    const ca = getComputedStyle(a), cb = getComputedStyle(b);
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    joins.push({
      from: (a.className || a.tagName).toString().split(' ')[0],
      to: (b.className || b.tagName).toString().split(' ')[0],
      padBottom: px(ca.paddingBottom), padTop: px(cb.paddingTop),
      join: px(ca.paddingBottom) + px(cb.paddingTop),
      boxGap: +(rb.top - ra.bottom).toFixed(2),
    });
  }

  const hero = document.querySelector('.hero');
  const inner = document.querySelector('.hero-inner');
  const hb = hero.getBoundingClientRect(), ib = inner.getBoundingClientRect();
  const hcs = getComputedStyle(hero);

  const note = document.querySelector('.cur-note');
  // Whatever the first section after the masthead draws first. Not named .window-plate: the
  // Window stands at the opening only while a curator places it there, and this suite must not
  // start failing because the shop was re-curated.
  const firstAfterHero = main.querySelector('.hero + * > *');
  const stage = document.querySelector('.rail-stage');
  const scs = stage ? getComputedStyle(stage) : null;

  return {
    vw: innerWidth, vh: innerHeight,
    joins,
    heroPadTop: px(hcs.paddingTop), heroPadBottom: px(hcs.paddingBottom),
    heroMinHeight: hcs.minHeight,
    // The centring slack the round removed: what the hero reserves BEYOND its own content.
    heroSlackBelow: +(hb.bottom - ib.bottom - px(hcs.paddingBottom)).toFixed(2),
    heroSlackAbove: +(ib.top - hb.top - px(hcs.paddingTop)).toFixed(2),
    // The ruling's own measure, end to end.
    currencyToFirstThing: (note && firstAfterHero)
      ? +(firstAfterHero.getBoundingClientRect().top - note.getBoundingClientRect().bottom).toFixed(2) : null,
    // ⛔ The stage, which is not this round's.
    stageGap: scs ? px(scs.rowGap) : null,
    stagePad: scs ? [px(scs.paddingTop), px(scs.paddingBottom)] : null,
    stageMargin: scs ? [px(scs.marginTop), px(scs.marginBottom)] : null,
    tokens: {
      headClose: px(getComputedStyle(document.documentElement).getPropertyValue('--shop-head-close')) * 16,
      sectionAir: px(getComputedStyle(document.documentElement).getPropertyValue('--shop-section-air')) * 16,
    },
  };
};

async function openShop(page, { inject } = {}) {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  await page.goto('/bookstore');
  await expect(page.locator('#fiction .shelf').first()).toBeVisible({ timeout: 30000 });
  // The rail locks its stage from a hidden probe in a layout effect, and the shelf's covers
  // settle a beat later. Both are above nothing this suite measures, but a half-laid-out page
  // is not a page.
  await page.waitForTimeout(1200);
  if (inject) await page.addStyleTag({ content: inject });
  await page.waitForTimeout(200);
  return page.evaluate(MEASURE);
}

// ── THE RECORD ─────────────────────────────────────────────────────────────────────────────
// Node-only, no browser: the constants must say what the ruling says. This is the half that
// goes red when somebody edits SHOP_RHYTHM and edits nothing else.
test.describe('the record', () => {
  test('SHOP_RHYTHM states the ruled figures', () => {
    expect(rem(SHOP_RHYTHM.headClose), 'the masthead\'s close to the first case moved').toBe(RULED.headClosePx);
    expect(rem(SHOP_RHYTHM.sectionAir) * 2, 'the section join moved — sectionAir is HALF a join, paid by each side')
      .toBe(RULED.sectionJoinPx);
    expect(SHOP_RHYTHM.navClearPx + rem(SHOP_RHYTHM.headAir), 'the masthead\'s air above the navigation moved')
      .toBe(RULED.headTopPx);
    // The record's own convenience getters must not drift from the parts they summarise.
    expect(SHOP_RHYTHM.headClosePx).toBe(RULED.headClosePx);
    expect(SHOP_RHYTHM.sectionJoinPx).toBe(RULED.sectionJoinPx);
  });
});

for (const vp of [
  { name: 'handset 402', use: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'laptop 1280', use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
]) {
  test.describe(vp.name, () => {
    test.use(vp.use);

    test('the masthead closes onto the first case at the ruled distance', async ({ page }) => {
      // ⭑ THE CENTRAL CASE. This read 283.06 on a handset and 228.80 on a laptop before R25.
      const m = await openShop(page);
      expect(m.joins[0].join, `the masthead's join is ${JSON.stringify(m.joins[0])}`).toBe(RULED.headClosePx);
      expect(m.currencyToFirstThing, 'the distance Ikenna measured: currency line to the first thing below it')
        .toBe(RULED.headClosePx);
      // The token really is what produced it.
      expect(m.tokens.headClose).toBe(RULED.headClosePx);
    });

    test('the masthead reserves no viewport — the void under the currency line is gone', async ({ page }) => {
      // The 88vh + align-items:center that put 219.06px (402x874) / 208.80px (1440x900) of
      // nothing under the currency line. A gap whose size was a function of the device.
      const m = await openShop(page);
      expect(m.heroMinHeight, 'the masthead is reserving a height again').toMatch(/^(0px|auto)$/);
      expect(m.heroSlackBelow, 'the masthead is reserving space below its own content').toBe(0);
      expect(m.heroSlackAbove, 'the masthead is reserving space above its own content').toBe(0);
      // And the air above it is stated rather than left over — the same at every width.
      expect(m.heroPadTop, 'the masthead\'s air above the navigation bar moved').toBe(RULED.headTopPx);
    });

    test('every join above the shelf is the one section interval', async ({ page }) => {
      const m = await openShop(page);
      const others = m.joins.slice(1);
      expect(others.length, 'there are no section joins above the shelf to measure').toBeGreaterThan(0);
      for (const j of others) {
        expect(j.join, `${j.from} → ${j.to} is not the section interval: ${JSON.stringify(j)}`).toBe(RULED.sectionJoinPx);
      }
      expect(m.tokens.sectionAir * 2).toBe(RULED.sectionJoinPx);
    });

    test('the joins are padding and nothing else — no margin has crept in', async ({ page }) => {
      // The whole scale assumes adjacent sections touch, so that a join is exactly two
      // paddings. A margin anywhere would make the scale describe something other than what
      // the page draws, and every figure above would be a coincidence.
      const m = await openShop(page);
      for (const j of m.joins) {
        expect(j.boxGap, `a margin has appeared between ${j.from} and ${j.to}`).toBe(0);
      }
    });

    test('⛔ THE STAGE IS UNTOUCHED — no rhythm token was let inside it', async ({ page }) => {
      // R22.1B's ruling, and explicitly not this round's: the stage's pinned height, its
      // reserved answer slot and the 1.8rem between its zones. payload.spec.mjs holds the
      // heights; this holds the fact that R25's scale stopped at the stage's edge.
      const m = await openShop(page);
      expect(m.stageGap, 'the stage\'s own gap changed — that is R22.1B\'s, not R25\'s').toBe(RULED.stageGapPx);
      expect(m.stagePad, 'the stage has grown padding').toEqual([0, 0]);
      expect(m.stageMargin, 'the stage has grown margin').toEqual([0, 0]);
    });

    // ── THE TWINS ──────────────────────────────────────────────────────────────────────────

    test('PROOF — restore the pre-R25 masthead and the head assertions go red', async ({ page }) => {
      const m = await openShop(page, { inject: PRE_R25_HERO });
      expect(m.heroSlackBelow, 'with 88vh and centring restored the masthead must reserve space below its content')
        .toBeGreaterThan(0);
      expect(m.currencyToFirstThing, 'with the reserved viewport back the currency line must be far from the first case')
        .toBeGreaterThan(RULED.headClosePx);
    });

    test('PROOF — a section that stops reading the token goes red', async ({ page }) => {
      const m = await openShop(page, { inject: PRE_R25_RAIL });
      const railJoins = m.joins.filter((j) => j.from === 'rail' || j.to === 'rail');
      expect(railJoins.length, 'no join involves the rail — this mutation measured nothing').toBeGreaterThan(0);
      for (const j of railJoins) {
        expect(j.join, `${j.from} → ${j.to} should have been forced off the interval`).not.toBe(RULED.sectionJoinPx);
      }
    });

    test('PROOF — CHANGE A CONSTANT AND THE PAGE STOPS MATCHING THE RULED FIGURES', async ({ page }) => {
      // ⭑ The brief's own requirement. Overriding the custom property at :root is exactly what
      // editing SHOP_RHYTHM.sectionAir does to every rule that reads it — so if this suite
      // could still pass here, it would be agreeing with whatever number was typed.
      const m = await openShop(page, { inject: A_CONSTANT_CHANGED });
      const others = m.joins.slice(1);
      for (const j of others) {
        expect(j.join, `${j.from} → ${j.to} still measures the ruled interval after the constant was changed`)
          .not.toBe(RULED.sectionJoinPx);
      }
    });

    test('PROOF — change the head constant and the masthead\'s close stops matching', async ({ page }) => {
      const m = await openShop(page, { inject: HEAD_CONSTANT_CHANGED });
      expect(m.joins[0].join, 'the masthead\'s join still measures the ruled figure after the constant was changed')
        .not.toBe(RULED.headClosePx);
      expect(m.currencyToFirstThing).not.toBe(RULED.headClosePx);
    });
  });
}
