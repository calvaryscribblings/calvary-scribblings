// SERIES-MOVE (ruling 233) · THE SERIES UNDER JUST ADDED HOLDS ITS SPACE WHILE IT LOADS.
//
//   npm run test:series-home     (Firebase emulators + `next dev`; hermetic, like w38-editor)
//
// Directly under Just Added, a row that drew nothing until its reads landed would push Top
// Readers, Top 10 and every genre row down when it arrived. So SeriesRow draws a skeleton
// while its FIRST read is in flight, and its card text is pinned to fixed line counts. This
// measures the skeleton against the finished row at a phone width and a desktop width; they
// must be equal to the pixel.
//
// HOLDING THE FIRST READ. The test holds the Series' own database reads on the emulator's
// WebSocket until it has measured the skeleton, then lets them through. (Not the loader's
// chunk: under `next dev` the loader is bundled into the page chunk.) Nothing else on the
// page is slowed.
//
// Emulators only, never production: the admin SDK talks to the emulator hosts set by
// harness.mjs, and the page is the emulator build (NEXT_PUBLIC_FB_EMULATOR=1).
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { adminApp, closeApp } from './harness.mjs';

const DAY = 86400000;
let app;
test.beforeAll(async () => { app = adminApp('series-home'); });
test.afterAll(async () => { if (app) await closeApp(app); });

const story = (id, category, title, daysAgo) => ({
  title, author: 'Fixture Author', category, url: `/stories/${id}`, cover: null,
  date: new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10), published: true,
});

async function seed({ series = true } = {}) {
  const db = getDatabase(app);
  const now = Date.now();
  await Promise.all(['series', 'series_instalments', 'series_instalments_detail', 'cms_stories_index', 'leaderboard']
    .map((p) => db.ref(p).set(null)));
  const index = {};
  ['flash', 'short', 'poetry', 'news', 'inspiring'].forEach((cat, c) => {
    for (let i = 0; i < 4; i++) index[`fx-${cat}-${i}`] = story(`fx-${cat}-${i}`, cat, `A ${cat} fixture ${i}`, c + i + 10);
  });
  const leaders = {};
  for (let i = 0; i < 3; i++) leaders[`fx-reader-${i}`] = { displayName: `Reader ${i}`, readerScore: 10 - i, scoreUpdatedAt: now, joinDate: i };
  const update = { cms_stories_index: index, leaderboard: leaders };
  if (series) {
    // Two series whose text differs as much as the format allows: a one-line title over a
    // one-line shelf, and a title that clamps over a shelf line that wraps.
    update.series = {
      'fx-short': { schemaVersion: 1, slug: 'fx-short', title: 'Ash', synopsis: '', coverUrl: null, status: 'published', addedAt: now - 1000, updatedAt: now },
      'fx-long': { schemaVersion: 1, slug: 'fx-long', title: 'The Very Long Title of a Series That Will Not Fit on Two Lines', synopsis: '', coverUrl: null, status: 'published', addedAt: now, updatedAt: now },
    };
    const rows = { 'fx-short-i1': { schemaVersion: 1, seriesId: 'fx-short', ordinal: 1, releaseAtMs: now - DAY, freeForGold: false, status: 'published', addedAt: now, updatedAt: now } };
    for (let i = 1; i <= 5; i++) rows[`fx-long-i${i}`] = { schemaVersion: 1, seriesId: 'fx-long', ordinal: i, releaseAtMs: now - (10 - i) * DAY, freeForGold: false, status: 'published', addedAt: now, updatedAt: now };
    rows['fx-long-i6'] = { schemaVersion: 1, seriesId: 'fx-long', ordinal: 6, releaseAtMs: now + 7 * DAY, freeForGold: false, status: 'published', addedAt: now, updatedAt: now };
    update.series_instalments = rows;
  }
  await db.ref().update(update);
}

/**
 * Hold the Series reads until `release()` is called. They go over the database WebSocket to
 * the emulator; every frame the page sends that asks for a path under /series… (series and
 * series_instalments) is queued, and everything else — the stories index the rest of the page
 * hangs off, Top Readers — goes straight through.
 *
 * In the page, by wrapping WebSocket.prototype.send before any script runs. Playwright's
 * routeWebSocket did not see the SDK's socket to :9000 under `next dev` (it saw only the HMR
 * one), so the hold sits where the frame is actually written.
 */
async function holdSeriesReads(page) {
  await page.addInitScript(() => {
    const send = WebSocket.prototype.send;
    window.__seriesHeld = [];
    window.__seriesHolding = true;
    WebSocket.prototype.send = function (data) {
      if (window.__seriesHolding && typeof data === 'string' && /"p":"\/?series/.test(data)) {
        window.__seriesHeld.push([this, data]);
        return;
      }
      return send.call(this, data);
    };
    window.__seriesRelease = () => {
      window.__seriesHolding = false;
      for (const [ws, data] of window.__seriesHeld.splice(0)) send.call(ws, data);
    };
  });
  return {
    count: () => page.evaluate(() => window.__seriesHeld.length),
    release: () => page.evaluate(() => window.__seriesRelease()),
  };
}

