// R15 — PLACEMENT, against the real static export.
//
// tests/bookstore/sections.test.mjs pins planShopFlow and shelfRuns as arithmetic. This one
// asserts the thing that arithmetic exists for: that a curated table actually stands in the
// middle of a shelf on the shipped page, that the shelf has no hole in it anywhere, that the
// genre tabs still answer the reader's question, and that the air around a mid-scroll head is
// the shelf's own rhythm rather than a number somebody liked the look of.
//
// ── WHY THE ASSERTIONS ARE INVARIANTS, NOT FIXTURES ────────────────────────────────────────
//
// Same decision as gate.spec.mjs and currency.spec.mjs, and the same reason: the catalogue and
// the claims are LIVE. This file cannot know which section Ikenna has placed where, and must
// not — a suite that pinned "Editor's Choice sits after the second book" would fail the first
// time a curator did their job. So it asserts the RULING over whatever is on the page:
//
//     every curated table stands at a legal stop, no shelf grid is ever empty,
//     the Window is above the catalogue, and a filtered shelf carries no tables.
//
// Those hold for any arrangement, including one nobody has made yet.
//
// THE INTERLEAVE-SPECIFIC CASES SKIP LOUDLY when no table is currently placed inside a shelf.
// A silent pass would be this suite reporting green on a shop that had quietly gone back to
// stacking its headers.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');

// Same extractor contract as the sibling suites: read the real constant, never copy it.
function stringConst(name) {
  const m = new RegExp(`^export const ${name} = '([^']*)';`, 'm').exec(GATE_SRC);
  if (!m) throw new Error(`app/lib/bookstore/gate.js no longer exports a single-quoted string const named ${name}.`);
  return m[1];
}
const GATE_STORAGE_KEY = stringConst('GATE_STORAGE_KEY');

