// TEXT-W1 — rulings 390 and 391: every multi-line box behaves the same, and with a phone's keyboard
// up nothing a reader needs is covered. Real pages against the EMULATORS (auth, database), signed in
// as invented emulator readers, never a founder. Nothing here touches production:
// NEXT_PUBLIC_FB_EMULATOR=1 and a localhost page (app/lib/firebase.js).
//
//   390 · growth at 1, 3, 6 and 9 lines on four boxes (the Square's post box, the thread's reply
//         bar, the Messages box, the profile bio), at 390 and at 1024: the box is its resting
//         height until the text needs more, then one line taller per line, to six; at six it is
//         full and still shows every line; at nine it holds six and scrolls inside, the cursor (the
//         last line) in view. A paste of a long passage lands the same. Sending (or deleting) takes
//         it back to its resting height. Send stays level with the last line.
//         The Open Pages piece (long-form) never scrolls inside: it grows with the page, and the
//         page does not jump while a reader types at its foot.
//   391 · the 390 phone with iPhone Safari's keyboard (the visual viewport shrinks, the layout
//         viewport doesn't: layout 844, glass 508): the Messages panel takes the whole glass, header
//         at the top, the newest message above the box, the box on the keyboard, nothing
//         overlapping; a short conversation's header is at the top too; the profile sheet sits on
//         the keyboard, so neither the bio nor Save is under it.
//
//   npm run test:text:w1
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';
import { routeSquareWrite } from '../square/write-route.mjs';

const app = adminApp('text-w1');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const A = 'textw1testreader', C = 'textw1readercee', G = 'textw1readergee';
const conv = (x, y) => [x, y].sort().join('_');
const AC = conv(A, C), AG = conv(A, G);

const londonAt = (hhmm, now = Date.now()) => {
  const fmt = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  let t = Math.floor(now / 60000) * 60000;
  for (let i = 0; i <= 1500 && fmt(t) !== hhmm; i++) t -= 60000;
  return t;
};
const OPEN = londonAt('20:30');   // the Square's hours

async function reset() {
  const prof = (displayName, h, extra = {}) => ({ displayName, username: h, handle: h, readCount: 12, createdAt: OPEN - 90 * 86400000, ...extra });
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${String(i).padStart(2, '0')}`, { text: `message ${i} in a long conversation`, senderUid: i % 2 ? A : C, createdAt: OPEN - (60 - i) * 60000 }]));
  await db.ref().set({
    users: { [A]: prof('Reader Ay', 'ay', { bio: '' }), [C]: prof('Reader Cee', 'cee'), [G]: prof('Reader Gee', 'gee') },
    usernames: { ay: A, cee: C, gee: G },
    user_search: Object.fromEntries([[A, 'ay'], [C, 'cee'], [G, 'gee']].map(([u, h]) => [u, { displayName: `Reader ${h}`, username: h }])),
    square_posts: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`-P${i}`, { text: `A post, number ${i}.`, authorUid: C, createdAt: OPEN - (20 - i) * 60000 }])),
    dm_messages: { [AC]: many, [AG]: { g1: { text: 'just the one message', senderUid: G, createdAt: OPEN - 60000 } } },
    dm_conversations: {
      [A]: { [AC]: { unread: 0, lastAt: OPEN - 2000 }, [AG]: { unread: 0, lastAt: OPEN - 1000 } },
      [C]: { [AC]: { unread: 0, lastAt: OPEN - 2000 } }, [G]: { [AG]: { unread: 0, lastAt: OPEN - 1000 } },
    },
  });
}

// The phone keyboard, as the page sees it: window.visualViewport shrinks while innerHeight doesn't.
const KEYBOARD = () => {
  const vv = new EventTarget();
  let h = null, top = 0;
  Object.defineProperties(vv, {
    height: { get: () => h ?? window.innerHeight }, width: { get: () => window.innerWidth },
    offsetTop: { get: () => top }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 },
    pageTop: { get: () => window.scrollY + top }, pageLeft: { get: () => 0 },
  });
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
  window.__keyboard = (height, offsetTop = 0) => { h = height; top = offsetTop; vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll')); };
};

async function open(page, path, { width, height = 844 } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width, height });
  await routeSquareWrite(page, { at: OPEN });
  await page.addInitScript(KEYBOARD);
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
  return { errors };
}

/** /profile sends a signed-out visitor home on its first auth state, so sign in on the Square and
 *  arrive signed in, as a reader does. */
async function openProfile(page, width) {
  const r = await open(page, '/square', { width });
  await expect(page.getByText('A post, number 11.')).toBeVisible({ timeout: 90000 });
  await page.goto('/profile');
  await expect(page.getByTitle('Edit profile')).toBeVisible({ timeout: 90000 });
  return r;
}

const lines = (n, word = 'line') => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`).join('\n');

