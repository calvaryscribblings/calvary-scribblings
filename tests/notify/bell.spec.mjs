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
//   · settings (ruling 337, P4 switch-on): STORIES and PEOPLE drawn, YOUR WRITING for writers, the Square held; switches write notify_prefs
//
// Invented emulator readers only, never a founder. Screenshots go to test-results/notif-b2/
// (git-ignored) and stay local. Nothing touches production.
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';
import { routeNotify } from '../square/write-route.mjs';
import { bellInstant, runnerNow, londonDate } from './bell-clock.mjs';

const app = adminApp('notif-b2-bell');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const SHOTS = 'test-results/notif-b2';
const A = 'nb2-reader-a', B = 'nb2-reader-b', C = 'nb2-reader-c', D = 'nb2-reader-d', E = 'nb2-reader-e';
const W = 'nb2-writer', M = 'nb2-muted', X = 'nb2-blocked', GONE = 'nb2-no-profile';
const WIDTHS = { phone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } };
const MIN = 60000, H = 60 * MIN, DAY = 24 * H;

// One instant, AT, dates every fixture, and the page's clock is PINNED to it with Playwright's
// page.clock.setFixedTime (BELL-1, after SAFETY-2B.1). Pinned, not shifted: the old relative shift of
// Date stacked twice under next dev and put every item in the future, while a fixed time set twice is
// the same time, and pinned() below asserts it after every load. AT is the real time unless London's
// day is too young to hold the TODAY fixtures (the first ~90 minutes after midnight, when this spec
// failed), and then the evening before: tests/notify/bell-clock.mjs, which imports nothing (an app
// import here broke Playwright's loader on CI's Node 22). The Square draws its bell whether it is
// open or not.
const AT = bellInstant(runnerNow());
// The fixtures meant for TODAY (minutes before AT; the oldest is the reaction group's firstAt), checked
// before anything is drawn: a wrong AT fails here, by name. tests/ci/bell-clock.test.mjs proves the
// same against the page's own sectionOf.
const TODAY_MINUTES = [1, 3, 5, 8, 12, 20, 36, 40, 70, 80, 90, 300];
const london = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'medium' });
console.log(`bell spec: runner ${london(runnerNow())} London, page pinned at ${london(AT)} London`);
for (const m of TODAY_MINUTES) {
  if (londonDate(AT - m * MIN) !== londonDate(AT)) throw new Error(`bell spec: a fixture ${m} minutes before its instant is not TODAY in London`);
}

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
  await page.setViewportSize(typeof size === 'object' ? size : WIDTHS[size]);
  await page.clock.setFixedTime(AT);
  await routeNotify(page, { at: AT });
  await page.goto(path);
  await pinned(page);
  if (uid) {
    await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
    await page.evaluate((tk) => window.__FB_EMULATOR_SIGNIN__(tk), await getAuth(app).createCustomToken(uid));
  }
  const decline = page.getByRole('button', { name: /^decline$/i });
  try { await decline.waitFor({ timeout: 5000 }); await decline.click(); } catch {}
  return errors;
}
/** The page's clock is AT exactly: pinned once or five times, never stacked. */
async function pinned(page) {
  expect(await page.evaluate(() => Date.now()), 'the page clock is not the spec\'s instant').toBe(AT);
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
  await pinned(page);
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
  await expect(harbour).toContainText('New short story by Wren Writer');
  await expect(page.locator('[data-bell-row="reaction"]')).toContainText('on A Quiet Harbour');
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
    await page.setViewportSize(typeof size === 'object' ? size : WIDTHS[size]);
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
  await pinned(page);
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

test('settings (ruling 337, P4 switch-on): STORIES and PEOPLE are drawn, YOUR WRITING for writers only, THE SQUARE held; switches write notify_prefs', async ({ page }) => {
  await reset({ unread: 0 });
  for (const size of Object.keys(WIDTHS)) {
    await open(page, '/notifications/settings', { size });
    await expect(page.locator('[data-pref="stories"] [role="switch"]')).toBeEnabled({ timeout: 60000 });
    await expect(page.getByRole('heading', { name: 'Push notifications' })).toBeVisible();
    await expect(page.locator('[data-pref="stories"] [role="switch"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-card]')).toHaveCount(2);
    for (const hidden of ['YOUR WRITING', 'THE SQUARE']) await expect(page.locator(`[data-card="${hidden}"]`)).toHaveCount(0);
    await expect(page.locator('main h2')).toHaveText(['STORIES', 'PEOPLE']);
    await expect(page.locator('[data-card="PEOPLE"] [data-pref]')).toHaveCount(4);
    for (const key of ['replies_mentions', 'messages', 'followers', 'reactions']) {
      await expect(page.locator(`[data-pref="${key}"] [role="switch"]`)).toHaveAttribute('aria-checked', 'true');
    }
    await expect(page.locator('[data-quiet-hours]')).toHaveText('Messages, replies and mentions reach you at any hour. Anything else that comes between midnight and 08:00 London waits until 08:00, when the first three arrive. The rest stay in your notifications.');
    await page.screenshot({ path: `${SHOTS}/settings-${size}.png`, fullPage: true });
  }
  await page.locator('[data-pref="stories"] [role="switch"]').click();
  await expect.poll(() => val(`notify_prefs/${A}/stories`)).toBe(false);
  await page.locator('[data-pref="messages"] [role="switch"]').click();
  await expect.poll(() => val(`notify_prefs/${A}/messages`)).toBe(false);
  await page.reload();
  await expect(page.locator('[data-pref="stories"] [role="switch"]')).toHaveAttribute('aria-checked', 'false', { timeout: 60000 });
  await expect(page.locator('[data-pref="messages"] [role="switch"]')).toHaveAttribute('aria-checked', 'false');

  await reset({ unread: 0, writerA: true });
  await open(page, '/notifications/settings', { size: 'phone' });
  await expect(page.locator('[data-pref="stories"] [role="switch"]')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('main h2')).toHaveText(['STORIES', 'PEOPLE', 'YOUR WRITING'], { timeout: 60000 });
  await expect(page.locator('[data-card="THE SQUARE"]')).toHaveCount(0);
  await page.locator('[data-pref="responses"] [role="switch"]').click();
  await expect.poll(() => val(`notify_prefs/${A}/responses`)).toBe(false);
  await page.screenshot({ path: `${SHOTS}/settings-writer-phone.png`, fullPage: true });
});

// ── NOTIF-B2 ship: the bell measured against the design, from the page's own boxes ────────────
// At 360, 390, 820, 1180 and 1440. Every figure comes from getBoundingClientRect (or computed
// style), never from a screenshot. The table goes to test-results/notif-b2/geometry.json.
const GEOMETRY_WIDTHS = [[360, 780], [390, 844], [820, 1180], [1180, 820], [1440, 900]];
const near = (a, b, tol = 0.51) => Math.abs(a - b) <= tol;

test('geometry: the bell, the badge, the panel and the rows, measured at five widths', async ({ page }) => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  await reset({ unread: 3 });
  const table = [];
  for (const [width, height] of GEOMETRY_WIDTHS) {
    const phone = width < 768;
    await reset({ unread: 3 });   // opening the panel clears the count (ruling 326)
    await open(page, '/about', { size: { width, height } });
    const bell = visibleBell(page);
    await expect(bell).toHaveAttribute('data-unread', '3', { timeout: 90000 });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate((isPhone) => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };
      const btn = [...document.querySelectorAll('[data-bell-button]')].find((e) => e.offsetParent);
      const neighbour = document.querySelector(isPhone ? '.cs-hamburger' : '.cs-nav-avatar');
      const out = { target: r(btn), circle: r(btn.querySelector('[data-bell-circle]')), badge: r(btn.querySelector('[data-bell-badge]')), neighbour: r(neighbour), vw: window.innerWidth, pageScroll: document.documentElement.scrollWidth > window.innerWidth };
      if (isPhone) {
        const title = document.querySelector('.cs-logo-title'), sub = document.querySelector('.cs-logo-sub');
        out.title = { ...r(title), clipped: title.scrollWidth > title.clientWidth + 0.5 };
        out.sub = { ...r(sub), clipped: sub.scrollWidth > sub.clientWidth + 0.5 };
      }
      return out;
    }, phone);
    const row = {
      width, mode: phone ? 'phone' : 'panel',
      target: `${m.target.w}×${m.target.h}`, circle: `${m.circle.w}×${m.circle.h}`,
      circleOffInTarget: [+(m.circle.cx - m.target.cx).toFixed(2), +(m.circle.cy - m.target.cy).toFixed(2)],
      centreLineVsNeighbour: +(m.circle.cy - m.neighbour.cy).toFixed(2),
      badgeH: m.badge.h, badgeAbove: +(m.circle.y - m.badge.y).toFixed(2), badgeRight: +(m.badge.r - m.circle.r).toFixed(2),
      pageScroll: m.pageScroll,
    };
    expect.soft(m.target.w).toBe(44); expect.soft(m.target.h).toBe(44);
    expect.soft(m.circle.w).toBe(phone ? 31 : 36);
    expect.soft(near(m.circle.cx, m.target.cx) && near(m.circle.cy, m.target.cy)).toBe(true);
    expect.soft(near(m.circle.cy, m.neighbour.cy)).toBe(true);
    expect.soft(m.badge.h).toBe(17);
    expect.soft(near(m.circle.y - m.badge.y, 5)).toBe(true);
    expect.soft(near(m.badge.r - m.circle.r, 7)).toBe(true);
    expect.soft(m.pageScroll).toBe(false);
    if (phone) {
      row.titleGap = +(m.target.x - m.title.r).toFixed(2); row.subGap = +(m.target.x - m.sub.r).toFixed(2);
      row.clipped = m.title.clipped || m.sub.clipped;
      expect.soft(m.title.r).toBeLessThanOrEqual(m.target.x);
      expect.soft(m.sub.r).toBeLessThanOrEqual(m.target.x);
      expect.soft(row.clipped).toBe(false);
    } else {
      await bell.click();
      const panel = page.locator('[data-bell-panel]');
      await expect(panel.locator('[data-bell-row]').first()).toBeVisible({ timeout: 60000 });
      const p = await page.evaluate(() => {
        const el = document.querySelector('[data-bell-panel]');
        const b = el.getBoundingClientRect();
        // The header's last item: its rightmost visible link or button (at every desktop width the
        // menu button, after the avatar), measured independently of the bell's own lastItemRight.
        const items = [...document.querySelector('nav.cs-nav').querySelectorAll('a, button')].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0; });
        const lastEl = items.reduce((a, e) => (e.getBoundingClientRect().right > a.getBoundingClientRect().right ? e : a));
        const last = lastEl.getBoundingClientRect();
        const rows = [...el.querySelectorAll('[data-bell-row]')];
        const faces = rows.flatMap((x) => [...x.querySelectorAll('[data-face]')].filter((f) => !f.closest('[data-grouped]'))).map((f) => f.getBoundingClientRect().width);
        const badges = rows.flatMap((x) => [...x.querySelectorAll('[data-kind-badge]')]).map((f) => f.getBoundingClientRect().width);
        const dots = [...el.querySelectorAll('[data-dot]')].map((f) => f.getBoundingClientRect().width);
        return { w: b.width, right: b.right, lastRight: last.right, lastItem: lastEl.className || lastEl.getAttribute('aria-label') || lastEl.tagName, radius: getComputedStyle(el).borderTopLeftRadius, vw: window.innerWidth, faces, badges, dots };
      });
      Object.assign(row, { panelW: p.w, panelPctOfScreen: +((100 * p.w) / p.vw).toFixed(1), panelRadius: p.radius, lastItem: p.lastItem, panelRightVsLastItem: +(p.right - p.lastRight).toFixed(2),
        panelFaces: [...new Set(p.faces)], panelKindBadges: [...new Set(p.badges)], panelDots: [...new Set(p.dots)] });
      console.log('[geometry]', JSON.stringify(row));
      expect.soft(p.w).toBe(Math.min(400, p.vw * 0.92));
      expect.soft(p.radius).toBe('16px');
      expect.soft(near(p.right, p.lastRight)).toBe(true);
      expect.soft(row.panelFaces).toEqual([36]); expect.soft(row.panelKindBadges).toEqual([16]); expect.soft(row.panelDots).toEqual([7]);
      await page.keyboard.press('Escape');
    }
    table.push(row);
  }
  // The page: avatars 40, kind badges 18, the dot 7, covers 31×46 (at a phone and a desktop width).
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await reset({ unread: 3 });
    await open(page, '/notifications', { size: { width, height } });
    await expect(page.locator('[data-bell-row="new_story"] [data-cover]').first()).toBeVisible({ timeout: 90000 });
    const g = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-notifications-list] [data-bell-row]')];
      const w = (els) => [...new Set(els.map((f) => f.getBoundingClientRect().width))];
      return {
        faces: w(rows.flatMap((x) => [...x.querySelectorAll('[data-face]')].filter((f) => !f.closest('[data-grouped]')))),
        badges: w(rows.flatMap((x) => [...x.querySelectorAll('[data-kind-badge]')])),
        dots: w([...document.querySelectorAll('[data-notifications-list] [data-dot]')]),
        covers: [...new Set([...document.querySelectorAll('[data-notifications-list] [data-cover]')].map((c) => `${c.getBoundingClientRect().width}×${c.getBoundingClientRect().height}`))],
      };
    });
    table.push({ width, mode: 'page', pageFaces: g.faces, pageKindBadges: g.badges, pageDots: g.dots, covers: g.covers });
    expect.soft(g.faces).toEqual([40]); expect.soft(g.badges).toEqual([18]); expect.soft(g.dots).toEqual([7]); expect.soft(g.covers).toEqual(['31×46']);
  }
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/geometry.json`, JSON.stringify(table, null, 2));
  console.log(JSON.stringify(table));
});

// ── Ruling 337: the settings page shows only what works, measured at 390 and 1180 ──────────────
// The STORIES card's margins, radius and switch, and the gap from the last card to the moon note,
// from the page's own boxes. The table goes to test-results/notif-b2/settings-geometry.json.
test('settings geometry: the STORIES card and the gap below the last card, at 390 and 1180', async ({ page }) => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const table = [];
  for (const [width, height] of [[390, 844], [1180, 820]]) {
    for (const writerA of [false, true]) {
      await reset({ unread: 0, writerA });
      await open(page, '/notifications/settings', { size: { width, height } });
      await expect(page.locator('[data-pref="stories"] [role="switch"]')).toBeEnabled({ timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      const g = await page.evaluate(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
        const cards = [...document.querySelectorAll('[data-card]')];
        const stories = document.querySelector('[data-card="STORIES"]');
        const box = stories.querySelector(':scope > div');
        const cs = getComputedStyle(stories), bs = getComputedStyle(box);
        const h2 = stories.querySelector('h2');
        const sw = stories.querySelector('[role="switch"]');
        const note = document.querySelector('[data-quiet-hours]');
        const last = cards[cards.length - 1].querySelector(':scope > div');
        return {
          cards: cards.map((c) => c.dataset.card),
          headings: [...document.querySelectorAll('main h2')].map((h) => h.textContent),
          section: { ...r(stories), marginBottom: cs.marginBottom },
          heading: { ...r(h2), margin: getComputedStyle(h2).margin },
          box: { ...r(box), radius: bs.borderRadius, border: bs.border },
          switch: r(sw),
          lastCardToNote: note.getBoundingClientRect().y - last.getBoundingClientRect().bottom,
          // the column's own bottom padding below the note (main is min-height 100vh, so its edge moves with the viewport)
          noteToEnd: note.parentElement.getBoundingClientRect().bottom - note.getBoundingClientRect().bottom,
          pageScroll: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      table.push({ width, writer: writerA, ...g });
      // Ruling 337 at P4 switch-on: STORIES and PEOPLE, and YOUR WRITING for a writer; never THE
      // SQUARE (P7). The STORIES card as it measured with all four drawn (x 20/330, 350/520 wide,
      // radius 22, 22 below, switch 51×31), and the last card to the moon note still 28: no stray
      // heading, no gap where the held card was.
      const drawn = writerA ? ['STORIES', 'PEOPLE', 'YOUR WRITING'] : ['STORIES', 'PEOPLE'];
      expect.soft(g.cards).toEqual(drawn);
      expect.soft(g.headings).toEqual(drawn);
      expect.soft(g.section.x).toBe(width === 390 ? 20 : 330);
      expect.soft(g.section.w).toBe(width === 390 ? 350 : 520);
      expect.soft(g.section.marginBottom).toBe('22px');
      expect.soft(g.heading.margin).toBe('0px 0px 10px 6px');
      expect.soft(g.box.radius).toBe('22px');
      expect.soft(g.box.h).toBe(78);
      expect.soft([g.switch.w, g.switch.h]).toEqual([51, 31]);
      expect.soft(g.switch.r).toBe(width === 390 ? 351 : 831);
      expect.soft(g.lastCardToNote).toBe(28);
      expect.soft(g.noteToEnd).toBe(56);
      expect.soft(g.pageScroll).toBe(false);
      await page.screenshot({ path: `${SHOTS}/settings-337-${width}${writerA ? '-writer' : ''}.png`, fullPage: true });
    }
  }
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/settings-geometry.json`, JSON.stringify(table, null, 2));
  console.log(JSON.stringify(table));
});

