// W54 — the Square's write Function, proven in real pages against the EMULATOR.
//
//   · the post box, the reply bar and edit all go through /api/square/write, and what lands is the
//     server's record: its clock, its author snapshot, no stored counts;
//   · outside the hours the server refuses even though the page thinks the room is open, and the
//     failed card says "Not sent. The Square opens at 8pm." (ruling 210);
//   · past the pace the card says "Not sent. Too much at once. Try again in a minute." (211), for a
//     post and for a reply;
//   · any other failure says only "Not sent." — Try again and Remove as before (205);
//   · reaction counts are who reacted, on the feed, the thread and the archive; the stored
//     likeCount/fireCount/clapCount are neither read nor written.
//
// Signed in only as the emulator test reader — no founder account. Nothing touches production:
// NEXT_PUBLIC_FB_EMULATOR=1, a localhost page (app/lib/firebase.js), and the Function's own calls go
// to the emulators (tests/square/write-route.mjs). Screenshots, if any, stay in test-results/.
//
//   npm run test:square:w54
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';
import { routeSquareWrite } from './write-route.mjs';

const app = adminApp('square-w54');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const A = 'w54-test-reader', B = 'w54-reader-b', C = 'w54-reader-c';

const londonAt = (hhmm, now = Date.now()) => {
  const fmt = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  let t = Math.floor(now / 60000) * 60000;
  for (let i = 0; i <= 1500 && fmt(t) !== hhmm; i++) t -= 60000;
  return t;
};
const OPEN = londonAt('20:30');
const val = async (path) => (await db.ref(path).get()).val();

async function reset(extra = {}) {
  const t = OPEN - 30 * 60000;
  const prof = (displayName, h) => ({ displayName, username: h, handle: h, readCount: 12, createdAt: 1 });
  await db.ref().set({
    users: { [A]: prof('Reader Ay', 'ay'), [B]: prof('Reader Bee', 'bee'), [C]: prof('Reader Cee', 'cee') },
    usernames: { ay: A, bee: B, cee: C },
    user_search: { [A]: { displayName: 'Reader Ay', username: 'ay' }, [B]: { displayName: 'Reader Bee', username: 'bee' }, [C]: { displayName: 'Reader Cee', username: 'cee' } },
    square_posts: {
      // stored counts that are WRONG on purpose: the page must draw who reacted, never these
      '-Pb': { text: 'A post by Bee.', authorUid: B, authorName: 'Reader Bee', authorHandle: 'bee', createdAt: t, likeCount: 99, clapCount: 42, fireCount: 7 },
      '-Pbr': { text: 'Cee replies to Bee', authorUid: C, authorName: 'Reader Cee', authorHandle: 'cee', parentId: '-Pb', createdAt: t + 60000, likeCount: 50 },
    },
    square_reactions: {
      '-Pb': { like: { [B]: true, [C]: true }, fire: { [C]: true } },
      '-Pbr': { clap: { [B]: true } },
    },
    square_archive: {
      '-Arch': { text: 'An archived post.', authorUid: B, authorName: 'Reader Bee', authorHandle: 'bee', createdAt: t - 3 * 86400000, likeCount: 30, archivedAt: 1 },
    },
    square_archive_reactions: { '-Arch': { like: { [C]: true }, clap: { [B]: true, [C]: true } } },
    ...extra,
  });
}

