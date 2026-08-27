// ═══════════════════════════════════════════════════════════════════════════════════════════
// R28 — THE DETAIL PAGE'S ALIGNMENT, BLOCK BY BLOCK
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:alignment
//
// Ikenna's ruling, 27 August 2026, from an iPhone Safari walk of the live site: the detail
// page's body copy runs CENTRED at phone width and must be left-aligned, like the app. Not
// everything — the page stays centred, and the things that are deliberately centred stay so.
//
// ── WHAT WAS MEASURED, AT 402 AND 1280, BEFORE THE CHANGE ──────────────────────────────────
//
// One declaration did it: `text-align:center` on .bd-header inside the max-width:720px query.
// .bd-header is the whole two-column header, so EVERY word in the right-hand column inherited
// it — the catalogue number, the genre kicker, the title, the byline, the synopsis, the shelf
// card, the author label, the author name, the author bio, the buy notes, the availability
// line. Meanwhile the meta strip and the From-the-book quote, which sit OUTSIDE .bd-header,
// stayed left. One blanket produced two alignments on one page.
//
// At 1280 every block already computed `start` except the colophon, which is the page's footer
// and centred on purpose. So the desktop page needed no change and got none — asserted below
// rather than assumed, because "we only touched the handset query" is exactly the kind of claim
// that turns out to be false.
//
// ── WHAT THIS SUITE REFUSES TO BE ──────────────────────────────────────────────────────────
//
// Nine tests in this project have been found that could not fail. So there is no assertion here
// about the source of page-detail.js and no grep for a declaration. Every case reads COMPUTED
// text-align off the real built page in a real browser, and every expectation has a twin that
// injects a defect and requires it to invert:
//
//   · the blanket restored — the prose must go centred at 402, and must NOT move at 1280
//   · the head blocks forced left — the deliberately-centred ones must stop being centred
//
// ⚠ THE TABLE IS THE RULING, WRITTEN DOWN. Each row is a block Ikenna named, with the
// alignment it must have at each width. A block that stops rendering fails loudly rather than
// silently passing: `required` rows must be on the page.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports GATE_STORAGE_KEY as a single-quoted string.');
  return m[1];
})();

// ── THE RULING, AS A TABLE ─────────────────────────────────────────────────────────────────
// `phone` is the alignment at 402; `desktop` at 1280. `prose` marks the blocks the ruling moved
// — they are the ones the blanket twin has to be able to push back to centre.
const BLOCKS = [
  { name: 'breadcrumb',        sel: '.cs-settle nav',        phone: 'start',  desktop: 'start', required: true },
  { name: 'catalogue number',  sel: '.bd-cat',               phone: 'center', desktop: 'start', required: true, head: true },
  { name: 'genre kicker',      sel: '.bd-kicker',            phone: 'center', desktop: 'start', required: true, head: true },
  { name: 'title',             sel: '.bd-header h1',         phone: 'center', desktop: 'start', required: true, head: true },
  { name: 'byline',            sel: '.bd-byline',            phone: 'center', desktop: 'start', required: true, head: true },
  { name: 'synopsis',          sel: '.bd-synopsis',          phone: 'start',  desktop: 'start', required: true, prose: true },
  { name: 'shelf card',        sel: '.bd-shelfcard',         phone: 'center', desktop: 'start', required: false, head: true },
  { name: 'author label',      sel: '.bd-author-label',      phone: 'start',  desktop: 'start', required: true, prose: true },
  { name: 'author name',       sel: '.bd-author-name',       phone: 'start',  desktop: 'start', required: true, prose: true },
  { name: 'author bio',        sel: '.bd-author-bio',        phone: 'start',  desktop: 'start', required: true, prose: true },
  { name: 'meta strip',        sel: '.bd-header + div',      phone: 'start',  desktop: 'start', required: true },
  { name: 'availability note', sel: '.bd-availability',      phone: 'center', desktop: 'start', required: false },
  { name: 'colophon',          sel: '.colophon-text',        phone: 'center', desktop: 'center', required: true },
];

// The declaration that was removed, restored on the element it was removed from.
const PUT_THE_BLANKET_BACK = '@media(max-width:720px){.bd-header{text-align:center}}';
// The opposite defect: the head loses the centring the ruling keeps for it.
const FLATTEN_THE_HEAD = '@media(max-width:720px){.bd-cat,.bd-kicker,.bd-header h1,.bd-byline,.bd-shelfcard{text-align:left!important}}';