// ── BELL-1: every row drawn to Ikenna's approved canvas ("Web · iPad, bell open", and the canvas's
// list for /notifications), measured from the rendered page. The measurer reads the row's own
// structure (the dot, then the picture box, then the words, then the time), so it measures the old
// rows and the new ones alike; the numbers are DESIGN's (the BELL-1 brief). Each kind's badge colour
// and glyph, the tiles, the badge's size and place, the dot's place, new against seen, and the row's
// own numbers, in the panel at 1024 and on the page at 390 and 1024. Tables go to
// test-results/notif-b2/canvas-*.json.

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const G = {
  heart: 'M12 20.5s-7.5-4.6-7.5-10.4A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z',
  arrow: 'M10 7L5 12l5 5 M5 12h9a5 5 0 0 1 5 5v1',
  at: 'circle 12,12,3.5 | M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7',
  bubble: 'M5 5h14v10H10l-5 4z',
  message: 'M4 5h16v11H11l-5 4v-4H4z',
  follow: 'circle 9,8,3.5 | M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5 M18 8v6M15 11h6',
  book: 'M3.5 6c2.8-1.2 5.8-1 8.5 1 2.7-2 5.7-2.2 8.5-1v12.5c-2.8-1.2-5.8-1-8.5 1-2.7-2-5.7-2.2-8.5-1z M12 7v12.5',
  diamond: 'M12 3.5l8.5 8.5-8.5 8.5L3.5 12z',
  feather: 'M19.5 4.5C13 5 8.5 9.5 7 16l-1.5 3.5 M19.5 4.5c.4 5.6-3 10-9.8 11.3 M8.6 12.6h6',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
};
const BADGE_OF = {
  reply: ['#6E45C8', 'arrow'], mention: ['#6E45C8', 'at'], response: ['#6E45C8', 'bubble'], quote: ['#6E45C8', 'bubble'],
  reaction: ['#A92339', 'heart'], story_reaction: ['#A92339', 'heart'],
  message: ['#4A5578', 'message'], follow: ['#4A5578', 'follow'], new_story: ['#C9A84C', 'book'],
};
const TILE_OF = {
  square_opens: { tile: 'diamond', ground: '#1A1728', ring: '#2A2640', ink: '#C9A84C', stroke: 1.8 },
  open_pages_live: { tile: 'feather', ground: '#1C1A26', ring: '#2A2640', ink: '#EFE8DA', stroke: 1.7 },
  tier_up: { tile: 'star', ground: '#241E10', ring: '#4A3D1C', ink: '#C9A84C', stroke: 1.7 },
};
const SPEC = {
  panel: { pad: '13px 18px 13px 24px', gap: 13, border: '#1E1B29', fresh: '#1A1626', seen: '#14121C', dot: [9, 29], box: 38, face: [36, 1], pair: [26, 11], cover: [28, 42], tileGlyph: 16, badge: 16, badgeGlyph: 9, size: 16, size2: 14.5, gap2: 2, timePad: 3, timeSpacing: 'normal' },
  page: { pad: '14px 18px 14px 26px', gap: 14, border: '#16141F', fresh: '#100D1B', seen: null, dot: [10, 32], box: 44, face: [40, 2], pair: [30, 13], cover: [31, 46], tileGlyph: 18, badge: 18, badgeGlyph: 10, size: 17, size2: 15.5, gap2: 3, timePad: 4, timeSpacing: '0.44px' },
};

