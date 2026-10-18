// W53 — Mute, Block and Report a message, proven in real pages against the EMULATOR.
//
//   · the message barrier both ways, and messages allowed once unblocked
//   · the block and mute lists unreadable by anyone but their owner
//   · a notification from a blocked sender refused
//   · mute hiding posts, replies (ruling 207's placeholder) and notifications
//   · ruling 205 (a failed post) and 206 (a moderator's removal)
//   · a message report written with the right snapshot
//   · the cookie notice clear of the reply bar and the messages "+ New", at 390 and 1280
//
// Signed in only as plain emulator readers — no founder account, not even here. Nothing touches
// production: NEXT_PUBLIC_FB_EMULATOR=1 and a localhost page (app/lib/firebase.js). Screenshots go
// to test-results/w53/ (git-ignored) and stay local.
//
//   npm run test:square:w53
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp, DB_NAMESPACE } from '../series/harness.mjs';
import { routeSquareWrite } from './write-route.mjs';

const WRITES = new WeakMap();   // page → its /api/square/write control (hold/release)

const app = adminApp('square-w53');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const A = 'w53-test-reader', B = 'w53-reader-b', C = 'w53-reader-c', D = 'w53-reader-d', M = 'w53-moderator';
const SHOTS = 'test-results/w53';
const conv = (x, y) => [x, y].sort().join('_');

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
  const prof = (displayName, h, extra = {}) => ({ displayName, username: h, handle: h, readCount: 12, createdAt: Date.UTC(2026, 2, 14), ...extra });
  const rec = (uid, h, text, over = {}) => ({ text, authorUid: uid, authorName: h, authorHandle: h, createdAt: at(), ...over });
  await db.ref().set({
    users: {
      [A]: readerA || prof('Reader Ay', 'ay'), [B]: prof('Reader Bee', 'bee'), [C]: prof('Reader Cee', 'cee'),
      [D]: prof('Reader Dee', 'dee'), [M]: prof('Moderator Em', 'em', { canRemovePosts: true }),
    },
    usernames: { ay: A, bee: B, cee: C, dee: D, em: M },
    user_search: Object.fromEntries([[A, 'ay'], [B, 'bee'], [C, 'cee'], [D, 'dee'], [M, 'em']].map(([u, h]) => [u, { displayName: `Reader ${h}`, username: h }])),
    square_posts: {
      '-Pa': rec(A, 'ay', 'A post by Ay.'),
      '-Pc': rec(C, 'cee', 'A post by Cee, to be muted.'),
      '-Pc1': rec(C, 'cee', 'Cee replies on Ay\'s post', { parentId: '-Pa' }),
      '-Pd1': rec(D, 'dee', 'Dee answers Cee', { parentId: '-Pa', replyToId: '-Pc1' }),
      '-Pc2': rec(C, 'cee', 'a lone Cee reply', { parentId: '-Pa' }),
      '-Pmod': rec(B, 'bee', null, { withdrawn: true, withdrawnAt: 1, removedBy: 'moderator' }),
      '-Pmodr': rec(D, 'dee', 'reply under the removed post', { parentId: '-Pmod' }),
      '-Pauth': rec(B, 'bee', null, { withdrawn: true, withdrawnAt: 1, removedBy: 'author' }),
      '-Pauthr': rec(D, 'dee', 'reply under the withdrawn post', { parentId: '-Pauth' }),
      '-Pold': rec(B, 'bee', '', { withdrawn: true, withdrawnAt: 1 }),
      '-Poldr': rec(D, 'dee', 'reply under the older withdrawn post', { parentId: '-Pold' }),
    },
    notifications: {
      [A]: {
        n1: { type: 'square_reply', fromUid: C, fromName: 'Reader Cee', postId: '-Pc1', threadId: '-Pa', read: false, createdAt: OPEN - 1000 },
        n2: { type: 'square_reply', fromUid: D, fromName: 'Reader Dee', postId: '-Pd1', threadId: '-Pa', read: false, createdAt: OPEN - 900 },
      },
    },
    dm_messages: { [conv(A, C)]: { m1: { text: 'a message from Cee that Ay will report', senderUid: C, createdAt: OPEN - 5000 } } },
    dm_conversations: { [A]: { [conv(A, C)]: { unread: 1, lastAt: OPEN - 5000 } }, [C]: { [conv(A, C)]: { unread: 0, lastAt: OPEN - 5000 } } },
  });
}