async function open(page, path, { route = {} } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const writes = await routeSquareWrite(page, { at: OPEN, ...route });
  await page.addInitScript((off) => {
    const RD = Date;
    class D2 extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + off); else super(...a); } static now() { return RD.now() + off; } }
    window.Date = D2;
  }, OPEN - Date.now());
  await page.goto(path);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), await getAuth(app).createCustomToken(A));
  const decline = page.getByRole('button', { name: /^decline$/i });
  try { await decline.waitFor({ timeout: 6000 }); await decline.click(); } catch {}
  return { errors, writes };
}
const openFeed = async (page, opts) => {
  const o = await open(page, '/square', opts);
  await expect(page.getByText('A post by Bee.')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('a[href="/profile"]').first()).toBeVisible();   // signed in
  await page.waitForTimeout(1200);                                           // userData settles
  return o;
};
const openThread = async (page, id, opts) => {
  const o = await open(page, `/square/p?id=${id}`, opts);
  await expect(page.locator('[data-thread-root]')).toBeVisible({ timeout: 90000 });
  return o;
};
const postIt = async (page, text) => {
  await page.getByPlaceholder(/What's on your mind/).fill(text);
  await page.getByRole('button', { name: /^Post$/i }).click();
};
const mine = async (text) => Object.entries((await val('square_posts')) || {}).filter(([, p]) => p.text === text);

test('a post goes through the Function: the server’s record, mirrored, no stored counts', async ({ page }) => {
  await reset();
  const { errors, writes } = await openFeed(page);
  await postIt(page, 'Hello from the Function.');
  await expect(page.getByPlaceholder(/What's on your mind/)).toHaveValue('');
  await expect(page.getByText('Hello from the Function.')).toBeVisible();
  await expect.poll(async () => (await mine('Hello from the Function.')).length).toBe(1);
  const [[id, rec]] = await mine('Hello from the Function.');
  expect(writes.calls.map((c) => c.status)).toEqual([200]);
  expect(rec.authorUid).toBe(A);
  expect(rec.authorName).toBe('Reader Ay');
  expect(rec.authorHandle).toBe('ay');
  expect(Math.abs(rec.createdAt - OPEN)).toBeLessThan(5 * 60000);   // the server's (shifted) clock
  for (const k of ['likeCount', 'clapCount', 'fireCount']) expect(rec[k]).toBeUndefined();
  await expect.poll(() => val(`user_square_posts/${A}/${id}/text`)).toBe('Hello from the Function.');
  expect(errors).toEqual([]);
});

test('outside the hours the server refuses, though the page thinks the room is open (ruling 210)', async ({ page }) => {
  await reset();
  await openFeed(page, { route: { now: londonAt('18:00') } });
  await postIt(page, 'posted at six by the server’s clock');
  const card = page.locator('[data-post="unsent"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[role="alert"]')).toContainText('Not sent. The Square opens at 8pm.');
  await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible();
  const before = JSON.stringify(await val('square_posts'));
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card).toHaveCount(0);
  expect(JSON.stringify(await val('square_posts'))).toBe(before);
});

test('past the pace a post is refused with ruling 211’s words; Try again keeps saying so', async ({ page }) => {
  const full = [1, 2, 3, 4, 5].map((i) => OPEN - i * 1000);
  await reset({ square_rate: { [A]: { post: full } } });
  await openFeed(page);
  await postIt(page, 'one post too many');
  const card = page.locator('[data-post="unsent"]');
  await expect(card.locator('[role="alert"]')).toContainText('Not sent. Too much at once. Try again in a minute.');
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card.locator('[data-unsent-reason]')).toHaveText(' Too much at once. Try again in a minute.');
  expect(await mine('one post too many')).toHaveLength(0);
});

test('any other failure says only "Not sent." (ruling 205), and Try again sends once it can', async ({ page }) => {
  await reset();
  await openFeed(page, { route: { fail: 502 } });
  await postIt(page, 'the Function is down');
  const card = page.locator('[data-post="unsent"]');
  await expect(card.getByText('Not sent.')).toBeVisible();
  await expect(card.locator('[data-unsent-reason]')).toHaveCount(0);
  // the Function comes back
  await page.unroute('**/api/square/write');
  await routeSquareWrite(page, { at: OPEN });
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await mine('the Function is down')).length).toBe(1);
});

