// APPLE-W1 — "Continue with Apple" in a real browser, against the Auth and Database emulators.
//
//   npm run test:apple-signin
//
// Firebase is the Auth emulator. The pop-up WINDOW is stood in for (window.__FB_EMULATOR_POPUP__,
// emulator builds only): the emulator's own pop-up relays its answer through Google's gapi iframes,
// which failed about one run in three in a headless browser here (the first pop-up of a run never
// heard back). So each flow hands the emulator the claims Apple would return, and the emulator's real
// signInWithIdp decides: which account, new or existing, linked or refused. Everything from the
// button press to the account is the page's own code. Nothing reaches Apple, Firebase or production.
// Invented readers only.
//
//   · the button: beside Google's, the same box, lined up, at phone and desktop, signing in and
//     creating an account, in the header's modal and on /account/shop
//   · a returning Apple-only reader signs in to their existing account (the same uid)
//   · a new Apple account meets the completion step, starting from the name Apple gave
//   · an email that already belongs to a password account: the same failure line Google gives
//   · /account/shop: the pop-up closes and the reader carries on in the one tab

import { test, expect } from '@playwright/test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp, DB_NAMESPACE } from '../series/harness.mjs';
import { handleShopCode } from '../../functions/api/account/shop-code.js';
import { SHOP_RETURN_URL } from '../../app/lib/shopHandoff.js';
import { APPLE_COPY } from '../../app/lib/appleSignIn.js';
import { COMPLETION_COPY } from '../../app/lib/profileCompletion.js';

const app = adminApp('apple-w1');
const db = getDatabase(app);
const auth = getAuth(app);
test.afterAll(() => closeApp(app));
test.describe.configure({ mode: 'serial' });

const RETURNING = 'appleReturning01';
const RETURNING_SUB = '001234.returningappleid.0001';
const STATE = 'apple-w1-state';
const SHOP = 'https://books.calvaryscribblings.co.uk';
const WIDTHS = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

// The code-minting Function, served for real against the emulators (as tests/account/shop.spec.mjs).
const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const FAKE = 'https://apple-w1-db.test';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'emulator-api-key', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey, FIREBASE_DATABASE_URL: FAKE };
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
  throw new Error(`apple spec: refused an outbound call to ${new URL(url).host}`);
};

async function reset() {
  await db.ref().set({ users: { [RETURNING]: { displayName: 'Returning Reader', username: 'applereturning', handle: 'applereturning', createdAt: Date.UTC(2026, 0, 2) } }, usernames: { applereturning: RETURNING } });
  const { users } = await auth.listUsers(1000);
  if (users.length) await auth.deleteUsers(users.map((u) => u.uid));
  // An Apple-only account, as the app made it: one provider, apple.com.
  const r = await auth.importUsers([{ uid: RETURNING, email: 'returning@privaterelay.appleid.com', emailVerified: true, providerData: [{ uid: RETURNING_SUB, providerId: 'apple.com', email: 'returning@privaterelay.appleid.com' }] }]);
  expect(r.failureCount).toBe(0);
}

