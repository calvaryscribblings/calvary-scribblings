// W35 · AN OPEN SERIES PAGE UNLOCKS AT THE RELEASE MINUTE — NO RELOAD.
//
// A synthetic instalment is seeded in the EMULATOR with releaseAtMs a few seconds ahead. The
// instalment page and the series page are opened while it is "Not yet", a marker is set on
// `window`, and the test waits for the fixture's title to appear. The marker surviving proves
// the page changed in place: a reload would have wiped it.
//
// The release gate under test is the emulator's own rule on series_instalments_detail, against
// the emulator's clock — the page only asks again; the rule decides.
//
// ── WHY THE IDS COME FROM PRODUCTION ─────────────────────────────────────────────────────
// `output: 'export'` makes `next dev` serve a dynamic route only for ids its
// generateStaticParams lists, and that reads the live, PUBLIC series_instalments node. So the
// test borrows one published id (and its series id) from a signed-out GET — never hardcoded
// (see the 'basil' lesson) — and seeds a clearly synthetic fixture UNDER THOSE IDS IN THE
// EMULATOR. Nothing is written anywhere but the emulator.
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { adminApp, closeApp } from './harness.mjs';

const PROD = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const LEAD_MS = 15000;
const FIXTURE_TITLE = 'W35 Fixture Instalment';

let app, ids;

test.beforeAll(async () => {
  const rows = await (await fetch(`${PROD}/series_instalments.json`)).json();
  const [id, row] = Object.entries(rows || {}).find(([, r]) => r?.status === 'published') || [];
  if (!id) throw new Error('no published instalment id to borrow');
  ids = { instalmentId: id, seriesId: row.seriesId };
  app = adminApp('w35-release');
});
test.afterAll(async () => { if (app) await closeApp(app); });

/** Open the route once so `next dev` compiles it BEFORE the clock starts — a cold compile can
 *  take longer than the lead, and the release would pass before the page first drew. */
async function warm(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function seed(releaseAtMs) {
  const db = getDatabase(app);
  const { instalmentId, seriesId } = ids;
  const now = Date.now();
  await db.ref('series').set(null);
  await db.ref('series_instalments').set(null);
  await db.ref('series_instalments_detail').set(null);
  await db.ref().update({
    [`series/${seriesId}`]: {
      schemaVersion: 1, slug: seriesId, title: 'W35 Fixture Series', synopsis: 'A fixture, not a book.',
      coverUrl: null, status: 'published', addedAt: now, updatedAt: now,
    },
    [`series_instalments/${instalmentId}`]: {
      schemaVersion: 1, seriesId, ordinal: 1, releaseAtMs, freeForGold: true,
      status: 'published', addedAt: now, updatedAt: now,
    },
    [`series_instalments_detail/${instalmentId}`]: {
      schemaVersion: 1, title: FIXTURE_TITLE, synopsis: null, logline: null, author: 'Fixture Author',
      authorUid: 'fixture-uid', authorHandle: 'fixture', coverUrl: null, epubPath: null,
      sponsorName: null, sponsorLogoUrl: null, wordCount: null, updatedAt: now,
    },
  });
}

test('the instalment page turns from "Not yet" to the instalment at its release minute, in place', async ({ page }) => {
  await warm(page, `/series/instalment/${ids.instalmentId}`);
  const releaseAtMs = Date.now() + LEAD_MS;
  await seed(releaseAtMs);
  await page.goto(`/series/instalment/${ids.instalmentId}`);
  await expect(page.getByRole('heading', { name: 'Not yet' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(FIXTURE_TITLE)).toHaveCount(0);
  await page.evaluate(() => { window.__w35NoReload = true; });

  await expect(page.getByText(FIXTURE_TITLE).first()).toBeVisible({ timeout: LEAD_MS + 20000 });
  expect(Date.now()).toBeGreaterThanOrEqual(releaseAtMs);
  expect(await page.evaluate(() => window.__w35NoReload === true), 'the page must not have reloaded').toBe(true);
});

test('the series page row turns from "Arrives …" to the instalment, in place', async ({ page }) => {
  await warm(page, `/series/${ids.seriesId}`);
  const releaseAtMs = Date.now() + LEAD_MS;
  await seed(releaseAtMs);
  await page.goto(`/series/${ids.seriesId}`);
  await expect(page.getByText(/^Arrives /)).toBeVisible({ timeout: 60000 });
  await page.evaluate(() => { window.__w35NoReload = true; });

  await expect(page.getByText(FIXTURE_TITLE).first()).toBeVisible({ timeout: LEAD_MS + 20000 });
  await expect(page.getByText(/^Arrives /)).toHaveCount(0);
  expect(await page.evaluate(() => window.__w35NoReload === true), 'the page must not have reloaded').toBe(true);
});

test('a hidden tab that comes back after the minute re-checks at once', async ({ page }) => {
  // Release 6s out; the tab is "hidden" across it with its timers frozen, then shown again.
  await warm(page, `/series/instalment/${ids.instalmentId}`);
  const releaseAtMs = Date.now() + 6000;
  await seed(releaseAtMs);
  await page.clock.install();
  await page.goto(`/series/instalment/${ids.instalmentId}`);
  await expect(page.getByRole('heading', { name: 'Not yet' })).toBeVisible({ timeout: 60000 });
  await page.evaluate(() => { window.__w35NoReload = true; });
  // Freeze the page's clock: its release timer cannot fire, as in a throttled background tab.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  // Real time passes the release on the emulator's clock; the page's clock is moved past it too
  // (without running the timers), then the tab reports itself visible.
  await new Promise((r) => setTimeout(r, Math.max(0, releaseAtMs - Date.now()) + 1500));
  await page.clock.setSystemTime(Date.now());
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText(FIXTURE_TITLE).first()).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => window.__w35NoReload === true)).toBe(true);
});