test('edit goes through the Function: text only, marked edited', async ({ page }) => {
  await reset();
  const { writes } = await openFeed(page);
  await postIt(page, 'first words');
  const post = page.locator('[id]').filter({ has: page.getByText('first words', { exact: true }) }).last();
  await expect(post).toBeVisible();
  await post.getByRole('button', { name: '···' }).click();
  await page.getByRole('button', { name: 'edit post' }).click();
  const field = page.locator('textarea').filter({ hasText: 'first words' });
  await field.fill('second words');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await mine('second words')).length).toBe(1);
  const [[, rec]] = await mine('second words');
  expect(rec.edited).toBe(true);
  expect(writes.calls.map((c) => c.body.ok)).toEqual([true, true]);
});

test('a reply goes through the Function; past the reply pace the failed reply says why', async ({ page }) => {
  await reset();
  await openThread(page, '-Pb');
  const field = page.getByLabel('Reply', { exact: true });
  await expect(page.locator('[data-reply-bar]')).toBeVisible({ timeout: 30000 });
  await field.fill('a reply via the server');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(field).toHaveValue('');
  await expect.poll(async () => (await mine('a reply via the server')).length).toBe(1);
  const [[id, rec]] = await mine('a reply via the server');
  expect(rec.parentId).toBe('-Pb');
  expect(rec.likeCount).toBeUndefined();
  await expect.poll(() => val(`user_square_posts/${A}/${id}/parentId`)).toBe('-Pb');
  // Bee (the root's author) hears of it, as before
  await expect.poll(async () => Object.values((await val(`notifications/${B}`)) || {}).map((n) => n.type)).toEqual(['square_reply']);

  await db.ref(`square_rate/${A}/reply`).set(Array.from({ length: 30 }, (_, i) => OPEN - i * 1000));
  await field.fill('one reply too many');
  await page.getByRole('button', { name: 'Send' }).click();
  const unsent = page.locator('[data-reply="unsent"]');
  await expect(unsent.locator('[role="alert"]')).toContainText('Not sent. Too much at once. Try again in a minute.');
  expect(await mine('one reply too many')).toHaveLength(0);
});

test('reaction counts are who reacted — feed, thread and archive — and a tap writes only its own leaf', async ({ page }) => {
  await reset();
  await openFeed(page);
  const feedPost = page.locator('[id="-Pb"]');
  await expect(feedPost.locator('button[data-kind="heart"]')).toHaveAttribute('aria-label', 'Heart, 2');   // not 99
  await expect(feedPost.locator('button[data-kind="fire"]')).toHaveAttribute('aria-label', 'Fire, 1');     // not 7
  await expect(feedPost.locator('button[data-kind="like"]')).toHaveAttribute('aria-label', 'Like');        // not 42
  await feedPost.locator('button[data-kind="like"]').click();
  await expect(feedPost.locator('button[data-kind="like"]')).toHaveAttribute('aria-label', 'Like, 1');
  await expect.poll(() => val(`square_reactions/-Pb/clap/${A}`)).toBe(true);
  expect(await val('square_posts/-Pb/clapCount')).toBe(42);   // the stored count is not touched

  await page.goto('/square/p?id=-Pb');
  await expect(page.locator('[data-thread-root]')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('[data-thread-root] button[data-kind="heart"]')).toHaveAttribute('aria-label', 'Heart, 2');
  await expect(page.locator('[data-thread-root] button[data-kind="like"]')).toHaveAttribute('aria-label', 'Like, 1');
  await expect(page.locator('[data-reply="-Pbr"] button[data-kind="like"]')).toHaveAttribute('aria-label', 'Like, 1');
  await expect(page.locator('[data-reply="-Pbr"] button[data-kind="heart"]')).toHaveAttribute('aria-label', 'Heart');   // not 50

  await page.goto('/square/p?id=-Arch');
  await expect(page.locator('[data-thread-root]')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('[data-thread-root] button[data-kind="heart"]')).toHaveAttribute('aria-label', 'Heart, 1');   // not 30
  await expect(page.locator('[data-thread-root] button[data-kind="like"]')).toHaveAttribute('aria-label', 'Like, 2');
});
