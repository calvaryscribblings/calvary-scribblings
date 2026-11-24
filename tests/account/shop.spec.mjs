// SHOP-B2 — /account/shop in a real browser, against the emulators, with the real Function.
//
//   npm run test:shop-handoff
//
// functions/api/account/shop-code.js runs unmodified behind page.route, with the real limiter, against
// the database and auth emulators (Google's token exchange is the only stand-in). The shop is a stub
// page on books.calvaryscribblings.co.uk served by page.route, so every navigation the page makes is
// seen and nothing leaves this machine. Invented readers only, never a founder.

import { test, expect } from '@playwright/test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp, DB_NAMESPACE } from '../series/harness.mjs';
import { handleShopCode } from '../../functions/api/account/shop-code.js';
import { SHOP_RETURN_URL, SHOP_COPY, CODE_TTL_MS, SHOP_CODE_TIMEOUT_MS } from '../../app/lib/shopHandoff.js';
import { COMPLETION_COPY } from '../../app/lib/profileCompletion.js';

const app = adminApp('shop-b2');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));
test.describe.configure({ mode: 'serial' });

const READER = 'shopb2reader', NEWBIE = 'shopb2newbie';   // house-shaped uids (app/lib/ids.js)
const STATE = 'Sess-9f._~ZQ';
const SHOP = 'https://books.calvaryscribblings.co.uk';
const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const FAKE = 'https://shop-b2-db.test';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'emulator-api-key', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey, FIREBASE_DATABASE_URL: FAKE };

// The Function's outbound calls, pointed at the emulators.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const { signal, ...rest } = init;
  if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'owner' });
  if (url.startsWith('https://identitytoolkit.googleapis.com/')) return realFetch(`${AUTH}/${url.slice('https://'.length)}`, rest);
  if (url.startsWith(FAKE)) {
    const u = new URL(url);
    return realFetch(`${DB}${u.pathname}?ns=${DB_NAMESPACE}${u.search ? `&${u.search.slice(1)}` : ''}`, { ...rest, headers: { ...(init.headers || {}), Authorization: 'Bearer owner' } });
  }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init);
  throw new Error(`shop spec: refused an outbound call to ${new URL(url).host}`);
};

const link = (ret = SHOP_RETURN_URL, state = STATE) => `/account/shop?return=${encodeURIComponent(ret)}&state=${encodeURIComponent(state)}`;

async function reset() {
  await db.ref().set({
    users: { [READER]: { displayName: 'Shop Reader', username: 'shopreader', handle: 'shopreader', createdAt: Date.UTC(2026, 0, 2) } },
    usernames: { shopreader: READER },
  });
}

/** Serve the Function and the shop; record both. */
async function wire(page) {
  const seen = { fn: [], shop: [] };
  await page.route('**/api/account/shop-code', async (route) => {
    const req = route.request();
    const res = await handleShopCode({
      request: new Request('https://calvaryscribblings.co.uk/api/account/shop-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: req.headers().authorization || '', 'CF-Connecting-IP': '198.51.100.20' },
        body: req.postData() || '',
      }),
      env: ENV, waitUntil() {},
    });
    const body = await res.text();
    seen.fn.push({ status: res.status, body: JSON.parse(body) });
    return route.fulfill({ status: res.status, contentType: 'application/json', body });
  });
  await page.route(`${SHOP}/**`, (route) => {
    seen.shop.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>shop</title><p>the shop</p>' });
  });
  return seen;
}

async function open(page, path, uid = null) {
  const t0 = Date.now();
  const step = (m) => { if (process.env.SHOP_DEBUG) console.log(`[open +${Date.now() - t0}ms] ${m}`); };
  const seen = await wire(page);
  if (process.env.SHOP_DEBUG) page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 300)));
  await page.goto(path);
  step('loaded');
  if (uid) {
    await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
    step('hook');
    const tk = await getAuth(app).createCustomToken(uid);
    step('token');
    await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), tk);
    step('signed in');
    // The page opened the sign-in while it was signed out; a reader signing in THROUGH it closes it.
    // The harness signs in around it, so it closes it as the reader would.
    const close = page.locator('.auth-close');
    // (Bounded: for a new account the completion step opens over both and takes the click.)
    try { await close.waitFor({ timeout: 3000 }); await close.click({ timeout: 3000 }); } catch {}
  }
  const decline = page.getByRole('button', { name: /^decline$/i });
  try { await decline.waitFor({ timeout: 3000 }); await decline.click({ timeout: 3000 }); } catch {}
  step('ready');
  return seen;
}

