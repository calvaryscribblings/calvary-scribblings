// W22 — DESIDERATA, SIGNED IN, AGAINST THE EMULATORS. Never production.
//
// `npm run test:desiderata` wraps this in `firebase emulators:exec` and serves the app with
// `next dev` on localhost with NEXT_PUBLIC_FB_EMULATOR=1 — the fenced switch in
// app/lib/firebase.js, the same one tests/series/sponsor-logo.spec.mjs uses. The catalogue is the
// LIVE one, read with public GETs (bookstore_titles, _genres, _sections, _signals are .read:true)
// and written ONLY into the emulator; the reader, their purchases, their Desiderata and the
// readership counts are fixtures. Nothing in this file can write to production: the admin SDK
// holds no credential and talks to 127.0.0.1, and the browser's firebase client is pointed at
// the emulators by a fence that refuses any hostname but localhost.
//
// What it proves (W22 §2–§5): the + states on the shelf and the page, the unit that draws once
// and never flips, the optimistic add and remove, Undo's original addedAt, a refused write that
// changes back with the house toast, the signed-out tap that is kept through sign-in, one list
// agreeing across two tabs, and the room — newest first, held books swept, a missing title's
// entry kept. Photographs of the room's three states go to W22_SHOTS if it is set.
import { test, expect } from '@playwright/test';
import { adminApp, adminToken, closeApp } from '../series/harness.mjs';
import { getDatabase } from 'firebase-admin/database';

const LIVE = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const READER = 'w22DesiderataReader000000001';
const GATE = 'cs_bookstore_gate_v1';
const SHOTS = process.env.W22_SHOTS || null;

let app;
let db;
let shelf;      // [{ id, title, slug, ... }] published, from the live catalogue

async function liveNode(path) {
  const res = await fetch(`${LIVE}/${path}.json`);
  if (!res.ok) throw new Error(`live read ${path}: HTTP ${res.status}`);
  return (await res.json()) || {};
}

test.beforeAll(async () => {
  app = adminApp('w22-desiderata');
  db = getDatabase(app);
  const [titles, genres, sections, signals] = await Promise.all(
    ['bookstore_titles', 'bookstore_genres', 'bookstore_sections', 'bookstore_signals'].map(liveNode));
  shelf = Object.entries(titles).filter(([, t]) => t.status === 'published')
    .map(([id, t]) => ({ id, ...t })).sort((a, b) => a.id.localeCompare(b.id));
  if (shelf.length < 6) throw new Error('the live catalogue has fewer than six published titles');
  await db.ref().update({
    bookstore_titles: titles, bookstore_genres: genres, bookstore_sections: sections, bookstore_signals: signals,
  });
});
test.afterAll(async () => { await closeApp(app); });

// The fixture, reset before every test: the reader holds shelf[0] (a sale) and shelf[1] (a comp),
// has marked shelf[1] (held → swept), shelf[2] (oldest), shelf[3] (newest) and a title that is not
// on the shelves; shelf[2] has three readers and shelf[4] one.
const OLD = 1_700_000_000_000;
test.beforeEach(async () => {
  await db.ref().update({
    [`users/${READER}`]: { displayName: 'W22 Reader', username: 'wtwentytworeader' },
    'usernames/wtwentytworeader': READER,
    [`bookstore_purchases/${READER}`]: {
      [shelf[0].id]: { status: 'active', title: shelf[0].title, purchasedAt: OLD },
      [shelf[1].id]: { status: 'active', source: 'comp', title: shelf[1].title, purchasedAt: OLD },
    },
    [`desiderata/${READER}`]: {
      [shelf[1].id]: { addedAt: OLD + 1 },
      [shelf[2].id]: { addedAt: OLD + 2 },
      [shelf[3].id]: { addedAt: OLD + 3 },
      'a-title-no-longer-on-the-shelves': { addedAt: OLD + 4 },
    },
    bookstore_readership: { [shelf[2].id]: { count: 3 }, [shelf[4].id]: { count: 1 } },
  });
});

async function enter(page, path, { signedIn = true } = {}) {
  await page.addInitScript((k) => {
    try { localStorage.setItem(k, '1'); localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private */ }
  }, GATE);
  await page.route('**/api/bookstore/region', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"country":"GB"}' }));
  await page.goto(path);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 60000 });
  if (signedIn) {
    const token = await adminToken(app, READER);
    await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
  }
}

const rowOf = (page, id) => page.locator(`.shelf-entry:has([data-testid="readers-row"])`).filter({
  has: page.locator(`.entry-title`, { hasText: shelf.find((t) => t.id === id).title }),
}).first().locator('[data-testid="readers-row"]');

