// W55.2 — the keyboard, images in messages, the failed message. Proven in real pages against the
// EMULATORS (auth, database, storage).
//
//   · the keyboard: the visual viewport is shrunk as an iPhone's keyboard shrinks it (layout 844,
//     glass 508). The Messages panel's box sits on top of it with the latest message in view; a
//     field in the page's flow is scrolled above it; a field that keeps itself is left alone; with
//     no keyboard nothing moves
//   · 222: the image button shows only to a reader with the grant; an image sent goes through the
//     Function, is shrunk to 1600px on its long side as a JPEG, and lands in the conversation
//   · 224: the preview above the box says "Images disappear after 24 hours."; an image more than 24
//     hours old shows "This image has expired." and its address is never requested; its words stay
//   · 223: a message that fails stays, at half opacity, with "Not sent." (#d4537e), Try again
//     (#a989d9) and Remove (ink 0.62); Remove writes nothing; Try again sends it; a block's refusal
//     still says "You can't message this reader."
//   · 225: reporting an image message holds the image under dm_reported/ and the report points there
//
// Signed in as the emulator test reader (no grant) and a granted reader — never a founder. The two
// Functions run unmodified in the test process (dm-route.mjs). Nothing touches production:
// NEXT_PUBLIC_FB_EMULATOR=1 and a localhost page (app/lib/firebase.js).
//
//   npm run test:square:w552
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { createCanvas } from '@napi-rs/canvas';
import { adminApp, closeApp } from '../series/harness.mjs';
import { routeSquareWrite } from './write-route.mjs';
import { routeDmFunctions, putObject, listNames, wipeObjects } from './dm-route.mjs';
import { dmImageObject, dmImageUrl } from '../../app/lib/dmImages.js';

const app = adminApp('square-w552');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const A = 'w552-test-reader', G = 'w552-reader-granted', C = 'w552-reader-c';
const conv = (x, y) => [x, y].sort().join('_');
const AC = conv(A, C), GC = conv(G, C);
const H = 60 * 60 * 1000;

const londonAt = (hhmm, now = Date.now()) => {
  const fmt = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  let t = Math.floor(now / 60000) * 60000;
  for (let i = 0; i <= 1500 && fmt(t) !== hhmm; i++) t -= 60000;
  return t;
};
const OPEN = londonAt('20:30');
const val = async (path) => (await db.ref(path).get()).val();

const photo = (w, h) => {
  const c = createCanvas(w, h); const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, '#6b2fad'); grad.addColorStop(1, '#c9a84c');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7 % 360},60%,${30 + i % 40}%)`; g.fillRect((i * 97) % w, (i * 53) % h, 40, 40); }
  return c.toBuffer('image/png');
};
const SMALL = createCanvas(40, 30).toBuffer('image/jpeg');

// Two images of C's in A's conversation: one 25 hours old, one 23.
const OLD = dmImageObject(AC, C, 'old'), FRESH = dmImageObject(AC, C, 'fresh');

async function reset() {
  const prof = (displayName, h, extra = {}) => ({ displayName, username: h, handle: h, readCount: 12, ...extra });
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${String(i).padStart(2, '0')}`, { text: `message ${i} in a long conversation`, senderUid: i % 2 ? A : C, createdAt: OPEN - (60 - i) * 60000 }]));
  await db.ref().set({
    users: {
      [A]: prof('Reader Ay', 'ay'),
      [G]: prof('Reader Gee', 'gee', { canPostImages: true }),
      [C]: prof('Reader Cee', 'cee'),
    },
    usernames: { ay: A, gee: G, cee: C },
    user_search: Object.fromEntries([[A, 'ay'], [G, 'gee'], [C, 'cee']].map(([u, h]) => [u, { displayName: `Reader ${h}`, username: h }])),
    square_posts: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`-P${i}`, { text: `A post, number ${i}.`, authorUid: C, createdAt: OPEN - (20 - i) * 60000 }])),
    dm_messages: {
      [AC]: {
        ...many,
        x1: { text: 'old words stay', senderUid: C, createdAt: OPEN - 25 * H + 0, imageUrl: dmImageUrl(OLD, 't-old') },
        x2: { text: '', senderUid: C, createdAt: OPEN - 23 * H, imageUrl: dmImageUrl(FRESH, 't-fresh') },
      },
      [GC]: { g1: { text: 'hello Gee', senderUid: C, createdAt: OPEN - 60000 } },
    },
    dm_conversations: {
      [A]: { [AC]: { unread: 0, lastAt: OPEN - 1000 } }, [G]: { [GC]: { unread: 0, lastAt: OPEN - 1000 } },
      [C]: { [AC]: { unread: 0, lastAt: OPEN - 1000 }, [GC]: { unread: 0, lastAt: OPEN - 1000 } },
    },
  });
  await wipeObjects('dm_images/', 'dm_reported/');
  await putObject(OLD, SMALL, 't-old');
  await putObject(FRESH, SMALL, 't-fresh');
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

