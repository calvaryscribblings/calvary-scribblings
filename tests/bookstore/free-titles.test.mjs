// FREE-TITLES (28 Oct 2026) — a price of 0 means FREE in that currency.
//
//   node --test tests/bookstore/free-titles.test.mjs      (npm run test:purchases)
//
// Ikenna's ruling: prices stay hand-set per currency, and 0 is now a legal hand-set price.
// Negative and non-numeric prices stay refused, and an EMPTY field is still "not priced in
// that currency" — never 0. A free title reaches a library through POST /api/bookstore/claim,
// which writes through patchPurchase() like a sale and calls no payment provider.
//
// What this file holds, in order:
//   1. VALIDATION — the form's field parser and the save-time schema (the rules layer is in
//      tests/rules/database.test.mjs, under "FREE-TITLES").
//   2. DISPLAY — priceLine prints "Free"; QuickLookModal and BoundBook's back cover RENDERED;
//      the shelf ticket, the button and the detail page held to priceLine by source.
//   3. THE CLAIM — onRequestPost called for real against a stateful in-memory RTDB that honours
//      ETags, so "twice grants once and counts once" is asserted for real, concurrency included.
//   4. THE TILLS — both checkout endpoints refuse a 0 price and create nothing.
//   5. REPORTING — a free copy is held and counted, never a sale; 0 never reaches arithmetic.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { transformSync } from '@babel/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  parsePriceField, isValidPrice, priceFor, regionPriceFor, isFreePrice, freeRefFor,
  FREE_LABEL, CLAIM_LABEL, CLAIM_ACTION, FREE_RAIL,
} from '../../app/lib/pricing.js';
import { priceLine, fallbackNote, fallbackSentence } from '../../app/lib/currency.js';
import { validateTitle } from '../../app/lib/bookstore/schema.js';
import { holdsBook, countsForReadership, isSale, isFreeGrant, isComp } from '../../app/lib/bookstore/purchaseSource.js';
import { isActiveHold } from '../../app/lib/bookstore/heldBook.js';
import { buildGrantPayload } from '../../functions/api/bookstore/_lib.js';
import { onRequestPost as claim, buildFreeGrantPayload, CLAIM_LOCKS_PATH } from '../../functions/api/bookstore/claim.js';
import { onRequestPost as stripeCheckout } from '../../functions/api/bookstore/checkout.js';
import { onRequestPost as paystackCheckout, selectNgnAmount } from '../../functions/api/bookstore/paystack-checkout.js';

