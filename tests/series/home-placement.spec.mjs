// SERIES-MOVE + SERIES-MOVE.1 · THE SERIES UNDER JUST ADDED (rulings 233–237, 27 Oct 2026).
//
//   npm run test:series-home     (Firebase emulators + `next dev`; hermetic, like w38-editor)
//
// 233: The Series sits directly under Just Added. 234: its posters are 160×240, so the two rows
// line up card for card. 235: 12px corners, its own faint edge. 236: 16px between heading and
// cards on every row from Just Added to the genre rows. 237: the card's text sits like Just
// Added's, no blank lines in reserve — so the finished row may differ from its loading skeleton
// by up to one title line (18.3px), and this measures all four text cases against it.
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
const TITLE_LINE = 0.88 * 16 * 1.3; // 18.304px — one line of the card title
const SHORT_TITLE = 'Ash';
const LONG_TITLE = 'The Very Long Title of a Series That Will Not Fit on Two Lines';
let app;
test.beforeAll(async () => { app = adminApp('series-home'); });
test.afterAll(async () => { if (app) await closeApp(app); });

const story = (id, category, title, daysAgo) => ({
  title, author: 'Fixture Author', category, url: `/stories/${id}`, cover: null,
  date: new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10), published: true,
});

/**
 * A series fixture. `released` instalments in the past, and if `next`, one more a week out:
 * 1 released and no next makes the one-line shelf ("1 instalment"); 12 released and a next
 * makes the longest the format writes ("12 instalments · next …"), which wraps.
 */
function seriesRecords(id, title, { released, next = false, addedAt }) {
  const now = Date.now();
  const series = { schemaVersion: 1, slug: id, title, synopsis: '', coverUrl: null, status: 'published', addedAt, updatedAt: now };
  const rows = {};
  const total = released + (next ? 1 : 0);
  for (let i = 1; i <= total; i++) {
    rows[`${id}-i${i}`] = {
      schemaVersion: 1, seriesId: id, ordinal: i,
      releaseAtMs: i <= released ? now - (total + 2 - i) * DAY : now + 7 * DAY,
      freeForGold: false, status: 'published', addedAt: now, updatedAt: now,
    };
  }
  return { series, rows };
}

const ONE_LINE_SHELF = { released: 1 };
const TWO_LINE_SHELF = { released: 12, next: true };

