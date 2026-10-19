// W55.1 — the conversation's ⋯ menu, muting a conversation, the report step, "reading since".
// Proven in real pages against the EMULATOR.
//
//   · ruling 217: the designed sheet at the foot of the Messages panel, at 390 and 1280 — dim,
//     grabber, header, View profile / Mute this conversation / Report a message / Block @handle,
//     Cancel — at the brief's measurements; dim and Cancel close it; each row does its thing
//   · ruling 218: Mute this conversation writes dm_muted/{uid}/{convId} = true; while it's set the
//     conversation's unread count isn't drawn, but its new messages still arrive and show; the
//     other reader's records are untouched; Unmute brings the count back
//   · ruling 220: the report step shows the picked message under "THE MESSAGE A MODERATOR WILL
//     SEE"; the filed record is what it was
//   · the reader card's "reading since": joinDate, then createdAt, nothing when neither, nothing
//     (and no error) when the date can't be read
//
// Signed in only as the emulator test reader — no founder account. Nothing touches production:
// NEXT_PUBLIC_FB_EMULATOR=1 and a localhost page (app/lib/firebase.js).
//
//   npm run test:square:w551
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';
import { routeSquareWrite } from './write-route.mjs';

const app = adminApp('square-w551');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const A = 'w551-test-reader', B = 'w551-reader-b', C = 'w551-reader-c', D = 'w551-reader-d', E = 'w551-reader-e';
const conv = (x, y) => [x, y].sort().join('_');
const AC = conv(A, C);

const londonAt = (hhmm, now = Date.now()) => {
  const fmt = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  let t = Math.floor(now / 60000) * 60000;
  for (let i = 0; i <= 1500 && fmt(t) !== hhmm; i++) t -= 60000;
  return t;
};
const OPEN = londonAt('20:30');
const val = async (path) => (await db.ref(path).get()).val();

async function reset() {
  const prof = (displayName, h, extra = {}) => ({ displayName, username: h, handle: h, readCount: 12, ...extra });
  await db.ref().set({
    users: {
      [A]: prof('Reader Ay', 'ay', { joinDate: Date.UTC(2026, 0, 5) }),
      [B]: prof('Reader Bee', 'bee', { joinDate: Date.UTC(2025, 5, 2) }),          // joinDate only
      [C]: prof('Reader Cee', 'cee', { createdAt: Date.UTC(2026, 2, 14) }),        // createdAt only
      [D]: prof('Reader Dee', 'dee'),                                              // neither
      [E]: prof('Reader Eee', 'eee', { joinDate: 'soon' }),                        // can't be read
    },
    usernames: { ay: A, bee: B, cee: C, dee: D, eee: E },
    user_search: Object.fromEntries([[A, 'ay'], [B, 'bee'], [C, 'cee'], [D, 'dee'], [E, 'eee']].map(([u, h]) => [u, { displayName: `Reader ${h}`, username: h }])),
    square_posts: {
      '-Pb': { text: 'A post by Bee.', authorUid: B, createdAt: OPEN - 600000 },
      '-Pc': { text: 'A post by Cee.', authorUid: C, createdAt: OPEN - 500000 },
      '-Pd': { text: 'A post by Dee.', authorUid: D, createdAt: OPEN - 400000 },
      '-Pe': { text: 'A post by Eee.', authorUid: E, createdAt: OPEN - 300000 },
    },
    dm_messages: { [AC]: { m1: { text: 'a message from Cee that Ay will report', senderUid: C, createdAt: OPEN - 5000 } } },
    dm_conversations: { [A]: { [AC]: { unread: 1, lastAt: OPEN - 5000 } }, [C]: { [AC]: { unread: 0, lastAt: OPEN - 5000 } } },
  });
}

async function open(page, { uid = A } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await routeSquareWrite(page, { at: OPEN });
  await page.addInitScript((off) => {
    const RD = Date;
    class D2 extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + off); else super(...a); } static now() { return RD.now() + off; } }
    window.Date = D2;
  }, OPEN - Date.now());
  await page.goto('/square');
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), await getAuth(app).createCustomToken(uid));
  const decline = page.getByRole('button', { name: /^decline$/i });
  try { await decline.waitFor({ timeout: 6000 }); await decline.click(); } catch {}
  await expect(page.getByText('A post by Bee.')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('a[href="/profile"]').first()).toBeVisible();
  await page.waitForTimeout(800);
  return { errors };
}
const openConversation = async (page) => {
  await page.getByRole('button', { name: 'Messages' }).click();
  await page.locator(`[data-conversation="${AC}"]`).click();
  await expect(page.locator('[data-message="m1"]')).toBeVisible();
};
const openMenu = async (page) => {
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await expect(page.locator('[data-conv-sheet]')).toBeVisible();
};
const rect = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
const css = (loc, ...props) => loc.evaluate((el, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(el)[p]])), props);

