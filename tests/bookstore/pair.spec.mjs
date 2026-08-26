// R19.8 — THE BUY/SAMPLE PAIR, MEASURED.
//
// Ikenna raised it directly: on /bookstore/[slug] the BUY · £X.XX and READ SAMPLE controls did
// not line up. Measured on the real export before the fix:
//
//   viewport   buy h    sample h   Δh      buy centre   sample centre   Δcentre
//   390        46.69    48.69     +2.00    1514.86      1602.20         87.34   (row wrapped)
//   820        46.69    48.69     +2.00     962.45       974.28         11.83
//   1280       46.69    48.69     +2.00     887.58       899.41         11.83
//
// Two causes, and this file guards both:
//
//   HEIGHT — the outlined control carried a 1px border top and bottom that the filled one did
//   not. Everything else was already identical. box-sizing:border-box absorbed none of it,
//   because neither control declares a height.
//
//   CENTRE — the buy button was not the sample's flex sibling. It sat inside a nested column
//   that also held "Available September 2026", and the row centred that 70.34px column rather
//   than the 46.69px button. Deleting the note from the DOM moved BOTH controls.
//
// ── WHY THESE ASSERTIONS ARE RELATIONS, NEVER PIXEL COUNTS ──────────────────────────────────
// Not one case below names 48.69. Every one compares the two controls TO EACH OTHER. That is
// deliberate: the catalogue is live, the price on the button is whatever the shop is charging
// today, and Cinzel may or may not have finished loading on a cold runner. A suite that pinned
// the height would go red for a price rise and would have to be re-blessed by hand, which is
// how a contract turns into a number nobody trusts. The ruling is that the two match — so that
// is what is written down.
//
// The one exception is DELTA_PX below, which is the ruling's own tolerance.
//
// ── THE MUTATIONS, AND WHY THEY ARE HERE ────────────────────────────────────────────────────
// Two cases edit the DOM. `the note takes no part` deletes the availability note and re-reads
// both boxes, because "its presence or absence must not move either control by a single pixel"
// is only provable by removing it. `the unavailable variant` forces [data-unavailable] and the
// long label on, because every title in the catalogue is worldwide today (see the head of
// territory.spec.mjs) and the disabled geometry would otherwise never be measured — and it was
// wrong before this round in a way nothing else would have caught: the button changed its OWN
// height by 2px depending on the reader's geography, so it was the DISABLED state that
// accidentally matched the sample and the sellable one that did not.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const TERRITORY_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/territory.js'), 'utf8');

// Same extractor contract as gate.spec.mjs, currency.spec.mjs and territory.spec.mjs: read the
// real constants, never copy them.
function stringConst(src, name, file) {
  const m = new RegExp(`^export const ${name} = '([^']*)';`, 'm').exec(src);
  if (!m) throw new Error(`${file} no longer exports a single-quoted string const named ${name}.`);
  return m[1];
}
const GATE_STORAGE_KEY = stringConst(GATE_SRC, 'GATE_STORAGE_KEY', 'app/lib/bookstore/gate.js');
const UNAVAILABLE_LABEL = stringConst(TERRITORY_SRC, 'UNAVAILABLE_LABEL', 'app/lib/bookstore/territory.js');

const CURRENCY_KEY = 'cs_bookstore_currency';
const DETAIL_SLUG = 'basil';

// The ruling's own tolerance for the vertical centres. Heights are compared exactly, because
// two boxes built from one declaration block have no reason to differ by a fraction.
const DELTA_PX = 0.5;

// The three widths the ruling names. Heights are generous so nothing under measurement is
// clipped by the viewport bottom.
const VIEWPORTS = [
  { name: '390 handset', width: 390, height: 844 },
  { name: '820 iPad', width: 820, height: 1180 },
  { name: '1280 laptop', width: 1280, height: 900 },
];

/** Past the curtain and the cookie banner, with the edge's answer pinned. */
async function enterShop(page, { currency = 'gbp', country = 'GB' } = {}) {
  await page.addInitScript(
    ([gateKey, curKey, cur]) => {
      try {
        window.localStorage.setItem('cs_cookie_consent', 'accepted');
        window.localStorage.setItem(gateKey, '1');
        if (cur) window.localStorage.setItem(curKey, cur);
      } catch { /* private mode */ }
    },
    [GATE_STORAGE_KEY, CURRENCY_KEY, currency],
  );
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ country }),
    }));
}

