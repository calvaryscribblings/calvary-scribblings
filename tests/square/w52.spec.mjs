// W52 — the Square's threads, proven in a real page against the EMULATOR, as a plain test reader.
//
//   · nesting: a reply to a reply sits one level in under its top-level ancestor, whatever its
//     depth, and says "Replying to @handle"
//   · the fold: two nested replies, then "View N more replies" — and your own reply, just sent,
//     stays visible below it
//   · tombstones: the author's and the moderator's words; a tombstone with nothing beneath is not
//     drawn; withdrawing or removing writes a tombstone, never a hard delete
//   · the failed state: in place, half opacity, "Not sent.", Try again, Remove
//   · notifications: "replied to your post" / "replied to you", never twice, never yourself
//   · the rules: replyToId across threads refused; a pre-A42 flat reply still saves
//   · the feed: replies gone, one latest-reply line that opens the thread at that reply
//   · read-only outside the room's hours; nothing leaves the screen at 390 or 1280
//   · ruling 190: no build stamp in the site footer for a reader (the story's end: tests/live/w52-live-check.mjs)
//
// No founder account is created here, not even in the emulator. Nothing touches production:
// NEXT_PUBLIC_FB_EMULATOR=1 and a localhost page (app/lib/firebase.js). Screenshots go to
// test-results/ (git-ignored) and stay local.
//
//   npm run test:square:w52
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp, DB_NAMESPACE } from '../series/harness.mjs';
import { routeSquareWrite } from './write-route.mjs';

const WRITES = new WeakMap();   // page → its /api/square/write control (hold/release)

const app = adminApp('square-w52');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const A = 'w52-test-reader', B = 'w52-reader-b', C = 'w52-reader-c', D = 'w52-reader-d', M = 'w52-moderator';
const SHOTS = 'test-results/w52';

const londonAt = (hhmm, now = Date.now()) => {
  const fmt = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  let t = Math.floor(now / 60000) * 60000;
  for (let i = 0; i <= 1500 && fmt(t) !== hhmm; i++) t -= 60000;
  return t;
};
const OPEN = londonAt('20:30');

async function reset({ readerA } = {}) {
  let t = OPEN - 60 * 60000;
  const at = () => (t += 60000);
  const prof = (displayName, h, extra = {}) => ({ displayName, username: h, handle: h, readCount: 12, createdAt: 1, ...extra });
  const rec = (uid, h, text, over = {}) => ({ text, authorUid: uid, authorName: h, authorHandle: h, createdAt: at(), ...over });
  await db.ref().set({
    users: {
      [A]: readerA || prof('Reader Ay', 'ay'), [B]: prof('Reader Bee', 'bee'), [C]: prof('Reader Cee', 'cee'),
      [D]: prof('Reader Dee', 'dee'), [M]: prof('Moderator Em', 'em', { canRemovePosts: true }),
    },
    usernames: { ay: A, bee: B, cee: C, dee: D, em: M },
    user_search: Object.fromEntries([[A, 'ay'], [B, 'bee'], [C, 'cee'], [D, 'dee'], [M, 'em']].map(([u, h]) => [u, { displayName: h, username: h }])),
    square_posts: {
      '-T1': rec(B, 'bee', 'The thread root.'),
      '-t1': rec(C, 'cee', 'top reply one', { parentId: '-T1' }),
      '-t1n1': rec(D, 'dee', 'nested one', { parentId: '-T1', replyToId: '-t1' }),
      '-t1n2': rec(B, 'bee', 'nested two, deeper', { parentId: '-T1', replyToId: '-t1n1' }),
      '-t1n3': rec(C, 'cee', 'nested three', { parentId: '-T1', replyToId: '-t1' }),
      '-t1n4': rec(D, 'dee', 'nested four, deepest', { parentId: '-T1', replyToId: '-t1n2' }),
      '-tA': rec(C, 'cee', null, { parentId: '-T1', withdrawn: true, withdrawnAt: 1, removedBy: 'author' }),
      '-tAc': rec(D, 'dee', 'under the withdrawn one', { parentId: '-T1', replyToId: '-tA' }),
      '-tM': rec(D, 'dee', null, { parentId: '-T1', withdrawn: true, withdrawnAt: 1, removedBy: 'moderator' }),
      '-tMc': rec(C, 'cee', 'under the removed one', { parentId: '-T1', replyToId: '-tM' }),
      '-tLone': rec(C, 'cee', null, { parentId: '-T1', withdrawn: true, withdrawnAt: 1, removedBy: 'author' }),
      '-tMine': rec(A, 'ay', 'my own top reply', { parentId: '-T1' }),
      '-T2': rec(C, 'cee', 'Another thread.'),
      '-t2r': rec(B, 'bee', 'a reply in thread two', { parentId: '-T2' }),
    },
  });
}