async function seed(seriesList = [
  ['fx-short', SHORT_TITLE, ONE_LINE_SHELF],
  ['fx-long', LONG_TITLE, TWO_LINE_SHELF],
]) {
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
  if (seriesList.length) {
    update.series = {};
    update.series_instalments = {};
    seriesList.forEach(([id, title, shelf], i) => {
      const r = seriesRecords(id, title, { ...shelf, addedAt: now - i * 1000 });
      update.series[id] = r.series;
      Object.assign(update.series_instalments, r.rows);
    });
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
const finishedRow = (page) => page.locator('section[data-series-row=""]');
const seriesCards = (page) => finishedRow(page).locator('a[href^="/series/"]');

/** The settled page: a card still in its reveal (translateY 16px) reads 16px low. */
async function settle(page) {
  await page.addStyleTag({ content: '[data-reveal]{animation:none!important;transform:none!important;opacity:1!important}' });
  await page.evaluate(() => document.fonts.ready);
}

/** Load Home and wait for the finished Series row and the rest of the page around it. */
async function openHome(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/public-library');
  await expect(finishedRow(page)).toBeAttached({ timeout: 120000 });
  await expect(page.locator('.just-added-scroll > a').first()).toBeAttached({ timeout: 60000 });
  await expect(page.locator('section a[href="/flash"]')).toBeAttached({ timeout: 60000 });
  await expect(page.locator('h3', { hasText: 'Top Readers' })).toBeAttached();
  await expect(page.locator('.top10-scroll')).toBeAttached({ timeout: 60000 });
  await settle(page);
}

for (const width of [390, 1280]) {
  test.describe(`at ${width}px`, () => {
    test('234 · the first two Series cards line up with the first two Just Added cards', async ({ page }) => {
      await seed();
      await openHome(page, width);
      const ja = await page.locator('.just-added-scroll > a').evaluateAll((as) => as.slice(0, 2).map((a) => a.getBoundingClientRect().left));
      const se = await seriesCards(page).evaluateAll((as) => as.slice(0, 2).map((a) => a.getBoundingClientRect().left));
      console.log(`[series-home] ${width}px left edges · Just Added ${ja.join(', ')} · Series ${se.join(', ')}`);
      expect(se).toHaveLength(2);
      expect(se).toEqual(ja);
    });

    test('234 + 235 · the poster is 160×240 with 12px corners', async ({ page }) => {
      await seed();
      await openHome(page, width);
      const poster = await seriesCards(page).first().locator('[role="presentation"]').evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { w: r.width, h: r.height, radius: cs.borderTopLeftRadius, border: `${cs.borderTopWidth} ${cs.borderTopColor}`, shadow: cs.boxShadow };
      });
      console.log(`[series-home] ${width}px poster ${JSON.stringify(poster)}`);
      expect(poster).toEqual({ w: 160, h: 240, radius: '12px', border: '1px rgba(255, 255, 255, 0.08)', shadow: 'none' });
    });

    test('236 · 16px between heading and cards on Just Added, The Series, Top Readers, Top 10 and a genre row', async ({ page }) => {
      await seed();
      await openHome(page, width);
      const gaps = await page.evaluate(() => {
        const gap = (title) => {
          const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.trim() === title);
          // The strip of cards: the first scrolling sibling found walking up from the heading.
          let el = h;
          while (el && !(el.nextElementSibling && getComputedStyle(el.nextElementSibling).overflowX === 'auto')) el = el.parentElement;
          return Math.round((el.nextElementSibling.getBoundingClientRect().top - h.getBoundingClientRect().bottom) * 100) / 100;
        };
        return Object.fromEntries(['Just Added', 'The Series', 'Top Readers', 'Top 10 Stories', 'Flash Fiction'].map((t) => [t, gap(t)]));
      });
      console.log(`[series-home] ${width}px heading→cards ${JSON.stringify(gaps)}`);
      for (const [title, g] of Object.entries(gaps)) expect(g, title).toBe(16);
    });

    test('237 · a one-line title has its shelf line 4px beneath it', async ({ page }) => {
      await seed();
      await openHome(page, width);
      const card = seriesCards(page).filter({ hasText: SHORT_TITLE }).first();
      const m = await card.evaluate((a) => {
        const [title, shelf] = a.querySelectorAll('div > div');
        const t = title.getBoundingClientRect();
        return { titleH: t.height, gap: shelf.getBoundingClientRect().top - t.bottom };
      });
      expect(m.titleH).toBeLessThan(TITLE_LINE + 1); // it IS one line
      expect(m.gap).toBe(4);
    });

    test('237 · the finished row is within one title line of the skeleton, in all four text cases', async ({ page }) => {
      // The skeleton, with the reads held.
      await seed([['fx-a', SHORT_TITLE, ONE_LINE_SHELF]]);
      await page.setViewportSize({ width, height: 900 });
      const gate = await holdSeriesReads(page);
      await page.goto('/public-library');
      await expect(page.locator('section[data-series-row="skeleton"]')).toBeAttached({ timeout: 120000 });
      await expect.poll(() => gate.count(), { message: 'the Series reads were held', timeout: 60000 }).toBeGreaterThan(0);
      await expect(page.locator('section a[href="/flash"]')).toBeAttached({ timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      const skeleton = await rowHeight(page);
      await gate.release();
      await expect(finishedRow(page)).toBeAttached();
      await expect(page.locator('section[data-series-row="skeleton"]')).toHaveCount(0);

      // The four cases, one series each so the row's height is that card's. On a fresh page:
      // the hold's init script would run again on every navigation of this one.
      const fresh = await page.context().newPage();
      await fresh.setViewportSize({ width, height: 900 });
      const results = {};
      for (const [tLines, title] of [[1, SHORT_TITLE], [2, LONG_TITLE]]) {
        for (const [sLines, shelf] of [[1, ONE_LINE_SHELF], [2, TWO_LINE_SHELF]]) {
          await seed([['fx-a', title, shelf]]);
          await fresh.goto('/public-library');
          await expect(finishedRow(fresh)).toBeAttached({ timeout: 120000 });
          await fresh.evaluate(() => document.fonts.ready);
          const m = await seriesCards(fresh).first().evaluate((a) => {
            const [t, s] = a.querySelectorAll('div > div');
            return { title: t.getBoundingClientRect().height, shelf: s.getBoundingClientRect().height };
          });
          const h = await rowHeight(fresh);
          results[`title ${tLines} × shelf ${sLines}`] = { row: h, diff: Math.round((h - skeleton) * 1000) / 1000, ...m };
        }
      }
      console.log(`[series-home] ${width}px skeleton ${skeleton}px · ${JSON.stringify(results)}`);
      // The cases are real: one-line and two-line titles and shelf lines actually differ.
      const r = Object.values(results);
      expect(r[2].title).toBeGreaterThan(r[0].title + TITLE_LINE / 2);
      expect(r[1].shelf).toBeGreaterThan(r[0].shelf * 1.5);
      for (const [name, { diff }] of Object.entries(results)) expect(Math.abs(diff), name).toBeLessThanOrEqual(TITLE_LINE);
    });

    test('the gaps above and below The Series, against two genre rows (recorded)', async ({ page }) => {
      await seed();
      await openHome(page, width);
      const gaps = await page.evaluate(() => {
        const section = (title) => [...document.querySelectorAll('h3')].find((h) => h.textContent.trim() === title).closest('section');
        // Ink, not boxes: the extent of the section's leaf elements.
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
  });
}

test('no published series: no section, and no skeleton left behind', async ({ page }) => {
  await seed([]);
  await page.goto('/public-library');
  await expect(page.locator('section a[href="/flash"]')).toBeAttached({ timeout: 120000 });
  await expect(page.locator('section[data-series-row]')).toHaveCount(0, { timeout: 30000 });
});