/**
 * Opens the detail page at one viewport and waits for the pair to be REAL.
 *
 * Waiting on `.bd-buy` alone is not enough. The button is rendered before the catalogue
 * resolves, so its label is still 'Buy' with no sum in it, and the sample link — which only
 * exists when the record carries a samplePath — may not be in the DOM at all yet. Measuring
 * then reads a half-built row. Waiting for BOTH controls, and for the web fonts, is what makes
 * the numbers below mean anything: Cinzel arriving late changes the line box and therefore the
 * height of both boxes, and a measurement taken mid-swap can catch one control in Cinzel and
 * the other in the fallback.
 */
async function openPair(page, { width, height }, opts = {}) {
  await page.setViewportSize({ width, height });
  await enterShop(page, opts);
  await page.goto(`/bookstore/${DETAIL_SLUG}`);
  await expect(page.locator('.bd-buy')).toBeVisible({ timeout: 30000 });
  const sample = page.locator('.bd-sample');
  if (await sample.count() === 0) {
    test.skip(true, `${DETAIL_SLUG} no longer carries a samplePath — this suite needs a title with both controls`);
  }
  await expect(sample).toBeVisible({ timeout: 30000 });
  // Cinzel arriving late changes the line box and therefore the height of BOTH controls, and a
  // measurement taken mid-swap can catch one in Cinzel and the other in the fallback.
  await page.evaluate(() => document.fonts.ready);
  // And the cover and the author photograph land above the row. Until they have, the row is
  // still travelling down the page — see the note on ROW-RELATIVE COORDINATES below.
  await page.evaluate(() => Promise.all(
    [...document.images].filter((i) => !i.complete).map((i) => new Promise((res) => {
      i.addEventListener('load', res, { once: true });
      i.addEventListener('error', res, { once: true });
    })),
  ));
}

/**
 * Height, width and vertical centre of both controls — MEASURED AGAINST THE ROW, not the
 * viewport.
 *
 * getBoundingClientRect().top is viewport-relative, so anything above that reflows moves it:
 * this suite's first run went red at 390 with the buy control 1.73px lower on the second read,
 * and the cause was the cover finishing its layout between the two measurements, not the note
 * it was supposed to be testing. Subtracting the row's own top makes every number below a
 * statement about the pair and nothing else, which is what is actually being ruled on. The
 * row's own height is returned alongside so a case can still prove the row did not reflow.
 */