async function open(page, path, { uid = A, at = OPEN, route = {} } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  WRITES.set(page, await routeSquareWrite(page, { at, ...route }));   // W54: posts, replies and edits go through /api/square/write
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
  return errors;
}
// The cookie notice sits over the bottom of the page until answered, as it does for any first
// visit (W51's harness answers it the same way).
const declineCookies = async (page) => {
  const decline = page.getByRole('button', { name: /^decline$/i });
  try { await decline.waitFor({ timeout: 4000 }); await decline.click(); } catch {}
};
const openThread = async (page, id, opts) => {
  const errors = await open(page, `/square/p?id=${id}`, opts);
  await expect(page.locator('[data-thread-root]')).toBeVisible({ timeout: 90000 });
  await declineCookies(page);
  if (opts?.uid !== null && (opts?.at ?? OPEN) === OPEN) await expect(page.locator('[data-reply-bar]')).toBeVisible({ timeout: 30000 });
  return errors;
};
const row = (page, id) => page.locator(`[id="r-${id}"]`);
const all = async () => (await db.ref('square_posts').get()).val() || {};
const notifs = async (uid) => Object.values((await db.ref(`notifications/${uid}`).get()).val() || {});

// A client write, judged by the rules. The database emulator takes an unsigned token for `uid`
// in ?auth= and does not verify it; it never signs anyone in anywhere.
const unsigned = (uid) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, iat: now, exp: now + 3600, aud: 'calvary-scribblings', iss: 'https://securetoken.google.com/calvary-scribblings', firebase: { sign_in_provider: 'custom' } })}.`;
};
async function clientPut(uid, path, value) {
  const q = uid ? `&auth=${unsigned(uid)}` : '';
  const res = await fetch(`http://127.0.0.1:9000/${path}.json?ns=${DB_NAMESPACE}${q}`, { method: 'PUT', body: JSON.stringify(value) });
  return res.status;
}

test('nesting: one level in under the top-level ancestor, whatever the depth, with "Replying to @handle"', async ({ page }) => {
  await reset();
  const errors = await openThread(page, '-T1');
  const group = page.locator('[data-reply-group="-t1"]');
  await expect(group.locator('[data-reply="-t1"]')).toHaveAttribute('data-depth', '1');
  await expect(group.locator('[data-reply="-t1n1"]')).toHaveAttribute('data-depth', '2');
  await expect(group.locator('[data-reply="-t1n2"]')).toHaveAttribute('data-depth', '2');   // a reply to a nested reply: still one level in
  await expect(row(page, '-t1n1').locator('[data-replying-to]')).toHaveText('Replying to @cee');
  await expect(row(page, '-t1n2').locator('[data-replying-to]')).toHaveText('Replying to @dee');
  // oldest first, top level
  const tops = await page.locator('[data-reply-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-reply-group')));
  expect(tops).toEqual(['-t1', '-tA', '-tM', '-tMine']);
  // the count leaves out the three tombstones
  await expect(page.locator('[data-replies-count]')).toHaveText('8');
  expect(errors).toEqual([]);
});

