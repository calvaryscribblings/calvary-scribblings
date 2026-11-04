// NOTIF-B2 — the bell, the panel, /notifications and /notifications/settings, proven in real pages
// against the EMULATOR, with screenshots at phone (390), iPad (820) and desktop (1440) widths,
// signed in and signed out, with zero, three and over 99 unread.
//
//   npm run test:notify:bell
//
//   · the header: signed-in only; left of the avatar from 768px, left of the menu below it
//   · the badge: none at zero, "3", "99+"; the aria-label
//   · the panel: five rows, NOTIFICATIONS + Settings, See all; opening writes seenAt and clears the
//     count; violet dots on what arrived since; Escape and a tap outside close it
//   · a phone's bell opens the page; the page reads the four sources, each event once, the blocked
//     and muted absent, FROM A WRITER YOU FOLLOW from the reader's own list, TODAY / THIS WEEK /
//     EARLIER; a sender-less note is "Calvary Scribblings"; one with no profile "Reader"
//   · the Square's bell opens the same list, with the same count; the Profile page links to it
//   · settings: the defaults, a switch writes notify_prefs, YOUR WRITING for writers only
//
// Invented emulator readers only, never a founder. Screenshots go to test-results/notif-b2/
// (git-ignored) and stay local. Nothing touches production.
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';
import { routeNotify } from '../square/write-route.mjs';

const app = adminApp('notif-b2-bell');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const SHOTS = 'test-results/notif-b2';
const A = 'nb2-reader-a', B = 'nb2-reader-b', C = 'nb2-reader-c', D = 'nb2-reader-d', E = 'nb2-reader-e';
const W = 'nb2-writer', M = 'nb2-muted', X = 'nb2-blocked', GONE = 'nb2-no-profile';
const WIDTHS = { phone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } };
const MIN = 60000, H = 60 * MIN, DAY = 24 * H;

// Real time: the page's clock is not shifted (a shifted Date stacked twice under next dev and put
// every item in the future). The Square draws its bell whether it is open or not.
const AT = Date.now();

const prof = (displayName, h, extra = {}) => ({ displayName, username: h, handle: h, readCount: 12, createdAt: Date.UTC(2026, 2, 14), ...extra });

/**
 * The world. `unread`: how many of A's items arrived after A's seenAt (0, 3, or 'many').
 * Without `unread` there's no seenAt at all.
 */