async function boxes(page) {
  return page.evaluate(() => {
    const rowRect = document.querySelector('.bd-actions').getBoundingClientRect();
    const m = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { h: r.height, w: r.width, top: r.top - rowRect.top, centre: (r.top - rowRect.top) + r.height / 2 };
    };
    return { buy: m('.bd-buy'), sample: m('.bd-sample'), rowH: rowRect.height };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE RULING: one height, one vertical centre, at every viewport.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the pair', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: buy and sample are the same height and share one centre`, async ({ page }) => {
      await openPair(page, vp);
      const { buy, sample } = await boxes(page);

      // EXACT, not within a tolerance. Both boxes are built from one declaration block, so a
      // fractional difference would mean something had gone back to declaring geometry twice.
      expect(sample.h, `heights must match — buy ${buy.h}, sample ${sample.h}`).toBeCloseTo(buy.h, 5);

      expect(Math.abs(sample.centre - buy.centre),
        `centres must agree within ${DELTA_PX}px — buy ${buy.centre.toFixed(2)}, sample ${sample.centre.toFixed(2)}`)
        .toBeLessThanOrEqual(DELTA_PX);

      // THE ROW HAS NOT WRAPPED. Two controls on separate lines cannot share a centre, and at
      // 390 the pre-R19.8 row DID wrap — 87.34px apart — so an equal-centres assertion that
      // passed on a wrapped row would be measuring nothing. Same top is the direct statement of
      // "one line, one alignment".
      expect(Math.abs(sample.top - buy.top),
        'the pair must sit on ONE line at this viewport')
        .toBeLessThanOrEqual(DELTA_PX);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE NOTE SITS BENEATH THE PAIR AND TAKES NO PART IN IT.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the availability note', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: removing the note moves neither control`, async ({ page }) => {
      await openPair(page, vp);

      // STRUCTURE FIRST. The measurement below would also pass if the note were inside the row
      // but happened to be shorter than the button — which is exactly the accident that would
      // let this defect back in the day someone shortens the copy. So the DOM relation is
      // asserted directly: the note is NOT inside the row that lays the pair out.
      const insideRow = await page.evaluate(() => {
        const row = document.querySelector('.bd-actions');
        const note = document.querySelector('[data-testid="availability-note"]');
        return { present: !!note, insideRow: !!note && row.contains(note) };
      });
      expect(insideRow.present, 'the availability note must still be on the page').toBeTruthy();
      expect(insideRow.insideRow, 'the note must sit BENEATH the pair, not inside the row that aligns it').toBeFalsy();

      const before = await boxes(page);
      await page.evaluate(() => document.querySelector('[data-testid="availability-note"]').remove());
      const after = await boxes(page);

      expect(after.buy.top, 'the buy control must not move when the note goes').toBeCloseTo(before.buy.top, 5);
      expect(after.buy.h, 'the buy control must not resize when the note goes').toBeCloseTo(before.buy.h, 5);
      expect(after.sample.top, 'the sample control must not move when the note goes').toBeCloseTo(before.sample.top, 5);
      expect(after.sample.h, 'the sample control must not resize when the note goes').toBeCloseTo(before.sample.h, 5);
      // The row itself is unchanged too — which is the row-relative reading of "the note takes
      // no part": if the note were still inside it, deleting it would shrink the row and every
      // offset above would move together and still compare equal.
      expect(after.rowH, 'the row must not resize when the note goes').toBeCloseTo(before.rowH, 5);

      // And with the note gone the pair is still a pair.
      expect(Math.abs(after.sample.centre - after.buy.centre)).toBeLessThanOrEqual(DELTA_PX);
    });
  }

  test('the wording is untouched', async ({ page }) => {
    // Launch is confirmed for 30 September 2026, so this sentence is correct and R19.8 moved it
    // without editing it. Pinned here so a geometry round cannot quietly become a copy round.
    await openPair(page, VIEWPORTS[2]);
    await expect(page.getByTestId('availability-note')).toHaveText('Available September 2026');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE DISABLED VARIANT KEEPS THE PAIR'S GEOMETRY.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the unavailable variant', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: an unsellable title matches the pair too`, async ({ page }) => {
      await openPair(page, vp);
      const sellable = await boxes(page);

      // FORCED, because no title in the catalogue is territory-restricted today — see the head
      // of territory.spec.mjs for why that is a real state of the shop rather than a gap in the
      // fixtures. The attribute and the label are the two things the restricted state actually
      // changes about this control, so setting both is the whole of the variant.
      await page.evaluate((label) => {
        const b = document.querySelector('.bd-buy');
        b.setAttribute('data-unavailable', 'true');
        b.textContent = label;
      }, UNAVAILABLE_LABEL);

      const unsellable = await boxes(page);

      // The button must not have changed its own size. Before R19.8 the [data-unavailable] rule
      // added a 1px border and the button grew 2px, so a reader in a restricted territory met a
      // different-sized control from a reader who could buy.
      expect(unsellable.buy.h, 'the buy control must not resize when it becomes unavailable')
        .toBeCloseTo(sellable.buy.h, 5);

      // And it must still be the sample's twin.
      expect(unsellable.sample.h).toBeCloseTo(unsellable.buy.h, 5);
      expect(Math.abs(unsellable.sample.centre - unsellable.buy.centre),
        `the unavailable pair must share a centre — buy ${unsellable.buy.centre.toFixed(2)}, sample ${unsellable.sample.centre.toFixed(2)}`)
        .toBeLessThanOrEqual(DELTA_PX);
      expect(Math.abs(unsellable.sample.top - unsellable.buy.top),
        'the unavailable pair must still sit on ONE line — the label is the longest the button ever shows')
        .toBeLessThanOrEqual(DELTA_PX);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ONE SOURCE, NOT TWO. The structural half of the ruling.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('one shared source', () => {
  test('both controls wear the shared geometry class, and their metrics are identical', async ({ page }) => {
    await openPair(page, VIEWPORTS[2]);

    const read = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        return {
          hasShared: el.classList.contains('bd-cta'),
          padT: cs.paddingTop, padB: cs.paddingBottom, padL: cs.paddingLeft, padR: cs.paddingRight,
          borT: cs.borderTopWidth, borB: cs.borderBottomWidth,
          fontSize: cs.fontSize, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing,
          fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, textTransform: cs.textTransform,
          boxSizing: cs.boxSizing,
        };
      };
      return { buy: pick('.bd-buy'), sample: pick('.bd-sample') };
    });

    // THE SHARED CLASS IS THE POINT. Without it the numbers below can agree today and drift
    // apart on the next edit to either rule, which is the failure the ruling names — "a future
    // change to one cannot silently desynchronise the other".
    expect(read.buy.hasShared, '.bd-buy must carry the shared .bd-cta geometry class').toBeTruthy();
    expect(read.sample.hasShared, '.bd-sample must carry the shared .bd-cta geometry class').toBeTruthy();

    // Every metric that decides the height, including the border width — which is what differed
    // before this round, and is now 1px on both (transparent on the filled control).
    for (const k of ['padT', 'padB', 'borT', 'borB', 'fontSize', 'lineHeight', 'boxSizing']) {
      expect(read.sample[k], `${k} must be identical on both controls`).toBe(read.buy[k]);
    }

    // R19.8 CHANGED GEOMETRY ONLY. The type is asserted alongside it so a later round cannot
    // resolve a height difference by shaving a font size or a tracking off one of them.
    for (const k of ['letterSpacing', 'fontFamily', 'fontWeight', 'textTransform']) {
      expect(read.sample[k], `${k} must be identical on both controls — the type is shared, not adjusted`).toBe(read.buy[k]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE BEHAVIOUR R19.8 WAS NOT ALLOWED TO COST. Geometry only — so the controls must still
// route, still mark, still disable. The rights and currency contracts have their own suites;
// what is pinned here is only that the restructure did not sever them from the pair.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('behaviour survived the restructure', () => {
  test('signed out, the buy control raises the sign-in modal rather than routing away', async ({ page }) => {
    await openPair(page, VIEWPORTS[2]);
    const before = page.url();
    await page.locator('.bd-buy').click();
    // AuthModal in place — the platform's affordance everywhere else, so a reader never loses
    // their page. It is position:fixed and out of flow, which is also why it cannot disturb the
    // pair it was opened from.
    await expect(page.locator('[role="dialog"], .auth-modal').first()).toBeVisible({ timeout: 15000 });
    expect(page.url(), 'the reader must not be routed away from the book').toBe(before);
  });

  test('the sample control still points at the sample reader', async ({ page }) => {
    await openPair(page, VIEWPORTS[2]);
    const href = await page.locator('.bd-sample').getAttribute('href');
    expect(href).toBe(`/reader/${DETAIL_SLUG}?sample=1`);
  });

  test('the qualifying sentences are still read after the button, in the block beneath', async ({ page }) => {
    await openPair(page, VIEWPORTS[2], { currency: 'ngn' });

    const notes = page.getByTestId('bd-actions-notes');
    await expect(notes).toBeVisible();

    const buyBox = await page.locator('.bd-buy').boundingBox();
    const notesBox = await notes.boundingBox();
    expect(notesBox.y, 'the notes qualify the button, so they are read after it')
      .toBeGreaterThan(buyBox.y);

    // Whichever sentence is showing — territory, currency fallback, or neither — it belongs to
    // the notes block and not to the row. Both are checked so this does not quietly pass on the
    // day the other one is the live case.
    for (const id of ['territory-sentence', 'price-fallback-sentence']) {
      const n = await page.getByTestId(id).count();
      if (n === 0) continue;
      const placed = await page.evaluate((testid) => {
        const el = document.querySelector(`[data-testid="${testid}"]`);
        return {
          inRow: document.querySelector('.bd-actions').contains(el),
          inNotes: document.querySelector('[data-testid="bd-actions-notes"]').contains(el),
        };
      }, id);
      expect(placed.inRow, `${id} must not sit inside the row that aligns the pair`).toBeFalsy();
      expect(placed.inNotes, `${id} belongs in the notes block beneath the pair`).toBeTruthy();
    }
  });

  test('the disabled state is true in the DOM as well as announced', async ({ page }) => {
    await openPair(page, VIEWPORTS[2], { country: 'US' });
    const buy = page.locator('.bd-buy');
    const restricted = await page.getByTestId('territory-sentence').count() > 0;
    if (!restricted) {
      // The live case today: every title is worldwide. Then the control must be LIVE — the
      // negative half of the same contract, and the half that would catch a restructure that
      // accidentally disabled the button for everyone.
      await expect(buy).toBeEnabled();
      await expect(buy).not.toHaveAttribute('data-unavailable', /.*/);
      return;
    }
    await expect(buy).toBeDisabled();
    await expect(buy).toHaveAttribute('aria-disabled', 'true');
    await expect(buy).toHaveText(UNAVAILABLE_LABEL);
  });
});
