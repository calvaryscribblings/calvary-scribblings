// W55 — the reply box grows, Quote in the thread, a moderator's wording. Proven in real pages
// against the EMULATOR.
//
//   · rulings 212, 216: the reply box on /square/p is 44, 64, 84px at one, two, three lines, and
//     stays 84 at four, scrolling inside; Send sits beside the last line; the "Replying to" row,
//     the mention list and the counter keep their places; the thread's foot grows with the bar;
//     after a send the box is one line again
//   · Quote on the thread's opening post, after "reply", shown exactly when "reply" is; it opens
//     /square with the post quoted and the cursor in the composer; a post that has left the room
//     opens the composer without it; replies have no Quote
//   · ruling 215: a moderator removing someone else's opening post is asked "Remove this post?"
//     (+ "The N replies beneath it will stay."), on the feed and the thread; the author's words
//     don't change; ruling 213's menu words, checked once more
//
// Signed in as the emulator test reader, and as an emulator reader with canRemovePosts — no
// founder account, not even here. Nothing touches production: NEXT_PUBLIC_FB_EMULATOR=1, a
// localhost page (app/lib/firebase.js), and /api/square/write is routed to the real handler on the
// emulators (tests/square/write-route.mjs). Screenshots, if any, stay in test-results/.
//
//   npm run test:square:w55
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';
import { routeSquareWrite } from './write-route.mjs';

const app = adminApp('square-w55');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const A = 'w55-test-reader', B = 'w55-reader-b', C = 'w55-reader-c', M = 'w55-moderator';

const londonAt = (hhmm, now = Date.now()) => {
  const fmt = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  let t = Math.floor(now / 60000) * 60000;
  for (let i = 0; i <= 1500 && fmt(t) !== hhmm; i++) t -= 60000;
  return t;
};
const OPEN = londonAt('20:30');
const val = async (path) => (await db.ref(path).get()).val();

async function reset() {
  let t = OPEN - 60 * 60000;
  const at = () => (t += 60000);
  const prof = (displayName, h, extra = {}) => ({ displayName, username: h, handle: h, readCount: 12, createdAt: 1, ...extra });
  const rec = (uid, h, text, over = {}) => ({ text, authorUid: uid, authorName: h, authorHandle: h, createdAt: at(), ...over });
  const replies = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`-t${i}`, rec(C, 'cee', `reply number ${i}`, { parentId: '-T1' })]));
  await db.ref().set({
    users: { [A]: prof('Reader Ay', 'ay'), [B]: prof('Reader Bee', 'bee'), [C]: prof('Reader Cee', 'cee'), [M]: prof('Moderator Em', 'em', { canRemovePosts: true }) },
    usernames: { ay: A, bee: B, cee: C, em: M },
    user_search: Object.fromEntries([[A, 'ay'], [B, 'bee'], [C, 'cee'], [M, 'em']].map(([u, h]) => [u, { displayName: h, username: h }])),
    square_posts: {
      '-T1': rec(B, 'bee', 'The thread root.'),
      ...replies,
      '-T2': rec(B, 'bee', 'A lone post by Bee.'),
      '-T3': rec(A, 'ay', 'My own post.'),
      '-t3r': rec(C, 'cee', 'a reply to my post', { parentId: '-T3' }),
      '-t3s': rec(C, 'cee', 'another reply to my post', { parentId: '-T3' }),
      '-Tw': rec(B, 'bee', '', { withdrawn: true, withdrawnAt: 1, removedBy: 'author' }),
      '-twr': rec(C, 'cee', 'under a withdrawn post', { parentId: '-Tw' }),
    },
    square_archive: { '-Arch': { text: 'An archived post.', authorUid: B, authorName: 'bee', authorHandle: 'bee', createdAt: OPEN - 3 * 86400000, archivedAt: 1 } },
  });
}