async function reset({ unread = 3, writerA = false } = {}) {
  const t = (minsAgo) => AT - minsAgo * MIN;
  const world = {
    users: {
      [A]: prof('Ada Reader', 'ada', writerA ? { isAuthor: true } : {}), [B]: prof('Ben Obi', 'ben'), [C]: prof('Cal Eze', 'cal'),
      [D]: prof('Dee Okafor', 'dee'), [E]: prof('Eve Nwosu', 'eve'), [W]: prof('Wren Writer', 'wren', { isAuthor: true }),
      [M]: prof('Muted Reader', 'mute'), [X]: prof('Blocked Reader', 'block'),
    },
    usernames: { ada: A, ben: B, cal: C, dee: D, eve: E, wren: W, mute: M, block: X },
    cms_stories_index: {
      'a-quiet-harbour': { title: 'A Quiet Harbour', author: 'Wren Writer', authorUid: W, cover: '/cs-logo-512-v3.png', category: 'short' },
      'the-long-field': { title: 'The Long Field', author: 'Wren Writer', authorUid: W, cover: '', category: 'short' },
    },
    following: { [A]: { [W]: true } },
    muted_users: { [A]: { [M]: true } },
    blocked_users: { [A]: { [X]: true } },
    inbox: {
      [A]: {
        'reply:a-quiet-harbour:-c2': { kind: 'reply', actor: B, subject: { slug: 'a-quiet-harbour', commentId: '-c2', parentId: '-c1' }, at: t(12) },
        'reaction:c:a-quiet-harbour:-c1': { kind: 'reaction', subject: { slug: 'a-quiet-harbour', commentId: '-c1' }, count: 5, actorCount: 5, actors: { [C]: 1, [B]: 1, [D]: 1, [E]: 1, [GONE]: 1 }, recent: [C, B, D], events: {}, firstAt: t(300), at: t(40) },
        [`message:${[A, D].sort().join('_')}`]: { kind: 'message', subject: { convId: [A, D].sort().join('_') }, count: 2, actorCount: 1, actors: { [D]: 2 }, recent: [D], events: {}, firstAt: t(90), at: t(70) },
        [`follow:${GONE}`]: { kind: 'follow', subject: { uid: GONE }, count: 1, actorCount: 1, actors: { [GONE]: 1 }, recent: [GONE], events: {}, firstAt: t(26 * 60), at: t(26 * 60) },
        'mention:sq:-p9': { kind: 'mention', actor: M, subject: { postId: '-p9', threadId: '-p9' }, at: t(5) },     // muted: absent
      },
    },
    announcements: {
      'story_a-quiet-harbour': { kind: 'story', id: 'a-quiet-harbour', authorUid: W, at: t(3 * 24 * 60) },
      'story_the-long-field': { kind: 'story', id: 'the-long-field', authorUid: B, at: t(10 * 24 * 60) },
    },
    library_notifications: {
      [A]: {
        '-old1': { type: 'reward', fromName: 'Calvary Scribblings', message: 'You earned 5 Scribbles — 10 stories read milestone!', read: true, createdAt: t(5 * 24 * 60) },
        '-old2': { type: 'new_story', fromUid: W, fromName: 'Wren Writer', storySlug: 'a-quiet-harbour', storyTitle: 'A Quiet Harbour', read: true, createdAt: t(3 * 24 * 60) }, // the announcement's copy
        'nb2:reply:a-quiet-harbour:-c2': { type: 'reply', fromUid: B, fromName: 'Ben Obi', slug: 'a-quiet-harbour', read: false, createdAt: t(12), nid: 'reply:a-quiet-harbour:-c2' }, // the mirror
        '-old3': { type: 'mention', fromUid: X, fromName: 'Blocked Reader', slug: 'a-quiet-harbour', read: false, createdAt: t(20) }, // blocked: absent
      },
    },
    notifications: {
      [A]: {
        '-sq1': { type: 'square_post', fromUid: B, fromName: 'Ben Obi', postId: '-p1', read: false, createdAt: t(8) },   // ruling 320: absent
        '-sq2': { type: 'square_quote', fromUid: E, fromName: 'stored name', postId: '-p2', quotedPostId: '-p1', read: true, createdAt: t(2 * 24 * 60) },
      },
    },
  };
  if (unread === 'many') {
    for (let i = 0; i < 120; i++) world.inbox[A][`mention:sq:-m${i}`] = { kind: 'mention', actor: B, subject: { postId: `-m${i}`, threadId: `-m${i}` }, at: t(1) - i };
  }
  // The four visible items newer than an hour: the reply (12m), the reaction group (40m), the
  // message (70m)… seenAt at 50 minutes ago leaves the reply and the reaction new; 80 adds the message.
  if (unread === 0) world.inbox_state = { [A]: { seenAt: AT } };
  if (unread === 3) world.inbox_state = { [A]: { seenAt: t(80) } };
  if (unread === 'many') world.inbox_state = { [A]: { seenAt: t(80) } };
  await db.ref().set(world);
}

async function open(page, path, { uid = A, size = 'desktop' } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.BELL_DEBUG) page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 300)));
  await page.setViewportSize(WIDTHS[size]);
  await routeNotify(page, { at: AT });
  await page.goto(path);
  if (uid) {
    await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
    await page.evaluate((tk) => window.__FB_EMULATOR_SIGNIN__(tk), await getAuth(app).createCustomToken(uid));
  }
  const decline = page.getByRole('button', { name: /^decline$/i });
  try { await decline.waitFor({ timeout: 5000 }); await decline.click(); } catch {}
  return errors;
}
const visibleBell = (page) => page.locator('[data-bell-button]:visible').first();
const val = async (p) => (await db.ref(p).get()).val();

test.describe.configure({ mode: 'serial' });

test('signed out: no bell anywhere in the header, at any width; the page and settings ask to sign in', async ({ page }) => {
  await reset();
  for (const size of Object.keys(WIDTHS)) {
    await open(page, '/about', { uid: null, size });
    await expect(page.locator('nav.cs-nav')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-bell-button]')).toHaveCount(0);
    await page.locator('nav.cs-nav').screenshot({ path: `${SHOTS}/header-signed-out-${size}.png` });
  }
  await open(page, '/notifications', { uid: null, size: 'phone' });
  await expect(page.locator('[data-signed-out]')).toContainText('Sign in to see your notifications.');
  await page.screenshot({ path: `${SHOTS}/page-signed-out-phone.png` });
  await open(page, '/notifications/settings', { uid: null, size: 'phone' });
  await expect(page.locator('[data-signed-out]')).toBeVisible();
});