async function wire(page) {
  const seen = { shop: [] };
  await page.route('**/api/account/shop-code', async (route) => {
    const req = route.request();
    const res = await handleShopCode({
      request: new Request('https://calvaryscribblings.co.uk/api/account/shop-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers().authorization || '', 'CF-Connecting-IP': '198.51.100.30' }, body: req.postData() || '',
      }),
      env: ENV, waitUntil() {},
    });
    return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  });
  await page.route(`${SHOP}/**`, (route) => { seen.shop.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>the shop</p>' }); });
  return seen;
}

const shopLink = () => `/account/shop?return=${encodeURIComponent(SHOP_RETURN_URL)}&state=${STATE}`;
async function declineCookies(page) {
  const d = page.getByRole('button', { name: /^decline$/i });
  try { await d.waitFor({ timeout: 4000 }); await d.click({ timeout: 3000 }); } catch {}
}

/**
 * Stand in for the pop-up window: the next provider sign-in on this page returns these claims to the
 * emulator's signInWithIdp, as Apple's (or Google's) would.
 */
async function popupWillReturn(page, claims) {
  await page.evaluate((c) => {
    window.__POPUP_CLAIMS__ = c;
    window.__FB_EMULATOR_POPUP__ = (providerId) => window.__FB_EMULATOR_IDP__(providerId, window.__POPUP_CLAIMS__);
  }, claims);
}

// ── the button ─────────────────────────────────────────────────────────────────────────────────
for (const [where, size] of [['header', 'desktop'], ['header', 'phone'], ['/account/shop', 'desktop'], ['/account/shop', 'phone']]) {
  test(`the button: beside Google's, the same box, lined up (${where}, ${size})`, async ({ page }) => {
    await reset();
    await page.setViewportSize(WIDTHS[size]);
    if (where === 'header') {
      await page.goto('/about');
      await declineCookies(page);
      const btn = size === 'phone' ? page.locator('.cs-hamburger') : page.locator('.cs-signin-btn');
      await btn.click({ timeout: 60000 });
      if (size === 'phone') await page.locator('.cs-drawer-signin').click();
    } else {
      await wire(page);
      await page.goto(shopLink());
      await declineCookies(page);
    }
    const modal = page.locator('.auth-backdrop');
    await expect(modal).toBeVisible({ timeout: 60000 });
    for (const mode of ['signin', 'register']) {
      if (mode === 'register') await modal.getByRole('button', { name: /Create one/ }).click();
      const a = modal.locator('[data-auth-apple]');
      await expect(a).toHaveText(APPLE_COPY.button);
      await expect(a).toBeVisible();
      // The modal animates in: wait for it to settle, then measure both in the same frame.
      await page.waitForFunction(() => document.getAnimations().every((x) => x.playState !== 'running'), null, { timeout: 10000 });
      const [gb, ab] = await page.evaluate(() => ['.auth-backdrop .auth-google:not(.auth-apple)', '.auth-backdrop [data-auth-apple]']
        .map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
      expect(Math.abs(gb.x - ab.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(gb.width - ab.width)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(gb.height - 44)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(ab.height - 44)).toBeLessThanOrEqual(0.5);
      expect(ab.y).toBeGreaterThan(gb.y + gb.height);                 // directly beneath Google's
      expect(Math.abs(ab.y - (gb.y + gb.height) - 8)).toBeLessThanOrEqual(1);   // an 8px gap (sub-pixel layout)
      // Apple's rules: white button, black logo and title.
      const style = await a.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, color: c.color, svg: getComputedStyle(el.querySelector('svg path')).fill }; });
      expect(style).toEqual({ bg: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', svg: 'rgb(0, 0, 0)' });
      // The logo and the title are centred in the box, as Google's are.
      const centre = await a.evaluate((el) => { const r = el.getBoundingClientRect(); const s = el.querySelector('svg').getBoundingClientRect(); return Math.round(Math.abs((s.top + s.height / 2) - (r.top + r.height / 2))); });
      expect(centre).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: `test-results/apple-w1/button-${where.replace(/\W/g, '')}-${size}.png` });
  });
}

// ── the flows ──────────────────────────────────────────────────────────────────────────────────
test('a returning Apple-only reader signs in to their existing account (the same uid), on /account/shop, in one tab', async ({ page }) => {
  await reset();
  const seen = await wire(page);
  await page.goto(shopLink());
  await declineCookies(page);
  await expect(page.locator('.auth-backdrop')).toBeVisible({ timeout: 60000 });
  // What Apple returns for the same Apple ID on a later sign-in: its stable `sub`, and no name.
  await popupWillReturn(page, { sub: RETURNING_SUB, email: 'returning@privaterelay.appleid.com', email_verified: true });
  await page.locator('[data-auth-apple]').click();
  await expect(page.locator('.auth-backdrop')).toHaveCount(0, { timeout: 30000 }).catch(async (e) => {
    throw new Error(`still open; modal says ${JSON.stringify(await page.locator('.auth-error').allTextContents())}; pages ${page.context().pages().length}`);
  });
  expect(page.context().pages()).toHaveLength(1);
  // Signed in as the app's account: "Keep it" mints a code whose record names that uid.
  await page.locator('[data-shop-keep]').click({ timeout: 30000 });
  await page.waitForURL(`${SHOP}/**`);
  const code = new URL(seen.shop[0]).searchParams.get('code');
  const key = createHash('sha256').update(code).digest('hex');
  expect((await db.ref(`shop_handoff_codes/${key}`).get()).val().uid).toBe(RETURNING);
  // No second account was made for the same Apple ID.
  const { users } = await auth.listUsers(1000);
  expect(users.map((u) => u.uid)).toEqual([RETURNING]);
});

test('a new Apple account meets the completion step, starting from the name Apple gave; no second tab', async ({ page }) => {
  await reset();
  await wire(page);
  await page.goto(shopLink());
  await declineCookies(page);
  await expect(page.locator('.auth-backdrop')).toBeVisible({ timeout: 60000 });
  // A first sign-in: Apple's new `sub`, a relay address, and the name Apple shares once.
  await popupWillReturn(page, { sub: '001234.newappleid.0002', email: 'ada-new@privaterelay.appleid.com', email_verified: true, name: 'Ada Appleseed' });
  await page.locator('[data-auth-apple]').click();
  await expect(page.getByText(COMPLETION_COPY.title)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('input[value="Ada Appleseed"]')).toHaveCount(1);
  await expect(page.locator('[data-shop-keep]')).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  const { users } = await auth.listUsers(1000);
  const created = users.find((u) => u.uid !== RETURNING);
  expect(created.providerData.map((p) => p.providerId)).toEqual(['apple.com']);
  expect(created.displayName).toBe('Ada Appleseed');
});

// AN EMAIL THAT ALREADY BELONGS TO A PASSWORD ACCOUNT. Firebase's one-account-per-email rule decides,
// not our code; our code's part is to hand Apple exactly what it hands Google, and to answer any
// refusal with the one failure line. So each case runs for both providers and must come out the same.
// The emulator's rule (firebase-tools, handleIdpSigninEmailRequired):
//   · the provider vouches for the email, the password account's email is VERIFIED: the reader is
//     signed in to THAT account (same uid) and the provider is added beside the password;
//   · the provider vouches for it, the password account's email is NOT verified: that account, same
//     uid, and its password is removed (whoever made it never proved the address);
//   · the provider does not vouch for it: refused (account-exists-with-different-credential); the
//     modal shows its one failure line and nothing changes.
// Production Firebase applies its own trusted-provider rules to the first two; see the report.
const PROVIDERS = [
  ['Google', '.auth-google:not(.auth-apple)', 'google.com', 'Google sign-in failed. Please try again.'],
  ['Apple', '[data-auth-apple]', 'apple.com', APPLE_COPY.failed],
];
const CASES = [
  ['vouched, password account verified', { accountVerified: true, idpVerified: true }],
  ['vouched, password account not verified', { accountVerified: false, idpVerified: true }],
  ['not vouched', { accountVerified: true, idpVerified: false }],
];
for (const [label, selector, providerId, failed] of PROVIDERS) {
  for (const [name, { accountVerified, idpVerified }] of CASES) {
    test(`${label}, an email already on a password account (${name})`, async ({ page }) => {
      await reset();
      const pw = await auth.createUser({ email: 'taken@example.com', emailVerified: accountVerified, password: 'correct-horse-9', displayName: 'Password Reader' });
      await db.ref(`users/${pw.uid}`).set({ displayName: 'Password Reader', username: 'pwreader', handle: 'pwreader' });
      await page.goto('/about');
      await declineCookies(page);
      await page.locator('.cs-signin-btn').click({ timeout: 60000 });
      await popupWillReturn(page, { sub: `${providerId.replace('.', '-')}-someone`, email: 'taken@example.com', email_verified: idpVerified, name: 'Someone Else' });
      await page.locator(selector).click();
      const others = async () => (await auth.listUsers(1000)).users.filter((u) => u.uid !== RETURNING);
      if (!idpVerified) {
        await expect(page.locator('.auth-backdrop .auth-error')).toHaveText(failed, { timeout: 30000 });
        const us = await others();
        expect(us.map((u) => u.uid)).toEqual([pw.uid]);
        expect(us[0].providerData.map((p) => p.providerId)).toEqual(['password']);
      } else {
        await expect(page.locator('.auth-backdrop')).toHaveCount(0, { timeout: 30000 });
        const us = await others();
        expect(us.map((u) => u.uid)).toEqual([pw.uid]);
        expect(us[0].providerData.map((p) => p.providerId).sort()).toEqual(accountVerified ? ['password', providerId].sort() : [providerId]);
      }
      expect(page.context().pages()).toHaveLength(1);
    });
  }
}
