// R8.3 — CURRENCY SELECTION, against the real static export.
//
// The unit suite (tests/bookstore/currency.test.mjs) pins priceFor and formatPrice. This one
// asserts the thing those functions exist for: that switching the selector actually repaints
// every price on the page, that the mark appears on exactly the titles it should, that the
// choice survives a reload, and that the buy button never names a sum in a currency it is not
// about to charge.
//
// ── WHY THE ASSERTIONS ARE INVARIANTS, NOT FIXTURES ────────────────────────────────────────
// The catalogue is LIVE — the same decision gate.spec.mjs made and for the same reason: a
// stubbed shelf would prove only that a stub renders. That means this file cannot know which
// titles carry an NGN price, so it does not assert "The Rescue costs ₦4,500". It asserts the
// RULING instead, over whatever is on the shelf:
//
//     every visible price is EITHER in the selected currency and unmarked,
//     OR in another currency and marked.
//
// That holds for any catalogue, it is exactly what D asked for, and it fails loudly if either
// half breaks — an unmarked fallback and a marked correct price are both caught.
//
// THE REGION ENDPOINT IS STUBBED, always. out/ is served by a plain static file server with no
// Pages Functions behind it, so /api/bookstore/region 404s here; more importantly, a test whose
// starting currency depends on where CI happens to be running is a test that fails in Lagos.
// Every case below either seeds a stored choice or stubs the endpoint explicitly.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { liveDetailSlug } from './live-slug.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');

// Same extractor contract as gate.spec.mjs: read the real constants, never copy them.
function stringConst(name) {
  const m = new RegExp(`^export const ${name} = '([^']*)';`, 'm').exec(GATE_SRC);
  if (!m) throw new Error(`app/lib/bookstore/gate.js no longer exports a single-quoted string const named ${name}.`);
  return m[1];
}
const GATE_STORAGE_KEY = stringConst('GATE_STORAGE_KEY');

const CURRENCY_KEY = 'cs_bookstore_currency';
const SYMBOL = { gbp: '£', ngn: '₦', usd: '$' };

// DETAIL_SLUG is gone — see gotoDetail below.