/** Every kind once, `order` newest first; the first three arrived since the last look. */
async function resetCanvas(order) {
  const ago = (i) => AT - (i + 1) * 3 * MIN;
  const at = Object.fromEntries(order.map((k, i) => [k, ago(i)]));
  const conv = [A, D].sort().join('_');
  const inbox = {
    reply: ['reply:a-quiet-harbour:-c2', { kind: 'reply', actor: B, subject: { slug: 'a-quiet-harbour', commentId: '-c2', parentId: '-c1' } }],
    mention: ['mention:sq:-p3', { kind: 'mention', actor: C, subject: { postId: '-p3', threadId: '-p3' } }],
    quote: ['quote:sq:-p4', { kind: 'quote', actor: E, subject: { postId: '-p4', threadId: '-p4' } }],
    response: ['response:a-quiet-harbour', { kind: 'response', subject: { slug: 'a-quiet-harbour' }, count: 2, actorCount: 2, actors: { [D]: 1, [C]: 1 }, recent: [D, C], events: {} }],
    story_reaction: ['story_reaction:the-long-field', { kind: 'story_reaction', subject: { slug: 'the-long-field' }, count: 1, actorCount: 1, actors: { [B]: 1 }, recent: [B], events: {} }],
    reaction: ['reaction:c:a-quiet-harbour:-c1', { kind: 'reaction', subject: { slug: 'a-quiet-harbour', commentId: '-c1' }, count: 2, actorCount: 2, actors: { [C]: 1, [B]: 1 }, recent: [C, B], events: {} }],
    message: [`message:${conv}`, { kind: 'message', subject: { convId: conv }, count: 1, actorCount: 1, actors: { [D]: 1 }, recent: [D], events: {} }],
    follow: [`follow:${E}`, { kind: 'follow', subject: { uid: E }, count: 1, actorCount: 1, actors: { [E]: 1 }, recent: [E], events: {} }],
    square_opens: ['square_opens:1', { kind: 'square_opens', subject: {} }],
    open_pages_live: ['open_pages_live:1', { kind: 'open_pages_live', subject: {} }],
    tier_up: ['tier_up:1', { kind: 'tier_up', subject: { tier: 'gold' } }],
  };
  const box = {};
  for (const [k, [key, rec]] of Object.entries(inbox)) box[key] = { ...rec, at: at[k], ...(rec.recent ? { firstAt: at[k] } : {}) };
  await db.ref().set({
    users: { [A]: prof('Ada Reader', 'ada'), [B]: prof('Ben Obi', 'ben'), [C]: prof('Cal Eze', 'cal'), [D]: prof('Dee Okafor', 'dee'), [E]: prof('Eve Nwosu', 'eve'), [W]: prof('Wren Writer', 'wren', { isAuthor: true }) },
    usernames: { ada: A, ben: B, cal: C, dee: D, eve: E, wren: W },
    cms_stories_index: {
      'a-quiet-harbour': { title: 'A Quiet Harbour', author: 'Wren Writer', authorUid: W, cover: '/cs-logo-512-v3.png', category: 'short' },
      'the-long-field': { title: 'The Long Field', author: 'Wren Writer', authorUid: W, cover: '', category: 'short' },
    },
    comments: { 'a-quiet-harbour': { '-c2': { text: 'What a line.', authorUid: B, authorName: 'x', createdAt: at.reply } } },
    square_posts: { '-p3': { text: '@ada look at this', authorUid: C, createdAt: at.mention } },
    following: { [A]: { [W]: true } },
    inbox: { [A]: box },
    announcements: { 'story_a-quiet-harbour': { kind: 'story', id: 'a-quiet-harbour', authorUid: W, at: at.new_story } },
    inbox_state: { [A]: { seenAt: AT - 10.5 * MIN } },
  });
}
const KINDS = ['reply', 'mention', 'quote', 'response', 'story_reaction', 'reaction', 'message', 'follow', 'new_story', 'square_opens', 'open_pages_live', 'tier_up'];