/** The box's height, one line's height, padding + borders, and whether it scrolls inside. */
const measure = (loc) => loc.evaluate((el) => {
  const cs = getComputedStyle(el);
  const px = (v) => parseFloat(v) || 0;
  let lh = parseFloat(cs.lineHeight);
  if (!Number.isFinite(lh)) {
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;padding:0;border:0;line-height:normal';
    p.style.font = cs.font; p.style.letterSpacing = cs.letterSpacing; p.textContent = 'x\nx\nx\nx';
    document.body.appendChild(p); lh = p.getBoundingClientRect().height / 4; p.remove();
  }
  const r = el.getBoundingClientRect();
  return {
    h: r.height, top: r.top, bottom: r.bottom, lh,
    chrome: px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth),
    scrolls: el.scrollHeight > el.clientHeight + 1,
    caretSeen: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    multiline: el.tagName === 'TEXTAREA',
  };
});

/**
 * Ruling 390 on one box: at 1, 3, 6 and 9 lines, and a pasted passage, then back to empty.
 * `send` (optional) sends what's in the box and expects it cleared.
 */
async function growth(page, box, { label, send = null, sendButton = null } = {}) {
  await box.click();
  await box.fill('');
  const rest = await measure(box);
  expect(rest.multiline, `${label}: a multi-line box`).toBe(true);
  const want = (n) => Math.max(rest.h, Math.min(n, 6) * rest.lh + rest.chrome);
  const seen = {};
  for (const n of [1, 3, 6, 9]) {
    await box.fill(lines(n));
    await expect.poll(async () => Math.abs((await measure(box)).h - want(n)), { message: `${label}: height at ${n} lines` }).toBeLessThanOrEqual(2);
    const m = await measure(box);
    seen[n] = m;
    expect(m.scrolls, `${label}: scrolls inside at ${n} lines`).toBe(n > 6);
    expect(m.caretSeen, `${label}: the last line in view at ${n} lines`).toBe(true);
    if (sendButton) {
      // Send is level with the box's last line: its foot within a few px of the box's foot.
      const b = await sendButton.evaluate((el) => el.getBoundingClientRect().bottom);
      expect(Math.abs(b - m.bottom), `${label}: Send level with the last line at ${n} lines`).toBeLessThanOrEqual(6);
    }
  }
  expect(seen[3].h).toBeGreaterThanOrEqual(seen[1].h);
  expect(seen[6].h).toBeGreaterThan(seen[1].h + 1);
  expect(Math.abs(seen[9].h - seen[6].h)).toBeLessThanOrEqual(1);
  // A pasted passage: the same six lines and the same scroll, the end of it in view.
  await box.fill('');
  await box.evaluate((el) => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', Array.from({ length: 14 }, (_, i) => `pasted line ${i + 1}`).join('\n'));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  // Chromium does not insert text for a synthetic paste event; insertText is what a real paste does.
  if (!(await box.inputValue())) await page.keyboard.insertText(Array.from({ length: 14 }, (_, i) => `pasted line ${i + 1}`).join('\n'));
  await expect.poll(async () => Math.abs((await measure(box)).h - want(6)), { message: `${label}: a paste` }).toBeLessThanOrEqual(2);
  expect((await measure(box)).caretSeen).toBe(true);
  // Deleted, or sent: back to its resting height.
  if (send) {
    await box.fill(lines(4, 'sent'));
    await send();
    await expect(box).toHaveValue('');
  } else {
    await box.fill('');
  }
  await expect.poll(async () => Math.abs((await measure(box)).h - rest.h), { message: `${label}: shrinks back` }).toBeLessThanOrEqual(1);
}

test.beforeEach(async () => { await reset(); });

for (const width of [390, 1024]) {
  test(`390 at ${width}: the Square's post box`, async ({ page }) => {
    const { errors } = await open(page, '/square', { width });
    await expect(page.getByText('A post, number 11.')).toBeVisible({ timeout: 90000 });
    const box = page.locator('textarea.sq-textarea').first();
    await growth(page, box, { label: 'post box' });
    expect(errors).toEqual([]);
  });

  test(`390 at ${width}: the thread's reply bar, sent`, async ({ page }) => {
    const { errors } = await open(page, '/square/p?id=-P11', { width });
    const box = page.locator('[data-reply-field]');
    await expect(box).toBeVisible({ timeout: 90000 });
    const sendButton = page.getByRole('button', { name: 'Send', exact: true });
    await growth(page, box, { label: 'reply bar', sendButton, send: () => sendButton.click() });
    expect(errors).toEqual([]);
  });

  test(`390 at ${width}: the Messages box, sent`, async ({ page }) => {
    const { errors } = await open(page, '/square', { width });
    await expect(page.getByText('A post, number 11.')).toBeVisible({ timeout: 90000 });
    await page.getByRole('button', { name: 'Messages' }).click();
    await page.locator(`[data-conversation="${AC}"]`).click();
    const box = page.locator('[data-dm-field]');
    await expect(box).toBeVisible();
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await growth(page, box, { label: 'Messages box', sendButton, send: () => sendButton.click() });
    expect(errors).toEqual([]);
  });

  test(`390 at ${width}: the profile bio`, async ({ page }) => {
    const { errors } = await openProfile(page, width);
    await page.getByTitle('Edit profile').click();
    const box = page.locator('textarea.pf-field-textarea');
    await expect(box).toBeVisible();
    await growth(page, box, { label: 'bio' });
    expect(errors).toEqual([]);
  });
}

test('390 long-form: an Open Pages piece grows with the page, never scrolls inside, and the page never jumps', async ({ page }) => {
  const { errors } = await open(page, '/open-pages/new', { width: 390 });
  const box = page.getByLabel('Your piece');
  await expect(box).toBeVisible({ timeout: 90000 });
  await box.fill(lines(60, 'a line of the piece'));
  // A writer at the foot of their piece: the caret at the end, the page scrolled so the last line
  // sits low on the screen, as it does while writing.
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Your piece"]');
    el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length);
    window.scrollTo({ top: el.getBoundingClientRect().bottom + window.scrollY - 700, behavior: 'instant' });
  });
  const before = await page.evaluate(() => window.scrollY);
  // Type at the foot, a line at a time: the page only ever moves down, to follow the line typed.
  let y = before;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`typed ${i}`);
    const now = await page.evaluate(() => window.scrollY);
    expect(now, 'the page never jumps up while typing at the foot').toBeGreaterThanOrEqual(y - 1);
    y = now;
  }
  const m = await measure(box);
  expect(m.scrolls, 'a piece never scrolls inside itself').toBe(false);
  expect(m.bottom - m.chrome, 'the line typed is on the screen').toBeLessThanOrEqual(844);
  expect(errors).toEqual([]);
});