test.describe('the shelf', () => {
  test('every + state, drawn once, and never flipping after it appears', async ({ page }) => {
    await page.addInitScript(() => {
      window.__rdFlips = [];
      new MutationObserver((ms) => {
        for (const m of ms) if (m.attributeName === 'data-state') {
          const was = m.oldValue; const now = m.target.getAttribute('data-state');
          if (was && was !== 'waiting') window.__rdFlips.push(`${was}→${now}`);
        }
      }).observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-state'] });
    });
    await enter(page, '/bookstore');
    await expect(page.locator('[data-testid="readers-unit"]').first()).toBeVisible({ timeout: 60000 });
    // Held — a sale and a comp alike: no +.
    await expect(rowOf(page, shelf[0].id)).toHaveAttribute('data-state', 'owned');
    await expect(rowOf(page, shelf[1].id)).toHaveAttribute('data-state', 'owned');
    await expect(rowOf(page, shelf[0].id).locator('[data-testid="desiderata-mark"]')).toHaveCount(0);
    // Marked: the disc, with three readers before it.
    await expect(rowOf(page, shelf[2].id)).toHaveAttribute('data-state', 'marked');
    await expect(rowOf(page, shelf[2].id).locator('[data-testid="readers-count"]')).toHaveText(/3 readers/i);
    await expect(rowOf(page, shelf[2].id).locator('[data-testid="desiderata-mark"]')).toHaveAttribute('aria-pressed', 'true');
    // Open, one reader: the singular spelt.
    await expect(rowOf(page, shelf[4].id)).toHaveAttribute('data-state', 'open');
    await expect(rowOf(page, shelf[4].id).locator('[data-testid="readers-count"]')).toHaveText(/one reader/i);
    // Open, no readers: the + alone.
    await expect(rowOf(page, shelf[5].id).locator('[data-testid="readers-count"]')).toHaveCount(0);
    await expect(rowOf(page, shelf[5].id).locator('[data-testid="desiderata-mark"]')).toHaveAttribute('aria-label', `Add ${shelf[5].title} to Desiderata`);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__rdFlips)).toEqual([]);
    if (SHOTS) for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      const row = rowOf(page, shelf[2].id).locator('xpath=ancestor::div[contains(concat(" ", @class, " "), " shelf ")][1]');
      await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
      await row.screenshot({ path: `${SHOTS}/shelf-states-${w}.png` });
    }
  });

  test('add: the ring turns at once, the toast says where it went, the server dates it', async ({ page }) => {
    await enter(page, '/bookstore');
    const mark = rowOf(page, shelf[5].id).locator('[data-testid="desiderata-mark"]');
    await expect(mark).toBeVisible({ timeout: 60000 });
    const before = Date.now();
    await mark.click();
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('save-toast')).toContainText('Added to Desiderata. You’ll find it under the ribbon at the top of the shop.');
    await expect.poll(async () => (await db.ref(`desiderata/${READER}/${shelf[5].id}`).get()).val()?.addedAt ?? null).not.toBeNull();
    const at = (await db.ref(`desiderata/${READER}/${shelf[5].id}/addedAt`).get()).val();
    expect(at).toBeGreaterThan(before - 60_000);
  });

  test('remove, then Undo: the ORIGINAL addedAt comes back', async ({ page }) => {
    await enter(page, '/bookstore');
    const mark = rowOf(page, shelf[3].id).locator('[data-testid="desiderata-mark"]');
    await expect(mark).toHaveAttribute('aria-pressed', 'true', { timeout: 60000 });
    await mark.click();
    await expect(mark).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('save-toast')).toContainText('Removed from Desiderata');
    await expect.poll(async () => (await db.ref(`desiderata/${READER}/${shelf[3].id}`).get()).exists()).toBe(false);
    await page.getByTestId('save-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await db.ref(`desiderata/${READER}/${shelf[3].id}/addedAt`).get()).val()).toBe(OLD + 3);
  });

  test('a refused write changes back, and the house toast says so', async ({ page }) => {
    await enter(page, '/bookstore');
    const mark = rowOf(page, shelf[5].id).locator('[data-testid="desiderata-mark"]');
    await expect(mark).toBeVisible({ timeout: 60000 });
    // The title leaves the catalogue under the page — so the rule ($titleId must exist) refuses.
    await db.ref(`bookstore_titles/${shelf[5].id}`).remove();
    try {
      await mark.click();
      await expect(page.getByTestId('save-toast')).toContainText('Couldn’t save that change. Try again.', { timeout: 15000 });
      await expect(mark).toHaveAttribute('aria-pressed', 'false');
    } finally {
      await db.ref(`bookstore_titles/${shelf[5].id}`).set(Object.fromEntries(Object.entries(shelf[5]).filter(([k]) => k !== 'id')));
    }
  });

  test('signed out: the + opens AuthModal in place; after sign-in the book is added with no second tap', async ({ page }) => {
    await enter(page, '/bookstore', { signedIn: false });
    const mark = rowOf(page, shelf[5].id).locator('[data-testid="desiderata-mark"]');
    await expect(mark).toBeVisible({ timeout: 60000 });
    await mark.click();
    await expect(page.locator('.auth-backdrop')).toBeVisible();
    const token = await adminToken(app, READER);
    await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
    await expect.poll(async () => (await db.ref(`desiderata/${READER}/${shelf[5].id}`).get()).exists(), { timeout: 20000 }).toBe(true);
  });

  test('signed out, a tap on a book the reader turns out to hold adds nothing', async ({ page }) => {
    await enter(page, '/bookstore', { signedIn: false });
    const mark = rowOf(page, shelf[0].id).locator('[data-testid="desiderata-mark"]');
    await expect(mark).toBeVisible({ timeout: 60000 });
    await mark.click();
    const token = await adminToken(app, READER);
    await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
    await expect(rowOf(page, shelf[0].id)).toHaveAttribute('data-state', 'owned', { timeout: 20000 });
    await page.waitForTimeout(1500);
    expect((await db.ref(`desiderata/${READER}/${shelf[0].id}`).get()).exists()).toBe(false);
  });

  test('two tabs agree — one listener each, one list', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await enter(a, '/bookstore');
    await enter(b, `/bookstore/${shelf[5].slug}`);
    await expect(rowOf(a, shelf[5].id).locator('[data-testid="desiderata-mark"]')).toBeVisible({ timeout: 60000 });
    const pageMark = b.locator('[data-testid="desiderata-mark"]');
    await expect(pageMark).toHaveAttribute('aria-pressed', 'false', { timeout: 60000 });
    await rowOf(a, shelf[5].id).locator('[data-testid="desiderata-mark"]').click();
    await expect(pageMark).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
    await ctx.close();
  });
});