// Past the curtain, past the cookie banner, and with no region opinion. Everything this suite
// asserts is about currency; nothing about it should depend on the gate or on geography.
async function enterShop(page, { currency = null, country = null } = {}) {
  // NOTHING IS REMOVED HERE, and that is load-bearing. addInitScript re-runs on EVERY
  // navigation, including page.reload() — so an `else removeItem(curKey)` branch would delete
  // the stored choice the reload test exists to prove survives, and the failure would look
  // like a persistence bug in the product rather than in the harness. It cost one debugging
  // round to find. Playwright gives each test a fresh context with empty storage, so there is
  // nothing to clear in the first place.
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

/** Every price the shelf is currently showing, paired with the mark beneath it (or null). */
async function shelfPrices(page) {
  return page.$$eval('.shelf-entry', (entries) =>
    entries.map((el) => ({
      price: el.querySelector('.entry-price')?.textContent?.trim() ?? null,
      note: el.querySelector('.entry-price-note')?.textContent?.trim() ?? null,
      title: el.querySelector('.entry-title')?.textContent?.trim() ?? null,
    })).filter((r) => r.price));
}

async function waitForShelf(page) {
  await expect(page.locator('.shelf-entry').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.entry-price').first()).toBeVisible();
}

// THE RULING, as an assertion. Applied after every switch.
function assertShownAndMarked(rows, selected) {
  const symbol = SYMBOL[selected];
  expect(rows.length, 'the shelf must be showing at least one price').toBeGreaterThan(0);

  for (const row of rows) {
    const inSelected = row.price.startsWith(symbol);
    if (inSelected) {
      expect(row.note, `"${row.title}" is priced in ${selected} — it must carry NO mark`).toBeNull();
    } else {
      expect(row.note, `"${row.title}" shows ${row.price}, not ${selected} — it MUST be marked`).toBeTruthy();
      expect(row.note).toMatch(/^in \w+ only$/);
      // The mark must name the currency actually shown, not the one being browsed in.
      const shown = Object.entries(SYMBOL).find(([, s]) => row.price.startsWith(s))?.[0];
      const names = { gbp: 'pounds', ngn: 'naira', usd: 'dollars' };
      expect(row.note).toBe(`in ${names[shown]} only`);
    }
  }
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
test.describe('the selector', () => {
  test('renders as a catalogue line with three real buttons', async ({ page }) => {
    await enterShop(page);
    await page.goto('/bookstore');
    await waitForShelf(page);

    const group = page.getByRole('group', { name: /prices in/i });
    await expect(group).toBeVisible();

    for (const c of ['gbp', 'ngn', 'usd']) {
      const btn = page.getByTestId(`currency-${c}`);
      await expect(btn).toBeVisible();
      // A real button, not a styled div — this is what buys Enter/Space and the tab order.
      expect(await btn.evaluate((el) => el.tagName)).toBe('BUTTON');
    }

    // Exactly one is pressed, and by default it is the shop's home currency.
    await expect(page.getByTestId('currency-gbp')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('currency-ngn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('currency-usd')).toHaveAttribute('aria-pressed', 'false');
  });

  test('is keyboard operable', async ({ page }) => {
    await enterShop(page);
    await page.goto('/bookstore');
    await waitForShelf(page);

    await page.getByTestId('currency-ngn').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('currency-ngn')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('currency-usd').focus();
    await page.keyboard.press(' ');
    await expect(page.getByTestId('currency-usd')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('currency-ngn')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the quiet line changes once the reader has chosen', async ({ page }) => {
    await enterShop(page);
    await page.goto('/bookstore');
    await waitForShelf(page);

    await expect(page.getByTestId('currency-note'))
      .toHaveText('Set from where you are — change it whenever you like.');

    await page.getByTestId('currency-ngn').click();
    await expect(page.getByTestId('currency-note'))
      .toHaveText('Showing prices in naira. Remembered for next time.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('shown and marked', () => {
  test('switching currency repaints EVERY visible price', async ({ page }) => {
    await enterShop(page);
    await page.goto('/bookstore');
    await waitForShelf(page);

    const before = await shelfPrices(page);
    assertShownAndMarked(before, 'gbp');

    await page.getByTestId('currency-ngn').click();
    await expect(page.getByTestId('currency-ngn')).toHaveAttribute('aria-pressed', 'true');

    // At least one price must actually have moved, or the switch did nothing and every
    // assertion below is vacuous.
    await expect
      .poll(async () => (await shelfPrices(page)).some((r) => r.price.startsWith('₦')
        || r.note !== before.find((b) => b.title === r.title)?.note))
      .toBeTruthy();

    assertShownAndMarked(await shelfPrices(page), 'ngn');

    await page.getByTestId('currency-usd').click();
    await expect(page.getByTestId('currency-usd')).toHaveAttribute('aria-pressed', 'true');
    assertShownAndMarked(await shelfPrices(page), 'usd');

    await page.getByTestId('currency-gbp').click();
    assertShownAndMarked(await shelfPrices(page), 'gbp');
  });

  test('the mark is a fact, not a warning — no badge, no alarm colour, no dimming', async ({ page }) => {
    await enterShop(page, { currency: 'ngn' });
    await page.goto('/bookstore');
    await waitForShelf(page);

    // WHY THIS CAN SKIP, and why that is honest rather than a hole being papered over.
    // The catalogue is live, and as of R8.3 all three published titles carry all three
    // currencies — so nothing on the shelf falls back and there is no mark to inspect. The
    // RULING itself is still enforced over live data by "switching currency repaints EVERY
    // visible price" above, which asserts both halves (a marked correct price fails it just as
    // an unmarked fallback does); and the fallback LOGIC is pinned exhaustively offline in
    // tests/bookstore/currency.test.mjs. What is unexercised here is only the rendered
    // appearance of the mark. The moment a curator adds a title without one of the three
    // prices, this test starts running by itself.
    const marked = page.locator('.entry-price-note').first();
    if (await marked.count() === 0) {
      test.skip(true, 'every published title is priced in all three currencies — no fallback to render');
    }

    const style = await marked.evaluate((el) => {
      const cs = getComputedStyle(el);
      const card = el.closest('.shelf-entry');
      return {
        fontStyle: cs.fontStyle,
        border: cs.borderStyle,
        background: cs.backgroundColor,
        text: el.textContent.trim(),
        cardOpacity: getComputedStyle(card).opacity,
        titleOpacity: getComputedStyle(card.querySelector('.entry-title')).opacity,
      };
    });

    expect(style.fontStyle).toBe('italic');
    expect(style.text).toBe(style.text.toLowerCase());
    expect(style.border).toMatch(/^none/);
    expect(style.background).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // The title it belongs to keeps its place AND its weight.
    expect(style.cardOpacity).toBe('1');
    expect(style.titleOpacity).toBe('1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('persistence and region', () => {
  test('the selection survives a reload', async ({ page }) => {
    await enterShop(page);
    await page.goto('/bookstore');
    await waitForShelf(page);

    await page.getByTestId('currency-ngn').click();
    await expect(page.getByTestId('currency-ngn')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((k) => window.localStorage.getItem(k), CURRENCY_KEY)).toBe('ngn');

    await page.reload();
    await waitForShelf(page);
    await expect(page.getByTestId('currency-ngn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('currency-note'))
      .toHaveText('Showing prices in naira. Remembered for next time.');
  });

  test('a region answer sets the default when nothing is stored', async ({ page }) => {
    await enterShop(page, { country: 'NG' });
    await page.goto('/bookstore');
    await waitForShelf(page);

    await expect(page.getByTestId('currency-ngn')).toHaveAttribute('aria-pressed', 'true');
    // Still not a "choice" — the reader has not picked, so the line keeps offering to explain.
    await expect(page.getByTestId('currency-note'))
      .toHaveText('Set from where you are — change it whenever you like.');
  });

  test('a region answer NEVER overrides a stored choice', async ({ page }) => {
    // Someone in Lagos who has deliberately switched to pounds stays in pounds.
    await enterShop(page, { currency: 'gbp', country: 'NG' });
    await page.goto('/bookstore');
    await waitForShelf(page);

    await expect(page.getByTestId('currency-gbp')).toHaveAttribute('aria-pressed', 'true');
    assertShownAndMarked(await shelfPrices(page), 'gbp');
  });

  test('first paint is not blocked on the region call', async ({ page }) => {
    // The endpoint hangs for 5s. The shelf and its prices must be on screen long before it
    // answers — this is the non-blocking requirement, asserted rather than asserted-about.
    await page.addInitScript(
      ([gateKey]) => {
        try {
          window.localStorage.setItem('cs_cookie_consent', 'accepted');
          window.localStorage.setItem(gateKey, '1');
        } catch { /* private mode */ }
      },
      [GATE_STORAGE_KEY],
    );
    await page.route('**/api/bookstore/region', async (route) => {
      await new Promise((r) => setTimeout(r, 5000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"country":"NG"}' });
    });

    await page.goto('/bookstore');
    // Prices visible while the region call is still in flight.
    await expect(page.locator('.entry-price').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('currency-gbp')).toHaveAttribute('aria-pressed', 'true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the buy button names the charged sum', () => {
  test('the detail page button and its sentence agree about the currency', async ({ page }) => {
    await enterShop(page, { currency: 'ngn' });
    await gotoDetail(page);

    const buy = page.locator('.bd-buy');
    await expect(buy).toBeVisible({ timeout: 30000 });

    const label = (await buy.textContent()).trim();
    const sentence = page.getByTestId('price-fallback-sentence');
    const hasSentence = await sentence.count() > 0;

    // Whatever the button says, it must name a currency the title is really priced in — and
    // the sentence must appear exactly when that is NOT the browsing currency.
    const m = /Buy · (.)/.exec(label);
    if (!m) {
      // No price at all on this title: then there is nothing to qualify either.
      expect(label).toBe('Buy');
      expect(hasSentence).toBeFalsy();
      return;
    }

    const shownSymbol = m[1];
    if (shownSymbol === SYMBOL.ngn) {
      expect(hasSentence, 'priced in the browsing currency — no sentence').toBeFalsy();
    } else {
      expect(hasSentence, `button says ${shownSymbol} while browsing in naira — the sentence is required`).toBeTruthy();
      const text = (await sentence.textContent()).trim();
      expect(text).toContain('isn’t priced in naira');
      // THE ASSERTION THIS WHOLE ROUND EXISTS FOR: the sum in the sentence is the sum on the
      // button. A button reading ₦4,500 that charges £4.99 is the worst available outcome.
      const amount = /charged (\S+) in/.exec(text)?.[1];
      expect(amount, 'the sentence must name an amount').toBeTruthy();
      expect(label).toContain(amount);
    }
  });

  test('the sentence sits BENEATH the button, not above the price', async ({ page }) => {
    await enterShop(page, { currency: 'ngn' });
    const slug = await gotoDetail(page);
    await expect(page.locator('.bd-buy')).toBeVisible({ timeout: 30000 });

    // Same situation as the shelf mark above: skips only while the catalogue prices this
    // title in every currency, and begins running the day it does not.
    const sentence = page.getByTestId('price-fallback-sentence');
    if (await sentence.count() === 0) {
      test.skip(true, `${slug} is priced in naira — there is no fallback sentence to place`);
    }

    const buyBox = await page.locator('.bd-buy').boundingBox();
    const noteBox = await sentence.boundingBox();
    expect(noteBox.y, 'it explains what the button will do, so it is read after it')
      .toBeGreaterThan(buyBox.y);
  });
});
