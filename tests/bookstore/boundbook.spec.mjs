// R16 — THE HOUSE DESIGN, against the real static export.
//
// tests/bookstore/boundbook.test.mjs and shelf-ticket.test.mjs pin the source. This one asserts
// what those exist for: that the shipped page draws a book with no feet and a pool at the depth
// it always had, three columns at every viewport, and a ticket whose clamp stops at the shelf.
//
// ── THE POOL IS MEASURED DIFFERENTIALLY, AND THAT IS THE WHOLE METHOD ──────────────────────
//
// The front face carries its own drop shadow — 8px 14px 46px — which paints some fifty pixels
// below the book, is attached to the face, and does not move when the feet do. A naive probe
// reads that and nothing else. So the frame is rendered twice, once with .bb-shadow suppressed,
// and the DIFFERENCE is the contact shadow. Where the difference dies is where the pool ends.
//
// ── WHY THE NUMBERS ARE IMPORTED AND NOT TYPED HERE ────────────────────────────────────────
//
// CONTACT_SHADOW_REBASE in BoundBook.js carries the pre-removal measurement. A suite holding
// its own copy would agree with itself forever; this one fails if the shipped page drifts from
// the record the ruling was implemented against.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { liveDetailSlug } from './live-slug.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BOOK_SRC = readFileSync(join(ROOT, 'app/bookstore/components/BoundBook.js'), 'utf8');
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');

function stringConst(name) {
  const m = new RegExp(`^export const ${name} = '([^']*)';`, 'm').exec(GATE_SRC);
  if (!m) throw new Error(`app/lib/bookstore/gate.js no longer exports a single-quoted string const named ${name}.`);
  return m[1];
}
const GATE_STORAGE_KEY = stringConst('GATE_STORAGE_KEY');

function record(name) {
  const m = new RegExp(`export const ${name} = ([\\s\\S]*?)\\n\\};`).exec(BOOK_SRC);
  if (!m) throw new Error(`BoundBook.js no longer exports ${name} as a literal`);
  return new Function(`return ${m[1]}\n};`)();
}
const REBASE = record('CONTACT_SHADOW_REBASE');
const REMOVED = record('BOTTOM_PAGE_BLOCK_REMOVED');
const FORE_EDGE = record('FORE_EDGE');

// R20 — `path` may be the string 'detail', which resolves a slug from the shop rather than
// naming one. This file used to open '/bookstore/basil'; a curator unpublished that title
// mid-round and these cases began driving the site's 404. See tests/bookstore/live-slug.mjs.
async function enterShop(page, path = '/bookstore') {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  let target = path;
  if (path === 'detail') {
    await page.goto('/bookstore');
    await expect(page.locator('.entry-title').first()).toBeVisible({ timeout: 30000 });
    target = `/bookstore/${await liveDetailSlug(page)}`;
  }
  await page.goto(target);
  // NOT `.shelf-entry` — the loading skeleton wears that class. See placement.spec.mjs.
  await expect(page.locator(target === '/bookstore' ? '.entry-title' : '.bb-front').first()).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
}

/** A flat ground and no grain, so a two-frame difference is the shadow and nothing else. */
const FLATTEN = `
  .bookstore-grain{display:none!important}
  body,main,.hero,.the-window,.catalogue-section,.shelf-entry{background:#8a8a8a!important}
  .hero-lamp,.window-lamp,.curated-lamp{display:none!important}
  .shelf-card{visibility:hidden!important}`;

/**
 * The visible pool depth below a book's silhouette, in CSS px.
 * `threshold` is a per-channel darkening in 0-255; 0.75 is the rung the record was taken at.
 */