for (const [unread, label, aria] of [[0, null, 'Notifications, 0 unread'], [3, '3', 'Notifications, 3 unread'], ['many', '99+', /Notifications, 1[0-9]{2} unread/]]) {
  test(`the header with ${unread === 'many' ? 'over 99' : unread} unread, at phone, iPad and desktop`, async ({ page }) => {
    await reset({ unread });
    for (const size of Object.keys(WIDTHS)) {
      await open(page, '/about', { size });
      const bell = visibleBell(page);
      await expect(bell).toBeVisible({ timeout: 60000 });
      await expect(bell).toHaveAttribute('aria-label', aria, { timeout: 30000 });
      if (label) await expect(bell.locator('[data-bell-badge]')).toHaveText(label);
      else await expect(bell.locator('[data-bell-badge]')).toHaveCount(0);
      // Placement: left of the avatar at 768+, left of the menu button on a phone.
      const bb = await bell.boundingBox();
      const nextTo = size === 'phone' ? page.locator('.cs-hamburger') : page.locator('.cs-nav-avatar');
      const nb = await nextTo.boundingBox();
      expect(bb.x + bb.width).toBeLessThanOrEqual(nb.x + 1);
      expect(nb.x - (bb.x + bb.width)).toBeLessThan(24);
      const circle = await bell.locator('[data-bell-circle]').boundingBox();
      expect(Math.round(circle.width)).toBe(size === 'phone' ? 31 : 36);
      expect(Math.round(bb.width)).toBe(44);
      // The header never overflows the screen.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.locator('nav.cs-nav').screenshot({ path: `${SHOTS}/header-${unread}-${size}.png` });
    }
  });
}

test('the panel (iPad and desktop): five rows, opening clears the count and keeps the dots, Escape and outside close', async ({ page }) => {
  for (const size of ['desktop', 'ipad']) {
    await reset({ unread: 3 });
    const errors = await open(page, '/about', { size });
    const bell = visibleBell(page);
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 3 unread', { timeout: 60000 });
    await bell.click();
    const panel = page.locator('[data-bell-panel]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('NOTIFICATIONS');
    await expect(panel.locator('[data-bell-settings]')).toHaveAttribute('href', '/notifications/settings');
    await expect(panel.locator('[data-bell-all]')).toHaveAttribute('href', '/notifications');
    await expect(panel.locator('[data-bell-row]')).toHaveCount(5);
    // Ruling 326: the count clears at once and seenAt is the page's now.
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 0 unread');
    await expect.poll(() => val(`inbox_state/${A}/seenAt`)).toBeGreaterThan(AT - MIN);
    await expect(panel.locator('[data-bell-row][data-fresh="true"]')).toHaveCount(3);
    await expect(panel.locator('[data-dot]')).toHaveCount(3);
    // The rows: live names, the grouped line, the house name never needed here.
    await expect(panel.locator('[data-bell-row="reply"]').first()).toContainText('Ben Obi replied to your response');
    await expect(panel.locator('[data-bell-row="reaction"]')).toContainText('Cal Eze and 4 others liked your response');
    await expect(panel.locator('[data-bell-row="message"]')).toContainText('Dee Okafor sent you 2 messages');
    const box = await panel.boundingBox();
    expect(Math.round(box.width)).toBe(Math.min(400, WIDTHS[size].width - 32));
    await page.screenshot({ path: `${SHOTS}/panel-${size}.png` });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await bell.click();
    await expect(panel).toBeVisible();
    await page.mouse.click(5, 300);   // the header's side gutter: no link there
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  }
});

test('the full page: a phone\'s bell opens it; four sources, each event once; the blocked and muted absent', async ({ page }) => {
  await reset({ unread: 3 });
  await open(page, '/about', { size: 'phone' });
  const bell = visibleBell(page);
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 3 unread', { timeout: 60000 });
  await bell.click();
  await page.waitForURL('**/notifications');
  const list = page.locator('[data-notifications-list]');
  await expect(list).toBeVisible({ timeout: 60000 });
  await expect.poll(() => val(`inbox_state/${A}/seenAt`)).toBeGreaterThan(AT - MIN);
  // Header.
  await expect(page.locator('[data-back]')).toHaveText('‹ HOME');
  await expect(page.locator('[data-settings-button]')).toHaveAttribute('href', '/notifications/settings');
  // Sections, in order.
  await expect(page.locator('[data-section]')).toHaveCount(3);
  expect(await page.locator('[data-section] > h2').allTextContents()).toEqual(['TODAY', 'THIS WEEK', 'EARLIER']);
  // Each event once: reply (inbox; its mirror hidden), reaction group, message group, follow,
  // two announcements (the old copy of the first hidden), the reward, the quote. Not: the muted
  // mention, the blocked mention, the square_post fan-out note.
  const rows = page.locator('[data-bell-row]');
  await expect(rows).toHaveCount(8);
  await expect(rows.filter({ hasText: 'Ben Obi replied to your response' })).toHaveCount(1);
  await expect(page.getByText('Muted Reader')).toHaveCount(0);
  await expect(page.getByText('Blocked Reader')).toHaveCount(0);
  await expect(page.locator('[data-bell-row="new_story"]')).toHaveCount(2);
  // 323: from the reader's own following list; the other story's writer isn't followed.
  const harbour = page.locator('[data-bell-row="new_story"]', { hasText: 'A Quiet Harbour' });
  await expect(harbour).toContainText('FROM A WRITER YOU FOLLOW');
  await expect(harbour).toContainText('A new story by Wren Writer');
  await expect(page.locator('[data-bell-row="new_story"]', { hasText: 'The Long Field' })).not.toContainText('FROM A WRITER YOU FOLLOW');
  // Sender-less: the house; a sender with no profile: "Reader". Never a stored name.
  await expect(page.locator('[data-bell-row="reward"]')).toContainText('Calvary Scribblings');
  await expect(page.locator('[data-bell-row="follow"]')).toContainText('Reader started following you');
  await expect(page.locator('[data-bell-row="square_quote"]')).toContainText('Eve Nwosu quoted your post');
  await expect(page.getByText('stored name')).toHaveCount(0);
  // Every row opens what it's about.
  for (const href of await rows.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) expect(href).toMatch(/^\/(stories|square|user|profile|series|open-pages)/);
  // The old notes on screen are marked read, as the old panels did, so the app's bells agree.
  await expect.poll(() => val(`notifications/${A}/-sq2/read`)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/page-phone.png`, fullPage: true });
  for (const size of ['ipad', 'desktop']) {
    await page.setViewportSize(WIDTHS[size]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/page-${size}.png`, fullPage: true });
  }
});

