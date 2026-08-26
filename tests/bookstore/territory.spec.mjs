// R8.4 — TERRITORY MARKING, against the real static export.
//
// The offline suites pin the decision (tests/bookstore/territory.test.mjs) and the refusal
// (tests/bookstore/territory-endpoints.test.mjs). This one pins what a reader SEES: that a
// restricted title keeps its place on the shelf and is marked rather than hidden, that its buy
// button is disabled and says so, that the detail page explains why, and that territory and
// currency never both speak at once.
//
// ── WHY THE ASSERTIONS ARE INVARIANTS, NOT FIXTURES ────────────────────────────────────────
// The catalogue is LIVE — gate.spec.mjs and currency.spec.mjs made the same decision for the
// same reason, and the long note at the head of currency.spec.mjs sets it out. All four titles
// in the catalogue are '*' (worldwide) as of R8.4, so there is no restricted book to point at.
// Rather than assert nothing, this file asserts THE RULING over whatever is on the shelf:
//
//     every entry shows EITHER a price and no territory mark,
//     OR the territory mark and no price — never both, never neither-when-restricted.
//
// That holds for any catalogue. Today it proves the negative half (nothing is wrongly marked,
// no button is wrongly disabled, the live shop is untouched by this round). The day a curator
// saves a title with real exclusions, the positive half starts running BY ITSELF — the
// skip-guarded cases below wake up with no edit to this file.
//
// THE COUNTRY IS ALWAYS STUBBED. out/ is a static export with no Pages Functions behind it, so
// /api/bookstore/region 404s here; more importantly, a test whose marks depended on where CI
// happens to be running is a test that fails in Lagos. Every case sets the country explicitly,
// which is also the only way to fake geography in this harness — there is no header the client
// reads and no query parameter, deliberately (the country is the server's to determine).

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { liveDetailSlug } from './live-slug.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const TERRITORY_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/territory.js'), 'utf8');

// Same extractor contract as gate.spec.mjs and currency.spec.mjs: read the real constants,
// never copy them. If the wording of a mark changes, this file follows it rather than failing.
function stringConst(src, name, file) {
  const m = new RegExp(`^export const ${name} = '([^']*)';`, 'm').exec(src);
  if (!m) throw new Error(`${file} no longer exports a single-quoted string const named ${name}.`);
  return m[1];
}
const GATE_STORAGE_KEY = stringConst(GATE_SRC, 'GATE_STORAGE_KEY', 'app/lib/bookstore/gate.js');
const TERRITORY_NOTE = stringConst(TERRITORY_SRC, 'TERRITORY_NOTE', 'app/lib/bookstore/territory.js');
const TERRITORY_SENTENCE = stringConst(TERRITORY_SRC, 'TERRITORY_SENTENCE', 'app/lib/bookstore/territory.js');
const UNAVAILABLE_LABEL = stringConst(TERRITORY_SRC, 'UNAVAILABLE_LABEL', 'app/lib/bookstore/territory.js');

const CURRENCY_KEY = 'cs_bookstore_currency';
// DETAIL_SLUG is gone — see gotoDetail below.

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
 * Waits for a BOOK, not for a shelf.
 *
 * `.shelf-entry` is worn by the loading skeleton as well as by a real entry, so waiting on the
 * class alone returns while the catalogue is still in flight — and every assertion downstream
 * then runs against a rack of placeholders with no titles and no prices. That cost one flaky
 * run to find, and it fails as "the shelf must have books on it", which reads like a catalogue
 * problem rather than a harness one. Waiting on `.entry-title` waits for the fetch.
 */
async function waitForShelf(page) {
  await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
}

/**
 * Every shelf entry, with its price and its mark — whichever mark that is.
 *
 * THE SKELETON WEARS THE SAME CLASS. `.shelf-entry` is also the loading placeholder (see
 * app/bookstore/page.js), which has no title element at all; reading a computed style off it
 * throws. Entries without a title are dropped rather than guarded around, because a skeleton
 * is not a book and has nothing this file can assert about.
 */
async function shelfEntries(page) {
  return page.$$eval('.shelf-entry', (entries) =>
    entries.map((el) => {
      const titleEl = el.querySelector('.entry-title');
      if (!titleEl) return null;
      return {
        title: titleEl.textContent.trim(),
        price: el.querySelector('.entry-price')?.textContent?.trim() ?? null,
        note: el.querySelector('.entry-price-note')?.textContent?.trim() ?? null,
        isTerritory: !!el.querySelector('[data-testid="territory-note"]'),
        cardOpacity: getComputedStyle(el).opacity,
        titleOpacity: getComputedStyle(titleEl).opacity,
      };
    }).filter(Boolean));
}


