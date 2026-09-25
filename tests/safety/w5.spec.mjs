// W5 · in a browser, against the emulators: /admin/reports, the under-18 check, the save toast.
// Run with `npm run test:safety`. Hermetic — tests/series/harness.mjs explains the project id.

import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp, FOUNDER_A } from '../series/harness.mjs';

const MOD = 'W5moderator000000000000000001';
const READER = 'W5reader00000000000000000002';
const OFFENDER = 'W5offender000000000000000003';
const CONV = [READER, OFFENDER].sort().join('_');

let app;
test.beforeAll(async () => { app = adminApp('w5-harness'); });
test.afterAll(async () => { if (app) await closeApp(app); });

const profile = (name) => ({ displayName: name, username: name.toLowerCase(), handle: name.toLowerCase() });

async function reset(extra = {}) {
  const db = getDatabase(app);
  await db.ref().set({
    users: {
      [MOD]: { ...profile('Moderator'), canRemovePosts: true },
      [READER]: profile('Reader'),
      [OFFENDER]: profile('Offender'),
      [FOUNDER_A]: profile('Founder'),
    },
    ...extra,
  });
}

async function signIn(page, uid, path) {
  const token = await getAuth(app).createCustomToken(uid);
  await page.goto(path);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 60000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
}

// ── /admin/reports ──────────────────────────────────────────────────────────────────────────
test.describe('/admin/reports', () => {
  const now = Date.now();
  const queue = {
    [`comment_a-daub-of-blue_-Oc1`]: {
      [READER]: { kind: 'comment', reason: 'harassment', reporterUid: READER, offenderUid: OFFENDER, contextPath: 'comments/a-daub-of-blue/-Oc1', snapshot: 'A rude comment.', createdAt: now - 60000 },
    },
    [`dm_${CONV}`]: {
      [READER]: { kind: 'dm', reason: 'unwanted', reporterUid: READER, offenderUid: OFFENDER, contextPath: `dm_messages/${CONV}/-Om1`, snapshot: 'The one reported message.', note: 'Please look.', createdAt: now },
    },
  };
  const thread = { [`${CONV}`]: { '-Om1': { text: 'The one reported message.', senderUid: OFFENDER, createdAt: 1 }, '-Om2': { text: 'SECRET OTHER MESSAGE', senderUid: OFFENDER, createdAt: 2 } } };

  test('a moderator sees the queue newest first, filters by kind, and resolves', async ({ page }) => {
    await reset({ content_reports: queue, dm_messages: thread });
    await signIn(page, MOD, '/admin/reports');
    const rows = page.getByTestId('report-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Direct message');
    await expect(rows.nth(1)).toContainText('Comment');

    // RULED: the DM row is the reported message and the note, with no way into the thread.
    const dm = rows.nth(0);
    await expect(dm).toContainText('The one reported message.');
    await expect(dm).toContainText('Please look.');
    await expect(dm.getByRole('link')).toHaveCount(0);
    await expect(page.getByText('SECRET OTHER MESSAGE')).toHaveCount(0);
    // The comment row links to its story.
    await expect(rows.nth(1).getByRole('link', { name: /View in context/ })).toHaveAttribute('href', '/stories/a-daub-of-blue');

    await page.getByRole('tab', { name: 'Messages' }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole('tab', { name: 'Comments' }).click();
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole('button', { name: 'Resolve' }).click();
    await expect(rows.first()).toContainText('RESOLVED');
    const node = (await getDatabase(app).ref('content_reports/comment_a-daub-of-blue_-Oc1').get()).val();
    expect(node.resolved).toBe(true);
    expect(node.resolvedBy).toBe(MOD);
    expect(typeof node.resolvedAt).toBe('number');
  });

  test('empty is fine', async ({ page }) => {
    await reset();
    await signIn(page, MOD, '/admin/reports');
    await expect(page.getByText('Nothing reported.')).toBeVisible();
  });

  test('a reader without the switch is turned away, and reads nothing', async ({ page }) => {
    await reset({ content_reports: queue });
    await signIn(page, READER, '/admin/reports');
    await expect(page.getByText('This queue is for moderators')).toBeVisible();
    await expect(page.getByTestId('report-row')).toHaveCount(0);
  });
});

// ── The under-18 check ──────────────────────────────────────────────────────────────────────
test.describe('the under-18 check', () => {
  const dialog = (page) => page.getByRole('dialog', { name: 'Please confirm your date of birth' });

  test('an under-18 stored date asks; an adult date is saved and the public copy cleared', async ({ page }) => {
    await reset({ users_private: { [READER]: { dob: '2012-03-04' } } });
    await getDatabase(app).ref(`users/${READER}/dob`).set('2012-03-04'); // an old binary's public copy
    await signIn(page, READER, '/about');
    await expect(dialog(page)).toBeVisible({ timeout: 30000 });
    await page.locator('#dc-dob').fill('1990-05-01');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog(page)).toHaveCount(0);
    const db = getDatabase(app);
    expect((await db.ref(`users_private/${READER}/dob`).get()).val()).toBe('1990-05-01');
    expect((await db.ref(`users/${READER}/dob`).get()).val()).toBe(null);
  });

  test('an unreadable stored date asks too', async ({ page }) => {
    await reset({ users_private: { [READER]: { dob: 'sometime' } } });
    await signIn(page, READER, '/about');
    await expect(dialog(page)).toBeVisible({ timeout: 30000 });
  });

  test('confirmed under 18 → the account is deleted through /api/account/delete', async ({ page }) => {
    await reset({ users_private: { [READER]: { dob: '2012-03-04' } } });
    const calls = [];
    await page.route('**/api/account/delete', async (route) => {
      calls.push(route.request().headers().authorization || '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true }) });
    });
    await signIn(page, READER, '/about');
    await expect(dialog(page)).toBeVisible({ timeout: 30000 });
    await page.locator('#dc-dob').fill('2012-03-04');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Story Island is for readers aged 18 and over')).toBeVisible();
    await expect(page.getByText('4 March 2012')).toBeVisible();
    // Nothing is deleted until the reader presses the button.
    expect(calls).toHaveLength(0);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.waitForURL('**/account/deleted', { timeout: 30000 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^Bearer .+/);
  });

  test('a founder is left alone, even with an under-18 date', async ({ page }) => {
    await reset({ users_private: { [FOUNDER_A]: { dob: '2012-03-04' } } });
    await signIn(page, FOUNDER_A, '/about');
    await page.waitForTimeout(5000);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('a reader with no date of birth is left alone', async ({ page }) => {
    await reset();
    await signIn(page, READER, '/about');
    await page.waitForTimeout(5000);
    await expect(dialog(page)).toHaveCount(0);
  });
});

// ── The save toast, on My Library ───────────────────────────────────────────────────────────
test.describe('the save toast', () => {
  // A record in the shelf's own shape (app/lib/shelf.js projectStory), written straight into
  // IndexedDB so the test needs no cover fetch.
  const SAVED_AT = 1780000000000;
  async function seedShelf(page) {
    await page.evaluate(async ({ uid, savedAt }) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('cs-shelf', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          const s = d.createObjectStore('shelf', { keyPath: 'id' });
          s.createIndex('kind', 'kind'); s.createIndex('savedAt', 'savedAt'); s.createIndex('uid_kind', ['uid', 'kind']);
          d.createObjectStore('assets', { keyPath: 'key' }); d.createObjectStore('meta', { keyPath: 'k' });
        };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const t = db.transaction(['shelf', 'assets'], 'readwrite');
        t.objectStore('shelf').put({ id: 'story:w5-story', kind: 'story', slug: 'w5-story', uid, schemaV: 1, title: 'The W5 Story', author: 'A. Writer', content: '<p>Words.</p>', savedAt, coverBlobKey: 'cover:w5-story:w360', readingTime: 3 });
        t.objectStore('assets').put({ key: 'cover:w5-story:w360', blob: new Blob(['x'], { type: 'image/webp' }), type: 'image/webp', bytes: 1 });
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
      db.close();
    }, { uid: READER, savedAt: SAVED_AT });
  }
  const readShelf = (page) => page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('cs-shelf', 1);
    r.onsuccess = () => {
      const t = r.result.transaction(['shelf', 'assets'], 'readonly');
      const a = t.objectStore('shelf').get('story:w5-story');
      const b = t.objectStore('assets').get('cover:w5-story:w360');
      t.oncomplete = () => res({ rec: a.result || null, asset: !!b.result });
    };
  }));

  test('Remove → "Removed from My Library" with Undo; Undo puts it back with the same saved date', async ({ page }) => {
    await reset();
    await page.goto('/about');
    await seedShelf(page);
    await signIn(page, READER, '/my-library');
    // The live region is in the page before any toast, so the announcement is heard.
    await expect(page.locator('[role="status"][aria-live="polite"].st-region')).toHaveCount(1);
    await expect(page.getByText('The W5 Story')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'REMOVE' }).click();
    const toast = page.getByTestId('save-toast');
    await expect(toast).toContainText('Removed from My Library');
    // No cookie consent in this browser, so the banner is up: Undo must still be pressable.
    await expect(page.locator('.cs-cookie')).toBeVisible();
    expect((await readShelf(page)).rec).toBe(null);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(toast).toHaveCount(0);
    await expect(page.getByText('The W5 Story')).toBeVisible();
    const back = await readShelf(page);
    expect(back.rec.savedAt).toBe(SAVED_AT);
    expect(back.asset).toBe(true);
  });

  test('it rises by default and only fades under Reduce Motion', async ({ page }) => {
    await reset();
    await page.goto('/about');
    await seedShelf(page);
    await signIn(page, READER, '/my-library');
    await page.getByRole('button', { name: 'REMOVE' }).click();
    const toast = page.getByTestId('save-toast');
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((el) => getComputedStyle(el).animationName)).toBe('st-in');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await toast.evaluate((el) => getComputedStyle(el).animationName)).toBe('st-fade');
  });
});