test('the Square\'s bell is the same list and the same count: panel on desktop, the page on a phone', async ({ page }) => {
  await reset({ unread: 3 });
  await open(page, '/square', { size: 'desktop' });
  const bell = visibleBell(page);
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 3 unread', { timeout: 90000 });
  await bell.click();
  const panel = page.locator('[data-bell-panel]');
  await expect(panel.locator('[data-bell-row]')).toHaveCount(5);
  await expect(panel.locator('[data-bell-row="reply"]').first()).toContainText('Ben Obi replied to your response');
  await page.screenshot({ path: `${SHOTS}/square-panel-desktop.png` });
  await page.keyboard.press('Escape');
  await reset({ unread: 3 });
  await open(page, '/square', { size: 'phone' });
  const phoneBell = visibleBell(page);
  await expect(phoneBell).toHaveAttribute('aria-label', 'Notifications, 3 unread', { timeout: 90000 });
  expect(Math.round((await phoneBell.locator('[data-bell-circle]').boundingBox()).width)).toBe(31);
  await phoneBell.click();
  await page.waitForURL('**/notifications');
  await expect(page.locator('[data-notifications-list]')).toBeVisible({ timeout: 60000 });
});

test('the Profile page: its panel is now a link to the one list, carrying the one count', async ({ page }) => {
  await reset({ unread: 3 });
  await open(page, '/profile', { size: 'desktop' });
  const link = page.locator('[data-profile-bell]');
  await expect(link).toHaveAttribute('href', '/notifications', { timeout: 90000 });
  await expect(link).toHaveAttribute('aria-label', 'Notifications, 3 unread', { timeout: 30000 });
  await expect(link.locator('[data-bell-badge]')).toHaveText('3');
});

test('settings: the defaults, a switch writes notify_prefs, YOUR WRITING for writers only', async ({ page }) => {
  await reset({ unread: 0 });
  for (const size of Object.keys(WIDTHS)) {
    await open(page, '/notifications/settings', { size });
    await expect(page.locator('[data-pref="stories"] [role="switch"]')).toBeEnabled({ timeout: 60000 });
    await expect(page.getByRole('heading', { name: 'Push notifications' })).toBeVisible();
    await expect(page.locator('[data-card="YOUR WRITING"]')).toHaveCount(0);
    await expect(page.locator('[data-pref="square_opens"] [role="switch"]')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-pref="reactions"] [role="switch"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-quiet-hours]')).toContainText('Nothing arrives between midnight and 08:00 London.');
    await page.screenshot({ path: `${SHOTS}/settings-${size}.png`, fullPage: true });
  }
  await page.locator('[data-pref="reactions"] [role="switch"]').click();
  await expect.poll(() => val(`notify_prefs/${A}/reactions`)).toBe(false);
  await page.locator('[data-pref="square_opens"] [role="switch"]').click();
  await expect.poll(() => val(`notify_prefs/${A}/square_opens`)).toBe(true);
  await page.reload();
  await expect(page.locator('[data-pref="reactions"] [role="switch"]')).toHaveAttribute('aria-checked', 'false', { timeout: 60000 });

  await reset({ unread: 0, writerA: true });
  await open(page, '/notifications/settings', { size: 'phone' });
  await expect(page.locator('[data-card="YOUR WRITING"]')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-pref="responses"]')).toContainText('grouped, at most once an hour for each story');
  await page.screenshot({ path: `${SHOTS}/settings-writer-phone.png`, fullPage: true });
});
