// ═══════════════════════════════════════════════════════════════════════════════════════════
// R30.2 — THE OPENING ROW OF EACH HALF IS CENTRED, AND EVERY ROW BELOW IT IS NOT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna's ruling, 30 August 2026. Fiction and non-fiction each get one centred row, at the
// top; everything under it stays hard left, short by one or short by two, no exceptions. A
// curated table does not reset it — R15's tables float through the shelf, and the row resuming
// after one is the shelf continuing.
//
// ── HOW ALIGNMENT IS MEASURED HERE, AND WHY NOT BY THE OBVIOUS METHOD ──────────────────────
//
// The obvious test is "a left row's first entry sits at the grid's left edge". IT IS WRONG ON
// THIS SHELF, and measuring it would produce a suite that is green on a broken arrangement.
// .shelf-entry carries max-width:200px under justify-items:center, so on a 1280 laptop each
// entry is a 200px box centred in a 330px column and its left edge is 65.3px INSIDE the grid.
// Measured, at 1280, on a left-packed row of one: lead = 65.3px, not 0.
//
// So alignment is read as LEAD AGAINST TRAIL — the space before the row's first entry against
// the space after its last:
//
//     centred      lead == trail
//     left-packed  trail - lead == (SHELF_COLUMNS - n) * pitch      (and n < SHELF_COLUMNS)
//
// The entry inset appears on both sides and cancels, so the comparison is about the ROW's
// position and nothing else. `pitch` is never hard-coded: it is read off a FULL row in the same
// section as the distance between two adjacent entries, so the suite cannot disagree with the
// grid about how wide a column is.
//
// ⚠ A FULL ROW SATISFIES BOTH FORMS, and that is the arithmetic rather than a loophole: with
// n == SHELF_COLUMNS the left-packed slack is zero, so lead == trail either way. The ruling
// says the opening row centres "whether short or FULL" for exactly this reason — it changes no
// pixel today and means nothing shifts on the day a half's opening row is short. Every case
// below therefore SKIPS LOUDLY rather than passing when the live catalogue does not currently
// put a short row in the position it is testing.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELF_COLUMNS } from '../../app/bookstore/components/shopVernacular.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports GATE_STORAGE_KEY as a single-quoted string.');
  return m[1];
})();

// Sub-pixel: the grid divides a container that is rarely a multiple of three, so a track can
// land on .656 and two sides of a comparison can differ by a rounding step. 1.5px is under a
// tenth of the smallest gap on the page and an order of magnitude under one pitch.
const EPS = 1.5;

const WIDTHS = [[390, 844], [640, 900], [768, 1024], [1280, 800], [1440, 900]];

/**
 * Every visual row in every half, in document order, with the geometry the ruling turns on.
 *
 * Rows are grouped by their entries' `top`, NOT by grid element — a suite that trusted
 * .shelf-opening to be the opening row would be asserting that the implementation did what it
 * says, which is not the same as asserting the shelf looks right. The class is checked
 * separately, once, as a structural claim of its own.
 */
const MEASURE = () => {
  const near = (a, b) => Math.abs(a - b) < 4;
  return [...document.querySelectorAll('.catalogue-section')].map((sec) => {
    const rows = [];
    for (const grid of sec.querySelectorAll('.shelf')) {
      const gb = grid.getBoundingClientRect();
      const items = [...grid.querySelectorAll('.shelf-entry')].map((e) => e.getBoundingClientRect());
      const byTop = [];
      for (const r of items) {
        const found = byTop.find((x) => near(x[0].top, r.top));
        if (found) found.push(r); else byTop.push([r]);
      }
      for (const r of byTop) {
        const first = r[0]; const last = r[r.length - 1];
        rows.push({
          n: r.length,
          lead: first.left - gb.left,
          trail: gb.right - last.right,
          // The distance between two adjacent entries in this row — one track pitch, when the
          // row has at least two entries. Read from the page, never assumed.
          pitch: r.length > 1 ? r[1].left - r[0].left : null,
          width: first.width,
          inOpeningGrid: grid.classList.contains('shelf-opening'),
        });
      }
    }
    return {
      id: sec.id,
      head: sec.querySelector('.section-title')?.textContent?.trim() || sec.id,
      openingGrids: sec.querySelectorAll('.shelf-opening').length,
      rows,
    };
  });
};

async function openShop(page, { width, height, inject, tab } = {}) {
  if (width) await page.setViewportSize({ width, height });
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  await page.goto('/bookstore');
  await expect(page.locator('#fiction .shelf').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1200);
  if (tab) { await page.locator(`#${tab.section} .genre-tab`).nth(tab.index).click(); await page.waitForTimeout(400); }
  if (inject) { await page.addStyleTag({ content: inject }); await page.waitForTimeout(250); }
  return page.evaluate(MEASURE);
}