async function open(page, path, { uid = A, at = OPEN } = {}) {
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await routeSquareWrite(page, { at });
  await page.addInitScript((off) => {
    const RD = Date;
    class D2 extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + off); else super(...a); } static now() { return RD.now() + off; } }
    window.Date = D2;
  }, at - Date.now());
  await page.goto(path);
  if (uid) {
    await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
    await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), await getAuth(app).createCustomToken(uid));
  }
  const decline = page.getByRole('button', { name: /^decline$/i });
  try { await decline.waitFor({ timeout: 6000 }); await decline.click(); } catch {}
  return { errors, dialogs };
}
const openThread = async (page, id, opts = {}) => {
  const o = await open(page, `/square/p?id=${id}`, opts);
  await expect(page.locator('[data-thread-root]')).toBeVisible({ timeout: 90000 });
  if (opts.uid !== null && (opts.at ?? OPEN) === OPEN && id !== '-Arch') await expect(page.locator('[data-reply-bar]')).toBeVisible({ timeout: 30000 });
  return o;
};
const openFeed = async (page, opts) => {
  const o = await open(page, '/square', opts);
  await expect(page.getByText('The thread root.')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('a[href="/profile"]').first()).toBeVisible();
  await page.waitForTimeout(1200);   // userData (canRemovePosts) settles
  return o;
};
const box = async (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; });
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

// ── 1. the reply box (212, 216) ──────────────────────────────────────────────

test('the box is 44, 64, 84 and 84px at one to four lines; past three it scrolls; Send sits by the last line', async ({ page }) => {
  await reset();
  const { errors } = await openThread(page, '-T1');
  const field = page.locator('[data-reply-field]');
  const send = page.getByRole('button', { name: 'Send' });
  const at1 = await box(field);
  const send1 = await box(send);
  expect(at1.height).toBe(44);
  // at one line nothing moves: Send is level with the field, top and bottom
  expect(send1.top).toBeCloseTo(at1.top, 0);
  expect(send1.bottom).toBeCloseTo(at1.bottom, 0);
  await expect(field).toHaveCSS('border-top-left-radius', '22px');
  await expect(field).toHaveCSS('line-height', '20px');
  await expect(field).toHaveCSS('font-size', '16px');
  await expect(field).toHaveCSS('padding-top', '11px');
  await expect(field).toHaveCSS('padding-bottom', '11px');

  const heights = [];
  for (const n of [1, 2, 3, 4]) {
    await field.fill(lines(n));
    const b = await box(field);
    heights.push(b.height);
    // 216 — Send's bottom stays at the field's bottom, beside the last line
    expect((await box(send)).bottom).toBeCloseTo(b.bottom, 0);
    // the field grows upward: its bottom never moves
    expect(b.bottom).toBeCloseTo(at1.bottom, 0);
  }
  expect(heights).toEqual([44, 64, 84, 84]);
  await expect(field).toHaveCSS('border-top-left-radius', '22px');
  const scroll = await field.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }));
  expect(scroll.oy).toBe('auto');
  expect(scroll.sh).toBeGreaterThan(scroll.ch);   // the fourth line is inside, scrolled to

  // a line that wraps grows the box the same as a newline does
  await field.fill('a long line that wraps '.repeat(6).trim());
  expect((await box(field)).height).toBeGreaterThan(44);
  expect(errors).toEqual([]);
});

test('"Replying to", the mention list and the counter keep their places as the box grows', async ({ page }) => {
  await reset();
  await openThread(page, '-T1');
  const field = page.locator('[data-reply-field]');
  await page.locator('[data-reply-to="-t0"]').click();
  const replying = page.locator('[data-replying-row]');
  await expect(replying).toBeVisible();
  const gapAbove = async () => (await box(field)).top - (await box(replying)).bottom;

  await field.fill('one');
  const g1 = await gapAbove();
  await field.fill(lines(3));
  expect(await gapAbove()).toBeCloseTo(g1, 0);    // the row rides up with the field's top

  // the mention list sits above the bar, whatever the box's height
  await field.fill(`${lines(2)} @be`);
  const list = page.locator('[data-mention-dropdown]');
  await expect(list).toBeVisible();
  expect((await box(list)).bottom).toBeLessThan((await box(replying)).top + 1);

  // the counter sits just under the field, at the height the field has grown to (240 characters
  // are always past one line, so the counter is never seen beside a one-line box)
  await field.fill('x '.repeat(125));
  const counter = page.getByText('250 / 300');
  await expect(counter).toBeVisible();
  expect((await box(field)).height).toBe(84);
  const gap = (await box(counter)).top - (await box(field)).bottom;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(8);
});

