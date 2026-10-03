// W33 — MY LIBRARY'S TILE (ruling 134) AND THE HELD-BOOK DOOR, driven in a browser against the
// Firebase EMULATORS with generic fixtures. Nothing here touches production.
//
//   npm run test:held
//
// The shelf: a published title, a WITHDRAWN title still held, a book held with NO catalogue
// record (an author copy's shape), a revoked copy, a long title and a finished book. Asserted:
//   · every tile carries four things — board, title, author, bar — and no bookplate;
//   · rows level at 390 and 1440: titles on one baseline, bars on one line;
//   · the door: /reader/<slug> only for a published record, /my-library/book?t= for the rest.
// The held page: signed out, a reader without the copy, a malformed id, the holder (the Reading
// Room opens on a fixture EPUB), and the holder whose stream is refused (the generic page, never
// the buy interstitial). The stream endpoint is a Pages Function next dev does not serve, so it is
// routed here — which is exactly what lets the refusal be produced on demand.
//
// Screenshots go to W33_SHOTS (default ~/calvary-backups/author-copy/w33/shots) — outside the repo.
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getDatabase } from 'firebase-admin/database';
import { adminApp, adminToken, closeApp } from '../series/harness.mjs';
import { HELD_SIGN_IN_LINE, HELD_NOT_ON_SHELF_LINE } from '../../app/components/HeldBookStates.js';
import { PRINT_LINE } from '../../app/lib/readerCopy.js';

const SHOTS = process.env.W33_SHOTS || join(homedir(), 'calvary-backups', 'author-copy', 'w33', 'shots');
const FIXTURE_EPUB = readFileSync(fileURLToPath(new URL('../fixtures/harness-book.epub', import.meta.url)));
const HOLDER = 'w33HeldReader000000000001';
const STRANGER = 'w33OtherReader00000000001';
const NOW = 1_790_000_000_000;

const sale = (title, author, t) => ({ status: 'active', slug: title.id, title: title.title, author, purchasedAt: NOW - t, amount: 999, currency: 'gbp', stripeSessionId: `cs_test_${title.id}` });
const T = {
  published: { id: 'w33-published', title: 'A Published Book' },
  withdrawn: { id: 'w33-withdrawn', title: 'A Withdrawn Book' },
  held: { id: 'w33-held', title: 'A Held Book With No Record' },
  revoked: { id: 'w33-revoked', title: 'A Revoked Copy' },
  long: { id: 'w33-long', title: 'A Book Whose Title Runs Long Enough To Take Two Lines' },
  finished: { id: 'w33-finished', title: 'A Finished Book' },
};
const doc = (t, status) => ({ schemaVersion: 1, status, slug: t.id, title: t.title, author: 'Catalogue Author', catalogueNumber: 900 });

let app; let db;
test.beforeAll(async () => {
  app = adminApp('w33-held'); db = getDatabase(app);
  await db.ref().update({
    [`users/${HOLDER}`]: { displayName: 'W33 Holder', username: 'wthirtythreeholder' },
    [`users/${STRANGER}`]: { displayName: 'W33 Stranger', username: 'wthirtythreestranger' },
    [`bookstore_titles/${T.published.id}`]: doc(T.published, 'published'),
    [`bookstore_titles/${T.withdrawn.id}`]: doc(T.withdrawn, 'withdrawn'),
    [`bookstore_titles/${T.revoked.id}`]: doc(T.revoked, 'published'),
    [`bookstore_titles/${T.long.id}`]: doc(T.long, 'published'),
    [`bookstore_purchases/${HOLDER}`]: {
      [T.published.id]: sale(T.published, 'An Author', 1),
      [T.withdrawn.id]: sale(T.withdrawn, 'An Author', 2),
      // The author copy's exact shape: a comp, no money, no catalogue record anywhere.
      [T.held.id]: { status: 'active', source: 'comp', compGrant: 'author-copy', compGrantedAt: NOW - 3, purchasedAt: NOW - 3, slug: T.held.id, title: T.held.title, author: 'An Author' },
      [T.revoked.id]: { ...sale(T.revoked, 'An Author', 4), status: 'revoked' },
      [T.long.id]: sale(T.long, 'An Author With A Rather Long Name Indeed', 5),
      [T.finished.id]: sale(T.finished, 'An Author', 6),
    },
    [`bookstore_reading_progress/${HOLDER}`]: {
      [T.published.id]: { fraction: 0.437, updatedAt: NOW },
      [T.finished.id]: { fraction: 1, updatedAt: NOW },
    },
  });
});
test.afterAll(async () => { await closeApp(app); });

async function open(page, path, uid) {
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem('cs_bookstore_gate_v1', '1'); } catch { /* private */ } });
  await page.goto(path);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
  if (uid) await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), await adminToken(app, uid));
}