async function open(page, { uid = A, failImage = null } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routeSquareWrite(page, { at: OPEN });
  const fns = await routeDmFunctions(page, { failImage });
  await page.addInitScript(KEYBOARD);
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
  await expect(page.getByText('A post, number 11.')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('a[href="/profile"]').first()).toBeVisible();
  await page.waitForTimeout(800);
  return { errors, fns };
}
const openConversation = async (page, convId, first) => {
  await page.getByRole('button', { name: 'Messages' }).click();
  await page.locator(`[data-conversation="${convId}"]`).click();
  await expect(page.locator(`[data-message="${first}"]`)).toBeVisible();
};
const rect = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; });

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await reset(); });

// ── the keyboard ─────────────────────────────────────────────────────────────────────────────

test('Messages: the box sits on top of the keyboard, the latest message in view above it', async ({ page }) => {
  const { errors } = await open(page);
  await openConversation(page, AC, 'k29');
  const field = page.locator('[data-dm-field]');
  await field.focus();
  const before = await rect(page.locator('[data-messages-glass]'));
  expect(before.bottom).toBeCloseTo(844, 0);
  await page.evaluate(() => window.__keyboard(508));
  await expect.poll(async () => Math.round((await rect(page.locator('[data-messages-glass]'))).bottom)).toBe(508);
  const f = await rect(field);
  expect(f.bottom).toBeLessThanOrEqual(508);
  expect(f.bottom).toBeGreaterThan(508 - 80);                                          // on the keyboard, not floating
  // the latest message (by createdAt) is k29; x1 and x2 are a day old and sit at the top
  const last = await rect(page.locator('[data-message="k29"]'));
  const scroller = await rect(page.locator('[data-dm-scroller]'));
  expect(last.bottom).toBeLessThanOrEqual(scroller.bottom + 1);
  expect(last.top).toBeGreaterThanOrEqual(scroller.top - 1);
  expect(last.bottom).toBeLessThanOrEqual(f.top);
  // the keyboard goes: back to the foot of the screen
  await page.evaluate(() => window.__keyboard(844));
  await expect.poll(async () => Math.round((await rect(page.locator('[data-messages-glass]'))).bottom)).toBe(844);
  expect(errors).toEqual([]);
});

test('a field in the page’s flow is brought above the keyboard; one that keeps itself, or no keyboard, moves nothing', async ({ page }) => {
  await open(page);
  // A field at the foot of a long page, as a story's response box sits; and one marked to keep itself.
  await page.evaluate(() => {
    const pad = document.createElement('div'); pad.style.height = '1600px'; document.body.appendChild(pad);
    const t = document.createElement('textarea'); t.id = 'w552-flow'; t.rows = 3; t.style.cssText = 'display:block;width:300px;height:80px;margin:0 0 900px'; document.body.appendChild(t);
    const own = document.createElement('div'); own.setAttribute('data-keyboard-own', '');
    own.innerHTML = '<textarea id="w552-own" style="display:block;width:300px;height:80px"></textarea>'; document.body.appendChild(own);
  });
  const place = (id) => page.evaluate((i) => { const el = document.getElementById(i); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 700, behavior: 'instant' }); return window.scrollY; }, id);

  // no keyboard: focusing moves nothing
  const y0 = await place('w552-flow');
  await page.evaluate(() => document.getElementById('w552-flow').focus({ preventScroll: true }));
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(y0);

  // the keyboard rises over it: the page comes up until its foot clears the glass
  await page.evaluate(() => window.__keyboard(508));
  await expect.poll(async () => (await rect(page.locator('#w552-flow'))).bottom).toBeLessThanOrEqual(508);
  expect((await rect(page.locator('#w552-flow'))).bottom).toBeGreaterThan(400);       // just above it, not flung to the top
  await page.evaluate(() => { document.activeElement.blur(); window.__keyboard(844); });

  // a field that keeps itself is left where it is
  const y1 = await place('w552-own');
  await page.evaluate(() => document.getElementById('w552-own').focus({ preventScroll: true }));
  await page.evaluate(() => window.__keyboard(508));
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.scrollY)).toBe(y1);
});