/** Each row as drawn: its box, its picture, its badge, its words and its time, relative to the row. */
const measureRows = (sel) => {
  const box = (el, o) => { const b = el.getBoundingClientRect(); return { x: +(b.left - o.left).toFixed(2), y: +(b.top - o.top).toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2), r: +(b.right - o.left).toFixed(2), b: +(b.bottom - o.top).toFixed(2) }; };
  const cs = (el) => getComputedStyle(el);
  const glyph = (svg) => (svg ? [...svg.querySelectorAll('path, circle')].map((e) => (e.tagName === 'circle' ? `circle ${e.getAttribute('cx')},${e.getAttribute('cy')},${e.getAttribute('r')}` : e.getAttribute('d'))).join(' | ') : null);
  const ink = (svg) => {
    const e = svg && svg.querySelector('path, circle');
    if (!e) return null;
    const s = cs(e);
    return { fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, cap: s.strokeLinecap, join: s.strokeLinejoin, size: +svg.getBoundingClientRect().width.toFixed(2) };
  };
  return [...document.querySelectorAll(sel)].map((row) => {
    const o = row.getBoundingClientRect();
    const s = cs(row);
    const kids = [...row.children];
    const dot = row.querySelector(':scope > [data-dot]');
    const pic = kids.find((k) => !k.hasAttribute('data-dot'));
    const text = kids[kids.indexOf(pic) + 1];
    const time = kids[kids.length - 1];
    const lines = [...text.children];
    const badge = row.querySelector('[data-kind-badge]');
    const tile = row.querySelector('[data-tile]');
    const cover = row.querySelector('[data-cover]');
    const faces = [...pic.querySelectorAll('[data-face]')];
    const name = lines[0].querySelector('b');
    const p = box(pic, o);
    return {
      kind: row.getAttribute('data-bell-row'), fresh: row.getAttribute('data-fresh') === 'true',
      pad: s.padding, gap: parseFloat(s.columnGap), align: s.alignItems, ground: s.backgroundColor,
      border: `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}`,
      dot: dot ? { ...box(dot, o), bg: cs(dot).backgroundColor } : null,
      pic: p,
      faces: faces.map((f) => ({ ...box(f, pic.getBoundingClientRect()), ring: cs(f).boxShadow })),
      cover: cover ? { ...box(cover, pic.getBoundingClientRect()), radius: cs(cover).borderTopLeftRadius, bg: cs(cover).backgroundColor } : null,
      tile: tile ? { ...box(tile, pic.getBoundingClientRect()), name: tile.getAttribute('data-tile'), radius: cs(tile).borderTopLeftRadius, bg: cs(tile).backgroundColor, ring: cs(tile).boxShadow, glyph: glyph(tile.querySelector('svg')), ink: ink(tile.querySelector('svg')) } : null,
      badge: badge ? {
        ...box(badge, o), dr: +(badge.getBoundingClientRect().right - pic.getBoundingClientRect().right).toFixed(2), db: +(badge.getBoundingClientRect().bottom - pic.getBoundingClientRect().bottom).toFixed(2),
        bg: cs(badge).backgroundColor, ring: cs(badge).boxShadow, radius: cs(badge).borderTopLeftRadius, glyph: glyph(badge.querySelector('svg')), ink: ink(badge.querySelector('svg')),
      } : null,
      // The words as drawn: a Range over the line's text, so words that run past their box (a
      // white-space: nowrap from above) show, which the box alone hides.
      inkRight: (() => { const rg = document.createRange(); rg.selectNodeContents(text); return +(rg.getBoundingClientRect().right - o.left).toFixed(2); })(),
      timeLeft: +(time.getBoundingClientRect().left - o.left).toFixed(2),
      ws: cs(lines[0]).whiteSpace,
      // Where a nowrap comes from: the outermost ancestor that sets it.
      nowrapFrom: (() => { let e = row, from = null; while (e && e !== document.body) { if (cs(e).whiteSpace === 'nowrap' && (!e.parentElement || cs(e.parentElement).whiteSpace !== 'nowrap')) from = `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}${e.getAttribute('style') && /nowrap/.test(e.getAttribute('style')) ? '[inline]' : ''}`; e = e.parentElement; } return from; })(),
      line1: { ...box(lines[0], o), family: cs(lines[0]).fontFamily, size: parseFloat(cs(lines[0]).fontSize), lh: parseFloat(cs(lines[0]).lineHeight), color: cs(lines[0]).color, name: name ? { color: cs(name).color, weight: cs(name).fontWeight } : null },
      line2: lines[1] && !lines[1].hasAttribute('data-followed') && lines[1].textContent && !/^FROM A WRITER/.test(lines[1].textContent) ? { ...box(lines[1], o), size: parseFloat(cs(lines[1]).fontSize), lh: parseFloat(cs(lines[1]).lineHeight), style: cs(lines[1]).fontStyle, color: cs(lines[1]).color, text: lines[1].textContent, clamp: cs(lines[1]).webkitLineClamp } : null,
      followed: (() => { const f = lines.find((l) => /^FROM A WRITER/.test(l.textContent)); if (!f) return null; const prev = lines[lines.indexOf(f) - 1]; return { gap: +(f.getBoundingClientRect().top - prev.getBoundingClientRect().bottom).toFixed(2), size: parseFloat(cs(f).fontSize), spacing: cs(f).letterSpacing, color: cs(f).color, weight: cs(f).fontWeight, family: cs(f).fontFamily }; })(),
      time: { family: cs(time).fontFamily, weight: cs(time).fontWeight, size: parseFloat(cs(time).fontSize), color: cs(time).color, spacing: cs(time).letterSpacing, padTop: cs(time).paddingTop, wrap: cs(time).whiteSpace },
    };
  });
};