const rowHeight = (page) => page.locator('section[data-series-row]').evaluate((el) => el.getBoundingClientRect().height);

for (const width of [390, 1280]) {
  test(`at ${width}px the skeleton is exactly the finished row's height`, async ({ page }) => {
    await seed();
    await page.setViewportSize({ width, height: 900 });
    const gate = await holdSeriesReads(page);
    await page.goto('/public-library');

    const skeleton = page.locator('section[data-series-row="skeleton"]');
    await expect(skeleton).toBeAttached({ timeout: 120000 });
    await expect(skeleton.locator('h3', { hasText: 'The Series' })).toHaveCount(1);
    // The Series' read is actually in flight and held, and the rest of the page has drawn
    // around it (the genre rows' real See-all links, not their skeletons' headings).
    await expect.poll(() => gate.count(), { message: 'the Series reads were held', timeout: 60000 }).toBeGreaterThan(0);
    await expect(page.locator('section a[href="/flash"]')).toBeAttached({ timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const before = await rowHeight(page);

    await gate.release();
    const finished = page.locator('section[data-series-row=""]');
    await expect(finished).toBeAttached();
    await expect(finished.getByRole('link', { name: /Ash/ })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const after = await rowHeight(page);
    await expect(page.locator('section[data-series-row="skeleton"]')).toHaveCount(0);

    // Every card the same height, whatever its text.
    const cards = await finished.locator('a[href^="/series/"]').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
    console.log(`[series-home] ${width}px · skeleton ${before}px · finished ${after}px · cards ${cards.join(', ')}px`);
    expect(after).toBe(before);
    expect(new Set(cards).size).toBe(1);

    // The shelf line reserves two lines. The longest line the format makes still fits in two:
    // set it into a drawn card and look for overflow (scrollHeight beyond the box = clamped).
    const fits = await finished.locator('a[href^="/series/"]').first().evaluate((a) => {
      const shelf = a.querySelector('div > div:last-child');
      const was = shelf.textContent;
      const count = (text) => {
        shelf.textContent = text;
        return Math.round(shelf.scrollHeight / parseFloat(getComputedStyle(shelf).lineHeight));
      };
      const longest = count('12 instalments · next 30 September 2027');
      const control = count('12 instalments · next 30 September 2027 · and a third line besides');
      shelf.textContent = was;
      return { longest, control };
    });
    expect(fits.control, 'the measure sees past the clamp').toBeGreaterThan(2);
    expect(fits.longest, 'the longest shelf line wraps to at most two lines').toBeLessThanOrEqual(2);
  });
}

test('no published series: no section, and no skeleton left behind', async ({ page }) => {
  await seed({ series: false });
  await page.goto('/public-library');
  await expect(page.locator('section a[href="/flash"]')).toBeAttached({ timeout: 120000 });
  await expect(page.locator('section[data-series-row]')).toHaveCount(0, { timeout: 30000 });
});

for (const width of [390, 1280]) {
  test(`at ${width}px the gaps around The Series, against two genre rows`, async ({ page }) => {
    // Recorded, not asserted: SERIES-MOVE reports these for a ruling rather than changing them.
    await seed();
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/public-library');
    await expect(page.locator('section[data-series-row=""]')).toBeAttached({ timeout: 120000 });
    await expect(page.getByRole('heading', { name: 'Top Readers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Short Stories' })).toBeVisible();
    // The settled page: a card still in its reveal (translateY 16px) reads 16px low, and which
    // cards are mid-reveal at the moment of measuring depends on timing.
    await page.addStyleTag({ content: '[data-reveal]{animation:none!important;transform:none!important;opacity:1!important}' });
    await page.evaluate(() => document.fonts.ready);
    const gaps = await page.evaluate(() => {
      const section = (title) => [...document.querySelectorAll('h3')].find((h) => h.textContent.trim() === title).closest('section');
      // Ink, not boxes: the extent of the section's leaf elements, so section padding counts
      // as space and nothing else does. The Series' reserved text lines are leaves too.
      const leaves = (sec) => [...sec.querySelectorAll('*')].filter((e) => !e.children.length || e.getAttribute('role') === 'presentation')
        .map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
      const top = (t) => Math.min(...leaves(section(t)).map((r) => r.top));
      const bottom = (t) => Math.max(...leaves(section(t)).map((r) => r.bottom));
      const gap = (a, b) => Math.round((top(b) - bottom(a)) * 10) / 10;
      return {
        justAddedToSeries: gap('Just Added', 'The Series'),
        seriesToTopReaders: gap('The Series', 'Top Readers'),
        flashToShort: gap('Flash Fiction', 'Short Stories'),
      };
    });
    console.log(`[series-home] ${width}px gaps · Just Added→Series ${gaps.justAddedToSeries}px · Series→Top Readers ${gaps.seriesToTopReaders}px · Flash→Short ${gaps.flashToShort}px`);
  });
}