async function open(page, path, { uid = A, at = OPEN, cookies = 'decline', route = {} } = {}) {
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
  if (cookies === 'decline') {
    const decline = page.getByRole('button', { name: /^decline$/i });
    try { await decline.waitFor({ timeout: 6000 }); await decline.click(); } catch {}
  }
  return errors;
}
const openFeed = async (page, opts) => {
  const errors = await open(page, '/square', opts);
  await expect(page.getByText('A post by Ay.')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('a[href="/profile"]').first()).toBeVisible();   // signed in
  await page.waitForTimeout(1000);
  return errors;
};
const openThread = async (page, id, opts) => {
  const errors = await open(page, `/square/p?id=${id}`, opts);
  await expect(page.locator('[data-thread-root]')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('[data-reply-bar]')).toBeVisible({ timeout: 30000 });
  return errors;
};
// A second page in the same tab: the clock shift and the session are already installed.
const gotoThread = async (page, id) => {
  await page.goto(`/square/p?id=${id}`);
  await expect(page.locator('[data-thread-root]')).toBeVisible({ timeout: 90000 });
};
const val = async (path) => (await db.ref(path).get()).val();

// The emulator takes an unsigned token in ?auth= and does not verify it.
const unsigned = (uid) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, iat: now, exp: now + 3600, aud: 'calvary-scribblings', iss: 'https://securetoken.google.com/calvary-scribblings', firebase: { sign_in_provider: 'custom' } })}.`;
};
const rest = async (method, uid, path, value) => {
  const q = uid ? `&auth=${unsigned(uid)}` : '';
  const res = await fetch(`http://127.0.0.1:9000/${path}.json?ns=${DB_NAMESPACE}${q}`, { method, body: value === undefined ? undefined : JSON.stringify(value) });
  return res.status;
};

async function cardFor(page, uid) {
  await page.locator(`[data-reader-open="${uid}"]`).first().click();
  const card = page.locator(`[data-reader-card="${uid}"]`);
  await expect(card).toBeVisible();
  return card;
}