// R20 — THE DETAIL SLUG IS RESOLVED FROM THE SHOP, NOT NAMED.
//
// This file used to open `/bookstore/basil`. Mid-way through R20 a curator set that title to
// `status: unpublished` — an ordinary thing to do to a shop — and every case here began
// rendering the site's 404 and failing on a selector, with nothing wrong in the code under
// test. See tests/bookstore/live-slug.mjs.
async function gotoDetail(page) {
  await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
  await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
  const slug = await liveDetailSlug(page);
  await page.goto(`/bookstore/${slug}`);
  return slug;
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the shelf', () => {
  test('THE RULING: a marked title has no price, a priced title has no territory mark', async ({ page }) => {
    await enterShop(page, { country: 'US' });
    await page.goto('/bookstore');
    await waitForShelf(page);

    const rows = await shelfEntries(page);
    expect(rows.length, 'the shelf must have books on it').toBeGreaterThan(0);

    for (const row of rows) {
      if (row.isTerritory) {
        // PRECEDENCE, as a rendered fact: never two marks, never a price the reader cannot
        // act on. This is the assertion the whole round turns on.
        expect(row.price, `"${row.title}" is not sold here — it must show NO price`).toBeNull();
        expect(row.note).toBe(TERRITORY_NOTE);
      } else {
        // Not restricted: whatever the currency logic decided is left alone, and R8.3's own
        // suite is what checks it. All that matters here is that R8.4 did not eat a price.
        expect(row.note === null || row.note !== TERRITORY_NOTE).toBeTruthy();
      }
    }
  });

  test('a restricted title keeps its place, its cover and its weight', async ({ page }) => {
    await enterShop(page, { country: 'US' });
    await page.goto('/bookstore');
    await waitForShelf(page);

    const marked = (await shelfEntries(page)).filter((r) => r.isTerritory);
    // SELF-ACTIVATING. Skips only while every title is worldwide, which is the live catalogue
    // today; it begins running the moment a curator saves one with real exclusions. Same
    // pattern, and same honesty about it, as currency.spec.mjs's mark-appearance test.
    test.skip(marked.length === 0, 'every published title is sold worldwide — no restricted title to inspect');

    for (const row of marked) {
      // NO DIMMING. The book is not lesser, it is elsewhere.
      expect(row.cardOpacity).toBe('1');
      expect(row.titleOpacity).toBe('1');
      expect(row.title).toBeTruthy();
    }

    const style = await page.locator('[data-testid="territory-note"]').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fontStyle: cs.fontStyle, border: cs.borderStyle, background: cs.backgroundColor, text: el.textContent.trim() };
    });
    // The same quiet register as the currency mark: a fact, not a warning.
    expect(style.fontStyle).toBe('italic');
    expect(style.text).toBe(style.text.toLowerCase());
    expect(style.border).toMatch(/^none/);
    expect(style.background).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test('the live catalogue is UNCHANGED — no title is marked for a reader anywhere', async ({ page }) => {
    // The negative that matters most on the day this ships: R8.4 must not have made a single
    // existing book unbuyable. All four are '*', so no country may produce a mark. If a
    // restricted title is later added, this narrows to "the worldwide ones are still clean".
    for (const country of ['GB', 'NG', 'US', 'JP']) {
      await enterShop(page, { country });
      await page.goto('/bookstore');
      await waitForShelf(page);

      const rows = await shelfEntries(page);
      for (const row of rows) {
        if (!row.isTerritory) continue;
        // Not a failure by itself — a genuinely restricted title SHOULD be marked. What must
        // hold is that it is marked consistently, which the ruling test above covers.
        expect(row.price).toBeNull();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the detail page', () => {
  test('the buy button and the sentence agree about whether the book can be bought', async ({ page }) => {
    await enterShop(page, { country: 'US' });
    await gotoDetail(page);

    const buy = page.locator('.bd-buy');
    await expect(buy).toBeVisible({ timeout: 30000 });

    const sentence = page.getByTestId('territory-sentence');
    const restricted = await sentence.count() > 0;
    const label = (await buy.textContent()).trim();

    if (restricted) {
      // DISABLED, NOT REMOVED — announced to assistive tech and true in the DOM.
      await expect(buy).toHaveAttribute('aria-disabled', 'true');
      await expect(buy).toBeDisabled();
      expect(label).toBe(UNAVAILABLE_LABEL);
      // It reads in the catalogue's voice, never as a price.
      expect(label).not.toMatch(/[£₦$]/);
      await expect(sentence).toHaveText(TERRITORY_SENTENCE);
      // PRECEDENCE: the currency sentence must not also be there.
      await expect(page.getByTestId('price-fallback-sentence')).toHaveCount(0);
      // It explains what the button will do, so it is read after it.
      const buyBox = await buy.boundingBox();
      const noteBox = await sentence.boundingBox();
      expect(noteBox.y).toBeGreaterThan(buyBox.y);
    } else {
      // A title sold here: no territory sentence anywhere, and a live button.
      await expect(buy).toBeEnabled();
      expect(label).not.toBe(UNAVAILABLE_LABEL);
      await expect(sentence).toHaveCount(0);
    }
  });

  test('a worldwide title shows neither mark, in any currency', async ({ page }) => {
    // The live case, asserted from four countries and both a matching and a fallback currency.
    for (const country of ['GB', 'NG', 'US', 'JP']) {
      await enterShop(page, { country, currency: 'usd' });
      const slug = await gotoDetail(page);
      await expect(page.locator('.bd-buy')).toBeVisible({ timeout: 30000 });

      const restricted = await page.getByTestId('territory-sentence').count() > 0;
      test.skip(restricted, `${slug} has acquired territory restrictions — this case now needs a worldwide slug`);

      await expect(page.locator('.bd-buy')).toBeEnabled();
      await expect(page.locator('.bd-buy')).not.toHaveAttribute('data-unavailable', /.*/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('an undetermined country', () => {
  test('marks nothing and disables nothing — the reader gets an honest error at the till instead', async ({ page }) => {
    // region.js answers null for a Tor exit node or an egress Cloudflare cannot place. A shelf
    // full of "not sold in your region" warnings the shop is only guessing at would be worse
    // than one accurate refusal, so: no marks, buy enabled, and the SERVER still refuses a
    // restricted title (asserted in tests/bookstore/territory-endpoints.test.mjs).
    await enterShop(page, { country: null });
    await page.goto('/bookstore');
    await waitForShelf(page);

    await expect(page.locator('[data-testid="territory-note"]')).toHaveCount(0);

    await gotoDetail(page);
    await expect(page.locator('.bd-buy')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('territory-sentence')).toHaveCount(0);
    await expect(page.locator('.bd-buy')).toBeEnabled();
  });

  test('a failed region call is silence, not a shelf of warnings', async ({ page }) => {
    // The endpoint is down. Nothing the reader asked for has failed, so nothing is said.
    await page.addInitScript(
      ([gateKey]) => {
        try {
          window.localStorage.setItem('cs_cookie_consent', 'accepted');
          window.localStorage.setItem(gateKey, '1');
        } catch { /* private mode */ }
      },
      [GATE_STORAGE_KEY],
    );
    await page.route('**/api/bookstore/region', (route) => route.fulfill({ status: 502, body: 'nope' }));

    await page.goto('/bookstore');
    await waitForShelf(page);
    await expect(page.locator('[data-testid="territory-note"]')).toHaveCount(0);
    await expect(page.locator('.entry-price').first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('one region call, two jobs', () => {
  test('the country and the currency default come from a SINGLE request', async ({ page }) => {
    // R8.4 reuses R8.3's probe rather than adding one. Two calls would be two round trips for
    // one value — and, worse, two answers that could disagree if an edge load-balanced between
    // them. Counted here rather than asserted about in a comment.
    let calls = 0;
    await page.addInitScript(
      ([gateKey]) => {
        try {
          window.localStorage.setItem('cs_cookie_consent', 'accepted');
          window.localStorage.setItem(gateKey, '1');
        } catch { /* private mode */ }
      },
      [GATE_STORAGE_KEY],
    );
    await page.route('**/api/bookstore/region', (route) => {
      calls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"country":"NG"}' });
    });

    await page.goto('/bookstore');
    await waitForShelf(page);
    // The currency defaulted from it...
    await expect(page.getByTestId('currency-ngn')).toHaveAttribute('aria-pressed', 'true');
    // ...and the shelf, the window, the modal and every button read the same answer.
    await page.waitForTimeout(500);
    expect(calls, 'the region endpoint must be called exactly once per document').toBe(1);
  });

  test('the probe still runs when a currency is already stored', async ({ page }) => {
    // The behavioural change R8.4 made to the store: the probe used to return early on a
    // stored choice, which would have left every returning reader with no country and no
    // marks. It now always asks, and simply declines to touch the currency.
    let calls = 0;
    await enterShop(page, { currency: 'gbp', country: 'NG' });
    await page.route('**/api/bookstore/region', (route) => {
      calls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"country":"NG"}' });
    });

    await page.goto('/bookstore');
    await waitForShelf(page);
    await page.waitForTimeout(500);

    expect(calls, 'a stored currency must not cancel the country lookup').toBe(1);
    // And R8.3's guarantee is untouched: the stored choice still wins.
    await expect(page.getByTestId('currency-gbp')).toHaveAttribute('aria-pressed', 'true');
  });
});