test('a return not on the list: the refusal, and nobody goes anywhere', async ({ page }) => {
  await reset();
  for (const bad of [`${SHOP_RETURN_URL}/`, 'https://evil.example/account/return', `${SHOP_RETURN_URL}?next=https://evil.example`, 'http://books.calvaryscribblings.co.uk/account/return']) {
    const seen = await open(page, link(bad));
    await expect(page.locator('[data-shop-bad]')).toHaveText(SHOP_COPY.badLink, { timeout: 60000 });
    await expect(page.locator('[data-shop-question]')).toHaveCount(0);
    await expect(page.locator('[data-shop-keep], [data-shop-not-now], [data-shop-signin]')).toHaveCount(0);
    await expect(page.locator('.auth-backdrop')).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(new URL(page.url()).pathname).toBe('/account/shop');
    expect(seen.shop).toEqual([]);
    expect(seen.fn).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
  // And a state the shop could not have sent.
  const seen = await open(page, link(SHOP_RETURN_URL, 'a'.repeat(129)));
  await expect(page.locator('[data-shop-bad]')).toHaveText(SHOP_COPY.badLink, { timeout: 60000 });
  expect(seen.shop).toEqual([]);
});

test('signed out: the question above the site\'s own sign-in; "Not now" goes back with the state and no code', async ({ page }) => {
  await reset();
  const seen = await open(page, link());
  await expect(page.locator('[data-shop-question]')).toHaveText(SHOP_COPY.question, { timeout: 60000 });
  await expect(page.locator('[data-shop-note]')).toHaveText(SHOP_COPY.note);
  await expect(page.locator('.auth-backdrop')).toBeVisible();   // AuthModal, opened at once
  await expect(page.locator('[data-shop-keep]')).toHaveCount(0);
  await page.locator('.auth-close').click();
  await expect(page.locator('[data-shop-signin]')).toHaveText(SHOP_COPY.signIn);
  await page.locator('[data-shop-not-now]').click();
  await page.waitForURL(`${SHOP}/**`);
  expect(seen.shop).toEqual([`${SHOP_RETURN_URL}?state=${STATE}`]);
  expect(seen.fn).toEqual([]);
});

test('signed in: "Keep it" mints a code, writes { uid, exp } at its hash, and goes back with code and state', async ({ page }) => {
  await reset();
  const seen = await open(page, link(), READER);
  const keep = page.locator('[data-shop-keep]');
  await expect(keep).toHaveText(SHOP_COPY.keep, { timeout: 60000 });
  await expect(page.locator('[data-shop-question]')).toHaveText(SHOP_COPY.question);
  await expect(page.locator('[data-shop-not-now]')).toHaveText(SHOP_COPY.notNow);
  const t0 = Date.now();
  await keep.click();
  await page.waitForURL(`${SHOP}/**`, { timeout: 30000 }).catch(async (e) => {
    throw new Error(`no return to the shop: Function ${JSON.stringify(seen.fn.map((c) => c.status))}, page says ${JSON.stringify(await page.locator('[data-shop-error]').allTextContents())} (${e.message.split('\n')[0]})`);
  });
  const t1 = Date.now();
  expect(seen.fn.map((c) => c.status)).toEqual([200]);
  expect(seen.shop).toHaveLength(1);
  const back = new URL(seen.shop[0]);
  expect(back.origin + back.pathname).toBe(SHOP_RETURN_URL);
  expect([...back.searchParams.keys()]).toEqual(['code', 'state']);
  expect(back.searchParams.get('state')).toBe(STATE);
  const code = back.searchParams.get('code');
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const key = createHash('sha256').update(code).digest('hex');
  const rec = (await db.ref(`shop_handoff_codes/${key}`).get()).val();
  expect(Object.keys(rec).sort()).toEqual(['exp', 'uid']);
  expect(rec.uid).toBe(READER);
  expect(rec.exp).toBeGreaterThanOrEqual(t0 + CODE_TTL_MS);
  expect(rec.exp).toBeLessThanOrEqual(t1 + CODE_TTL_MS);
  expect(Object.keys((await db.ref('shop_handoff_codes').get()).val())).toEqual([key]);
  // Back does not return to the handoff page (replace), so it cannot mint again.
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(2);
});

test('a new account completes its handle and date of birth first; the buttons wait for it', async ({ page }) => {
  await reset();
  await open(page, link(), NEWBIE);
  await expect(page.getByText(COMPLETION_COPY.title)).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-shop-keep]')).toHaveCount(0);
  // Once the identity exists, the question can be answered.
  await db.ref(`users/${NEWBIE}`).update({ displayName: 'New Reader', handle: 'newreader', username: 'newreader' });
  await expect(page.locator('[data-shop-keep]')).toHaveText(SHOP_COPY.keep, { timeout: 30000 });
});

test('the limiter: a reader over the minute cap is told so, and no code is written', async ({ page }) => {
  await reset();
  const m = Math.floor(Date.now() / 60000);
  await db.ref().update({ [`rate_limits/shopcode/minute/m${m}/${READER}`]: 5, [`rate_limits/shopcode/minute/m${m + 1}/${READER}`]: 5 });
  const seen = await open(page, link(), READER);
  await page.locator('[data-shop-keep]').click({ timeout: 60000 });
  await expect(page.locator('[data-shop-error]')).toHaveText(SHOP_COPY.limited);
  expect(seen.fn.map((c) => c.status)).toEqual([429]);
  expect(seen.shop).toEqual([]);
  expect((await db.ref('shop_handoff_codes').get()).val()).toBeNull();
  await expect(page.locator('[data-shop-keep]')).toBeEnabled();
  // Refused, the reader can still go back: the state and no code.
  await expectNotNowBack(page, seen);
});