/** DESIGN, row by row: the failures as strings, so the table and the list of drifts are one thing. */
function canvasDrifts(rows, where, pageGround) {
  const d = SPEC[where];
  const out = [];
  const near = (a, b, t = 0.6) => typeof a === 'number' && Math.abs(a - b) <= t;
  const want = (row, what, got, ok, expect) => { if (!ok) out.push(`${where} ${row.kind}${row.fresh ? ' (new)' : ' (seen)'}: ${what} is ${JSON.stringify(got)}, DESIGN ${expect}`); };
  for (const r of rows) {
    const ground = r.fresh ? rgb(d.fresh) : (d.seen ? rgb(d.seen) : 'rgba(0, 0, 0, 0)');
    const ring = r.fresh ? rgb(d.fresh) : rgb(d.seen || pageGround);
    want(r, 'padding', r.pad, r.pad === d.pad, d.pad);
    want(r, 'gap', r.gap, r.gap === d.gap, d.gap);
    want(r, 'align', r.align, r.align === 'flex-start', 'flex-start');
    want(r, 'bottom border', r.border, r.border === `1px solid ${rgb(d.border)}`, `1px solid ${d.border}`);
    want(r, 'ground', r.ground, r.ground === ground, ground);
    want(r, 'text colour', r.line1.color, r.line1.color === rgb(r.fresh ? '#EFE8DA' : '#DCD5C9'), r.fresh ? '#EFE8DA' : '#DCD5C9');
    if (r.line1.name) want(r, 'name', r.line1.name, r.line1.name.color === rgb('#EFE8DA') && r.line1.name.weight === '600', '#EFE8DA 600');
    want(r, 'line 1 size/line height', [r.line1.size, r.line1.lh], r.line1.size === d.size && near(r.line1.lh, d.size * 1.32, 0.05), `${d.size}px / 1.32`);
    want(r, 'words clear of the time', [r.inkRight, r.timeLeft, r.ws], r.inkRight <= r.timeLeft - d.gap + 0.5 && r.ws === 'normal', `wrapping, ending ${d.gap}px before the time`);
    want(r, 'line 1 family', r.line1.family, /^"?Cormorant Garamond/.test(r.line1.family), 'Cormorant Garamond');
    if (r.fresh) want(r, 'dot', r.dot && [r.dot.x, r.dot.y, r.dot.w, r.dot.bg], !!r.dot && near(r.dot.x, d.dot[0], 0.1) && near(r.dot.y, d.dot[1], 0.1) && r.dot.w === 7 && r.dot.bg === rgb('#8B63E6'), `7px #8B63E6 at ${d.dot}`);
    else want(r, 'dot', !!r.dot, !r.dot, 'none');
    const padL = parseFloat(d.pad.split(' ')[3]), padT = parseFloat(d.pad.split(' ')[0]);
    const covered = r.kind === 'new_story' || r.kind === 'response';
    const boxH = covered ? d.cover[1] : d.box;
    want(r, 'picture box', [r.pic.x, r.pic.y, r.pic.w, r.pic.h], near(r.pic.x, padL, 0.1) && near(r.pic.y, padT, 0.1) && r.pic.w === d.box && r.pic.h === boxH, `${d.box}×${boxH} at ${padL},${padT}`);
    if (covered) {
      const c = r.cover;
      want(r, 'cover', c && [c.x, c.y, c.w, c.h, c.radius, c.bg], !!c && c.w === d.cover[0] && c.h === d.cover[1] && near(c.x, (d.box - d.cover[0]) / 2, 0.1) && c.y === 0 && c.radius === '0px' && c.bg === rgb('#2A2338'), `${d.cover.join('×')}, square corners, centred, on #2A2338`);
      if (r.faces.length) want(r, 'faces beside the cover', r.faces.length, false, 'none');
    } else if (TILE_OF[r.kind]) {
      const t = r.tile, x = TILE_OF[r.kind];
      want(r, 'tile', t && [t.name, t.x, t.y, t.w, t.radius, t.bg, t.ring], !!t && t.name === x.tile && t.x === d.face[1] && t.y === d.face[1] && t.w === d.face[0] && t.radius === '50%' && t.bg === rgb(x.ground) && t.ring === `${rgb(x.ring)} 0px 0px 0px 1px inset`, `a ${d.face[0]}px circle at ${d.face[1]},${d.face[1]}, ${x.ground}, ring 1px ${x.ring} inside`);
      want(r, 'tile glyph', t && t.glyph, !!t && t.glyph === G[x.tile], G[x.tile]);
      want(r, 'tile ink', t && t.ink, !!t && t.ink && t.ink.size === d.tileGlyph && t.ink.stroke === rgb(x.ink) && t.ink.fill === 'none' && parseFloat(t.ink.strokeWidth) === x.stroke && t.ink.cap === 'round' && t.ink.join === 'round', `${d.tileGlyph}px, stroke ${x.ink} ${x.stroke}, round caps and joins`);
      want(r, 'badge on a tile', !!r.badge, !r.badge, 'none');
    } else if (r.faces.length === 2) {
      const [a, b] = r.faces;
      want(r, 'grouped faces', [a.x, a.y, a.w, b.x, b.y, b.w, b.ring], a.x === 0 && a.y === 0 && a.w === d.pair[0] && b.x === d.pair[1] && b.y === d.pair[1] && b.w === d.pair[0] && b.ring === `${ring} 0px 0px 0px 2px`, `two ${d.pair[0]}px at 0,0 and ${d.pair[1]},${d.pair[1]}, the second ringed 2px in the row's ground`);
    } else {
      const f = r.faces[0];
      want(r, 'face', f && [f.x, f.y, f.w], !!f && f.x === d.face[1] && f.y === d.face[1] && f.w === d.face[0], `${d.face[0]}px at ${d.face[1]},${d.face[1]}`);
    }
    if (BADGE_OF[r.kind]) {
      const [bg, glyphName] = BADGE_OF[r.kind];
      const b = r.badge;
      want(r, 'badge size and place', b && [b.w, b.dr, b.db, b.radius], !!b && b.w === d.badge && b.h === d.badge && b.dr === 4 && b.db === 4 && b.radius === '50%', `${d.badge}px circle, right −4, bottom −4 of the box`);
      want(r, 'badge ring', b && b.ring, !!b && b.ring === `${ring} 0px 0px 0px 2px`, `2px ${ring}`);
      want(r, 'badge colour', b && b.bg, !!b && b.bg === rgb(bg), bg);
      want(r, 'badge glyph', b && b.glyph, !!b && b.glyph === G[glyphName], `${glyphName}: ${G[glyphName]}`);
      const gold = r.kind === 'new_story';
      const okInk = !!b && !!b.ink && b.ink.size === d.badgeGlyph && (glyphName === 'heart'
        ? b.ink.fill === rgb('#F6EFE6') && b.ink.stroke === 'none'
        : b.ink.fill === 'none' && b.ink.stroke === rgb(gold ? '#1A140A' : '#F6EFE6') && parseFloat(b.ink.strokeWidth) === (gold ? 2.4 : 2.6) && b.ink.cap === 'round' && b.ink.join === 'round');
      want(r, 'badge ink', b && b.ink, okInk, glyphName === 'heart' ? `${d.badgeGlyph}px, filled #F6EFE6` : `${d.badgeGlyph}px, stroke ${gold ? '#1A140A 2.4' : '#F6EFE6 2.6'}, round`);
    }
    if (r.line2) {
      const quoted = r.line2.text.startsWith('“');
      want(r, 'second line', [r.line2.size, r.line2.lh, r.line2.style, +(r.line2.y - r.line1.b).toFixed(2)], r.line2.size === d.size2 && near(r.line2.lh, d.size2 * 1.35, 0.05) && r.line2.style === 'italic' && near(r.line2.y - r.line1.b, d.gap2, 0.1), `italic ${d.size2}px / 1.35, ${d.gap2} below`);
      want(r, 'second line colour', r.line2.color, r.line2.color === rgb(quoted ? '#A39CB2' : '#D8D0C2'), quoted ? '#A39CB2' : '#D8D0C2');
      if (where === 'page') want(r, 'second line clamp', r.line2.clamp, r.line2.clamp === '2', '2 lines');
    }
    if (r.followed) want(r, 'FROM A WRITER YOU FOLLOW', r.followed, r.followed.size === 9.5 && r.followed.spacing === '1.9px' && r.followed.color === rgb('#C9A84C') && r.followed.weight === '600' && near(r.followed.gap, 8, 0.1), 'Inter 600 9.5px, 0.2em, #C9A84C, 8 below');
    const t = r.time;
    want(r, 'time', t, /^"?Inter/.test(t.family) && t.weight === '500' && t.size === 11 && t.color === rgb('#8E879D') && t.spacing === d.timeSpacing && t.padTop === `${d.timePad}px` && t.wrap === 'nowrap', `Inter 500 11px #8E879D, spacing ${d.timeSpacing}, padding-top ${d.timePad}, one line`);
  }
  return out;
}

test('BELL-1 canvas: the panel at 1024, every kind, new and seen', async ({ page }) => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(SHOTS, { recursive: true });
  // The panel draws five rows: three passes put every kind among them.
  const passes = [KINDS.slice(0, 5), KINDS.slice(5, 10), [...KINDS.slice(10), ...KINDS.slice(0, 3)]];
  const drifts = [], table = [];
  for (const [i, first] of passes.entries()) {
    await resetCanvas([...first, ...KINDS.filter((k) => !first.includes(k))]);
    await open(page, '/about', { size: { width: 1024, height: 900 } });
    // The bell has read seenAt (three arrived since) before the panel opens, as a reader's has.
    await expect(visibleBell(page)).toHaveAttribute('aria-label', 'Notifications, 3 unread', { timeout: 90000 });
    await visibleBell(page).click();
    const panel = page.locator('[data-bell-panel]');
    await expect(panel.locator('[data-bell-row]')).toHaveCount(5, { timeout: 60000 });
    // The details are in: the story's cover (old rows and new draw it) and the response's title.
    if (first.includes('new_story')) await expect(panel.locator('[data-bell-row="new_story"] [data-cover] img')).toBeVisible({ timeout: 60000 });
    if (first.includes('response')) await expect(panel.locator('[data-bell-row="response"]')).toContainText('A Quiet Harbour', { timeout: 60000 });
    await page.waitForTimeout(800);
    const rows = await page.evaluate(measureRows, '[data-bell-panel] [data-bell-row]');
    table.push(...rows);
    drifts.push(...canvasDrifts(rows, 'panel', '#14121C'));
    await panel.screenshot({ path: `${SHOTS}/canvas-panel-1024-${i + 1}.png` });
    await page.keyboard.press('Escape');
  }
  writeFileSync(`${SHOTS}/canvas-panel-1024.json`, JSON.stringify(table, null, 2));
  console.log(`[canvas] panel 1024: ${drifts.length} drift(s)\n${drifts.join('\n')}`);
  expect(new Set(table.map((r) => r.kind)).size, 'every kind measured').toBe(KINDS.length);
  expect(table.filter((r) => r.fresh).length, 'three new in each pass').toBe(9);
  expect(drifts).toEqual([]);
});

for (const width of [390, 1024]) {
  test(`BELL-1 canvas: /notifications at ${width}, every kind, new and seen`, async ({ page }) => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(SHOTS, { recursive: true });
    await resetCanvas(KINDS);
    await open(page, '/notifications', { size: { width, height: 900 } });
    const list = page.locator('[data-notifications-list] [data-bell-row]');
    await expect(list).toHaveCount(KINDS.length, { timeout: 90000 });
    await expect(page.locator('[data-bell-row="new_story"] [data-cover] img')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-bell-row="response"]')).toContainText('A Quiet Harbour', { timeout: 60000 });
    await page.waitForTimeout(800);
    const rows = await page.evaluate(measureRows, '[data-notifications-list] [data-bell-row]');
    const drifts = canvasDrifts(rows, 'page', '#0A0A0A');
    writeFileSync(`${SHOTS}/canvas-page-${width}.json`, JSON.stringify(rows, null, 2));
    await page.screenshot({ path: `${SHOTS}/canvas-page-${width}.png`, fullPage: true });
    console.log(`[canvas] page ${width}: ${drifts.length} drift(s)\n${drifts.join('\n')}`);
    expect(rows.filter((r) => r.fresh).length, 'three new, the rest seen').toBe(3);
    expect(rows.find((r) => r.kind === 'new_story')?.followed, 'FROM A WRITER YOU FOLLOW measured').toBeTruthy();
    expect(drifts).toEqual([]);
  });
}