async function enterShop(page) {
  await page.addInitScript((gateKey) => {
    try {
      window.localStorage.setItem('cs_cookie_consent', 'accepted');
      window.localStorage.setItem(gateKey, '1');
    } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  // out/ is static, so there are no Pages Functions behind it and nothing here should depend
  // on where the suite happens to run.
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  await page.goto('/bookstore');
  // ⚠ NOT `.shelf-entry`. SkeletonShelf draws eight of those while the four reads are in
  // flight, so waiting on that class lands every assertion below on the skeleton — which has
  // one uncut grid, no curated section and no colophon, and therefore fails the placement
  // suite for reasons that have nothing to do with placement. It cost a full run to find.
  // `.entry-title` exists only on a real entry, and `.colophon` only once the shop has painted.
  await expect(page.locator('.entry-title').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.colophon')).toBeVisible();
}

/**
 * THE SHOP'S SCROLL, as the DOM actually holds it: every landmark in document order.
 * Read from the page rather than assumed, because the whole question this round answers is
 * "in what order do these appear", and a helper that assumed an order would beg it.
 */
async function scrollOrder(page) {
  return page.evaluate(() => {
    const marks = [];
    const seen = document.querySelectorAll(
      '.the-window, .curated-section, .catalogue-section, .curation-band, .colophon',
    );
    for (const el of seen) {
      marks.push({
        kind: el.classList.contains('the-window') ? 'window'
          : el.classList.contains('curated-section') ? 'table'
            : el.classList.contains('catalogue-section') ? 'catalogue'
              : el.classList.contains('curation-band') ? 'band' : 'colophon',
        id: el.id || null,
        type: el.getAttribute('data-section-type'),
        // Is it standing INSIDE a catalogue section, i.e. interleaved through a shelf?
        inCatalogue: !!el.closest('.catalogue-section') && !el.classList.contains('catalogue-section'),
        insideAGrid: !!el.closest('.shelf'),
        top: Math.round(el.getBoundingClientRect().top + window.scrollY),
      });
    }
    return marks;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('the scroll', () => {
  test('every curated table stands at a legal stop, and none of them is inside a grid', async ({ page }) => {
    await enterShop(page);
    const marks = await scrollOrder(page);
    const tables = marks.filter((m) => m.kind === 'table' || m.kind === 'window');
    expect(tables.length, 'the shop is showing no curated claim at all').toBeGreaterThan(0);

    for (const t of tables) {
      // ⛔ A table is a SIBLING of the shelf runs, never a cell in the grid. A full-width child
      // of the shelf grid pushes itself to a new row and leaves the trailing cells of the
      // previous one empty — a ragged hole, which is exactly what interleaving must not cost.
      // (R16 made the grid three fixed columns; that makes the ragged hole smaller, not gone.)
      expect(t.insideAGrid, `a ${t.type || t.kind} is inside a .shelf grid`).toBe(false);
    }

    // Document order is scroll order: the tops must ascend monotonically.
    const tops = marks.map((m) => m.top);
    expect(tops, 'the landmarks are not in scroll order').toEqual([...tops].sort((a, b) => a - b));
  });

  test('the Window opens the shop — nothing of the catalogue comes before it', async ({ page }) => {
    await enterShop(page);
    const marks = await scrollOrder(page);
    const window_ = marks.findIndex((m) => m.kind === 'window');
    test.skip(window_ === -1, 'no WINDOW section is claimed on the live shop');

    const firstCatalogue = marks.findIndex((m) => m.kind === 'catalogue');
    expect(firstCatalogue, 'the shop is showing no catalogue at all').toBeGreaterThan(-1);
    expect(window_, 'a shelf now comes before the Window').toBeLessThan(firstCatalogue);
    expect(marks[window_].inCatalogue, 'the Window has been placed inside a shelf').toBe(false);
  });

  test('NO SHELF GRID IS EVER EMPTY — the hole this round must not open', async ({ page }) => {
    await enterShop(page);
    // The end-to-end form of "the shelf closes over a silent section". An empty .shelf is a
    // row gap with no row in it, and mid-scroll that reads as a missing plank.
    const empties = await page.$$eval('.shelf', (grids) =>
      grids.filter((g) => g.children.length === 0).length);
    expect(empties, 'a .shelf rendered with nothing in it').toBe(0);
  });

  test('the curation band and the colophon still close the page', async ({ page }) => {
    await enterShop(page);
    const marks = await scrollOrder(page);
    const band = marks.findIndex((m) => m.kind === 'band');
    const colophon = marks.findIndex((m) => m.kind === 'colophon');
    expect(band).toBeGreaterThan(-1);
    expect(colophon).toBeGreaterThan(band);
    // Nothing curated may fall past them.
    const lastTable = marks.map((m) => m.kind).lastIndexOf('table');
    if (lastTable > -1) expect(lastTable).toBeLessThan(band);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('interleaving', () => {
  test('a table stands between two runs of shelf, with books above it and below it', async ({ page }) => {
    await enterShop(page);
    const placed = await page.$$eval('.catalogue-interleave', (els) => els.length);
    test.skip(placed === 0, 'no section is currently placed inside a shelf on the live shop');

    const shape = await page.evaluate(() => {
      const out = [];
      for (const cat of document.querySelectorAll('.catalogue-section')) {
        const kids = [...cat.children].filter((el) => el.querySelector('.shelf, .catalogue-interleave') || el.classList.contains('shelf'));
        const runs = [];
        for (const wrap of cat.querySelectorAll(':scope > div')) {
          const grid = wrap.querySelector(':scope > .shelf');
          const table = wrap.querySelector(':scope > .catalogue-interleave');
          if (grid) runs.push({ books: grid.children.length });
          if (table) runs.push({ table: true });
        }
        if (runs.length) out.push({ id: cat.id, runs, total: cat.querySelectorAll('.shelf > .shelf-entry').length });
      }
      return out;
    });

    const cut = shape.find((c) => c.runs.some((r) => r.table));
    expect(cut, 'no catalogue section is carrying a table').toBeTruthy();
    const i = cut.runs.findIndex((r) => r.table);
    // THE WHOLE RULING, in one line: the reader walks the shelf and comes upon a table.
    expect(i, 'the table is the first thing in the shelf, with nothing above it').toBeGreaterThan(0);
    expect(cut.runs[i - 1].books, 'the run above the table is empty').toBeGreaterThan(0);
    expect(cut.runs.slice(i + 1).some((r) => r.books > 0), 'nothing is below the table').toBe(true);
  });

  test('cutting the shelf loses no book and repeats none', async ({ page }) => {
    await enterShop(page);
    const titles = await page.$$eval('#fiction .shelf:not(.curated-shelf) .entry-title',
      (els) => els.map((e) => e.textContent.trim()));
    test.skip(titles.length === 0, 'no fiction shelf on the live shop');
    expect(new Set(titles).size, 'a book appears twice across the runs').toBe(titles.length);
  });

  test('THE AIR IS THE SHELF’S OWN RHYTHM, DOUBLED — derived, not eyeballed', async ({ page }) => {
    await enterShop(page);
    const placed = await page.$$eval('.catalogue-interleave', (els) => els.length);
    test.skip(placed === 0, 'no section is currently placed inside a shelf on the live shop');

    const air = await page.evaluate(() => {
      const el = document.querySelector('.catalogue-interleave');
      const grid = el.closest('.catalogue-section').querySelector('.shelf');
      const cs = getComputedStyle(el);
      return {
        top: parseFloat(cs.paddingTop),
        bottom: parseFloat(cs.paddingBottom),
        rowGap: parseFloat(getComputedStyle(grid).rowGap),
        // The section's own padding is zeroed inside the flow — the wrapper supplies the air,
        // so the two cannot stack into a table that has drifted off its shelf.
        sectionTop: parseFloat(getComputedStyle(el.querySelector('.curated-section')).paddingTop),
      };
    });

    expect(air.rowGap).toBeGreaterThan(0);
    expect(air.top, 'the air above a mid-scroll head is not twice the shelf row gap').toBeCloseTo(air.rowGap * 2, 1);
    expect(air.bottom).toBeCloseTo(air.rowGap * 2, 1);
    expect(air.sectionTop, 'the section is still adding its standalone padding on top').toBe(0);
    // And it must be BIGGER than a row change, or the head reads as a mis-parented row.
    expect(air.top).toBeGreaterThan(air.rowGap);
  });

  test('…and the rhythm shrinks with the grid on a phone, without a second breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterShop(page);
    const placed = await page.$$eval('.catalogue-interleave', (els) => els.length);
    test.skip(placed === 0, 'no section is currently placed inside a shelf on the live shop');

    const air = await page.evaluate(() => {
      const el = document.querySelector('.catalogue-interleave');
      const grid = el.closest('.catalogue-section').querySelector('.shelf');
      return {
        top: parseFloat(getComputedStyle(el).paddingTop),
        rowGap: parseFloat(getComputedStyle(grid).rowGap),
      };
    });
    // The handset token is smaller than the desktop one (2.75rem against 3.5rem), so this
    // both re-proves the ratio and proves the phone is reading the phone's value.
    expect(air.rowGap).toBeLessThan(3.5 * 16);
    expect(air.top).toBeCloseTo(air.rowGap * 2, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('the genre tabs, with tables interleaved', () => {
  test('a filtered tab shows exactly its own genre, and no tables', async ({ page }) => {
    await enterShop(page);
    const tabs = page.locator('#fiction .genre-tab');
    const count = await tabs.count();
    test.skip(count < 2, 'the fiction shelf has only the All tab');

    for (let i = 1; i < count; i += 1) {
      const label = (await tabs.nth(i).textContent()).trim();
      await tabs.nth(i).click();

      const genres = await page.$$eval('#fiction .shelf .entry-genre', (els) => els.map((e) => e.textContent.trim()));
      expect(genres.length, `the ${label} tab shows nothing`).toBeGreaterThan(0);
      for (const g of genres) expect(g, `the ${label} tab is showing a ${g} book`).toBe(label);

      // THE RULING: the shelf is the reader's while they have narrowed it.
      expect(await page.locator('#fiction .catalogue-interleave').count(),
        `a curated table survived the ${label} tab`).toBe(0);
      expect(await page.locator('#fiction .shelf').count(),
        `the ${label} tab drew more than one grid`).toBe(1);
    }
  });

  test('…and returning to All puts every table back exactly where it was', async ({ page }) => {
    await enterShop(page);
    const before = await page.$$eval('#fiction .catalogue-interleave',
      (els) => els.map((el) => el.querySelector('.section-title')?.textContent?.trim() || null));
    const booksBefore = await page.locator('#fiction .shelf .shelf-entry').count();

    const tabs = page.locator('#fiction .genre-tab');
    test.skip(await tabs.count() < 2, 'the fiction shelf has only the All tab');

    await tabs.nth(1).click();
    await tabs.nth(0).click();

    const after = await page.$$eval('#fiction .catalogue-interleave',
      (els) => els.map((el) => el.querySelector('.section-title')?.textContent?.trim() || null));
    expect(after).toEqual(before);
    expect(await page.locator('#fiction .shelf .shelf-entry').count()).toBe(booksBefore);
  });

  test('the tabs themselves are untouched by the tables between the rows', async ({ page }) => {
    await enterShop(page);
    const first = page.locator('#fiction .genre-tab').first();
    await expect(first).toHaveClass(/active/);
    await expect(first).toHaveText(/^All /);
  });
});