// ── 391: the keyboard, on the 390 phone ─────────────────────────────────────────────────────────
const rect = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; });

for (const [name, convId, newest] of [['a long conversation', AC, 'k29'], ['a short one', AG, 'g1']]) {
  test(`391 Messages with the keyboard up, ${name}: full height, header at the top, newest above the box, nothing overlapping`, async ({ page }) => {
    const { errors } = await open(page, '/square', { width: 390 });
    await expect(page.getByText('A post, number 11.')).toBeVisible({ timeout: 90000 });
    await page.getByRole('button', { name: 'Messages' }).click();
    await page.locator(`[data-conversation="${convId}"]`).click();
    const box = page.locator('[data-dm-field]');
    expect(await box.evaluate((el) => el.tagName), 'a box a message can have lines in').toBe('TEXTAREA');
    await box.focus();
    await page.evaluate(() => window.__keyboard(508));
    await expect.poll(async () => Math.round((await rect(page.locator('[data-messages-panel]'))).bottom)).toBe(508);
    for (const n of [1, 6, 9]) {
      await box.fill(lines(n));
      await page.waitForTimeout(150);
      const panel = await rect(page.locator('[data-messages-panel]'));
      const header = await rect(page.locator('[data-messages-panel] > div').first());
      const f = await rect(box);
      const last = await rect(page.locator(`[data-message="${newest}"]`));
      const scroller = await rect(page.locator('[data-dm-scroller]'));
      expect(Math.round(panel.top), `${n} lines: the panel takes the whole glass`).toBe(0);
      expect(header.top, `${n} lines: the header at the top (inside the panel's 1px border)`).toBeLessThanOrEqual(1.5);
      expect(f.bottom, `${n} lines: the box on the keyboard`).toBeLessThanOrEqual(508);
      expect(f.bottom).toBeGreaterThan(508 - 80);
      expect(header.bottom, `${n} lines: header and box apart`).toBeLessThanOrEqual(f.top);
      expect(scroller.top, `${n} lines: header and messages apart`).toBeGreaterThanOrEqual(header.bottom - 1);
      expect(last.bottom, `${n} lines: the newest message above the box`).toBeLessThanOrEqual(f.top + 1);
      expect(last.bottom, `${n} lines: the newest message in view`).toBeLessThanOrEqual(scroller.bottom + 1);
      expect(last.top).toBeGreaterThanOrEqual(scroller.top - 1);
    }
    expect(errors).toEqual([]);
  });
}

test('391 the profile sheet with the keyboard up: the bio and Save are above it', async ({ page }) => {
  const { errors } = await openProfile(page, 390);
  await page.getByTitle('Edit profile').click();
  const box = page.locator('textarea.pf-field-textarea');
  await box.focus();
  await page.evaluate(() => window.__keyboard(508));
  await box.fill(lines(9));
  await page.waitForTimeout(300);
  const f = await rect(box);
  expect(f.bottom, 'the bio above the keyboard').toBeLessThanOrEqual(508);
  expect(f.top).toBeGreaterThanOrEqual(0);
  const sheet = await rect(page.locator('.pf-modal').last());
  expect(sheet.bottom, 'the sheet sits on the keyboard, so Save can be reached above it').toBeLessThanOrEqual(509);
  await page.getByRole('button', { name: 'Save changes' }).scrollIntoViewIfNeeded();
  const save = await rect(page.getByRole('button', { name: 'Save changes' }));
  expect(save.bottom, 'Save above the keyboard').toBeLessThanOrEqual(508);
  expect(errors).toEqual([]);
});