test('the reader card: face, name, badge, handle and join month; Message, Profile; Mute and Block', async ({ page }) => {
  await reset();
  const errors = await openFeed(page);
  const card = await cardFor(page, C);
  await expect(card.locator('[data-card-handle]')).toHaveText('@cee · reading since March 2026');
  await expect(card.getByRole('button', { name: 'Message', exact: true })).toHaveCSS('background-color', 'rgb(107, 47, 173)');
  await expect(card.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', `/user?id=${C}`);
  await expect(card.locator('[data-card-action="mute"]')).toContainText('Mute in the Square');
  await expect(card.locator('[data-card-action="mute"]')).toContainText('Their posts stop showing for you. They won’t know.');
  await expect(card.locator('[data-card-action="block"]')).toContainText('Block @cee');
  await expect(card.locator('[data-card-action="block"]')).toHaveCSS('color', 'rgb(224, 134, 143)');
  expect((await card.getByRole('button', { name: 'Message', exact: true }).boundingBox()).height).toBe(44);
  expect((await card.getByRole('link', { name: 'Profile' }).boundingBox()).height).toBe(44);
  await page.keyboard.press('Escape');
  // your own card: Profile only
  const own = await cardFor(page, A);
  await expect(own.getByRole('link', { name: 'Profile' })).toBeVisible();
  await expect(own.getByRole('button', { name: 'Message', exact: true })).toHaveCount(0);
  await expect(own.locator('[data-card-action]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mute: their posts leave the feed, their replies hide (207), their notifications stop; messages do not', async ({ page }) => {
  await reset();
  await openFeed(page);
  await expect(page.getByText('A post by Cee, to be muted.')).toBeVisible();
  const card = await cardFor(page, C);
  await card.locator('[data-card-action="mute"]').click();
  await expect(card.locator('[data-card-action="mute"]')).toContainText('Unmute');
  await expect.poll(() => val(`muted_users/${A}/${C}`)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByText('A post by Cee, to be muted.')).toHaveCount(0);
  // the latest line on Ay's post skips Cee
  await expect(page.locator('[id="-Pa"] [data-thread-open="latest"]')).toContainText('Dee answers Cee');
  // notifications: Cee's is gone, Dee's stays
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.locator('[data-notification="n2"]')).toBeVisible();
  await expect(page.locator('[data-notification="n1"]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/muted-notifications.png` });

  // the thread: Cee's reply that holds up Dee's reads "A reply you've hidden."; the lone one is gone
  await gotoThread(page, '-Pa');
  await expect(page.locator('[id="r--Pc1"]')).toContainText('A reply you’ve hidden.');
  await expect(page.locator('[id="r--Pc1"] [data-reply-tombstone="hidden"]')).toBeVisible();
  await expect(page.locator('[id="r--Pc2"]')).toHaveCount(0);
  await expect(page.locator('[id="r--Pd1"]')).toContainText('Dee answers Cee');
  await expect(page.locator('[data-replies-count]')).toHaveText('1');
  // a mute never stops messages: Cee can still write to Ay
  expect(await rest('PUT', C, `dm_messages/${conv(A, C)}/m2`, { text: 'still allowed', senderUid: C, createdAt: Date.now() })).toBe(200);
});

test('block: the message barrier both ways, the words on each side, and messages again once unblocked', async ({ browser }) => {
  await reset();
  const ctxA = await browser.newContext({ serviceWorkers: 'block' });
  const ctxB = await browser.newContext({ serviceWorkers: 'block' });
  const pa = await ctxA.newPage(), pb = await ctxB.newPage();
  try {
    // Ay blocks Bee from the card
    await openFeed(pa);
    // open a conversation with Bee, then Bee's card from its header
    await pa.getByRole('button', { name: 'Messages' }).click();
    await pa.getByRole('button', { name: '+ New' }).click();
    await pa.getByPlaceholder(/Search by name/).fill('bee');
    await pa.locator('[data-messages-panel]').getByText('Reader bee', { exact: true }).click();
    await pa.locator('[data-messages-panel] button[data-reader-open]').last().click();
    const card = pa.locator(`[data-reader-card="${B}"]`);
    await card.locator('[data-card-action="block"]').click();
    await expect(card.locator('[data-card-action="block"]')).toContainText('Unblock @bee');
    await expect.poll(() => val(`blocked_users/${A}/${B}`)).toBe(true);
    await pa.keyboard.press('Escape');
    // the blocker's side
    const barrierA = pa.locator('[data-dm-barrier="blocker"]');
    await expect(barrierA).toContainText('You’ve blocked @bee.');
    await expect(barrierA.getByRole('button', { name: 'Unblock' })).toBeVisible();
    await expect(pa.getByPlaceholder('Message Reader Bee…')).toHaveCount(0);
    await pa.screenshot({ path: `${SHOTS}/blocker-side.png` });

    // the blocked reader tries to message Ay
    await openFeed(pb, { uid: B });
    await pb.getByRole('button', { name: 'Messages' }).click();
    await pb.getByRole('button', { name: '+ New' }).click();
    await pb.getByPlaceholder(/Search by name/).fill('ay');
    await pb.locator('[data-messages-panel]').getByText('Reader ay', { exact: true }).click();
    await pb.getByPlaceholder('Message Reader Ay…').fill('can you hear me');
    await pb.getByRole('button', { name: 'Send message' }).click();
    await expect(pb.locator('[data-dm-barrier="blocked"]')).toHaveText('You can’t message this reader.');
    await pb.screenshot({ path: `${SHOTS}/blocked-side.png` });
    expect(Object.values((await val(`dm_messages/${conv(A, B)}`)) || {})).toHaveLength(0);
    // and the other way, at the rules
    expect(await rest('PUT', A, `dm_messages/${conv(A, B)}/x`, { text: 'no', senderUid: A, createdAt: Date.now() })).toBe(401);
    expect(await rest('PATCH', B, `dm_conversations/${A}/${conv(A, B)}`, { unread: 1 })).toBe(401);

    // Unblock: messages flow again, both ways
    await barrierA.getByRole('button', { name: 'Unblock' }).click();
    await expect.poll(() => val(`blocked_users/${A}/${B}`)).toBe(null);
    await expect(pa.getByPlaceholder('Message Reader Bee…')).toBeVisible();
    await pa.getByPlaceholder('Message Reader Bee…').fill('hello again');
    await pa.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(async () => Object.values((await val(`dm_messages/${conv(A, B)}`)) || {}).map((m) => m.text)).toEqual(['hello again']);
    expect(await rest('PUT', B, `dm_messages/${conv(A, B)}/y`, { text: 'and back', senderUid: B, createdAt: Date.now() })).toBe(200);
  } finally {
    await ctxA.close(); await ctxB.close();
  }
});

test('the lists are their owner\'s alone; a blocked sender\'s notification is refused', async () => {
  await reset();
  await db.ref(`blocked_users/${A}/${B}`).set(true);
  await db.ref(`muted_users/${A}/${C}`).set(true);
  expect(await rest('GET', A, `blocked_users/${A}`)).toBe(200);
  expect(await rest('GET', A, `muted_users/${A}`)).toBe(200);
  for (const who of [B, C, D, null]) {
    expect(await rest('GET', who, `blocked_users/${A}`)).toBe(401);
    expect(await rest('GET', who, `muted_users/${A}`)).toBe(401);
  }
  const n = (from) => ({ type: 'square_reply', fromUid: from, fromName: 'x', postId: '-p', read: false, createdAt: Date.now() });
  expect(await rest('POST', B, `notifications/${A}`, n(B))).toBe(401);   // blocked
  expect(await rest('POST', D, `notifications/${A}`, n(D))).toBe(200);   // control
});

test('a reply from a blocked reader leaves no notification, and the reply itself still saves', async ({ page }) => {
  await reset();
  await db.ref(`blocked_users/${A}/${B}`).set(true);
  await openThread(page, '-Pa', { uid: B });
  await page.getByLabel('Reply', { exact: true }).fill('Bee replies to Ay');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => Object.values(await val('square_posts')).some((p) => p.text === 'Bee replies to Ay')).toBe(true);
  await page.waitForTimeout(1500);
  expect(Object.values((await val(`notifications/${A}`)) || {}).filter((x) => x.fromUid === B)).toHaveLength(0);
});

test('ruling 205: a post that fails waits at the top of the feed — Not sent, Try again, Remove writes nothing', async ({ page }) => {
  // W54: posts go through /api/square/write, which builds the author snapshot itself, so the
  // stale-username refusal this used can no longer happen. The failure is the Function answering
  // 502, as an outage would.
  await reset();
  await openFeed(page, { route: { fail: 502 } });
  const box = page.getByPlaceholder(/What's on your mind/);
  await box.fill('this post is refused');
  await page.getByRole('button', { name: /^Post$/i }).click();
  const card = page.locator('[data-post="unsent"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('this post is refused');
  await expect(box).toHaveValue('');
  await expect(card.getByText('Not sent.')).toHaveCSS('color', 'rgb(212, 83, 126)');
  await expect(card.locator('> div').first()).toHaveCSS('opacity', '0.5');
  // above every post
  const top = await page.evaluate(() => { const u = document.querySelector('[data-post="unsent"]'); const f = document.getElementById('-Pa'); return u.getBoundingClientRect().top < f.getBoundingClientRect().top; });
  expect(top).toBe(true);
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card).toHaveCount(1);
  const before = JSON.stringify(await val('square_posts'));
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card).toHaveCount(0);
  expect(JSON.stringify(await val('square_posts'))).toBe(before);
  expect(Object.values(await val('square_posts')).filter((p) => p.text === 'this post is refused')).toHaveLength(0);
});

test('ruling 206: "This post was removed." for a moderator; the author\'s words otherwise, older records included', async ({ page }) => {
  await reset();
  await openFeed(page);
  await expect(page.locator('[id="-Pmod"] [data-postbody="feed-post"]')).toHaveText('This post was removed.');
  await expect(page.locator('[id="-Pauth"] [data-postbody="feed-post"]')).toContainText('The author withdrew this post.');
  await expect(page.locator('[id="-Pold"] [data-postbody="feed-post"]')).toContainText('The author withdrew this post.');
  await gotoThread(page, '-Pmod');
  await expect(page.locator('[data-postbody="permalink"]')).toHaveText('This post was removed.');
});

test('report a message: pick one, give a reason; the record carries that message\'s snapshot', async ({ page }) => {
  await reset();
  await openFeed(page);
  await page.getByRole('button', { name: 'Messages' }).click();
  await page.locator(`[data-conversation="${conv(A, C)}"]`).click();
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await expect(page.getByText('Pick the message. A moderator sees only that one.').first()).toBeVisible();
  await page.getByRole('button', { name: /Report a message/ }).click();
  await page.locator('[data-message="m1"]').click();
  await page.getByLabel('Harassment').check();
  await page.getByRole('button', { name: /^Report$/ }).click();
  await expect(page.locator('[data-report-sheet]').getByRole('status')).toHaveText('Reported. A moderator sees only this message.');
  const r = await val(`content_reports/dm_${conv(A, C)}/${A}`);
  expect(r).toMatchObject({
    kind: 'dm', reason: 'harassment', reporterUid: A, offenderUid: C,
    contextPath: `dm_messages/${conv(A, C)}/m1`, snapshot: 'a message from Cee that Ay will report',
  });
});

test('messages draw the live identity components in the list and the header', async ({ page }) => {
  await reset();
  await openFeed(page);
  await page.getByRole('button', { name: 'Messages' }).click();
  const row = page.locator(`[data-conversation="${conv(A, C)}"]`);
  await expect(row.locator(`[data-reader-open="${C}"]`)).toBeVisible();          // the Avatar
  await expect(row).toContainText('Reader Cee');                               // users/{uid}, not a stored copy
  await row.click();
  await expect(page.locator('[data-messages-panel]').getByText('@cee')).toBeVisible();
  await page.locator('[data-messages-panel] button[data-reader-open]').last().click();
  await expect(page.locator(`[data-reader-card="${C}"]`)).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`the cookie notice covers nothing a reader needs, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await reset();
    await open(page, '/square/p?id=-Pa', { cookies: 'leave' });
    await expect(page.locator('[data-reply-bar]')).toBeVisible({ timeout: 90000 });
    await expect(page.locator('[data-cookie-notice]')).toBeVisible();
    const clear = async (locator) => locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === hit || el.contains(hit);
    });
    expect(await clear(page.getByRole('button', { name: 'Send' }))).toBe(true);
    expect(await clear(page.getByLabel('Reply', { exact: true }))).toBe(true);
    await page.screenshot({ path: `${SHOTS}/cookie-thread-${width}.png` });
    // the feed: the messages sheet's "+ New", its conversation box, and the reader card
    await page.goto('/square');
    await expect(page.getByText('A post by Ay.')).toBeVisible({ timeout: 90000 });
    await expect(page.locator('[data-cookie-notice]')).toBeVisible();
    await page.getByRole('button', { name: 'Messages' }).click();
    expect(await clear(page.getByRole('button', { name: '+ New' }))).toBe(true);
    await page.locator(`[data-conversation="${conv(A, C)}"]`).click();
    expect(await clear(page.getByRole('button', { name: 'Send message' }))).toBe(true);
    await page.screenshot({ path: `${SHOTS}/cookie-messages-${width}.png` });
    await page.getByRole('button', { name: 'Close messages' }).click();
    await page.locator(`[data-reader-open="${C}"]`).first().click();
    expect(await clear(page.locator('[data-card-action="block"]'))).toBe(true);
    await page.screenshot({ path: `${SHOTS}/cookie-card-${width}.png` });
  });
}
