// W2 — NOTHING THAT FAILED MAY LOOK EMPTY.
//
//   npx next build && npx playwright test -c tests/states/playwright.config.mjs
//
// Every surface the audit found failing into "empty" (BS-01/02/03, LIB-01 is signed-in and is
// proved on the live site instead, SRCH-01, STORY-04, SER-01, HOME-05, SQ-03) is opened with the
// Realtime Database UNREACHABLE — every HTTP request to it aborted, every WebSocket to it held
// open and silent, which is what a dead or blocked database looks like to the SDK: reads that
// never answer. The page must then draw the designed failure ([data-unavailable]) and must NOT
// draw any of the sentences that used to stand in for it.
//
// Then: Retry works once the database is back; content already drawn survives the database going
// away; the 404 is the house page; the curtain's tab bar answers a tap.
import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BOOK = readdirSync(join(ROOT, 'out/bookstore')).find((f) => f.endsWith('.html') && !f.startsWith('__'))?.replace(/\.html$/, '');
const RTDB = /firebasedatabase\.app|firebaseio\.com/;
const SQUARE_OPEN = new Date('2026-09-24T19:30:00Z'); // 20:30 London

// The lies each surface used to tell. None may be visible while the database is unreachable.
const LIES = [
  /\b0 (stories|poems|articles)\b/, /BY FORM\s*0/i, /Nothing under that word/, /No such series/,
  /The first series is being written/, /No posts yet/, /\b0 in the room\b/, /This page doesn.t exist/,
  /Books you buy/,
];

/** Make the database unreachable, with a switch to bring it back. */
async function cutDatabase(page) {
  // Bringing it back also CLOSES the sockets that were held silent — what a real network change
  // does to a connection that went dead. Retry must then get through on a fresh one.
  const held = [];
  const state = {
    dead: true,
    revive() { this.dead = false; for (const ws of held.splice(0)) ws.close(); },
  };
  await page.route(RTDB, (route) => (state.dead ? route.abort() : route.continue()));
  await page.routeWebSocket(RTDB, (ws) => { if (state.dead) held.push(ws); else ws.connectToServer(); });
  return state;
}

async function seed(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem('cs_bookstore_gate_v1', '1'); } catch {}
  });
}

async function expectNoLies(page) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const lie of LIES) expect(text, `the page claims ${lie} while the database is unreachable`).not.toMatch(lie);
}

const SURFACES = [
  ['home', '/public-library'],
  ['search', '/search'],
  ['short', '/short'],
  ['poetry', '/poetry'],
  ['flash', '/flash'],
  ['news', '/news'],
  ['inspiring', '/inspiring'],
  ['series', '/series'],
  ['series detail', '/series/beta-princess'],
  ['bookstore', '/bookstore'],
  ['book detail', `/bookstore/${BOOK}`],
  ['square (open hours)', '/square'],
];

test.describe('unreachable database → a designed failure, never an empty page', () => {
  for (const [name, path] of SURFACES) {
    test(`${name}: ${path}`, async ({ page }) => {
      await seed(page);
      await page.clock.setFixedTime(SQUARE_OPEN); // Date only; timers run — the Square is open
      await cutDatabase(page);
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const failure = page.locator('[data-unavailable]').first();
      await expect(failure).toBeVisible();
      await expect(failure.getByRole('button', { name: /try again/i })).toBeVisible();
      await expectNoLies(page);
    });
  }
});

test('Retry brings the content once the database is back', async ({ page }) => {
  await seed(page);
  const db = await cutDatabase(page);
  await page.goto('/short', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-unavailable]')).toBeVisible();
  db.revive();
  await page.getByRole('button', { name: /try again/i }).click();
  await expect(page.locator('[data-unavailable]')).toHaveCount(0, { timeout: 40000 });
  await expect(page.getByText(/\b\d+ stor(y|ies)\b/)).toBeVisible({ timeout: 40000 });
});

test('RENDERED CONTENT STAYS: a page that has drawn its stories keeps them when the database goes', async ({ page, context }) => {
  await seed(page);
  await page.goto('/public-library', { waitUntil: 'domcontentloaded' });
  // A real card, not the skeleton (which carries the "Just Added" heading too).
  await expect(page.locator('.just-added-scroll a').first()).toBeVisible({ timeout: 40000 });
  const cards = await page.locator('.just-added-scroll a').count();
  expect(cards).toBeGreaterThan(0);
  // …and the Top 10, which loads by its own two reads. The premise is content ALREADY DRAWN: on a
  // slow runner the Top 10 had not arrived when the connection went, and it correctly drew its
  // "couldn't reach" panel — the test was racing it (reader tests on dcbfa17a and 18bd75a0).
  await expect(page.locator('.top10-scroll > *').first()).toBeVisible({ timeout: 40000 });
  await context.setOffline(true);
  await page.waitForTimeout(20000); // past the read deadline
  await expect(page.locator('[data-unavailable]')).toHaveCount(0);
  expect(await page.locator('.just-added-scroll a').count()).toBe(cards);
  await context.setOffline(false);
});

test('an unknown address is the house 404, with a way home', async ({ page }) => {
  const res = await page.goto('/this-address-does-not-exist');
  expect(res.status()).toBe(404);
  await expect(page.getByRole('heading', { name: /nothing at this address/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /go to the library/i })).toHaveAttribute('href', '/public-library');
  await expect(page.locator('nav.cs-tabbar')).toBeVisible();
  await expect(page.getByText('This page could not be found')).toHaveCount(0);
});

test('offline: once any page has loaded, a navigation with no connection is the house page, fenced routes included', async ({ page, context }) => {
  await seed(page);
  await page.goto('/public-library', { waitUntil: 'domcontentloaded' });
  // Registered site-wide on idle (Providers), and it claims the page on activation.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 });
  await context.setOffline(true);
  for (const path of ['/bookstore', '/square', '/search']) {
    await page.goto(path).catch(() => {});
    await expect(page.getByRole('heading', { name: 'No signal' }), `${path} offline`).toBeVisible();
    await expect(page.getByRole('link', { name: 'TRY AGAIN' })).toBeVisible();
  }
  await context.setOffline(false);
});