/** In an error state "Not now" is on the page, enabled, and goes back with the state alone. */
async function expectNotNowBack(page, seen) {
  const notNow = page.locator('[data-shop-not-now]');
  await expect(notNow).toHaveText(SHOP_COPY.notNow);
  await expect(notNow).toBeEnabled();
  await notNow.click();
  await page.waitForURL(`${SHOP}/**`);
  expect(seen.shop).toEqual([`${SHOP_RETURN_URL}?state=${STATE}`]);
}

test('a failure stays on the page: the line, "Not now" still there, and no return carries an error', async ({ page }) => {
  await reset();
  const seen = await open(page, link(), READER);
  await page.unroute('**/api/account/shop-code');
  await page.route('**/api/account/shop-code', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"unavailable"}' }));
  await page.locator('[data-shop-keep]').click({ timeout: 60000 });
  await expect(page.locator('[data-shop-error]')).toHaveText(SHOP_COPY.failed);
  expect(seen.shop).toEqual([]);
  await expectNotNowBack(page, seen);
});

test('a request that never answers fails after its timeout, and "Not now" comes back', async ({ page }) => {
  await reset();
  const seen = await open(page, link(), READER);
  await page.unroute('**/api/account/shop-code');
  await page.route('**/api/account/shop-code', () => new Promise(() => {}));   // never answers
  await page.locator('[data-shop-keep]').click({ timeout: 60000 });
  await expect(page.locator('[data-shop-keep]')).toHaveText(SHOP_COPY.keeping);
  await expect(page.locator('[data-shop-error]')).toHaveText(SHOP_COPY.failed, { timeout: SHOP_CODE_TIMEOUT_MS + 15000 });
  expect(seen.shop).toEqual([]);
  await expectNotNowBack(page, seen);
});

// ── Ruling (Ikenna, 24 Nov 2026): on /account/shop ONLY, a new email account skips "Check your inbox." ──

/** Sign up by email in the open AuthModal. Records the verification-mail requests the page makes. */
async function signUpByEmail(page, { name, handle, email }) {
  const mail = [];
  await page.route('**/api/auth/send-verification', (route) => {
    mail.push(route.request().method());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  const modal = page.locator('.auth-backdrop');
  await modal.getByRole('button', { name: /Create one/ }).click();
  await modal.getByPlaceholder('Your name').fill(name);
  await modal.locator('#auth-handle').fill(handle);
  await modal.getByPlaceholder('you@example.com').fill(email);
  const pw = modal.locator('input[type="password"]');
  await pw.nth(0).fill('correct-horse-9');
  await pw.nth(1).fill('correct-horse-9');
  await modal.locator('input[type="date"]').fill('1990-05-05');
  await modal.getByRole('button', { name: 'Create account' }).click();
  return mail;
}

const VERIFY_TITLE = 'Check your inbox.';
const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test('on /account/shop a new email account skips "Check your inbox.": the email still goes, and the question is next, in this tab', async ({ page }) => {
  await reset();
  const seen = await open(page, link());
  await expect(page.locator('.auth-backdrop')).toBeVisible({ timeout: 60000 });
  const tag = stamp();
  const mail = await signUpByEmail(page, { name: 'Shop Newcomer', handle: `shopnew${tag}`, email: `shopnew-${tag}@example.com` });
  await expect(page.locator('[data-shop-keep]')).toHaveText(SHOP_COPY.keep, { timeout: 60000 });
  await expect(page.locator('.auth-backdrop')).toHaveCount(0);
  await expect(page.getByText(VERIFY_TITLE)).toHaveCount(0);
  expect(mail).toEqual(['POST']);                     // the verification email was still asked for
  expect(page.context().pages()).toHaveLength(1);    // no other tab
  expect(new URL(page.url()).pathname).toBe('/account/shop');
  expect(seen.shop).toEqual([]);
});

test('everywhere else the screen stays: a new email account from the header sees "Check your inbox."', async ({ page }) => {
  await reset();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/about');
  const decline = page.getByRole('button', { name: /^decline$/i });
  try { await decline.waitFor({ timeout: 5000 }); await decline.click({ timeout: 3000 }); } catch {}
  await page.locator('.cs-signin-btn').click({ timeout: 60000 });
  await expect(page.locator('.auth-backdrop')).toBeVisible();
  const tag = stamp();
  const mail = await signUpByEmail(page, { name: 'Header Newcomer', handle: `hdrnew${tag}`, email: `hdrnew-${tag}@example.com` });
  await expect(page.locator('.auth-backdrop').getByText(VERIFY_TITLE)).toBeVisible({ timeout: 60000 });
  expect(mail).toEqual(['POST']);
});