/** One pitch for a section, from any row that has two entries side by side. */
const pitchOf = (sec) => {
  const p = sec.rows.map((r) => r.pitch).filter((x) => x !== null);
  return p.length ? p[0] : null;
};

const isCentred = (r) => Math.abs(r.lead - r.trail) <= EPS;

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('the opening row of each half is centred', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
  for (const [width, height] of WIDTHS) {
    test(`${width}x${height}: the first row of every half is centred`, async ({ page }) => {
      const sections = await openShop(page, { width, height });
      expect(sections.length, 'no catalogue section was drawn at all').toBeGreaterThan(0);
      for (const sec of sections) {
        expect(sec.rows.length, `${sec.head} drew no rows`).toBeGreaterThan(0);
        const first = sec.rows[0];
        expect(first.n, `${sec.head}'s opening row holds more books than the shelf has columns`)
          .toBeLessThanOrEqual(SHELF_COLUMNS);
        expect(Math.abs(first.lead - first.trail),
          `${sec.head}'s opening row is not centred: lead ${first.lead.toFixed(1)}, trail ${first.trail.toFixed(1)}`)
          .toBeLessThanOrEqual(EPS);
      }
    });

    test(`${width}x${height}: every row BELOW the opening one is flush left`, async ({ page }) => {
      const sections = await openShop(page, { width, height });
      let shortRowsChecked = 0;
      for (const sec of sections) {
        const pitch = pitchOf(sec);
        for (let i = 1; i < sec.rows.length; i += 1) {
          const r = sec.rows[i];
          if (r.n >= SHELF_COLUMNS) {
            // A full row has no slack to distribute; it reads the same either way.
            expect(Math.abs(r.lead - r.trail), `${sec.head} row ${i + 1} is full but not flush`).toBeLessThanOrEqual(EPS);
            continue;
          }
          expect(pitch, `${sec.head} has a short row but no full row to read a pitch from`).not.toBeNull();
          shortRowsChecked += 1;
          // ⚠ THE ASSERTION THAT CAN FAIL. A left-packed short row carries ALL its slack on the
          // trailing side — exactly (SHELF_COLUMNS - n) pitches of it. Centred, it would carry
          // half. Both numbers are checked, so drifting either way is caught.
          const expected = (SHELF_COLUMNS - r.n) * pitch;
          expect(r.trail - r.lead,
            `${sec.head} row ${i + 1} (${r.n} of ${SHELF_COLUMNS}) is not flush left — `
            + `lead ${r.lead.toFixed(1)}, trail ${r.trail.toFixed(1)}, expected a ${expected.toFixed(1)}px difference`)
            .toBeCloseTo(expected, 0);
          expect(isCentred(r), `${sec.head} row ${i + 1} is CENTRED and only the opening row may be`).toBe(false);
        }
      }
      // A pass that never met a short row below the top would be a pass that tested nothing.
      test.skip(shortRowsChecked === 0,
        'the live catalogue currently has no underfull row below an opening row in either half');
    });
  }

  test('the opening row holds books the same size as every other row', async ({ page }) => {
    // Centring must move the row, not resize it — the opening grid states its own tracks, so
    // a wrong column width would show up here and nowhere else.
    const sections = await openShop(page, { width: 1280, height: 800 });
    for (const sec of sections) {
      if (sec.rows.length < 2) continue;
      for (let i = 1; i < sec.rows.length; i += 1) {
        expect(sec.rows[i].width, `${sec.head}'s books change size between rows`).toBeCloseTo(sec.rows[0].width, 0);
      }
    }
  });

  test('ONE centred row per half — a curated table does not reset it', async ({ page }) => {
    // R15's tables float through the shelf; the row resuming after one is the shelf continuing.
    // This is the structural half of that claim; the geometric half is the flush-left case
    // above, which walks every row after the first regardless of what stands between them.
    const sections = await openShop(page, { width: 1280, height: 800 });
    for (const sec of sections) {
      expect(sec.openingGrids, `${sec.head} has ${sec.openingGrids} opening rows; a half gets exactly one`).toBe(1);
      expect(sec.rows[0].inOpeningGrid, `${sec.head}'s first row is not the opening row`).toBe(true);
      for (let i = 1; i < sec.rows.length; i += 1) {
        expect(sec.rows[i].inOpeningGrid, `${sec.head} row ${i + 1} is inside the opening grid`).toBe(false);
      }
    }
  });

  test('a genre tab gets its own opening row', async ({ page }) => {
    // A tab narrows the half to the books the reader asked for, and that filtered shelf still
    // opens with a centred row. Tab 1 is the first real genre — tab 0 is "All".
    const sections = await openShop(page, { width: 1280, height: 800, tab: { section: 'fiction', index: 1 } });
    const fiction = sections.find((s) => s.id === 'fiction');
    expect(fiction, 'the fiction section vanished when a tab was pressed').toBeTruthy();
    expect(fiction.rows.length, 'the filtered shelf drew no rows').toBeGreaterThan(0);
    expect(fiction.openingGrids, 'a filtered shelf gets exactly one opening row').toBe(1);
    const first = fiction.rows[0];
    expect(Math.abs(first.lead - first.trail),
      `the filtered shelf's opening row is not centred: lead ${first.lead.toFixed(1)}, trail ${first.trail.toFixed(1)}`)
      .toBeLessThanOrEqual(EPS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('THE MUTATION TWINS — the checks above must go red on the wrong arrangement', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Eighteen instances now exist across this project of tests that could not fail. These two
// exist so this suite is not the nineteenth: each injects the exact arrangement the ruling
// forbids and asserts the corresponding check above stops holding.

  test('MUTATION A — flush the opening row and the centring check reddens', async ({ page }) => {
    const sections = await openShop(page, {
      width: 1280,
      height: 800,
      // Exactly the pre-R30.2 web: a short opening row packed into the leading columns.
      inject: '.shelf-opening{justify-content:start !important}',
    });
    const broken = sections.filter((s) => s.rows.length && !isCentred(s.rows[0]));
    test.skip(broken.length === 0,
      'no half currently has a SHORT opening row, so flushing it changes nothing to detect — '
      + 'a full opening row is centred and flush at once, by the arithmetic');
    for (const sec of broken) {
      expect(sec.rows[0].trail - sec.rows[0].lead,
        `${sec.head}'s flushed opening row should now carry all its slack behind it`).toBeGreaterThan(EPS);
    }
  });

  test('MUTATION B — centre a later row and the flush-left check reddens', async ({ page }) => {
    // A lone trailing entry moved into the MIDDLE track is exactly centred in a three-track
    // row, which is the arrangement R30.2 forbids everywhere but the top.
    //
    // ⚠ grid-column-start AND NOT A MARGIN. The first version of this mutation shifted the
    // entry with margin-left and the twin SKIPPED — .shelf-entry sits under justify-items:
    // center, so a grid item's margins are taken out of the track before it is centred in what
    // is left, and the entry moved by half of what was asked and stayed visibly left. A
    // mutation that does not mutate is the failure this describe block exists to prevent, so it
    // is recorded here rather than quietly fixed.
    const sections = await openShop(page, {
      width: 1280,
      height: 800,
      inject: `.shelf:not(.shelf-opening) > .shelf-entry:last-child:nth-child(${SHELF_COLUMNS}n+1)`
        + '{grid-column-start:2 !important}',
    });
    const offenders = [];
    for (const sec of sections) {
      for (let i = 1; i < sec.rows.length; i += 1) {
        if (sec.rows[i].n < SHELF_COLUMNS && isCentred(sec.rows[i])) offenders.push(`${sec.head} row ${i + 1}`);
      }
    }
    test.skip(offenders.length === 0,
      'the live catalogue currently has no lone trailing entry for the mutation to move');
    expect(offenders.length,
      'a later row was centred by the injected style and the suite must be able to see it')
      .toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('the record', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════════
  test('the shelf still holds one column count at every width', async ({ page }) => {
    // R16 fixed the count at three everywhere, which is why this round has no breakpoint table
    // and why "the first row" can never be one book on a phone and four on a laptop. If an
    // auto-fill rule ever comes back, the ruling needs rewriting before this goes green again.
    const seen = new Set();
    for (const [width, height] of WIDTHS) {
      const sections = await openShop(page, { width, height });
      const full = sections.flatMap((s) => s.rows).filter((r) => r.n > 1).map((r) => r.n);
      for (const n of full) seen.add(n);
      expect(Math.max(...full), `a row at ${width}px holds more than ${SHELF_COLUMNS} books`)
        .toBeLessThanOrEqual(SHELF_COLUMNS);
    }
    expect(SHELF_COLUMNS, 'the shelf is documented as three across at every viewport').toBe(3);
  });

  test('the CSS states the rule rather than leaving it to the grid', async ({ page }) => {
    await openShop(page, { width: 1280, height: 800 });
    const declared = await page.evaluate(() => {
      const g = document.querySelector('.shelf-opening');
      if (!g) return null;
      const cs = getComputedStyle(g);
      return { justify: cs.justifyContent, cols: cs.gridTemplateColumns.split(' ').length };
    });
    expect(declared, 'no opening row was rendered').not.toBeNull();
    expect(declared.justify, 'the opening row no longer centres its tracks').toBe('center');
    expect(declared.cols, 'the opening row states more tracks than it has books')
      .toBeLessThanOrEqual(SHELF_COLUMNS);
  });
});