test('the foot of the thread grows with the bar, so the last reply never sits under it; a send takes the box back to one line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await reset();
  await openThread(page, '-T1');
  const field = page.locator('[data-reply-field]');
  const bar = page.locator('[data-reply-bar]');
  const last = page.locator('[id="r--t11"]');
  await expect(last).toBeVisible();
  const clearOfBar = async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    return (await box(bar)).top - (await box(last)).bottom;
  };
  const one = await clearOfBar();
  expect(one).toBeGreaterThan(0);
  await field.fill(lines(4));
  expect((await box(field)).height).toBe(84);
  const three = await clearOfBar();
  expect(three).toBeGreaterThan(0);
  expect(three).toBeCloseTo(one, 0);              // the foot grew by exactly what the box did

  await page.getByRole('button', { name: 'Send' }).click();
  await expect(field).toHaveValue('');
  expect((await box(field)).height).toBe(44);
  await expect.poll(async () => Object.values((await val('square_posts')) || {}).some((p) => p.text === lines(4))).toBe(true);
  const docW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(docW).toBeLessThanOrEqual(390);
});

// ── 2. Quote on the thread's opening post ────────────────────────────────────

test('Quote follows "reply" on the opening post, never on a reply, and opens the feed with the post quoted', async ({ page }) => {
  await reset();
  const { errors } = await openThread(page, '-T1');
  const root = page.locator('[data-thread-root]');
  const quote = root.locator('[data-thread-quote]');
  await expect(quote).toBeVisible();
  await expect(quote).toHaveText('quote');
  await expect(page.locator('[data-thread-quote]')).toHaveCount(1);   // replies stay unquotable
  // in the same style as reply, right after it
  const order = await root.locator('button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()).filter((t) => t === 'reply' || t === 'quote'));
  expect(order).toEqual(['reply', 'quote']);
  const replyBtn = root.getByRole('button', { name: 'reply', exact: true });
  for (const p of ['color', 'font-size', 'font-family', 'letter-spacing', 'min-height']) {
    expect(await quote.evaluate((el, k) => getComputedStyle(el)[k], p)).toBe(await replyBtn.evaluate((el, k) => getComputedStyle(el)[k], p));
  }

  await quote.click();
  await page.waitForURL((u) => u.pathname === '/square');
  const composer = page.getByPlaceholder(/What's on your mind/);
  await expect(composer).toBeFocused({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Remove quoted post' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');                        // taken once
  await composer.fill('quoting from the thread');
  await page.getByRole('button', { name: /^Post$/i }).click();
  await expect.poll(async () => Object.values((await val('square_posts')) || {}).find((p) => p.text === 'quoting from the thread')?.quotedPostId).toBe('-T1');
  expect(errors).toEqual([]);
});

test('a post that has left the room by then: the composer opens without it', async ({ page }) => {
  await reset();
  await openFeed(page);                         // signed in, cookie notice answered
  await page.goto('/square?quote=-NotInTheRoom');
  const composer = page.getByPlaceholder(/What's on your mind/);
  await expect(composer).toBeFocused({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Remove quoted post' })).toHaveCount(0);
  await expect(page.getByText('[original post no longer available]')).toHaveCount(0);

  // and one withdrawn since: the same
  await page.goto('/square?quote=-Tw');
  await expect(composer).toBeFocused({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Remove quoted post' })).toHaveCount(0);
});

test('Quote shows exactly when reply does: not signed out, not out of hours, not archived, not withdrawn', async ({ browser }) => {
  await reset();
  const cases = [
    ['signed out', '-T1', { uid: null }],
    ['out of hours', '-T1', { at: londonAt('18:00') }],
    ['archived', '-Arch', {}],
    ['withdrawn', '-Tw', {}],
  ];
  for (const [name, id, opts] of cases) {
    const page = await browser.newPage();
    await openThread(page, id, opts);
    await page.waitForTimeout(2500);
    expect(await page.locator('[data-thread-root] [data-thread-quote]').count(), name).toBe(0);
    expect(await page.locator('[data-thread-root]').getByRole('button', { name: 'reply', exact: true }).count(), name).toBe(0);
    await page.close();
  }
});

// ── 3. a moderator's wording (215), and the menu's (213) ─────────────────────

test('feed: a moderator removing someone else\'s post is asked "Remove this post?", with the replies line when it has them', async ({ page }) => {
  await reset();
  const { dialogs } = await openFeed(page, { uid: M });
  const post = (id) => page.locator(`[id="${id}"]`);
  await post('-T1').getByRole('button', { name: '···' }).first().click();
  await page.getByRole('button', { name: 'Remove post' }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toBe('Remove this post?\n\nThe 12 replies beneath it will stay.');
  await expect.poll(() => val('square_posts/-T1/removedBy')).toBe('moderator');

  await post('-T2').getByRole('button', { name: '···' }).first().click();
  await page.getByRole('button', { name: 'Remove post' }).click();
  await expect.poll(() => dialogs.length).toBe(2);
  expect(dialogs[1]).toBe('Remove this post?');
  await expect.poll(() => val('square_posts/-T2')).toBe(null);
});

test('thread: the same words for the moderator; "Remove reply" on a reply', async ({ page }) => {
  await reset();
  const { dialogs } = await openThread(page, '-T1', { uid: M });
  await page.locator('[id="r--t0"]').getByRole('button', { name: '···' }).click();
  await expect(page.getByRole('button', { name: 'Remove reply' })).toBeVisible();
  await page.mouse.click(10, 400);   // the menu closes on a press outside it
  await page.locator('[data-thread-root]').getByRole('button', { name: '···' }).first().click();
  await page.getByRole('button', { name: 'Remove post' }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toBe('Remove this post?\n\nThe 12 replies beneath it will stay.');
  await expect.poll(() => val('square_posts/-T1/removedBy')).toBe('moderator');
});

test('the author\'s words don\'t change, on the feed and the thread; "Withdraw reply" on their own reply', async ({ page }) => {
  await reset();
  await db.ref('square_posts/-tmine').set({ text: 'my reply', authorUid: A, authorName: 'ay', authorHandle: 'ay', parentId: '-T1', createdAt: OPEN - 1000 });
  const { dialogs } = await openThread(page, '-T3');
  await page.locator('[data-thread-root]').getByRole('button', { name: '···' }).first().click();
  await page.getByRole('button', { name: 'Withdraw post' }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toBe("Withdraw this post?\n\nThe 2 replies beneath it will stay — they aren't yours to delete.");
  await expect.poll(() => val('square_posts/-T3/removedBy')).toBe('author');

  await page.goto('/square/p?id=-T1');
  await page.locator('[id="r--tmine"]').getByRole('button', { name: '···' }).click();
  await expect(page.getByRole('button', { name: 'Withdraw reply' })).toBeVisible();

  await page.goto('/square');
  await db.ref('square_posts/-T4').set({ text: 'My lone post.', authorUid: A, authorName: 'ay', authorHandle: 'ay', createdAt: OPEN - 500 });
  await expect(page.getByText('My lone post.')).toBeVisible({ timeout: 90000 });
  await page.locator('[id="-T4"]').getByRole('button', { name: '···' }).first().click();
  await page.getByRole('button', { name: 'Withdraw post' }).click();
  await expect.poll(() => dialogs.length).toBe(2);
  expect(dialogs[1]).toBe("Withdraw this post? It'll be removed from the Square.");
});