/**
 * A detail page that renders the AUTHOR BLOCK, resolved from the shop rather than named.
 *
 * The same rule as live-slug.mjs and for the same reason (see its header): a slug typed into a
 * test file silently stops being a title the shop is showing. This suite additionally needs one
 * with an author block, which is a runtime read and cannot be seen in the export, so it walks
 * the shop's own links until it finds one. If none of them has an author block it THROWS rather
 * than skipping — R18 shipped the block and a suite that quietly stopped asserting it would be
 * a suite that stopped running the day it was most needed.
 */
async function detailSlugWithAuthor(page) {
  await page.goto('/bookstore');
  await expect(page.locator('a[href^="/bookstore/"]').first()).toBeAttached({ timeout: 30000 });
  const slugs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="/bookstore/"]')]
    .map((a) => a.getAttribute('href'))
    .filter((h) => /^\/bookstore\/[a-z0-9][a-z0-9-]*$/.test(h))
    .map((h) => h.replace('/bookstore/', '')))]);
  if (!slugs.length) throw new Error('The storefront rendered no link to a detail page, so this suite has no book to drive.');
  for (const slug of slugs.slice(0, 8)) {
    await page.goto(`/bookstore/${slug}`);
    await expect(page.locator('h1')).toBeVisible({ timeout: 30000 });
    if (await page.locator('.bd-author-bio').count()) return slug;
  }
  throw new Error(`None of the first ${Math.min(8, slugs.length)} titles the shop links to renders an author block. `
    + 'R18 shipped it; either the catalogue lost its bios or the block stopped rendering.');
}

async function openDetail(page, { inject } = {}) {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  const slug = await detailSlugWithAuthor(page);
  await page.goto(`/bookstore/${slug}`);
  await expect(page.locator('.bd-synopsis')).toBeVisible({ timeout: 30000 });
  // The author block and the readership line arrive from their own reads.
  await expect(page.locator('.bd-author-bio')).toBeVisible({ timeout: 30000 });
  if (inject) await page.addStyleTag({ content: inject });
  await page.waitForTimeout(200);
  const read = await page.evaluate((rows) => Object.fromEntries(rows.map(({ name, sel }) => {
    const el = document.querySelector(sel);
    return [name, el ? getComputedStyle(el).textAlign : null];
  })), BLOCKS.map(({ name, sel }) => ({ name, sel })));
  return { slug, read };
}

for (const vp of [
  { name: 'handset 402', width: 402, key: 'phone', use: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'laptop 1280', width: 1280, key: 'desktop', use: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } },
]) {
  test.describe(vp.name, () => {
    test.use(vp.use);

    test('every named block carries the alignment the ruling gives it', async ({ page }) => {
      // ⭑ THE CENTRAL CASE. At 402, before R28, every `start` row below read `center`.
      const { read } = await openDetail(page);
      for (const b of BLOCKS) {
        if (b.required) {
          expect(read[b.name], `${b.name} (${b.sel}) is not on the page at all`).not.toBeNull();
        }
        if (read[b.name] === null) continue;
        expect(read[b.name], `${b.name} (${b.sel}) reads ${read[b.name]} and must be ${b[vp.key]} at ${vp.width}`)
          .toBe(b[vp.key]);
      }
    });

    test('PROOF — restore the blanket and the prose goes back to centre', async ({ page }) => {
      // ⭑ The removed declaration, on the element it was removed from. At 402 it must push
      // every prose block back to centre. At 1280 it must do NOTHING — which is the assertion
      // that the desktop page is genuinely outside the handset query, rather than untouched by
      // luck.
      const { read } = await openDetail(page, { inject: PUT_THE_BLANKET_BACK });
      for (const b of BLOCKS.filter((x) => x.prose)) {
        if (read[b.name] === null) continue;
        if (vp.width <= 720) {
          expect(read[b.name], `with the blanket restored ${b.name} must be centred again`).toBe('center');
        } else {
          expect(read[b.name], `the handset blanket reached ${b.name} at ${vp.width} — the desktop page is not outside the query`).toBe('start');
        }
      }
    });

    if (vp.width <= 720) {
      test('PROOF — flatten the head and the deliberately-centred blocks stop being centred', async ({ page }) => {
        // The opposite defect, and the reason the ruling is a list rather than "left-align the
        // page": the catalogue number, kicker, title, byline and shelf card are centred ON
        // PURPOSE, and a round that left-aligned everything would have taken them too.
        //
        // 402 only: at 1280 these are already `start`, so the same injection is a no-op there
        // and a case asserting it would be one of the nine.
        const { read } = await openDetail(page, { inject: FLATTEN_THE_HEAD });
        const heads = BLOCKS.filter((x) => x.head && read[x.name] !== null);
        expect(heads.length, 'no head blocks were on the page — this twin measured nothing').toBeGreaterThan(0);
        for (const b of heads) {
          expect(read[b.name], `${b.name} should have been forced off centre by the twin`).not.toBe('center');
        }
      });
    }
  });
}
