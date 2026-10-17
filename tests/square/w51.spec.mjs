// W51 — tonight's Square fixes, proven in a real page against the emulator.
//
//   · a reply with "@Bee" (mixed case) saves ONCE and its box clears
//   · a second press while saving posts nothing
//   · autocomplete and "+ New" message search work for a plain reader
//   · reply on a reply posts into the thread, prefilled "@handle "
//   · a refused reply keeps its words, with "Not sent." and Try again
//   · no element leaves the screen at 390 or 1280 (W48's card-width check)
//
// The browser clock is moved BACK to the last 20:30 London, so the room is open whatever the
// hour the suite runs and every createdAt stays in the past for the rules (forward would break
// `createdAt <= now + 5 min`).
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';

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

const replies = async (parentId) => Object.values((await db.ref('square_posts').get()).val() || {}).filter((p) => p.parentId === parentId);

test('a reply with a mixed-case @mention saves once, clears, and notifies the right reader', async ({ page }) => {
  await reset();
  const errors = await openRoom(page);
  const post = page.locator('[id="-T2root"]');
  await post.getByRole('button', { name: /^reply$/i }).click();
  await post.locator('textarea').fill('thanks @Bee for this');
  await post.getByRole('button', { name: /^Reply$/ }).click();
  await expect(post.locator('textarea')).toHaveCount(0);
  await expect.poll(async () => (await replies('-T2root')).length).toBe(1);
  await expect.poll(async () => Object.values((await db.ref(`notifications/${B}`).get()).val() || {}).filter((n) => n.type === 'mention').length).toBe(1);
  expect(errors).toEqual([]);
});

test('a second press while saving posts nothing', async ({ page }) => {
  await reset();
  await openRoom(page);
  const post = page.locator('[id="-T2root"]');
  await post.getByRole('button', { name: /^reply$/i }).click();
  await post.locator('textarea').fill('pressed twice');
  // Two clicks in ONE task: React cannot re-render between them, so only a ref guard holds.
  await post.getByRole('button', { name: /^Reply$/ }).evaluate((b) => { b.click(); b.click(); });
  await expect(post.locator('textarea')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect((await replies('-T2root')).filter((r) => r.text === 'pressed twice')).toHaveLength(1);
  // and the main composer, the same
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
  const post = page.locator('[id="-T2root"]');
  await post.getByRole('button', { name: /^reply$/i }).click();
  await post.locator('textarea').fill('hey @Be');
  const dropdown = page.locator('[data-mention-dropdown]');
  await expect(dropdown.getByText('@bee', { exact: true })).toBeVisible();
  await dropdown.getByText('@bee', { exact: true }).click();
  await expect(post.locator('textarea')).toHaveValue('hey @bee ');

  await page.getByRole('button', { name: 'Messages' }).click();
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByPlaceholder(/Search by name/).fill('cee');
  const panel = page.getByPlaceholder(/Search by name/).locator('xpath=..');
  await expect(panel.getByText('Reader Ay', { exact: true })).toHaveCount(0);   // never yourself
  await panel.getByText('Reader Cee', { exact: true }).click();
  await expect(page.getByPlaceholder('Message Reader Cee…')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reply on a reply posts into the thread, prefilled with the handle', async ({ page }) => {
  await reset();
  await openRoom(page);
  const thread = page.locator('[id="-T1root"]');
  const first = thread.getByText('first reply', { exact: true });
  await first.locator('xpath=ancestor::div[2]').getByRole('button', { name: /^reply$/i }).click();
  const box = thread.locator('textarea');
  await expect(box).toHaveCount(1);
  await expect(box).toHaveValue('@cee ');
  await expect(box).toBeFocused();
  await page.keyboard.type('agreed');
  await thread.getByRole('button', { name: /^Reply$/ }).click();
  await expect(box).toHaveCount(0);
  await expect.poll(async () => (await replies('-T1root')).map((r) => r.text).sort()).toEqual(['@cee agreed', 'first reply']);
  await expect(thread.getByText('agreed')).toBeVisible();
});

test('a refused reply keeps its words, with "Not sent." and Try again; Remove discards them', async ({ page }) => {
  // A legacy record: the stored username is not this reader's in the index, so the rules refuse
  // authorHandle and the write fails server-side.
  await reset({ readerA: { displayName: 'Reader Ay', username: 'ay_old', readCount: 12, createdAt: 1 } });
  await openRoom(page);
  const post = page.locator('[id="-T2root"]');
  await post.getByRole('button', { name: /^reply$/i }).click();
  await post.locator('textarea').fill('this one is refused');
  await post.getByRole('button', { name: /^Reply$/ }).click();
  await expect(post.getByText('Not sent.')).toBeVisible();
  await expect(post.locator('textarea')).toHaveValue('this one is refused');
  await expect(post.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(await replies('-T2root')).toHaveLength(0);
  // Try again while still refused: the words stay, and so does the message.
  await post.getByRole('button', { name: 'Try again' }).click();
  await expect(post.getByText('Not sent.')).toBeVisible();
  await expect(post.locator('textarea')).toHaveValue('this one is refused');
  await post.getByRole('button', { name: 'Remove' }).click();
  await expect(post.locator('textarea')).toHaveCount(0);
  expect(await replies('-T2root')).toHaveLength(0);
});

for (const width of [390, 1280]) {
  test(`no card leaves the screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await reset();
    await openRoom(page);
    await page.locator('[id="-T1root"]').getByText('first reply', { exact: true }).locator('xpath=ancestor::div[2]').getByRole('button', { name: /^reply$/i }).click();
    const out = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      return [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > cw + 1 || r.left < -1) && !(getComputedStyle(e).position === 'fixed' && r.width >= cw); }).length;
    });
    expect(out).toBe(0);
  });
}
