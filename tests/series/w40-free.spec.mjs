// W40 — "FREE TO READ" ON THE READER'S SERIES SURFACES (rulings 146 and 148).
//
//   npm run test:series-free     (Firebase emulators + `next dev`; hermetic)
//
// The series page's row, the instalment page and the reader route, against the emulators. The
// static routes only exist for ids the build knows, so — as release-recheck.spec.mjs does — the
// suite BORROWS one published instalment id from production (a public GET, nothing written)
// and seeds the emulator under it. Every non-GET and every off-host request is refused.
//
//   · signed out: the row says "Free to read" and opens its page, where the one action is Sign in;
//   · signed in on a Free account: the page's action is the read button, with "Free to read";
//   · the reader route, signed out, shows the free lock when the endpoint says the instalment is
//     free (the endpoint itself is proven by tests/ci/w40-stream-free.test.mjs) — and the paid
//     lock when it doesn't;
//   · control: a Gold-taste row signed out keeps its lock and says nothing about free.
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { adminApp, closeApp, adminToken } from './harness.mjs';

const PROD = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const READER = 'w40-free-reader';
const DAY = 86_400_000;
let app, ids;

test.beforeAll(async () => {
  const rows = await (await fetch(`${PROD}/series_instalments.json`)).json();
  const [id, row] = Object.entries(rows || {}).find(([, r]) => r?.status === 'published') || [];
  if (!id) throw new Error('no published instalment id to borrow');
  ids = { instalmentId: id, seriesId: row.seriesId };
  app = adminApp('w40-free');
});
test.afterAll(async () => { if (app) await closeApp(app); });

async function seed({ openToFree = true, freeForGold = true } = {}) {
  const db = getDatabase(app);
  const { instalmentId, seriesId } = ids;
  const now = Date.now();
  await db.ref('series').set(null);
  await db.ref('series_instalments').set(null);
  await db.ref('series_instalments_detail').set(null);
  await db.ref().update({
    [`users/${READER}/displayName`]: 'Free Reader',
    [`users/${READER}/username`]: 'w40freereader',
    [`usernames/w40freereader`]: READER,
    [`series/${seriesId}`]: { schemaVersion: 1, slug: seriesId, title: 'W40 Fixture Series', synopsis: 'A fixture, not a book.', coverUrl: null, status: 'published', addedAt: now, updatedAt: now },
    [`series_instalments/${instalmentId}`]: {
      schemaVersion: 1, seriesId, ordinal: 1, releaseAtMs: now - DAY, freeForGold, ...(openToFree ? { openToFree: true } : {}),
      status: 'published', addedAt: now, updatedAt: now,
    },
    [`series_instalments_detail/${instalmentId}`]: {
      schemaVersion: 1, title: 'W40 Fixture Instalment', synopsis: null, logline: null, author: 'Fixture Author',
      authorUid: 'fixture-uid', authorHandle: 'fixture', coverUrl: null, epubPath: null, sponsorName: null, sponsorLogoUrl: null,
      wordCount: null, updatedAt: now,
    },
  });
}

async function fence(page, stream = null) {
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (stream && u.pathname === '/api/series/stream') return r.fulfill({ status: stream.status, contentType: 'application/json', body: JSON.stringify(stream.body) });
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (!local && !/fonts\.(googleapis|gstatic)/.test(u.hostname)) return r.abort();
    if (!local && r.request().method() !== 'GET') return r.abort();
    return r.continue();
  });
}
async function signInAsFreeReader(page) {
  const token = await adminToken(app, READER);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 60000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
}
const row = (page) => page.locator('li').filter({ hasText: 'W40 Fixture Instalment' }).getByRole('button');

test('signed out: the row says "Free to read" and opens its page, where the one action is Sign in', async ({ page }) => {
  await seed();
  await fence(page);
  await page.goto(`/series/${ids.seriesId}`);
  await expect(row(page)).toContainText('Free to read', { timeout: 60000 });
  await expect(row(page)).toContainText('Sign in to read this instalment.');
  await expect(row(page)).toBeEnabled();
  await row(page).click();
  await expect(page).toHaveURL(new RegExp(`/series/instalment/${ids.instalmentId}`));
  const lock = page.locator('[data-free-lock]');
  await expect(lock).toContainText('Free to read', { timeout: 60000 });
  await expect(lock).toContainText('Sign in to read this instalment.');
  await expect(lock).toContainText('Anyone signed in can read this one.');
  await expect(lock).not.toContainText('See membership');
  await expect(lock).not.toContainText('Already a member?');
  await lock.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.auth-modal')).toBeVisible();
});

test('signed in on a Free account: the page opens to the read button, with "Free to read"', async ({ page }) => {
  await seed();
  await fence(page);
  await page.goto(`/series/instalment/${ids.instalmentId}`);
  await signInAsFreeReader(page);
  await expect(page.getByRole('button', { name: 'Read Instalment 1' })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-free-to-read]')).toHaveText('Free to read');
  await expect(page.locator('[data-archive-lock]')).toHaveCount(0);
  await page.goto(`/series/${ids.seriesId}`);
  await expect(row(page)).toContainText('Free to read', { timeout: 60000 });
  await expect(row(page)).not.toContainText('Sign in');
  await expect(row(page)).toBeEnabled();
});

test('the reader route, signed out, shows the free lock when the endpoint says it is free', async ({ page }) => {
  await seed();
  await fence(page, { status: 401, body: { error: 'Sign in to read this instalment.', code: 'signed_out', openToFree: true } });
  await page.goto(`/series/read/${ids.instalmentId}`);
  const lock = page.locator('[data-free-lock]');
  await expect(lock).toContainText('Free to read', { timeout: 60000 });
  await expect(lock.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(lock).not.toContainText('See membership');
});

test('control: the reader route keeps the paid lock when the endpoint does not say free', async ({ page }) => {
  await seed({ openToFree: false });
  await fence(page, { status: 401, body: { error: 'Sign in to read this instalment.', code: 'signed_out' } });
  await page.goto(`/series/read/${ids.instalmentId}`);
  await expect(page.locator('[data-archive-lock]')).toContainText('This instalment is closed.', { timeout: 60000 });
  await expect(page.locator('[data-free-lock]')).toHaveCount(0);
});

test('control: a Gold-taste row, signed out, keeps its lock and says nothing about free', async ({ page }) => {
  await seed({ openToFree: false });
  await fence(page);
  await page.goto(`/series/${ids.seriesId}`);
  await expect(row(page)).toContainText('Sign in to read this instalment.', { timeout: 60000 });
  await expect(row(page)).not.toContainText('Free to read');
  await expect(row(page)).toBeDisabled();
});