test('the Square’s report-a-post dialog: its note field stays above the keyboard', async ({ page }) => {
  await open(page);
  await page.locator('[id="-P11"]').getByRole('button', { name: '···' }).first().click();
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(page.getByText('Report this post')).toBeVisible();
  const note = page.locator('[data-report-overlay] textarea');
  await note.focus();
  await page.evaluate(() => window.__keyboard(508));
  await expect.poll(async () => Math.round((await rect(page.locator('[data-report-overlay]'))).bottom)).toBe(508);
  expect((await rect(note)).bottom).toBeLessThanOrEqual(508);
  await page.evaluate(() => window.__keyboard(844));
  await expect.poll(async () => Math.round((await rect(page.locator('[data-report-overlay]'))).bottom)).toBe(844);
});

// ── 222 · the image button ──────────────────────────────────────────────────────────────────

test('the image button: not for the test reader, who has no grant', async ({ page }) => {
  await open(page, { uid: A });
  await openConversation(page, AC, 'k29');
  await expect(page.locator('[data-dm-field]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add an image' })).toHaveCount(0);
});

test('a granted reader: the button, the preview line above the box, and an image sent shrunk to 1600px', async ({ page }) => {
  const { errors, fns } = await open(page, { uid: G });
  await openConversation(page, GC, 'g1');
  await expect(page.getByRole('button', { name: 'Add an image' })).toBeVisible();
  await page.locator('[data-dm-file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo(2400, 1800) });
  // 224 — the line, above the box
  await expect(page.locator('[data-dm-preview-note]')).toHaveText('Images disappear after 24 hours.');
  const pv = await rect(page.locator('[data-dm-preview]'));
  const f = await rect(page.locator('[data-dm-field]'));
  expect(pv.bottom).toBeLessThanOrEqual(f.top);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('[data-dm-preview]')).toHaveCount(0);
  await expect.poll(async () => Object.values((await val(`dm_messages/${GC}`)) || {}).filter((m) => m.imageUrl).length).toBe(1);
  const sent = Object.values(await val(`dm_messages/${GC}`)).find((m) => m.imageUrl);
  expect(sent.senderUid).toBe(G);
  const stored = await listNames(`dm_images/${GC}/`);
  expect(stored).toHaveLength(1);
  expect(stored[0].startsWith(`dm_images/${GC}/${G}_`)).toBe(true);
  // drawn from the stored object: 1600 on its long side, a JPEG
  const img = page.locator(`img[data-message-image][src="${sent.imageUrl}"]`);
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(1600);
  expect(await img.evaluate((el) => el.naturalHeight)).toBe(1200);
  expect(fns.imageRequests.some((u) => u.startsWith(sent.imageUrl.split('?')[0]))).toBe(true);
  expect(errors).toEqual([]);
});

// ── 223 · the failed message ────────────────────────────────────────────────────────────────