test.describe('the book page', () => {
  test('owned: no +. Readers: the + after the line. None: the ring alone.', async ({ page }) => {
    await enter(page, `/bookstore/${shelf[0].slug}`);
    await expect(page.locator('.bd-header h1, h1').first()).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(2500);
    await expect(page.locator('[data-testid="desiderata-mark"]')).toHaveCount(0);

    await page.goto(`/bookstore/${shelf[4].slug}`);
    await expect(page.getByTestId('readership-line')).toContainText(/one reader/i, { timeout: 60000 });
    await expect(page.getByTestId('readership-line').locator('[data-testid="desiderata-mark"]')).toBeVisible();

    await page.goto(`/bookstore/${shelf[5].slug}`);
    await expect(page.getByTestId('readership-mark-alone').locator('[data-testid="desiderata-mark"]')).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('readership-line')).toHaveCount(0);
    if (SHOTS) for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const [slug, name] of [[shelf[4].slug, 'with'], [shelf[5].slug, 'without']]) {
        await page.goto(`/bookstore/${slug}`);
        const row = page.locator('[data-testid="readership-line"], [data-testid="readership-mark-alone"]').first();
        await row.waitFor({ timeout: 60000 }); await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
        const box = await row.boundingBox();
        await page.screenshot({ path: `${SHOTS}/page-${name}-readers-${w}.png`, clip: { x: 0, y: Math.max(0, box.y - 260), width: w, height: 380 } });
      }
    }
  });
});

test.describe('the Desiderata room', () => {
  test('newest first; a held book is swept quietly; a title off the shelves keeps its entry', async ({ page }) => {
    await enter(page, '/bookstore/desiderata');
    const list = page.getByTestId('desiderata-list');
    await expect(list).toBeVisible({ timeout: 60000 });
    const ids = await list.locator('[data-testid="room-row"]').evaluateAll((els) => els.map((e) => e.dataset.titleId));
    expect(ids).toEqual([shelf[3].id, shelf[2].id]);
    await expect(page.getByTestId('desiderata-count')).toHaveText(/2 titles/i);
    await expect(list.locator('.rr-buy').first()).toContainText(/buy/i);
    await expect.poll(async () => (await db.ref(`desiderata/${READER}/${shelf[1].id}`).get()).exists()).toBe(false);
    expect((await db.ref(`desiderata/${READER}/a-title-no-longer-on-the-shelves`).get()).exists()).toBe(true);
    if (SHOTS) for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/desiderata-full-${w}.png`, fullPage: true });
    }
    // The disc takes a book out, and the row goes with it.
    await list.locator(`[data-title-id="${shelf[3].id}"] [data-testid="desiderata-mark"]`).click();
    await expect(list.locator('[data-testid="room-row"]')).toHaveCount(1);
  });

  test('empty, and signed out', async ({ page }) => {
    await db.ref(`desiderata/${READER}`).remove();
    await enter(page, '/bookstore/desiderata');
    await expect(page.getByTestId('desiderata-empty')).toHaveText('Nothing marked yet. The + under any book on the shelves adds it here.', { timeout: 60000 });
    if (SHOTS) for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/desiderata-empty-${w}.png` });
    }
    const guest = await page.context().browser().newPage();
    await enter(guest, '/bookstore/desiderata', { signedIn: false });
    await expect(guest.getByTestId('desiderata-signed-out')).toContainText('Sign in to see your Desiderata.', { timeout: 60000 });
    if (SHOTS) for (const w of [390, 1440]) {
      await guest.setViewportSize({ width: w, height: 900 }); await guest.waitForTimeout(400);
      await guest.screenshot({ path: `${SHOTS}/desiderata-signedout-${w}.png` });
    }
    await guest.getByTestId('desiderata-signed-out').getByRole('button', { name: 'Sign in' }).click();
    await expect(guest.locator('.auth-backdrop')).toBeVisible();
    await guest.close();
  });
});
