// W51 — tonight's Square fixes, proven in a real page against the emulator.
//
// ⚠ W52 moved replies out of the feed into the thread (/square/p). The reply cases that lived
// here — the mixed-case @mention reply, reply on a reply, the refused reply's "Not sent." — are
// now proven on the thread page by tests/square/w52.spec.mjs. What stays is what the feed still
// does: the main composer's double press, autocomplete, "+ New", and the card widths.
//
//   · a second press while saving posts nothing
//   · autocomplete and "+ New" message search work for a plain reader
//   · no element leaves the screen at 390 or 1280 (W48's card-width check)
//
// The browser clock is moved BACK to the last 20:30 London, so the room is open whatever the
// hour the suite runs and every createdAt stays in the past for the rules (forward would break
// `createdAt <= now + 5 min`).
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';
import { routeSquareWrite } from './write-route.mjs';

const app = adminApp('square-w51');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const A = 'w51-reader-a', B = 'w51-reader-b', C = 'w51-reader-c';

function lastOpenInstant(now = Date.now()) {
  const london = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  let t = Math.floor(now / 60000) * 60000;
  for (let i = 0; i <= 1500 && london(t) !== '20:30'; i++) t -= 60000;
  return t;
}
const OPEN = lastOpenInstant();

async function reset({ readerA } = {}) {
  const t = OPEN - 30 * 60000;
  const prof = (displayName, h) => ({ displayName, username: h, handle: h, readCount: 12, createdAt: 1 });
  await db.ref().set({
    users: { [A]: readerA || prof('Reader Ay', 'ay'), [B]: prof('Reader Bee', 'bee'), [C]: prof('Reader Cee', 'cee') },
    usernames: { ay: A, bee: B, cee: C },
    user_search: { [A]: { displayName: 'Reader Ay', username: 'ay' }, [B]: { displayName: 'Reader Bee', username: 'bee' }, [C]: { displayName: 'Reader Cee', username: 'cee' } },
    square_posts: {
      '-T1root': { text: 'Root post with a thread.', authorUid: B, authorName: 'Reader Bee', authorHandle: 'bee', createdAt: t },
      '-T1r1': { text: 'first reply', authorUid: C, authorName: 'Reader Cee', authorHandle: 'cee', parentId: '-T1root', createdAt: t + 60000 },
      '-T2root': { text: 'A quiet post, no replies yet.', authorUid: C, authorName: 'Reader Cee', authorHandle: 'cee', createdAt: t + 120000 },
    },
  });
}

async function openRoom(page, uid = A) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeSquareWrite(page, { at: OPEN });   // W54: posts go through /api/square/write
  await page.addInitScript((off) => {
    const RD = Date;
    class D extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + off); else super(...a); } static now() { return RD.now() + off; } }
    window.Date = D;
  }, OPEN - Date.now());
  await page.goto('/square');
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), await getAuth(app).createCustomToken(uid));
  await expect(page.getByText('Root post with a thread.')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('a[href="/profile"]').first()).toBeVisible();   // signed in
  await page.waitForTimeout(1200);                                           // userData settles
  const decline = page.getByRole('button', { name: /^decline$/i });
  if (await decline.count()) await decline.click();
  return errors;
}

test('a second press while saving posts nothing', async ({ page }) => {
  await reset();
  await openRoom(page);
  // Two clicks in ONE task: React cannot re-render between them, so only a ref guard holds.
  await page.getByPlaceholder(/What's on your mind/).fill('a root pressed twice');
  await page.getByRole('button', { name: /^Post$/i }).evaluate((b) => { b.click(); b.click(); });
  await expect(page.getByPlaceholder(/What's on your mind/)).toHaveValue('');
  await page.waitForTimeout(1500);
  const roots = Object.values((await db.ref('square_posts').get()).val()).filter((p) => p.text === 'a root pressed twice');
  expect(roots).toHaveLength(1);
});

test('autocomplete and "+ New" message search work for a plain reader', async ({ page }) => {
  await reset();
  const errors = await openRoom(page);
  const box = page.getByPlaceholder(/What's on your mind/);
  await box.fill('hey @Be');
  const dropdown = page.locator('[data-mention-dropdown]');
  await expect(dropdown.getByText('@bee', { exact: true })).toBeVisible();
  await dropdown.getByText('@bee', { exact: true }).click();
  await expect(box).toHaveValue('hey @bee ');

  await page.getByRole('button', { name: 'Messages' }).click();
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByPlaceholder(/Search by name/).fill('cee');
  const panel = page.getByPlaceholder(/Search by name/).locator('xpath=..');
  await expect(panel.getByText('Reader Ay', { exact: true })).toHaveCount(0);   // never yourself
  await panel.getByText('Reader Cee', { exact: true }).click();
  await expect(page.getByPlaceholder('Message Reader Cee…')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [390, 1280]) {
  test(`no card leaves the screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await reset();
    await openRoom(page);
    const out = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      return [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > cw + 1 || r.left < -1) && !(getComputedStyle(e).position === 'fixed' && r.width >= cw); }).length;
    });
    expect(out).toBe(0);
  });
}