test('a message that fails stays, faded, with Not sent., Try again and Remove; Remove writes nothing; Try again sends', async ({ page }) => {
  const { fns } = await open(page, { uid: G, failImage: 502 });
  await openConversation(page, GC, 'g1');
  const before = await val(`dm_messages/${GC}`);
  await page.locator('[data-dm-file]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: photo(300, 200) });
  await page.locator('[data-dm-field]').fill('with words');
  await page.getByRole('button', { name: 'Send message' }).click();
  const unsent = page.locator('[data-message="unsent"]');
  await expect(unsent).toHaveCount(1);
  await expect(unsent).toContainText('with words');
  expect(await unsent.locator(':scope > div').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5');
  const line = unsent.locator('[data-unsent]');
  await expect(line.getByText('Not sent.')).toHaveCSS('color', 'rgb(212, 83, 126)');
  await expect(line.getByRole('button', { name: 'Try again' })).toHaveCSS('color', 'rgb(169, 137, 217)');
  await expect(line.getByRole('button', { name: 'Remove' })).toHaveCSS('color', 'rgba(245, 240, 232, 0.62)');
  await expect(page.locator('[data-dm-field]')).toHaveValue('');

  // Remove: gone, and nothing written
  await line.getByRole('button', { name: 'Remove' }).click();
  await expect(unsent).toHaveCount(0);
  expect(await val(`dm_messages/${GC}`)).toEqual(before);
  expect(await listNames(`dm_images/${GC}/`)).toEqual([]);

  // again, then Try again once the server is back
  await page.locator('[data-dm-file]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: photo(300, 200) });
  await page.locator('[data-dm-field]').fill('second try');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(unsent).toHaveCount(1);
  fns.failImage = null;
  await unsent.getByRole('button', { name: 'Try again' }).click();
  await expect(unsent).toHaveCount(0);
  await expect.poll(async () => Object.values(await val(`dm_messages/${GC}`)).filter((m) => m.text === 'second try' && m.imageUrl).length).toBe(1);
});

test('a block’s refusal still says "You can’t message this reader."', async ({ page }) => {
  await open(page, { uid: G });
  await openConversation(page, GC, 'g1');
  await db.ref(`blocked_users/${C}/${G}`).set(true);
  await page.locator('[data-dm-field]').fill('are you there');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('You can’t message this reader.')).toBeVisible();
  await expect(page.locator('[data-message="unsent"]')).toHaveCount(0);
  expect(Object.values(await val(`dm_messages/${GC}`)).some((m) => m.text === 'are you there')).toBe(false);
});

// ── 224 · the expired image ─────────────────────────────────────────────────────────────────

test('an image more than 24 hours old: "This image has expired.", never requested, its words kept', async ({ page }) => {
  const { fns } = await open(page, { uid: A });
  await openConversation(page, AC, 'k29');
  const old = page.locator('[data-message="x1"]');
  await expect(old.locator('[data-image-expired]')).toHaveText('This image has expired.');
  await expect(old.locator('img')).toHaveCount(0);
  await expect(old).toContainText('old words stay');
  const fresh = page.locator('[data-message="x2"] img[data-message-image]');
  await expect.poll(() => fresh.evaluate((el) => el.complete && el.naturalWidth)).toBe(40);
  expect(fns.imageRequests.some((u) => u.includes(encodeURIComponent(FRESH)))).toBe(true);
  expect(fns.imageRequests.some((u) => u.includes(encodeURIComponent(OLD)))).toBe(false);
});

// ── 225 · a reported image is held ──────────────────────────────────────────────────────────

test('reporting an image message holds the image under dm_reported/, and the report points at it', async ({ page }) => {
  await open(page, { uid: A });
  await openConversation(page, AC, 'k29');
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.locator('[data-conv-action]', { hasText: 'Report a message' }).click();
  await page.locator('[data-message="x2"]').click();
  await expect(page.locator('[data-report-message] img[data-message-image]')).toBeVisible();
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  const key = `dm_${AC}`;
  const rec = await val(`content_reports/${key}/${A}`);
  expect(rec.imageUrl).toContain(encodeURIComponent(`dm_reported/${key}/`));
  expect(await listNames(`dm_reported/${key}/`)).toEqual([`dm_reported/${key}/${A}_${FRESH.split('/').pop()}`]);
  expect(await listNames(`dm_images/${AC}/`)).toEqual([FRESH, OLD].sort());                 // the originals untouched
});