/** The stream, as the Pages Function would answer — or refuse. */
async function routeStream(page, { refuse } = {}) {
  const BYTES = 'https://storage.googleapis.com/calvary-scribblings.firebasestorage.app/bookstore_epubs/w33/master.epub?X-Goog-Signature=stub';
  await page.context().route('**/api/bookstore/stream', (r) => r.fulfill(refuse
    ? { status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'You don’t own this book yet.', code: refuse }) }
    : { status: 200, contentType: 'application/json', body: JSON.stringify({ url: BYTES, expiresAt: Date.now() + 300e3, version: '1', md5: null }) }));
  await page.context().route((u) => u.hostname === 'storage.googleapis.com' && /\.epub$/.test(u.pathname),
    (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'application/epub+zip', 'Access-Control-Allow-Origin': '*' }, body: FIXTURE_EPUB }));
}

// ═══ THE TILE ═══════════════════════════════════════════════════════════════════════════════
for (const width of [390, 1440]) {
  test(`My Library at ${width}: four things a tile, no bookplate, rows level, the right doors`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    // The shelf settles in with a staggered fade; reduced motion (which the page honours) puts
    // every tile at rest, so the photograph is of the shelf and not of an animation frame.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/my-library?tab=books', HOLDER);
    await page.locator('.ml-sw', { hasText: 'BOOKS' }).first().click({ timeout: 60000 });
    const tiles = page.locator('article.ml-held');
    await expect(tiles).toHaveCount(6, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);

    // No bookplate, no accession mark, no PURCHASED anywhere on the shelf.
    await expect(page.locator('.ml-plate')).toHaveCount(0);
    const shelfText = await page.locator('article.ml-held').allInnerTexts();
    for (const t of shelfText) { expect(t).not.toMatch(/PURCHASED|CS\s?\d{3}|CS —/); }

    // Four things: one board, one title, one author, and a bar — or, revoked, the withdrawn line.
    const rows = await tiles.evaluateAll((els) => els.map((a) => ({
      title: a.querySelector('h3')?.textContent,
      boards: a.querySelectorAll('.ml-boards').length,
      titles: a.querySelectorAll('.ml-vol-t').length,
      authors: a.querySelectorAll('.ml-vol-a').length,
      bars: a.querySelectorAll('.ml-bar').length,
      withdrawn: !!a.querySelector('.ml-withdrawn'),
      href: a.querySelector('a.ml-book')?.getAttribute('href') ?? null,
      quiet: a.querySelector('.ml-quiet')?.getAttribute('href') ?? null,
      label: a.querySelector('.ml-bar-l')?.textContent ?? null,
      titleTop: a.querySelector('.ml-vol-t').getBoundingClientRect().top,
      barTop: (a.querySelector('.ml-bar') || a.querySelector('.ml-withdrawn')).getBoundingClientRect().top,
      top: a.getBoundingClientRect().top,
      kids: [...a.children].map((c) => c.className),
    })));
    const by = Object.fromEntries(rows.map((r) => [r.title, r]));
    for (const r of rows) {
      expect([r.boards, r.titles, r.authors], r.title).toEqual([1, 1, 1]);
      expect(r.bars + (r.withdrawn ? 1 : 0), `${r.title}: a bar, or the withdrawn line`).toBe(1);
    }
    expect(by[T.published.title].href).toBe(`/reader/${T.published.id}`);
    expect(by[T.long.title].href).toBe(`/reader/${T.long.id}`);
    expect(by[T.withdrawn.title].href).toBe(`/my-library/book?t=${T.withdrawn.id}`);
    expect(by[T.held.title].href).toBe(`/my-library/book?t=${T.held.id}`);
    expect(by[T.finished.title].href).toBe(`/my-library/book?t=${T.finished.id}`);
    expect(by[T.revoked.title].withdrawn).toBe(true);
    expect(by[T.revoked.title].quiet).toBe(`/bookstore/${T.revoked.id}`);
    expect(by[T.published.title].label).toBe('43%');          // floored, not rounded
    expect(by[T.finished.title].label).toBe('FINISHED');

    // Rows level: within each visual row, every title starts on one line, and every bar (the
    // withdrawn line sits elsewhere by design) on another.
    const lines = new Map();
    for (const r of rows) { const k = Math.round(r.top); lines.set(k, [...(lines.get(k) || []), r]); }
    let worstTitle = 0; let worstBar = 0;
    for (const row of lines.values()) {
      const tt = row.map((r) => r.titleTop); worstTitle = Math.max(worstTitle, Math.max(...tt) - Math.min(...tt));
      const bb = row.filter((r) => r.bars).map((r) => r.barTop);
      if (bb.length > 1) worstBar = Math.max(worstBar, Math.max(...bb) - Math.min(...bb));
    }
    console.log(`\n=== ${width}: ${lines.size} row(s); worst title misalignment ${worstTitle.toFixed(3)}px; worst bar ${worstBar.toFixed(3)}px ===`);
    expect(worstTitle).toBeLessThanOrEqual(0.5);
    expect(worstBar).toBeLessThanOrEqual(0.5);

    mkdirSync(SHOTS, { recursive: true });
    await page.locator('.ml-grid').last().screenshot({ path: join(SHOTS, `my-library-books-${width}.png`) });
  });
}