// ── 1. the sheet (217) ───────────────────────────────────────────────────────

for (const width of [390, 1280]) {
  test(`the ⋯ sheet, at the foot of the panel, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await reset();
    const { errors } = await open(page);
    await openConversation(page);
    await openMenu(page);
    const sheet = page.locator('[data-conv-sheet]');
    const panel = page.locator('[data-messages-panel]');
    const s = await rect(sheet), p = await rect(panel);
    // at the panel's foot, its width
    expect(s.bottom).toBeCloseTo(844, 0);
    expect(s.left).toBeCloseTo(p.left, 0);
    expect(s.width).toBeCloseTo(p.width, 0);

    expect(await css(page.locator('[data-conv-dim]'), 'backgroundColor')).toEqual({ backgroundColor: 'rgba(4, 3, 8, 0.6)' });
    expect(await css(sheet, 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderTopLeftRadius', 'borderTopRightRadius', 'paddingLeft', 'paddingRight', 'paddingBottom')).toEqual({
      backgroundColor: 'rgb(14, 11, 24)', borderTopWidth: '1px', borderTopColor: 'rgba(245, 240, 232, 0.1)',
      borderTopLeftRadius: '12px', borderTopRightRadius: '12px', paddingLeft: '24px', paddingRight: '24px', paddingBottom: '34px',
    });
    const grab = await rect(page.locator('[data-conv-grabber]'));
    expect([grab.width, grab.height]).toEqual([36, 5]);
    expect(grab.top - s.top).toBeCloseTo(8 + 1, 0);                                  // 8px inside the 1px border
    expect((await css(page.locator('[data-conv-grabber]'), 'backgroundColor')).backgroundColor).toBe('rgba(245, 240, 232, 0.25)');

    const header = page.locator('[data-conv-header]');
    expect((await rect(header)).top - grab.bottom).toBeCloseTo(14, 0);
    const faceBox = await rect(header.locator(':scope > :first-child'));   // their live Avatar
    expect([faceBox.width, faceBox.height]).toEqual([36, 36]);
    await expect(page.locator('[data-conv-name]')).toHaveText('Reader Cee');
    expect(await css(page.locator('[data-conv-name]'), 'fontSize', 'lineHeight', 'fontWeight')).toEqual({ fontSize: '17px', lineHeight: '21px', fontWeight: '500' });
    await expect(page.locator('[data-conv-handle]')).toHaveText('@cee');
    expect(await css(page.locator('[data-conv-handle]'), 'fontSize', 'color')).toEqual({ fontSize: '14.5px', color: 'rgba(169, 137, 217, 0.85)' });

    // the rows, in order, each under a hairline
    const rows = sheet.locator('[data-conv-action]');
    await expect(rows).toHaveCount(4);
    const titles = await rows.evaluateAll((els) => els.map((e) => e.querySelector('span > span').textContent));
    expect(titles).toEqual(['View profile', 'Mute this conversation', 'Report a message', 'Block @cee']);
    const firstRow = await rect(rows.first());
    expect(firstRow.top - (await rect(header)).bottom).toBeCloseTo(0, 0);           // the header's 14px is its own padding
    expect((await css(header, 'paddingBottom')).paddingBottom).toBe('14px');
    for (let i = 0; i < 4; i++) {
      expect(await css(rows.nth(i), 'borderTopWidth', 'borderTopColor')).toEqual({ borderTopWidth: '1px', borderTopColor: 'rgba(245, 240, 232, 0.08)' });
      const icon = await rect(rows.nth(i).locator('svg'));
      expect([icon.width, icon.height]).toEqual([20, 20]);
      const words = rows.nth(i).locator('span > span').first();
      expect((await rect(words)).left - icon.right).toBeCloseTo(14, 0);
      expect(await css(words, 'fontSize', 'fontWeight')).toEqual({ fontSize: '16.5px', fontWeight: '500' });
    }
    expect((await rect(rows.nth(0))).height).toBe(52);
    expect((await rect(rows.nth(1))).height).toBe(52);
    for (const i of [2, 3]) {
      const hint = rows.nth(i).locator('[data-conv-hint]');
      expect(await css(hint, 'fontStyle', 'fontSize', 'lineHeight', 'color')).toEqual({ fontStyle: 'italic', fontSize: '14.5px', lineHeight: '18px', color: 'rgba(245, 240, 232, 0.55)' });
      expect(await css(rows.nth(i), 'paddingTop', 'paddingBottom')).toEqual({ paddingTop: '12px', paddingBottom: '12px' });
    }
    await expect(rows.nth(2).locator('[data-conv-hint]')).toHaveText('Pick the message. A moderator sees only that one.');
    await expect(rows.nth(3).locator('[data-conv-hint]')).toHaveText('They can’t message you, and their posts leave your Square.');
    expect((await css(rows.nth(3), 'color')).color).toBe('rgb(224, 134, 143)');

    const cancel = sheet.locator('[data-conv-cancel]');
    const cb = await rect(cancel);
    expect(cb.top - (await rect(rows.nth(3))).bottom).toBeCloseTo(10, 0);
    expect(cb.height).toBe(50);
    const cc = await css(cancel, 'borderTopWidth', 'borderTopColor', 'fontSize', 'borderTopLeftRadius');
    expect(cc.borderTopWidth).toBe('1px');
    expect(cc.borderTopColor).toBe('rgba(245, 240, 232, 0.14)');
    expect(cc.fontSize).toBe('16.5px');
    expect(parseFloat(cc.borderTopLeftRadius)).toBeGreaterThanOrEqual(25);         // fully rounded
    await expect(cancel).toHaveText('Cancel');
    expect(s.bottom - cb.bottom).toBeCloseTo(34, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    // Cancel closes; so does the dim
    await cancel.click();
    await expect(sheet).toHaveCount(0);
    await openMenu(page);
    await page.mouse.click(width / 2, 20);
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('[data-messages-panel]')).toBeVisible();                // the panel stays
    expect(errors).toEqual([]);
  });
}

test('View profile opens their reader card; Block @handle blocks, and reads "Unblock @cee" once set', async ({ page }) => {
  await reset();
  await open(page);
  await openConversation(page);
  await openMenu(page);
  await page.locator('[data-conv-action="profile"]').click();
  await expect(page.locator(`[data-reader-card="${C}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await openMenu(page);
  await page.locator('[data-conv-action="block"]').click();
  await expect.poll(() => val(`blocked_users/${A}/${C}`)).toBe(true);
  await expect(page.locator('[data-dm-barrier="blocker"]')).toContainText('You’ve blocked @cee.');
  await openMenu(page);
  await expect(page.locator('[data-conv-action="block"]')).toContainText('Unblock @cee');
  await expect(page.locator('[data-conv-action="block"] [data-conv-hint]')).toHaveCount(0);
  await page.locator('[data-conv-action="block"]').click();
  await expect.poll(() => val(`blocked_users/${A}/${C}`)).toBe(null);
});

// ── 2. Mute this conversation (218) ──────────────────────────────────────────

test('muting a conversation hides its unread count; its messages still arrive; Cee isn\'t told; Unmute brings it back', async ({ page }) => {
  await reset();
  const cBefore = JSON.stringify({ conv: await val(`dm_conversations/${C}`), notifs: await val(`notifications/${C}`), muted: await val(`muted_users/${C}`) });
  await open(page);
  await page.getByRole('button', { name: 'Messages' }).click();
  const row = page.locator(`[data-conversation="${AC}"]`);
  await expect(row.locator('[data-unread]')).toHaveText('1');                       // control: the count shows
  await row.click();
  await openMenu(page);
  await page.locator('[data-conv-action="mute"]').click();
  await expect.poll(() => val(`dm_muted/${A}/${AC}`)).toBe(true);
  await openMenu(page);
  await expect(page.locator('[data-conv-action="mute"]')).toContainText('Unmute this conversation');
  await page.locator('[data-conv-cancel]').click();

  // Cee writes while it's muted: the message arrives and shows
  await db.ref(`dm_messages/${AC}/m2`).set({ text: 'Cee again, while muted', senderUid: C, createdAt: OPEN + 1000 });
  await db.ref(`dm_conversations/${A}/${AC}`).update({ unread: 1, lastAt: OPEN + 1000 });
  await expect(page.locator('[data-message="m2"]')).toContainText('Cee again, while muted');
  await page.getByRole('button', { name: 'Back to messages' }).click();
  await expect(row).toContainText('Cee again, while muted');
  await db.ref(`dm_conversations/${A}/${AC}`).update({ unread: 2 });
  await page.waitForTimeout(1000);
  await expect(row.locator('[data-unread]')).toHaveCount(0);                        // not shown, not counted
  // the mute survives a reload
  await page.reload();
  await page.getByRole('button', { name: 'Messages' }).click();
  await expect(row).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
  await expect(row.locator('[data-unread]')).toHaveCount(0);
  // Cee's side: nothing of theirs was written by the mute
  const cAfter = JSON.stringify({ conv: await val(`dm_conversations/${C}`), notifs: await val(`notifications/${C}`), muted: await val(`muted_users/${C}`) });
  expect(cAfter).toBe(cBefore);

  await row.click();
  await openMenu(page);
  await page.locator('[data-conv-action="mute"]').click();
  await expect.poll(() => val(`dm_muted/${A}`)).toBe(null);
  await db.ref(`dm_conversations/${A}/${AC}`).update({ unread: 3 });
  await page.getByRole('button', { name: 'Back to messages' }).click();
  await expect(row.locator('[data-unread]')).toHaveText('3');
});

// ── 3. the report step (220) ─────────────────────────────────────────────────

test('the report step shows the picked message under "THE MESSAGE A MODERATOR WILL SEE"; the filed record is unchanged', async ({ page }) => {
  await reset();
  await open(page);
  await openConversation(page);
  await openMenu(page);
  await page.locator('[data-conv-action="report"]').click();
  await expect(page.locator('[data-conv-sheet]')).toHaveCount(0);
  await page.locator('[data-message="m1"]').click();
  const step = page.locator('[data-report-sheet]');
  const heading = step.locator('[data-report-heading] span').first();
  await expect(heading).toHaveText('The message a moderator will see');
  expect(await heading.evaluate((el) => el.innerText)).toBe('THE MESSAGE A MODERATOR WILL SEE');
  // in the thread's "REPLIES" style
  expect(await css(heading, 'fontSize', 'letterSpacing', 'textTransform', 'color')).toEqual({
    fontSize: '12.8px', letterSpacing: '2.048px', textTransform: 'uppercase', color: 'rgb(201, 168, 76)',
  });
  const shown = step.locator('[data-report-message]');
  await expect(shown).toContainText('a message from Cee that Ay will report');
  // as it appeared: the same bubble the conversation draws
  const inList = await css(page.locator('[data-message="m1"] [data-postbody]').locator('..'), 'backgroundColor', 'borderTopLeftRadius', 'paddingLeft');
  const inStep = await css(shown.locator('[data-postbody]').locator('..'), 'backgroundColor', 'borderTopLeftRadius', 'paddingLeft');
  expect(inStep).toEqual(inList);
  // the reasons sit under it
  expect((await rect(step.getByLabel('Harassment'))).top).toBeGreaterThan((await rect(shown)).bottom);

  await step.getByLabel('Spam or a scam').check();
  await step.getByRole('button', { name: /^Report$/ }).click();
  await expect(step.getByRole('status')).toHaveText('Reported. A moderator sees only this message.');
  const r = await val(`content_reports/dm_${AC}/${A}`);
  expect(r).toMatchObject({
    kind: 'dm', reason: 'spam', reporterUid: A, offenderUid: C,
    contextPath: `dm_messages/${AC}/m1`, snapshot: 'a message from Cee that Ay will report',
  });
});

// ── 4. "reading since" ───────────────────────────────────────────────────────

test('the reader card: joinDate, then createdAt; nothing when neither, or when the date can\'t be read', async ({ page }) => {
  await reset();
  const { errors } = await open(page);
  const card = async (uid) => {
    await page.locator(`[data-reader-open="${uid}"]`).first().click();
    const handle = page.locator(`[data-reader-card="${uid}"] [data-card-handle]`);
    await expect(handle).toBeVisible();
    await page.waitForTimeout(500);
    const text = await handle.textContent();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    return text;
  };
  expect(await card(B)).toBe('@bee · reading since June 2025');     // joinDate only (the case the card missed)
  expect(await card(C)).toBe('@cee · reading since March 2026');    // createdAt only
  expect(await card(D)).toBe('@dee');                               // neither
  expect(await card(E)).toBe('@eee');                               // can't be read
  expect(errors).toEqual([]);
});