const ROOT = new URL('../../', import.meta.url);
const src = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const priceErrors = (prices) => validateTitle({ prices }).errors.filter((e) => /^prices/.test(e));

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('1 · VALIDATION — 0 is a price, negative is not, empty is unpriced', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the form field: empty is UNPRICED (null), never 0', () => {
    for (const v of ['', '   ', null, undefined]) assert.equal(parsePriceField(v), null, JSON.stringify(v));
  });

  test('the form field: 0 is FREE, in any spelling the number input produces', () => {
    for (const v of ['0', '0.00', '0.0', 0]) assert.equal(parsePriceField(v), 0, JSON.stringify(v));
    assert.equal(parsePriceField('4.99'), 499);
    assert.equal(parsePriceField('4500'), 450000);
  });

  test('the form field: negative, non-numeric and sub-penny are INVALID (NaN), not dropped', () => {
    for (const v of ['-1', '-0.01', 'abc', '1e999', '0.004']) {
      assert.ok(Number.isNaN(parsePriceField(v)), `${v} must be refused, not silently skipped`);
    }
  });

  test('the admin form saves through parsePriceField and refuses an invalid field by name', () => {
    const page = src('app/admin/bookstore/page.js');
    assert.match(page, /const majorToMinor = parsePriceField;/);
    assert.match(page, /if \(isValidPrice\(gbp\)\) prices\.gbp = gbp;/);
    assert.match(page, /Number\.isNaN\(majorToMinor\(form\[k\]\)\)/);
    // The old drop — `n <= 0` returned null, so 0 vanished — must not come back.
    assert.equal(/n <= 0\) return null/.test(page), false);
  });

  test('save-time schema: 0 accepted in all three currencies', () => {
    assert.deepEqual(priceErrors({ gbp: 0, ngn: 0, usd: 0 }), []);
    assert.deepEqual(priceErrors({ gbp: 0 }), []);
  });

  test('save-time schema: negative, fractional and string prices refused', () => {
    for (const bad of [{ gbp: -1 }, { ngn: -100 }, { usd: 1.5 }, { gbp: '0' }, { gbp: null }]) {
      assert.equal(priceErrors(bad).length, 1, JSON.stringify(bad));
    }
  });

  test('save-time schema: an absent currency is unpriced, and no currency at all is refused', () => {
    assert.deepEqual(priceErrors({ gbp: 199 }), [], 'ngn and usd absent is fine');
    assert.ok(priceErrors({}).some((e) => /at least one/.test(e)));
  });

  test('isValidPrice is the one definition', () => {
    assert.equal(isValidPrice(0), true);
    assert.equal(isValidPrice(199), true);
    for (const v of [-1, 1.5, '0', null, undefined, NaN]) assert.equal(isValidPrice(v), false, String(v));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('2 · DISPLAY — a 0 prints "Free", in the price\'s own element', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const FREE_ALL = { id: 'ep1', slug: 'ep1', title: 'The Mysterious Cat', prices: { gbp: 0, ngn: 0, usd: 0 }, territoriesAllowed: '*' };

  test('priceLine: Free in every currency, no currency mark', () => {
    for (const c of ['gbp', 'ngn', 'usd']) {
      const l = priceLine(FREE_ALL, c, 'GB');
      assert.equal(l.price, FREE_LABEL);
      assert.equal(l.free, true);
      assert.equal(l.note, null);
      assert.equal(l.sellable, true);
    }
  });

  test('priceLine: free only in pounds, browsing in naira — Free, and no "in pounds only"', () => {
    const t = { prices: { gbp: 0 }, territoriesAllowed: '*' };
    const l = priceLine(t, 'ngn', 'NG');
    assert.equal(l.price, 'Free');
    assert.equal(l.free, true);
    assert.equal(l.note, null, 'free in pounds is free — a currency mark names money nobody pays');
    assert.equal(fallbackSentence(l.priced, 'ngn'), null);
    assert.equal(fallbackNote(l.priced), null);
  });

  test('priceLine: free in one currency, priced in another — each reader sees their own', () => {
    const t = { prices: { gbp: 199, ngn: 0 }, territoriesAllowed: '*' };
    assert.equal(priceLine(t, 'ngn', 'NG').price, 'Free');
    assert.equal(priceLine(t, 'gbp', 'GB').price, '£1.99');
    assert.equal(priceLine(t, 'gbp', 'GB').free, false);
  });

  test('a title NOT priced in the reader\'s currency is still shown and marked as before', () => {
    const t = { prices: { gbp: 199 }, territoriesAllowed: '*' };
    const l = priceLine(t, 'ngn', 'NG');
    assert.equal(l.price, '£1.99');
    assert.equal(l.note, 'in pounds only');
    assert.equal(l.free, false);
  });

  test('territory still outranks the price: an excluded free title shows no price and no claim', () => {
    const t = { ...FREE_ALL, territoriesAllowed: ['GB'] };
    const l = priceLine(t, 'usd', 'US');
    assert.equal(l.sellable, false);
    assert.equal(l.price, null);
    assert.equal(l.free, false);
  });

  test('priceFor: 0 wins the selection like any price; absent still falls back', () => {
    assert.deepEqual(priceFor({ prices: { gbp: 199, ngn: 0 } }, 'ngn'), { currency: 'ngn', minorUnits: 0, isFallback: false });
    assert.deepEqual(priceFor({ prices: { gbp: 0 } }, 'usd'), { currency: 'gbp', minorUnits: 0, isFallback: true });
    assert.equal(priceFor({ prices: { gbp: -1 } }, 'gbp'), null);
  });

  test('the button words: the act, then the price', () => {
    assert.equal(CLAIM_LABEL, `${CLAIM_ACTION} · ${FREE_LABEL}`);
    // Ruling 240 (29 Oct 2026): "Get · Free", mirroring "Buy · £1.99".
    assert.equal(CLAIM_ACTION, 'Get');
    assert.equal(CLAIM_LABEL, 'Get · Free');
  });

  // ── RENDERED: Quick Look and the back cover ──────────────────────────────────────────────
  // Same harness as tests/bookstore/author-render.test.mjs: JSX through Next's own babel
  // preset, written beside the original under a dot-prefixed, gitignored name, imported, deleted.
  const require = createRequire(import.meta.url);
  const builds = [];
  async function load(rel, tmpName) {
    const SRC = new URL(rel, ROOT);
    const TMP = new URL(rel.replace(/[^/]+$/, tmpName), ROOT);
    const { code } = transformSync(readFileSync(SRC, 'utf8'), {
      presets: [[require.resolve('next/dist/compiled/babel/preset-react'), { runtime: 'automatic' }]],
      configFile: false, babelrc: false, filename: fileURLToPath(SRC),
    });
    const resolved = code.replace(/(from\s+'\.\.?\/[^']*?)(')/g, (m, path, q) => (/\.[a-z]+$/.test(path) ? m : `${path}.js${q}`));
    writeFileSync(TMP, resolved);
    builds.push(TMP);
    return import(`${TMP.href}?t=${process.pid}`);
  }
  let QuickLookModal; let BoundBook;
  before(async () => {
    QuickLookModal = (await load('app/bookstore/components/QuickLookModal.js', '.quicklook.test-build.mjs')).default;
    BoundBook = (await load('app/bookstore/components/BoundBook.js', '.boundbook-free.test-build.mjs')).default;
  });
  after(() => { for (const f of builds) rmSync(f, { force: true }); });

  const PAID = { ...FREE_ALL, prices: { gbp: 199, ngn: 180000, usd: 249 } };

  test('Quick Look renders "Get · Free" for a free title, "Buy · £1.99" otherwise', () => {
    const free = renderToStaticMarkup(createElement(QuickLookModal, { title: FREE_ALL, originRect: null, onClose() {} }));
    assert.ok(free.includes(CLAIM_LABEL), 'the claim label');
    assert.equal(/Buy ·/.test(free), false, 'no Buy on a free title');
    assert.equal(/£0\.00|₦0|\$0\.00/.test(free), false, 'never a zero sum');
    const paid = renderToStaticMarkup(createElement(QuickLookModal, { title: PAID, originRect: null, onClose() {} }));
    assert.ok(paid.includes('Buy · £1.99'));
  });

  test('the back cover prints "Free" where the price prints, in the same element', () => {
    const free = renderToStaticMarkup(createElement(BoundBook, { title: FREE_ALL, variant: 'shelf' }));
    const paid = renderToStaticMarkup(createElement(BoundBook, { title: PAID, variant: 'shelf' }));
    const priceEl = (html, text) => new RegExp(`font-weight:700;font-size:\\.82rem;color:#2a2318">${text.replace(/[.$]/g, '\\$&')}</div>`).test(html);
    assert.ok(priceEl(paid, '£1.99'), 'harness check: the paid price is where we look');
    assert.ok(priceEl(free, 'Free'), '"Free" in the very element £1.99 occupies');
    assert.equal(/£0\.00/.test(free), false);
  });

  // ── BY SOURCE: the surfaces whose modules cannot load outside a browser ───────────────────
  test('the shelf ticket prints priceLine\'s price in .entry-price — the element a price uses', () => {
    const shop = src('app/bookstore/page.js');
    assert.match(shop, /const \{ price, note, isTerritoryNote \} = priceLine\(title, currency, country\);/);
    assert.match(shop, /\{price && <div className="entry-price">\{price\}<\/div>\}/);
  });

  test('the buy button (detail page, Window, room, reader) claims on free and labels it so', () => {
    const btn = src('app/bookstore/components/BuyButton.js');
    assert.match(btn, /priceLine\(title, currency, country\)/);
    assert.match(btn, /free \? \(pending \? 'Adding…' : CLAIM_LABEL\)/);
    assert.match(btn, /if \(free\) \{[\s\S]*?claimFreeTitle\(user, title\?\.id\)/);
    // A free title never reaches the checkout call.
    const freeBranch = btn.slice(btn.indexOf('if (free) {'), btn.indexOf('return;', btn.indexOf('if (free) {')));
    assert.equal(/createCheckoutSession/.test(freeBranch), false);
    // Signed out: the existing in-place sign-in, before either branch.
    assert.ok(btn.indexOf('if (!user) { setShowAuth(true); return; }') < btn.indexOf('if (free) {'));
    const detail = src('app/bookstore/[slug]/page-detail.js');
    assert.match(detail, /<BuyButton title=\{title\} className="bd-cta bd-buy" \/>/);
  });

  test('no surface formats a price itself — every one goes through priceLine', () => {
    for (const f of ['app/bookstore/page.js', 'app/bookstore/components/BoundBook.js', 'app/bookstore/components/QuickLookModal.js',
      'app/bookstore/components/BuyButton.js', 'app/bookstore/[slug]/page-detail.js']) {
      assert.equal(/\bformatPrice\(/.test(src(f)), false, `${f} calls formatPrice directly — it would print £0.00`);
    }
  });

  test('the claim sends a titleId and nothing else — no price, no currency', () => {
    const lib = src('app/lib/bookstore/checkout.js');
    const fn = lib.slice(lib.indexOf('export async function claimFreeTitle'));
    assert.match(fn, /body: JSON\.stringify\(\{ titleId \}\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
// 3 · THE CLAIM, against a stateful RTDB that honours ETags
// ═════════════════════════════════════════════════════════════════════════════════════════

const UID = 'ReaderUid0000000000000000001';
const TITLE_ID = 'starlet-the-mysterious-cat-episode-1';
const DB = 'https://stub-db.example.com';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'stub-web-api-key',
  FIREBASE_DATABASE_URL: DB,
  FIREBASE_CLIENT_EMAIL: 'sa@stub.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  STRIPE_SECRET_KEY: 'sk_test_stub',
  PAYSTACK_SECRET_KEY: 'sk_test_paystack_stub',
  SITE_ORIGIN: 'https://example.test',
};

const FREE_TITLE = {
  status: 'published', slug: TITLE_ID, title: 'The Mysterious Cat — Episode 1', author: 'Starlet Comics',
  coverUrl: 'https://example.test/c.jpg', publisherId: 'starlet', prices: { gbp: 0, ngn: 0, usd: 0 }, territoriesAllowed: '*',
};

/** A tiny RTDB: GET (with ETag), conditional PUT, DELETE, and the root multi-path PATCH. */
function fakeDb(seed = {}) {
  const tree = structuredClone(seed);
  const calls = [];
  const split = (p) => p.split('/').filter(Boolean).map(decodeURIComponent);
  const getAt = (parts) => parts.reduce((n, k) => (n && typeof n === 'object' ? n[k] ?? null : null), tree) ?? null;
  const setAt = (parts, v) => {
    let n = tree;
    for (const k of parts.slice(0, -1)) { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    const last = parts[parts.length - 1];
    if (v === null) delete n[last]; else n[last] = v;
  };
  const etag = (v) => createHash('sha1').update(JSON.stringify(v)).digest('base64');
  const ok = (data, headers = {}) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });

  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const method = init.method || 'GET';
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url: href, method });
    // Yield, so two claims in flight genuinely interleave.
    await new Promise((r) => setImmediate(r));

    if (href.includes('identitytoolkit.googleapis.com')) {
      const tok = JSON.parse(init.body).idToken;
      return ok({ users: tok === 'good-token' ? [{ localId: UID, email: 'r@example.com' }] : [] });
    }
    if (href.includes('oauth2.googleapis.com')) return ok({ access_token: 'stub-admin', expires_in: 3600 });
    if (href.includes('api.stripe.com')) return ok({ id: 'cs_test_x', url: 'https://checkout.stripe.com/x' });
    if (href.includes('api.paystack.co')) return ok({ status: true, data: { authorization_url: 'https://paystack/x' } });
    if (!href.startsWith(DB)) throw new Error(`unstubbed fetch: ${href}`);

    const path = new URL(href).pathname.replace(/\.json$/, '');
    const parts = split(path);
    if (method === 'GET') {
      const v = getAt(parts);
      return ok(v, headers['x-firebase-etag'] ? { ETag: etag(v) } : {});
    }
    if (method === 'PUT') {
      if (headers['if-match'] && headers['if-match'] !== etag(getAt(parts))) {
        return new Response('{"error":"precondition"}', { status: 412, headers: { ETag: etag(getAt(parts)) } });
      }
      setAt(parts, JSON.parse(init.body));
      return ok(JSON.parse(init.body));
    }
    if (method === 'DELETE') { setAt(parts, null); return ok(null); }
    if (method === 'PATCH' && parts.length === 0) {
      for (const [p, v] of Object.entries(JSON.parse(init.body))) {
        const ps = split(p);
        if (v && typeof v === 'object' && v['.sv']?.increment !== undefined) setAt(ps, (getAt(ps) || 0) + v['.sv'].increment);
        else setAt(ps, v);
      }
      return ok({});
    }
    throw new Error(`fake db cannot ${method} ${href}`);
  };

  return {
    tree, calls,
    restore: () => { globalThis.fetch = original; },
    purchase: () => getAt(['bookstore_purchases', UID, TITLE_ID]),
    count: () => getAt(['bookstore_readership', TITLE_ID, 'count']),
    locks: () => getAt([CLAIM_LOCKS_PATH, TITLE_ID, UID]),
    hitProvider: () => calls.some((c) => /api\.stripe\.com|api\.paystack\.co/.test(c.url)),
    purchaseWrites: () => calls.filter((c) => c.method !== 'GET' && (c.url === `${DB}/.json`)).length,
  };
}

function ctx(body, { country = 'GB', token = 'good-token', header = true } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token && header) h.Authorization = `Bearer ${token}`;
  const request = new Request('https://calvaryscribblings.co.uk/api/bookstore/claim', {
    method: 'POST', headers: h, body: JSON.stringify(body ?? {}),
  });
  if (country !== null) Object.defineProperty(request, 'cf', { value: { country }, configurable: true });
  return { request, env: ENV };
}

const seedTitle = (title = FREE_TITLE, extra = {}) => ({
  bookstore_titles: { [TITLE_ID]: title },
  bookstore_publishers: { starlet: { status: 'active' } },
  ...extra,
});

describe('3 · THE CLAIM — refusals', () => {
  test('signed out: 401 signed_out, nothing read, nothing written', async () => {
    const db = fakeDb(seedTitle());
    try {
      const res = await claim(ctx({ titleId: TITLE_ID }, { token: null }));
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, 'signed_out');
      assert.equal(db.purchase(), null);
    } finally { db.restore(); }
  });

  test('an expired or forged token: 401 signed_out', async () => {
    const db = fakeDb(seedTitle());
    try {
      const res = await claim(ctx({ titleId: TITLE_ID }, { token: 'bad-token' }));
      assert.equal(res.status, 401);
      assert.equal(db.purchase(), null);
    } finally { db.restore(); }
  });

  test('a title that is NOT free: 409 not_free, nothing written', async () => {
    const db = fakeDb(seedTitle({ ...FREE_TITLE, prices: { gbp: 199, ngn: 180000, usd: 249 } }));
    try {
      const res = await claim(ctx({ titleId: TITLE_ID }));
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'not_free');
      assert.equal(db.purchase(), null);
      assert.equal(db.count(), null);
    } finally { db.restore(); }
  });

  test('free in naira only: a reader in Lagos may claim, a reader in London may not — and a body currency changes nothing', async () => {
    const t = { ...FREE_TITLE, prices: { gbp: 199, ngn: 0 } };
    let db = fakeDb(seedTitle(t));
    try {
      const res = await claim(ctx({ titleId: TITLE_ID, currency: 'ngn', prices: { gbp: 0 } }, { country: 'GB' }));
      assert.equal(res.status, 409, 'the client cannot talk its way into a free copy');
      assert.equal(db.purchase(), null);
    } finally { db.restore(); }
    db = fakeDb(seedTitle(t));
    try {
      const res = await claim(ctx({ titleId: TITLE_ID }, { country: 'NG' }));
      assert.equal(res.status, 200);
      assert.equal(db.purchase().currency, 'ngn');
    } finally { db.restore(); }
  });

  test('an unpublished title: 403 not_on_sale', async () => {
    for (const status of ['draft', 'unpublished', 'withdrawn']) {
      const db = fakeDb(seedTitle({ ...FREE_TITLE, status }));
      try {
        const res = await claim(ctx({ titleId: TITLE_ID }));
        assert.equal(res.status, 403, status);
        assert.equal((await res.json()).code, 'not_on_sale');
        assert.equal(db.purchase(), null);
      } finally { db.restore(); }
    }
  });

  test('a suspended publisher: 403 not_on_sale', async () => {
    const db = fakeDb({ ...seedTitle(), bookstore_publishers: { starlet: { status: 'suspended' } } });
    try {
      const res = await claim(ctx({ titleId: TITLE_ID }));
      assert.equal(res.status, 403);
      assert.equal(db.purchase(), null);
    } finally { db.restore(); }
  });

  test('excluded in the reader\'s territory: 403 not_in_territory — free is still licensed', async () => {
    const cases = [[{ territoriesAllowed: ['GB', 'IE'] }, 'US'], [{ territoriesAllowed: '*', territoriesExcluded: ['US'] }, 'US'], [{ territoriesAllowed: ['GB'] }, null]];
    for (const [terr, country] of cases) {
      const db = fakeDb(seedTitle({ ...FREE_TITLE, ...terr }));
      try {
        const res = await claim(ctx({ titleId: TITLE_ID }, { country }));
        assert.equal(res.status, 403, JSON.stringify([terr, country]));
        assert.equal((await res.json()).code, 'not_in_territory');
        assert.equal(db.purchase(), null);
      } finally { db.restore(); }
    }
  });

  test('a missing title: 404; a malformed id: 400', async () => {
    const db = fakeDb({});
    try {
      assert.equal((await claim(ctx({ titleId: TITLE_ID }))).status, 404);
      assert.equal((await claim(ctx({ titleId: '../users' }))).status, 400);
    } finally { db.restore(); }
  });
});

describe('3 · THE CLAIM — the grant', () => {
  test('a free title is granted through the purchase write: active, rail free, amount 0, deterministic ref, counted', async () => {
    const db = fakeDb(seedTitle());
    try {
      const res = await claim(ctx({ titleId: TITLE_ID }));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, granted: true });
      const rec = db.purchase();
      assert.equal(rec.status, 'active');
      assert.equal(rec.rail, FREE_RAIL);
      assert.equal(rec.amount, 0);
      assert.equal(rec.currency, 'gbp');
      assert.equal(rec.freeRef, freeRefFor(UID, TITLE_ID));
      assert.equal(rec.slug, TITLE_ID);
      assert.equal(rec.title, FREE_TITLE.title);
      assert.equal(typeof rec.purchasedAt, 'number');
      assert.equal(db.count(), 1, 'the public count moved once, in the same write');
      assert.equal(db.hitProvider(), false, 'no Stripe, no Paystack');
      assert.equal(db.locks(), null, 'the lock is released');
      // Exactly one write to the root: the grant and the count together (patchPurchase).
      assert.equal(db.purchaseWrites(), 1);
    } finally { db.restore(); }
  });

  test('the Authorization header and the body idToken both identify the reader', async () => {
    const db = fakeDb(seedTitle());
    try {
      const res = await claim(ctx({ titleId: TITLE_ID, idToken: 'good-token' }, { header: false }));
      assert.equal(res.status, 200);
    } finally { db.restore(); }
  });

  test('CLAIMING TWICE — one grant, one count', async () => {
    const db = fakeDb(seedTitle());
    try {
      assert.equal((await claim(ctx({ titleId: TITLE_ID }))).status, 200);
      const first = structuredClone(db.purchase());
      const res = await claim(ctx({ titleId: TITLE_ID }));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, already: true });
      assert.deepEqual(db.purchase(), first, 'the second claim wrote nothing');
      assert.equal(db.count(), 1);
      assert.equal(db.purchaseWrites(), 1);
    } finally { db.restore(); }
  });

  test('CLAIMING TWICE AT ONCE — the lock: one grant, one count', async () => {
    const db = fakeDb(seedTitle());
    try {
      const results = await Promise.all([1, 2, 3].map(() => claim(ctx({ titleId: TITLE_ID }))));
      const bodies = await Promise.all(results.map((r) => r.json()));
      assert.equal(bodies.filter((b) => b.granted).length, 1, JSON.stringify(bodies));
      assert.equal(db.count(), 1, 'three taps in flight are still one library');
      assert.equal(db.purchaseWrites(), 1);
      assert.equal(db.purchase().status, 'active');
      assert.equal(db.locks(), null);
    } finally { db.restore(); }
  });

  test('a stale lock (a worker killed mid-claim) blocks nothing', async () => {
    const db = fakeDb(seedTitle(undefined, { [CLAIM_LOCKS_PATH]: { [TITLE_ID]: { [UID]: { nonce: 'dead', at: 1 } } } }));
    try {
      const res = await claim(ctx({ titleId: TITLE_ID }));
      assert.equal(res.status, 200);
      assert.equal(db.count(), 1);
    } finally { db.restore(); }
  });

  test('a reader who already holds it (a sale, a comp) — nothing written, the count unmoved', async () => {
    for (const rec of [
      { status: 'active', stripeSessionId: 'cs_live_1', amount: 199, currency: 'gbp' },
      { status: 'active', source: 'comp', compGrant: 'founder-comps-2026-09-25' },
    ]) {
      const db = fakeDb(seedTitle(undefined, {
        bookstore_purchases: { [UID]: { [TITLE_ID]: rec } },
        bookstore_readership: { [TITLE_ID]: { count: 7 } },
      }));
      try {
        const res = await claim(ctx({ titleId: TITLE_ID }));
        assert.deepEqual(await res.json(), { ok: true, already: true });
        assert.deepEqual(db.purchase(), rec, 'a sale stays a sale, a comp stays a comp');
        assert.equal(db.count(), 7);
      } finally { db.restore(); }
    }
  });

  test('a refunded sale, now free: granted, the dead charge\'s ids cleared, counted', async () => {
    const db = fakeDb(seedTitle(undefined, {
      bookstore_purchases: { [UID]: { [TITLE_ID]: {
        status: 'revoked', revokedReason: 'refunded', revokedAt: 5, stripeSessionId: 'cs_live_old', stripePaymentIntent: 'pi_old', amount: 199,
      } } },
    }));
    try {
      assert.equal((await claim(ctx({ titleId: TITLE_ID }))).status, 200);
      const rec = db.purchase();
      assert.equal(rec.status, 'active');
      assert.equal(rec.revokedReason, undefined);
      assert.equal(rec.stripeSessionId, undefined, 'a late dispute on the old charge must not match a free copy');
      assert.equal(rec.stripePaymentIntent, undefined);
      assert.equal(isSale(rec), false, 'and it is not revenue');
      assert.equal(db.count(), 1);
    } finally { db.restore(); }
  });

  test('the endpoint calls no provider and sends no receipt — by source', () => {
    const s = src('functions/api/bookstore/claim.js').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/stripe|paystack|resend|receipt|_stripe\.js/i.test(s.replace(/stripeSessionId|stripePaymentIntent|paystackRef/g, '')), false);
    assert.match(s, /patchPurchase\(env, token, uid, titleId, payload, existing\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('4 · THE TILLS refuse a free title, and create nothing', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('Stripe: 409 free_title pointing at the claim, no session', async () => {
    for (const cur of ['gbp', 'usd']) {
      const db = fakeDb(seedTitle());
      try {
        const res = await stripeCheckout(ctx({ idToken: 'good-token', titleId: TITLE_ID, currency: cur }));
        assert.equal(res.status, 409, cur);
        const body = await res.json();
        assert.equal(body.code, 'free_title');
        assert.equal(body.claim, '/api/bookstore/claim');
        assert.equal(db.hitProvider(), false, 'never a zero-amount session');
      } finally { db.restore(); }
    }
  });

  test('Paystack: 409 free_title pointing at the claim, no transaction', async () => {
    const db = fakeDb(seedTitle());
    try {
      const res = await paystackCheckout(ctx({ idToken: 'good-token', titleId: TITLE_ID }, { country: 'NG' }));
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.code, 'free_title');
      assert.equal(body.claim, '/api/bookstore/claim');
      assert.equal(db.hitProvider(), false);
    } finally { db.restore(); }
    assert.equal(selectNgnAmount({ prices: { ngn: 0 } }).code, 'free_title');
    assert.equal(selectNgnAmount({ prices: {} }).code, 'not_priced_in_ngn', 'absent is still unpriced');
  });

  test('a paid title still sells — the guard is a guard, not an off switch', async () => {
    const db = fakeDb(seedTitle({ ...FREE_TITLE, prices: { gbp: 199, ngn: 0 } }));
    try {
      const res = await stripeCheckout(ctx({ idToken: 'good-token', titleId: TITLE_ID, currency: 'gbp' }));
      assert.equal(res.status, 200);
      assert.equal(db.hitProvider(), true);
    } finally { db.restore(); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('5 · REPORTING — held and counted like a sale, never revenue', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const rec = buildFreeGrantPayload({ uid: UID, titleId: TITLE_ID, currency: 'gbp', title: FREE_TITLE });

  test('stream.js and My Library open it; the public count counts it', () => {
    assert.equal(holdsBook(rec), true);
    assert.equal(isActiveHold(rec), true, 'the exact test stream.js and My Library make');
    assert.equal(countsForReadership(rec), true);
    assert.equal(isComp(rec), false);
  });

  test('it is a free grant and not a sale; its amount is 0, a number — never NaN in a sum', () => {
    assert.equal(isFreeGrant(rec), true);
    assert.equal(isSale(rec), false);
    assert.equal(rec.amount, 0);
    const records = [rec, { status: 'active', amount: 199, stripeSessionId: 'cs_1' }];
    const revenue = records.filter(isSale).reduce((s, r) => s + r.amount, 0);
    assert.equal(revenue, 199);
    assert.equal(Number.isNaN(records.reduce((s, r) => s + (r.amount ?? 0), 0)), false);
  });

  test('a paid grant over a free copy makes it a sale — the free markers are cleared', () => {
    const paid = buildGrantPayload({ amount: 199, currency: 'gbp', refField: 'stripeSessionId', refValue: 'cs_live_2' });
    assert.equal(paid.freeRef, null);
    assert.equal(paid.rail, null);
    const merged = Object.fromEntries(Object.entries({ ...rec, ...paid }).filter(([, v]) => v !== null));
    assert.equal(isFreeGrant(merged), false);
    assert.equal(isSale(merged), true);
  });

  test('the free grant keeps its own ref and rail through the shared payload builder', () => {
    assert.equal(rec.freeRef, freeRefFor(UID, TITLE_ID));
    assert.equal(rec.rail, FREE_RAIL);
    assert.equal(rec.status, 'active');
  });

  test('regionPriceFor is the shelf\'s own answer for the edge\'s country', () => {
    const t = { prices: { gbp: 199, ngn: 0, usd: 249 } };
    assert.equal(isFreePrice(regionPriceFor(t, 'NG')), true);
    assert.equal(isFreePrice(regionPriceFor(t, 'GB')), false);
    assert.equal(isFreePrice(regionPriceFor(t, null)), false, 'unknown country browses in pounds, as on the shelf');
    assert.equal(isFreePrice(regionPriceFor({ prices: { gbp: 0 } }, 'NG')), true, 'free in pounds is free to a reader in Lagos, as the shelf shows it');
  });
});