// ═══ THE HELD PAGE ══════════════════════════════════════════════════════════════════════════
const NAMES = Object.values(T).flatMap((t) => [t.title, t.id]);
async function expectGeneric(page, state) {
  await expect(page.locator(`[data-held-state="${state}"]`)).toBeVisible({ timeout: 60000 });
  const text = await page.locator('body').innerText();
  for (const n of NAMES) expect(text, 'the generic page names nothing').not.toContain(n);
  await expect(page.locator('a[href^="/bookstore"], .br-buy, [class*="buy"]')).toHaveCount(0);
  return text;
}

test('signed out: the ordinary sign-in prompt, for a real id, an unknown id and a malformed one', async ({ page }) => {
  const seen = [];
  for (const q of [`?t=${T.held.id}`, '?t=w33-no-such-book', '?t=../../x', '']) {
    await open(page, `/my-library/book${q}`);
    seen.push(await expectGeneric(page, 'signed-out'));
    expect(seen.at(-1)).toContain(HELD_SIGN_IN_LINE);
  }
  expect(new Set(seen).size, 'the same page, whatever the address').toBe(1);
});

test('a reader without the copy: one generic page, the same for a held id, an unknown id and a malformed one', async ({ page }) => {
  const seen = [];
  for (const q of [`?t=${T.held.id}`, `?t=${T.withdrawn.id}`, '?t=w33-no-such-book', '?t=a%2Fb']) {
    await open(page, `/my-library/book${q}`, STRANGER);
    seen.push(await expectGeneric(page, 'not-on-shelf'));
    expect(seen.at(-1)).toContain(HELD_NOT_ON_SHELF_LINE);
  }
  expect(new Set(seen).size).toBe(1);
});

test('the holder, a revoked copy: the generic page — never the buy interstitial', async ({ page }) => {
  await routeStream(page);
  await open(page, `/my-library/book?t=${T.revoked.id}`, HOLDER);
  await expectGeneric(page, 'not-on-shelf');
});

for (const which of ['held', 'withdrawn']) {
  test(`the holder of a ${which === 'held' ? 'book with no catalogue record' : 'withdrawn title'}: the Reading Room opens on it`, async ({ page }) => {
    await routeStream(page);
    const asked = [];
    page.on('request', (r) => { if (r.url().includes('/api/bookstore/stream')) asked.push(JSON.parse(r.postData() || '{}').titleId); });
    await open(page, `/my-library/book?t=${T[which].id}`, HOLDER);
    await expect(page.locator('.rr-ctitle')).toHaveText(T[which].title, { timeout: 60000 });
    expect(asked).toContain(T[which].id);
    await expect(page.locator('a[href^="/bookstore"]')).toHaveCount(0);
    await expect(page.locator('.br-buy')).toHaveCount(0);
    await page.locator('.rr-ccta').click();
    await expect(page.frameLocator('iframe').first().locator('foliate-view')).toHaveCount(1, { timeout: 60000 });
    // The room's own print rule: the reader page prints one line instead of the book.
    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => getComputedStyle(document.body, '::before').content);
    expect(printed).toContain(PRINT_LINE);
  });
}

test('the holder, stream REFUSED: the generic page, never the buy interstitial', async ({ page }) => {
  for (const code of ['not_purchased', 'revoked']) {
    await page.context().unrouteAll({ behavior: 'ignoreErrors' });
    await routeStream(page, { refuse: code });
    await open(page, `/my-library/book?t=${T.held.id}`, HOLDER);
    await expectGeneric(page, 'not-on-shelf');
  }
});

// ═══ SITE SEARCH (§4) ═══════════════════════════════════════════════════════════════════════
// The live catalogue holds no withdrawn title today, so production cannot show this leak
// closing. The emulator can: a WITHDRAWN record is searched for by its own title.
test('site search lists published books only — a withdrawn title is not a result, a published one is', async ({ page }) => {
  const books = async (q) => {
    await open(page, `/search?q=${encodeURIComponent(q)}`);
    await page.waitForTimeout(4000);
    return page.locator('a.ix-res[href^="/bookstore/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  };
  expect(await books(T.published.title)).toContain(`/bookstore/${T.published.id}`);
  expect(await books(T.withdrawn.title)).not.toContain(`/bookstore/${T.withdrawn.id}`);
});