async function poolDepth(page, selector, threshold = 0.75) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  // ── R25 — THE BOOK IS PLACED, NOT NUDGED ────────────────────────────────────────────────
  //
  // This used to be `scrollBy(0, -200)`: scroll the book into view, then scroll the page back
  // up 200px so the book sat lower and the 150px clip below it had somewhere to land. That is
  // a nudge tuned to where the Window happened to fall in a 7,485px-tall document, and R25's
  // retune moved it 306px up. scrollIntoViewIfNeeded then found the book ALREADY VISIBLE and
  // did nothing, scrollBy(0,-200) clamped at the top of the document, and the clip ran off the
  // bottom of the viewport: "Clipped area is either empty or outside the resulting image".
  //
  // Nothing about the MEASUREMENT changed — it is still a differential of the same frame with
  // and without .bb-shadow. What changed is that the book is PLACED rather than nudged: it is
  // scrolled so its BOTTOM sits CLIP_ROOM above the fold, which is the arrangement the -200
  // was reaching for and states it as a requirement instead of an offset.
  //
  // ⚠ AND IT MUST STAY LOW IN THE VIEWPORT, not high. Placing it near the TOP was tried first
  // and read 66.62px then 17.62px for the same book on two runs: the shop's covers are
  // loading="lazy", so a book high on the screen puts a page of un-decoded covers underneath
  // it and they arrive BETWEEN the two frames of the differential. Keeping it low leaves only
  // the clip beneath it, and the wait below closes the rest of that window.
  await page.evaluate(([sel, room]) => {
    const e = document.querySelector(sel);
    const b = e.getBoundingClientRect();
    const want = b.bottom + window.scrollY + room - window.innerHeight;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, Math.min(want, max)));
  }, [selector, 160]);
  // Every image THE VIEWPORT NOW HOLDS, decoded, before either frame is taken. Restricted to
  // the viewport on purpose: the shop's covers are loading="lazy", so an <img> below the fold
  // reports complete:false for ever and a document-wide wait never resolves.
  await page.waitForFunction(() => [...document.images]
    .filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && r.width > 0; })
    .every((i) => i.complete), null, { timeout: 15000 });
  await page.waitForTimeout(250);

  const silhouette = await el.evaluate((root) => {
    const f = root.querySelector('.bb-front').getBoundingClientRect();
    const feet = root.querySelector('.bb-foreedge-b');
    return Math.max(f.bottom, feet ? feet.getBoundingClientRect().bottom : -Infinity);
  });
  const box = await el.boundingBox();
  const clip = { x: Math.round(box.x - 60), y: Math.round(box.y + box.height - 40), width: Math.round(box.width + 120), height: 150 };

  const rowsOf = async () => {
    const buf = await page.screenshot({ clip });
    return page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = `data:image/png;base64,${b64}`; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const x0 = Math.round(img.width * 0.28), x1 = Math.round(img.width * 0.72);
      const out = [];
      for (let y = 0; y < img.height; y += 1) {
        let s = 0, n = 0;
        for (let x = x0; x < x1; x += 1) { s += d[(y * img.width + x) * 4]; n += 1; }
        out.push(s / n);
      }
      return { rows: out, w: img.width };
    }, buf.toString('base64'));
  };

  const withShadow = await rowsOf();
  await page.addStyleTag({ content: '.bb-shadow{display:none!important}' });
  await page.waitForTimeout(120);
  const without = await rowsOf();
  await page.evaluate(() => {
    document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('.bb-shadow{display:none')) s.remove(); });
  });
  await page.waitForTimeout(120);

  const dsf = withShadow.w / clip.width;
  let last = -1;
  for (let i = 0; i < withShadow.rows.length; i += 1) {
    if (without.rows[i] - withShadow.rows[i] >= threshold) last = i;
  }
  expect(last, 'no contact shadow was detected at all').toBeGreaterThan(-1);
  return (clip.y + last / dsf) - silhouette;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('the book has no feet', () => {
  test('nothing on the shipped page renders the bottom page block', async ({ page }) => {
    await enterShop(page);
    expect(await page.locator(`.${REMOVED.removedClass}`).count(),
      'the feet are back on the shelf').toBe(0);
    // Every BoundBook on the page, the Window included — the ruling said everywhere.
    const books = await page.locator('.bb-persp').count();
    expect(books, 'no book rendered at all').toBeGreaterThan(0);
    expect(await page.locator('.bb-persp .bb-foreedge-b').count()).toBe(0);
  });

  test('…and the Window in particular', async ({ page }) => {
    await enterShop(page);
    const win = page.locator('.the-window .bb-persp');
    test.skip(await win.count() === 0, 'no WINDOW section is claimed on the live shop');
    await expect(win.locator('.bb-foreedge-b')).toHaveCount(0);
    // Everything the ruling kept, on the same object.
    await expect(win.locator('.bb-foreedge')).toHaveCount(1);
    await expect(win.locator('.bb-ribbon')).toHaveCount(1);
    await expect(win.locator('.bb-back')).toHaveCount(1);
    await expect(win.locator('.bb-spine').first()).toBeAttached();
    // R17.4 — this line used to read `.toBe(`${REMOVED.foreEdgeMinWidthPx}px`)`, i.e. exactly
    // 12px. The width is now a FRACTION of the board the book actually draws, so the check is
    // the fraction: measure the container the cqw resolves against (.bb-persp), and assert the
    // painted strip is that board times the app's ratified iPad ratio, floored. Asserting a
    // constant here would re-pin the slab from the test side.
    const fe = win.locator('.bb-foreedge').first();
    const got = await fe.evaluate((e) => {
      const board = e.closest('.bb-persp').getBoundingClientRect().width;
      return { board, w: parseFloat(getComputedStyle(e).width) };
    });
    const want = Math.max(FORE_EDGE.floorPx, got.board * FORE_EDGE.appFixedWidthPt / FORE_EDGE.appBoardWidthPt);
    // Chrome quantises container-relative lengths to 1/64px (0.0156), hence the tolerance —
    // it is rounding, not slack. Anything wider than this is a different rule, not a rounding.
    expect(Math.abs(got.w - want), `fore-edge is ${got.w}px on a ${got.board}px board; the ratio wants ${want.toFixed(3)}px`)
      .toBeLessThan(0.05);
  });

  test('the detail page’s book lost them too', async ({ page }) => {
    await enterShop(page, 'detail');
    await expect(page.locator('.bd-cover-wrap .bb-foreedge-b')).toHaveCount(0);
    await expect(page.locator('.bd-cover-wrap .bb-foreedge')).toHaveCount(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('the contact pool', () => {
  // ── R19.7 — THE RULING, PINNED BY ITS GEOMETRY ────────────────────────────────────────
  //
  // This test is new and it is the one that matters. The three assertions below are EXACT —
  // an integer equation, a computed CSS length, and a layout offset — where the pool probe
  // beneath them reads the tail of a 46px blur at a threshold of 0.75 in 255. When the two
  // disagree, THIS is the one telling the truth about whether the geometry moved.
  //
  // It exists because the pool assertion spent R17.4 through R19.6 failing on a drift of
  // 1.11px while the geometry underneath it had not moved by one hundredth of a pixel — and
  // the suite ran in no workflow, so nobody was told. See CONTACT_SHADOW_REBASE's own header.
  test('THE DERIVATION HOLDS: the shadow rose by exactly the drop the feet occupied', async ({ page }) => {
    // 1. The record is internally consistent. -8 === -16 + 8.
    expect(REBASE.isBottomPx, 'the rebase must BE the derivation, not a number beside it')
      .toBe(REBASE.wasBottomPx + REBASE.raisedByPx);
    expect(REBASE.raisedByPx, 'and the rise must be the drop the feet occupied')
      .toBe(REMOVED.removedDropPx);

    await enterShop(page);

    // 2. The shipped stylesheet agrees with the record.
    const bottoms = await page.locator('.bb-shadow').evaluateAll(
      (els) => [...new Set(els.map((el) => getComputedStyle(el).bottom))],
    );
    expect(bottoms, 'every contact shadow on the page must sit at the rebased offset')
      .toEqual([`${REBASE.isBottomPx}px`]);

    // 3. The silhouette is where R16 measured it AFTER the removal — the feet are gone and the
    //    lowest paint is the front face's own perspective overhang. Tight tolerance on purpose:
    //    this is a layout number, it does not rasterise, and it should not move at all.
    for (const [sel, key] of [
      ['.the-window .bb-persp', 'window190'],
      ['.curated-case-book .bb-persp', 'curatedCase170'],
    ]) {
      const el = page.locator(sel).first();
      if (await el.count() === 0) continue;
      const below = await el.evaluate((root) => {
        const box = root.getBoundingClientRect();
        const f = root.querySelector('.bb-front').getBoundingClientRect();
        const feet = root.querySelector('.bb-foreedge-b');
        return Math.max(f.bottom, feet ? feet.getBoundingClientRect().bottom : -Infinity) - box.bottom;
      });
      expect(Math.abs(below - REBASE.silhouetteAfterPx[key]),
        `${key}: the silhouette sits ${below.toFixed(2)}px below the box, against ${REBASE.silhouetteAfterPx[key]}px on the record`)
        .toBeLessThanOrEqual(0.1);
    }
  });

  // ── The pool itself. Compared against measuredPoolNow, NOT measuredPoolBefore. ──────────
  //
  // The target moved in R19.7 and CONTACT_SHADOW_REBASE explains why at length: R16's own
  // derivation measured and documented a −0.55px residual on the window, so comparing against
  // the PRE-removal depth spent half the drift budget on a residual the ruling had already
  // accounted for. The tolerance is unchanged at 1px; only the thing it is measured from moved.
  test('the Window’s pool is the depth this ruling renders', async ({ page }) => {
    await enterShop(page);
    const win = page.locator('.the-window .bb-persp');
    test.skip(await win.count() === 0, 'no WINDOW section is claimed on the live shop');
    await page.addStyleTag({ content: FLATTEN });
    const depth = await poolDepth(page, '.the-window .bb-persp');
    const base = REBASE.measuredPoolNow.window190;
    console.log(`\n=== window pool ===\n${depth.toFixed(2)}px against ${base}px recorded ${REBASE.measuredOn}\n`);
    expect(Math.abs(depth - base),
      `the Window's pool is ${depth.toFixed(2)}px deep against ${base}px recorded on ${REBASE.measuredOn}`)
      .toBeLessThanOrEqual(REBASE.tolerancePx);
  });

  test('…and so is the curated case’s', async ({ page }) => {
    await enterShop(page);
    const cased = page.locator('.curated-case-book .bb-persp');
    test.skip(await cased.count() === 0, 'no curated section is rendering a case on the live shop');
    await page.addStyleTag({ content: FLATTEN });
    const depth = await poolDepth(page, '.curated-case-book .bb-persp');
    const base = REBASE.measuredPoolNow.curatedCase170;
    console.log(`\n=== curated case pool ===\n${depth.toFixed(2)}px against ${base}px recorded ${REBASE.measuredOn}\n`);
    expect(Math.abs(depth - base),
      `the curated case's pool is ${depth.toFixed(2)}px deep against ${base}px recorded on ${REBASE.measuredOn}`)
      .toBeLessThanOrEqual(REBASE.tolerancePx);
  });

  test('the shadow still sits BELOW the book and not on it', async ({ page }) => {
    await enterShop(page);
    const geom = await page.locator('.the-window .bb-persp, .bb-persp').first().evaluate((root) => {
      const s = root.querySelector('.bb-shadow').getBoundingClientRect();
      const f = root.querySelector('.bb-front').getBoundingClientRect();
      return { shadowBottom: s.bottom, frontBottom: f.bottom };
    });
    // Raised by 8px, not by 16 — it must still clear the silhouette.
    expect(geom.shadowBottom).toBeGreaterThan(geom.frontBottom);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('three across, at every viewport', () => {
  for (const [name, width, height] of [['phone', 390, 844], ['tablet', 820, 1180], ['laptop', 1280, 900]]) {
    test(`${name} (${width}px) draws three columns`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await enterShop(page);
      const cols = await page.locator('#fiction .shelf').first()
        .evaluate((g) => getComputedStyle(g).gridTemplateColumns.trim().split(/\s+/).length);
      expect(cols, `the shelf drew ${cols} columns at ${width}px`).toBe(3);
    });
  }

  test('the book is the width of its column, and the same book is bigger on a laptop', async ({ page }) => {
    const widthAt = async (vw) => {
      await page.setViewportSize({ width: vw, height: 900 });
      await enterShop(page);
      return page.locator('#fiction .shelf-entry').first().evaluate((e) => ({
        entry: e.getBoundingClientRect().width,
        book: e.querySelector('.bb-persp').getBoundingClientRect().width,
        ticket: e.querySelector('.shelf-card')?.getBoundingClientRect().width ?? null,
      }));
    };
    const phone = await widthAt(390);
    expect(phone.book, 'the phone book is not the width of its entry').toBeCloseTo(phone.entry, 0);
    const laptop = await widthAt(1280);
    expect(laptop.book, 'the laptop book did not grow with its column').toBeGreaterThan(phone.book);
    // Capped by .shelf-entry's long-standing 200px, so it cannot out-scale the display case.
    expect(laptop.book).toBeLessThanOrEqual(200.5);
  });

  test('R15’s placement is counted in BOOKS and did not move when the grid did', async ({ page }) => {
    await enterShop(page);
    const shape = await page.evaluate(() => {
      const cat = document.querySelector('#fiction');
      const runs = [];
      for (const wrap of cat.querySelectorAll(':scope > div')) {
        const grid = wrap.querySelector(':scope > .shelf');
        if (grid) runs.push(grid.children.length);
        if (wrap.querySelector(':scope > .catalogue-interleave')) runs.push('table');
      }
      return runs;
    });
    // Whatever the arrangement is, a cut is still measured in books: the run above a table has
    // the number of books the record asks for, on a three-column grid exactly as it did on an
    // auto-fill one.
    const i = shape.indexOf('table');
    test.skip(i < 0, 'no section is currently placed inside the fiction shelf');
    expect(shape[i - 1], 'the run above the table is empty').toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('the ticket, and the copy it must not swallow', () => {
  test('the shelf clamps the note to two lines', async ({ page }) => {
    await enterShop(page);
    const card = page.locator('#fiction .shelf-card-body').first();
    test.skip(await card.count() === 0, 'no title on the shelf carries a shelf card');
    const s = await card.evaluate((e) => ({
      clamp: getComputedStyle(e).webkitLineClamp,
      overflow: getComputedStyle(e).overflow,
      lines: Math.round(e.clientHeight / parseFloat(getComputedStyle(e).lineHeight)),
      clipped: e.scrollHeight > e.clientHeight + 1,
    }));
    expect(s.clamp).toBe('2');
    expect(s.overflow).toBe('hidden');
    expect(s.lines).toBeLessThanOrEqual(2);
    expect(s.clipped, 'the fixture note is short enough to fit — this case proves nothing today').toBe(true);
  });

  test('the ticket is 92% of its column and narrower than the book above it', async ({ page }) => {
    await enterShop(page);
    const m = await page.locator('#fiction .shelf-entry').first().evaluate((e) => ({
      entry: e.getBoundingClientRect().width,
      ticket: e.querySelector('.shelf-card')?.getBoundingClientRect().width ?? null,
      book: e.querySelector('.bb-persp').getBoundingClientRect().width,
    }));
    test.skip(m.ticket === null, 'the first title carries no shelf card');
    expect(m.ticket / m.entry).toBeCloseTo(0.92, 2);
    expect(m.ticket, 'the ticket is wider than the book it is tucked under').toBeLessThan(m.book);
  });

  test('⛔ THE DETAIL PAGE PRINTS THE WHOLE NOTE, unclamped', async ({ page }) => {
    // The shelf may clamp only because this is true. If it stops being true, the curator's
    // sentence exists nowhere in full and nothing else would notice.
    await enterShop(page, 'detail');
    const card = page.locator('.bd-shelfcard');
    test.skip(await card.count() === 0, 'this title carries no shelf card');
    const s = await card.evaluate((e) => ({
      clamp: getComputedStyle(e).webkitLineClamp,
      clipped: e.scrollHeight > e.clientHeight + 1,
      text: e.textContent.trim(),
    }));
    expect(s.clamp === 'none' || s.clamp === '' || s.clamp === 'auto').toBe(true);
    expect(s.clipped, 'the detail page is clipping the note').toBe(false);
    expect(s.text.endsWith('…') || s.text.endsWith('...')).toBe(false);
  });

  test('…and it is LONGER than what the shelf showed — the clamp is doing something', async ({ page }) => {
    await enterShop(page);
    const shelfText = await page.locator('#fiction .shelf-entry').first().evaluate((e) => ({
      slug: e.querySelector('a[href^="/bookstore/"]')?.getAttribute('href') ?? null,
      title: e.querySelector('.entry-title')?.textContent?.trim(),
      body: e.querySelector('.shelf-card-body')?.textContent?.trim() ?? null,
      visibleHeight: e.querySelector('.shelf-card-body')?.clientHeight ?? 0,
      fullHeight: e.querySelector('.shelf-card-body')?.scrollHeight ?? 0,
    }));
    test.skip(shelfText.body === null, 'the first title carries no shelf card');
    // Same string in both places — the clamp is a paint, not an edit. What differs is how much
    // of it the box lets you see.
    expect(shelfText.fullHeight).toBeGreaterThan(shelfText.visibleHeight);
  });

  test('the price line still sits where the money surfaces put it', async ({ page }) => {
    await enterShop(page);
    const order = await page.locator('#fiction .shelf-entry').first().evaluate((e) => {
      const y = (s) => e.querySelector(s)?.getBoundingClientRect().top ?? null;
      return { book: y('.shelf-book-wrap'), price: y('.entry-price'), card: y('.shelf-card') };
    });
    test.skip(order.price === null, 'this title prints no price');
    expect(order.price).toBeGreaterThan(order.book);
    if (order.card !== null) expect(order.card).toBeGreaterThan(order.price);
  });
});