test('the fold: two, then "View N more replies"; your own reply, just sent, stays visible below it', async ({ page }) => {
  await reset();
  await openThread(page, '-T1');
  const group = page.locator('[data-reply-group="-t1"]');
  await expect(group.locator('[data-view-more]')).toHaveText('View 2 more replies');
  await expect(row(page, '-t1n3')).toHaveCount(0);
  await expect(row(page, '-t1n4')).toHaveCount(0);

  // answer the deeper nested reply (Bee's, and Bee wrote the root too)
  await row(page, '-t1n2').locator('[data-reply-to="-t1n2"]').click();
  await expect(page.locator('[data-replying-row]')).toContainText('Replying to @bee');
  await expect(row(page, '-t1n2')).toHaveCSS('background-color', 'rgba(107, 47, 173, 0.1)');
  const field = page.getByLabel('Reply', { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS('border-top-color', 'rgba(201, 168, 76, 0.45)');
  await field.fill('my answer to bee');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(field).toHaveValue('');
  await expect(page.locator('[data-replying-row]')).toHaveCount(0);

  let mine;
  await expect.poll(async () => { mine = Object.entries(await all()).find(([, p]) => p.text === 'my answer to bee'); return !!mine; }).toBe(true);
  expect(mine[1].parentId).toBe('-T1');
  expect(mine[1].replyToId).toBe('-t1n2');
  // it lands below the fold (fifth nested) and stays visible; the fold still holds the other two
  await expect(group.locator(`[data-reply="${mine[0]}"]`)).toBeVisible();
  await expect(group.locator(`[data-reply="${mine[0]}"]`)).toHaveAttribute('data-depth', '2');
  await expect(group.locator('[data-view-more]')).toHaveText('View 2 more replies');
  await group.locator('[data-view-more]').click();
  await expect(row(page, '-t1n3')).toBeVisible();
  await expect(row(page, '-t1n4')).toBeVisible();

  // Bee is the root's author AND the answered reply's author: told once, "replied to you".
  await expect.poll(async () => (await notifs(B)).length).toBe(1);
  const nb = (await notifs(B))[0];
  expect(nb.type).toBe('square_reply_to_you');
  expect(nb.threadId).toBe('-T1');
  expect(nb.postId).toBe(mine[0]);
  expect(await notifs(A)).toEqual([]);                                       // never yourself

  // answering Cee's nested reply tells Cee "replied to you" and Bee "replied to your post"
  await row(page, '-t1n3').locator('[data-reply-to="-t1n3"]').click();
  await field.fill('and to cee');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => (await notifs(C)).map((n) => n.type)).toEqual(['square_reply_to_you']);
  await expect.poll(async () => (await notifs(B)).map((n) => n.type).sort()).toEqual(['square_reply', 'square_reply_to_you']);
});

test('tombstones: the author\'s words, the moderator\'s, and none with nothing beneath', async ({ page }) => {
  await reset();
  await openThread(page, '-T1');
  await expect(row(page, '-tA')).toContainText('The author withdrew this reply.');
  await expect(row(page, '-tM')).toContainText('This reply was removed.');
  await expect(row(page, '-tA').locator('[data-reply-tombstone="author"]')).toBeVisible();
  await expect(row(page, '-tM').locator('[data-reply-tombstone="moderator"]')).toBeVisible();
  await expect(row(page, '-tLone')).toHaveCount(0);
  // a tombstone has no Reply, no reactions, no face
  await expect(row(page, '-tA').locator('[data-reply-to]')).toHaveCount(0);
  await expect(row(page, '-tA').locator('a[href^="/user"]')).toHaveCount(0);
  // the dashed 36px circle
  const circle = row(page, '-tA').locator('[data-reply-tombstone] > div').first();
  await expect(circle).toHaveCSS('border-top-style', 'dashed');
  await expect(circle).toHaveCSS('width', '36px');
});

test('withdrawing your own reply writes a tombstone (removedBy author), never a hard delete', async ({ page }) => {
  await reset();
  await openThread(page, '-T1');
  await row(page, '-tMine').getByRole('button', { name: '···' }).click();
  await page.getByRole('button', { name: /Withdraw reply/ }).click();
  await expect.poll(async () => (await all())['-tMine']?.withdrawn).toBe(true);
  const rec = (await all())['-tMine'];
  expect(rec.removedBy).toBe('author');
  expect(rec.text).toBeUndefined();
  expect(rec.parentId).toBe('-T1');
  await expect(row(page, '-tMine')).toHaveCount(0);                          // nothing beneath it: not drawn
});

test('a moderator (canRemovePosts, not a founder) removes a reply: removedBy moderator', async ({ page }) => {
  await reset();
  await openThread(page, '-T1', { uid: M });
  await expect(row(page, '-tAc').getByRole('button', { name: '···' })).toBeVisible();
  // remove a reply that has one beneath it, so its tombstone stays drawn
  await db.ref('square_posts/-t1n4x').set({ text: 'under nested one', authorUid: B, parentId: '-T1', replyToId: '-t1n1', createdAt: OPEN - 1000 });
  await row(page, '-t1n1').getByRole('button', { name: '···' }).click();
  await page.getByRole('button', { name: /Remove reply/ }).click();
  await expect.poll(async () => (await all())['-t1n1']?.removedBy).toBe('moderator');
  expect((await all())['-t1n1'].text).toBeUndefined();
  await expect(row(page, '-t1n1')).toContainText('This reply was removed.');
  // its children keep their place and their "Replying to" line
  await expect(row(page, '-t1n2').locator('[data-replying-to]')).toHaveText('Replying to @dee');
});

test('a reply that fails waits in place: half opacity, "Not sent.", Try again, Remove', async ({ page }) => {
  // W54: replies go through /api/square/write, which builds the author snapshot itself — the
  // stale-username refusal this used (W51's case) can no longer happen. The failure now is the
  // Function answering 502, as an outage would.
  await reset();
  await openThread(page, '-T1', { route: { fail: 502 } });
  await row(page, '-t1').locator('[data-reply-to="-t1"]').click();
  const field = page.getByLabel('Reply', { exact: true });
  await field.fill('this one is refused');
  await page.getByRole('button', { name: 'Send' }).click();
  const unsent = page.locator('[data-reply="unsent"]');
  await expect(unsent).toHaveCount(1);
  await expect(unsent).toContainText('this one is refused');
  // W51 guard: a failed reply keeps its words — in place in the thread, exactly as typed.
  await expect(unsent.locator('[data-postbody="thread-reply"]')).toHaveText('this one is refused');
  await expect(unsent.getByText('Not sent.')).toHaveCSS('color', 'rgb(212, 83, 126)');
  await expect(unsent.getByRole('button', { name: 'Try again' })).toHaveCSS('color', 'rgb(169, 137, 217)');
  await expect(unsent.getByRole('button', { name: 'Remove' })).toHaveCSS('color', 'rgba(245, 240, 232, 0.62)');
  await expect(unsent.locator('[data-depth]').or(unsent)).toHaveAttribute('data-depth', '2');   // in place, nested under -t1
  const faded = await unsent.locator('div').nth(0).evaluate((e) => getComputedStyle(e).opacity);
  expect(faded).toBe('0.5');
  await unsent.getByRole('button', { name: 'Try again' }).click();
  await expect(unsent).toHaveCount(1);
  await expect(unsent.getByText('Not sent.')).toBeVisible();
  await unsent.getByRole('button', { name: 'Remove' }).click();
  await expect(unsent).toHaveCount(0);
  expect(Object.values(await all()).filter((p) => p.text === 'this one is refused')).toHaveLength(0);
});

// ── W51's regression guards, re-pointed at the thread's reply bar ─────────────────────────────
// W51 proved these on the feed's reply box, which W52 removed. Each now runs on /square/p.

test('W51 guard: a capitalised @mention resolves through the lowercase index, and the users root is never read', async ({ page }) => {
  await reset();
  const denied = [];
  page.on('console', (m) => { if (/permission_denied/i.test(m.text())) denied.push(m.text()); });
  const errors = await openThread(page, '-T2');                              // Cee's thread: Dee is neither author
  const field = page.getByLabel('Reply', { exact: true });
  await field.fill('thanks @Dee for this');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(field).toHaveValue('');
  await expect.poll(async () => (await notifs(D)).filter((n) => n.type === 'mention').length).toBe(1);
  const n = (await notifs(D)).find((x) => x.type === 'mention');
  expect(n.threadId).toBe('-T2');
  // Cee (the root's author) is told once, as the root's author
  await expect.poll(async () => (await notifs(C)).map((x) => x.type)).toEqual(['square_reply']);
  await page.waitForTimeout(800);
  expect(denied.filter((t) => /\/users['"\s]|users:/.test(t) || /at \/users\b/.test(t))).toEqual([]);   // no read of the founder-only users root
  expect(errors).toEqual([]);
});

test('W51 guard: a double press saves one reply', async ({ page }) => {
  await reset();
  await openThread(page, '-T2');
  const field = page.getByLabel('Reply', { exact: true });
  await field.fill('pressed twice');
  // Two clicks in ONE task: React cannot re-render between them, so only the ref guard holds.
  await page.getByRole('button', { name: 'Send' }).evaluate((b) => { b.click(); b.click(); });
  await expect(field).toHaveValue('');
  await page.waitForTimeout(1500);
  expect(Object.values(await all()).filter((p) => p.text === 'pressed twice')).toHaveLength(1);
});

test('W51 guard: the box clears only once the save is written', async ({ page }) => {
  await reset();
  await openThread(page, '-T2');
  const field = page.getByLabel('Reply', { exact: true });
  await field.fill('written before the box clears');
  // Hold the reply's request to /api/square/write (W54): the save is not written yet.
  WRITES.get(page).hold();
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(1500);
  await expect(field).toHaveValue('written before the box clears');
  expect(Object.values(await all()).filter((p) => p.text === 'written before the box clears')).toHaveLength(0);
  // Let it through: the write lands, then the box clears.
  WRITES.get(page).release();
  await expect(field).toHaveValue('');
  expect(Object.values(await all()).filter((p) => p.text === 'written before the box clears')).toHaveLength(1);
});

test('the rules: replyToId across threads refused; same thread and a pre-A42 flat reply save', async () => {
  await reset();
  const base = (over) => ({ text: 'x', authorUid: A, parentId: '-T1', createdAt: Date.now(), ...over });
  expect(await clientPut(null, 'square_posts/-ctl', base({}))).toBe(401);             // control: the rules are loaded
  expect(await clientPut(A, 'square_posts/-x1', base({ replyToId: '-t2r' }))).toBe(401);  // a reply in thread two
  expect(await clientPut(A, 'square_posts/-x2', base({ replyToId: '-T1' }))).toBe(401);   // the root itself
  expect(await clientPut(A, 'square_posts/-x3', base({ replyToId: '-t1n1' }))).toBe(200);
  // the app's current reply, field for field, before A42
  expect(await clientPut(A, 'square_posts/-x4', base({
    authorName: 'ay', authorInitials: 'AY', authorHandle: 'ay', authorReadCount: 0, isAuthor: false, likeCount: 0, pinned: false,
  }))).toBe(200);
});

test('the feed: replies leave it; one latest-reply line opens the thread at that reply', async ({ page }) => {
  await reset();
  await open(page, '/square');
  const post = page.locator('[id="-T1"]');
  await expect(post.getByText('The thread root.')).toBeVisible({ timeout: 90000 });
  await declineCookies(page);
  await expect(post.getByText('nested one', { exact: true })).toHaveCount(0);
  await expect(post.getByText('top reply one')).toHaveCount(0);
  await expect(post.locator('[data-thread-open="count"]')).toHaveText(/8 replies/);
  const latest = post.locator('[data-thread-open="latest"]');
  await expect(latest).toContainText('my own top reply');
  await expect(latest).toHaveCSS('height', '36px');
  await expect(latest).toHaveAttribute('href', '/square/p?id=-T1&reply=-tMine');
  await latest.click();
  await expect(page).toHaveURL(/\/square\/p\?id=-T1&reply=-tMine$/);
  await expect(row(page, '-tMine')).toBeVisible({ timeout: 60000 });
  // the body opens the thread too
  await page.goto('/square');
  await page.locator('[id="-T2"] [data-thread-open="body"]').click();
  await expect(page).toHaveURL(/\/square\/p\?id=-T2$/);
});

test('a link to a reply opens its thread at it (older links carry the reply\'s id)', async ({ page }) => {
  await reset();
  await open(page, '/square/p?id=-t1n4');
  await expect(page).toHaveURL(/\/square\/p\?id=-T1&reply=-t1n4$/, { timeout: 90000 });
  await expect(row(page, '-t1n4')).toBeVisible();                            // behind the fold, opened for the link
});

test('outside the room\'s hours the thread is read-only', async ({ page }) => {
  await reset();
  await openThread(page, '-T1', { at: londonAt('19:00') });
  await expect(page.getByText('The Square opens at 8pm. Replies open with it.')).toBeVisible();
  await expect(page.locator('[data-reply-bar]')).toHaveCount(0);
  await expect(page.locator('[data-reply-to]')).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`nothing leaves the screen at ${width}px, and the bar sits at the bottom`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await reset();
    await openThread(page, '-T1');
    await row(page, '-t1n2').locator('[data-reply-to="-t1n2"]').click();
    await page.screenshot({ path: `${SHOTS}/thread-${width}.png`, fullPage: false });
    const out = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      return [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > cw + 1 || r.left < -1) && !(getComputedStyle(e).position === 'fixed' && r.width >= cw); }).length;
    });
    expect(out).toBe(0);
    const bar = await page.locator('[data-reply-bar]').boundingBox();
    expect(Math.round(bar.y + bar.height)).toBe(900);
    const sendBox = await page.getByRole('button', { name: 'Send' }).boundingBox();
    expect([Math.round(sendBox.width), Math.round(sendBox.height)]).toEqual([44, 44]);
  });
}

// Ruling 190 — no reader sees a build ID. Signed out and as the test reader (not a founder).
for (const width of [390, 1280]) {
  for (const who of ['signed-out', 'reader']) {
    test(`ruling 190: no stamp in /public-library's footer at ${width}px, ${who}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await reset();
      const uid = who === 'reader' ? A : null;
      await open(page, '/public-library', { uid });
      const footer = page.locator('footer').last();
      await footer.scrollIntoViewIfNeeded({ timeout: 90000 });
      await page.waitForTimeout(1500);                                         // auth has answered
      await expect(page.locator('[data-build-stamp]')).toHaveCount(0);
      // no empty gap: the copyright line is the footer's last child
      const last = await footer.evaluate((f) => f.lastElementChild.textContent);
      expect(last).toMatch(/All rights reserved\./);
      await footer.screenshot({ path: `${SHOTS}/footer-${width}-${who}.png` });

      // The story's end is checked on the LIVE site after deploy (tests/live/w52-live-check.mjs):
      // a story page needs the live catalogue and the story gate, which the emulator does not hold.
    });
  }
}
