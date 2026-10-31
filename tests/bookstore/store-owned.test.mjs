// STORE-OWNED (29 Oct 2026) — rulings 240, 241, 242 and 245, and the Opening Lines frame.
//
//   node --test tests/bookstore/store-owned.test.mjs      (npm run test:purchases)
//
//   240  a free title's button reads "Get · Free", mirroring "Buy · £1.99"
//   241  every title a reader HOLDS shows "In My Library" instead of Buy; both checkouts refuse
//        an owner with 409 already_owned. Owned = holdsBook: status 'active' (a sale, a comp or a
//        free copy). A revoked copy is not owned.
//   242  free is all-or-nothing: a 0 in one currency requires 0 in every currency priced
//   245  the author photo plate has 12px corners
//
// The rules half of 242 is in tests/rules/database.test.mjs ("STORE-OWNED · 242"). The rail's
// frame is asserted in a browser by tests/bookstore/payload.spec.mjs, unchanged; the CSS that
// holds it is pinned here so a later tidy cannot put the marks back inline unnoticed.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { transformSync } from '@babel/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import * as pricing from '../../app/lib/pricing.js';
import { validateTitle } from '../../app/lib/bookstore/schema.js';
import { onRequestPost as stripeCheckout } from '../../functions/api/bookstore/checkout.js';
import { onRequestPost as paystackCheckout } from '../../functions/api/bookstore/paystack-checkout.js';

const ROOT = new URL('../../', import.meta.url);
const src = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
// AuthorBlock.js is JSX, so its stylesheet is read from the source text rather than imported.
const AUTHOR_BLOCK_CSS = /AUTHOR_BLOCK_CSS = `([\s\S]*?)`;/.exec(src('app/bookstore/components/AuthorBlock.js'))[1];

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('240 · "Get · Free"', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
  test('the free button reads "Get · Free", in the "Buy · £1.99" pattern', () => {
    assert.equal(pricing.CLAIM_LABEL, 'Get · Free');
    assert.equal(/Add to My Library/.test(pricing.CLAIM_LABEL), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('241 · the owned state, on every surface', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
  test('the words and the link are shared', () => {
    assert.equal(pricing.OWNED_LABEL, 'In My Library');
    assert.equal(pricing.OWNED_HREF, '/my-library');
  });

  test('BuyButton (book page, Window, Desiderata room, the reader) shows it for ANY held title', () => {
    const btn = src('app/bookstore/components/BuyButton.js');
    assert.match(btn, /const ownsIt = !!title\?\.id && owned\.has\(title\.id\);/);
    assert.equal(/ownsIt = free &&/.test(btn), false, 'the owned state must not be gated on free');
    assert.match(btn, /if \(ownsIt\) \{[\s\S]*?href=\{OWNED_HREF\}[\s\S]*?\{OWNED_LABEL\}/);
    // Owned comes BEFORE the territory decision renders: a held book opens anywhere.
    assert.ok(btn.indexOf('if (ownsIt) {') < btn.indexOf('{!sellable ? UNAVAILABLE_LABEL'));
  });

  test('the storefront tells Quick Look whether the reader holds the title', () => {
    const shop = src('app/bookstore/page.js');
    assert.match(shop, /<QuickLookModal [^>]*owned=\{owned\.has\(modal\.title\?\.id\)\}/);
    assert.match(shop, /const \{ owned \} = useDesiderata\(\);/);
  });

  // Quick Look, RENDERED — the same harness as free-titles.test.mjs.
  const require = createRequire(import.meta.url);
  const TMP = new URL('app/bookstore/components/.quicklook-owned.test-build.mjs', ROOT);
  let QuickLookModal;
  before(async () => {
    const SRC = new URL('app/bookstore/components/QuickLookModal.js', ROOT);
    const { code } = transformSync(readFileSync(SRC, 'utf8'), {
      presets: [[require.resolve('next/dist/compiled/babel/preset-react'), { runtime: 'automatic' }]],
      configFile: false, babelrc: false, filename: fileURLToPath(SRC),
    });
    writeFileSync(TMP, code.replace(/(from\s+'\.\.?\/[^']*?)(')/g, (m, p, q) => (/\.[a-z]+$/.test(p) ? m : `${p}.js${q}`)));
    QuickLookModal = (await import(`${TMP.href}?t=${process.pid}`)).default;
  });
  after(() => rmSync(TMP, { force: true }));

  const PAID = { id: 't1', slug: 't1', title: 'A Title', prices: { gbp: 199 }, territoriesAllowed: '*' };
  const render = (props) => renderToStaticMarkup(createElement(QuickLookModal, { originRect: null, onClose() {}, ...props }));

  test('Quick Look: a held title reads "In My Library" and links to My Library — paid, free, or not licensed here', () => {
    for (const title of [PAID, { ...PAID, prices: { gbp: 0 } }, { ...PAID, territoriesAllowed: ['NG'] }]) {
      const html = render({ title, owned: true });
      assert.ok(html.includes('>In My Library</a>'), JSON.stringify(title.prices));
      assert.ok(html.includes('href="/my-library"'));
      assert.equal(/Buy ·|Get ·|Unavailable here/.test(html), false);
    }
  });

  test('Quick Look: a title NOT held is unchanged', () => {
    const html = render({ title: PAID, owned: false });
    assert.ok(html.includes('Buy · £1.99'));
    assert.ok(html.includes('href="/bookstore/t1"'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('241 · both checkouts refuse an owner, and create nothing', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
  const UID = 'OwnerUid00000000000000000001';
  const DB = 'https://stub-db.example.com';
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ENV = {
    NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_DATABASE_URL: DB,
    FIREBASE_CLIENT_EMAIL: 'sa@stub.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    STRIPE_SECRET_KEY: 'sk_test_stub', PAYSTACK_SECRET_KEY: 'sk_test_p', SITE_ORIGIN: 'https://example.test',
  };
  const TITLE = { status: 'published', slug: 't1', title: 'A Title', publisherId: 'p', prices: { gbp: 199, usd: 249, ngn: 180000 }, territoriesAllowed: '*' };

  function stub(purchase, { purchaseStatus = 200 } = {}) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const href = String(url); calls.push(href);
      const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (href.includes('identitytoolkit')) return ok({ users: [{ localId: UID, email: 'r@example.com' }] });
      if (href.includes('oauth2.googleapis.com')) return ok({ access_token: 'admin', expires_in: 3600 });
      if (href.includes('/bookstore_purchases/')) return purchaseStatus === 200 ? ok(purchase) : new Response('down', { status: purchaseStatus });
      if (href.includes('/bookstore_titles/')) return ok(TITLE);
      if (href.includes('/bookstore_publishers/')) return ok({ status: 'active' });
      if (href.includes('api.stripe.com')) return ok({ id: 'cs_test_x', url: 'https://checkout.stripe.com/x' });
      if (href.includes('api.paystack.co')) return ok({ status: true, data: { authorization_url: 'https://paystack/x' } });
      throw new Error(`unstubbed ${href}`);
    };
    return { restore: () => { globalThis.fetch = original; }, provider: () => calls.some((c) => /stripe\.com|paystack\.co/.test(c)) };
  }
  const ctx = (body, country = 'GB') => {
    const request = new Request('https://calvaryscribblings.co.uk/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    Object.defineProperty(request, 'cf', { value: { country } });
    return { request, env: ENV };
  };
  const rails = [
    ['Stripe', () => stripeCheckout(ctx({ idToken: 't', titleId: 't1', currency: 'gbp' }))],
    ['Paystack', () => paystackCheckout(ctx({ idToken: 't', titleId: 't1' }, 'NG'))],
  ];
  const HELD = {
    sale: { status: 'active', stripeSessionId: 'cs_live_1', amount: 199 },
    comp: { status: 'active', source: 'comp' },
    free: { status: 'active', rail: 'free', amount: 0, freeRef: 'free.x.t1' },
  };

  for (const [rail, call] of rails) {
    for (const [kind, rec] of Object.entries(HELD)) {
      test(`${rail}: a reader holding a ${kind} copy gets 409 already_owned with the library link — no ${rail} call`, async () => {
        const f = stub(rec);
        try {
          const res = await call();
          assert.equal(res.status, 409);
          const body = await res.json();
          assert.equal(body.code, 'already_owned');
          assert.equal(body.library, '/my-library');
          assert.equal(typeof body.error, 'string');
          assert.equal(f.provider(), false, 'nothing may be created for an owner');
        } finally { f.restore(); }
      });
    }
    test(`${rail}: a REVOKED copy is not owned — the reader may buy again`, async () => {
      const f = stub({ status: 'revoked', revokedReason: 'refunded', stripeSessionId: 'cs_old' });
      try {
        const res = await call();
        assert.equal(res.status, 200);
        assert.equal(f.provider(), true);
      } finally { f.restore(); }
    });
    test(`${rail}: no copy — sells as before`, async () => {
      const f = stub(null);
      try { assert.equal((await call()).status, 200); } finally { f.restore(); }
    });
    test(`${rail}: the copy cannot be read — FAILS OPEN, as the publisher check does`, async () => {
      const f = stub(null, { purchaseStatus: 503 });
      try { assert.equal((await call()).status, 200); } finally { f.restore(); }
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('242 · free is all-or-nothing — the form and the schema', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
  const errs = (prices) => validateTitle({ prices }).errors.filter((e) => /^prices/.test(e));

  test('mixed free and priced is refused, with the reason', () => {
    for (const prices of [{ gbp: 0, ngn: 180000 }, { gbp: 199, usd: 0 }, { gbp: 0, ngn: 0, usd: 249 }]) {
      assert.ok(errs(prices).some((e) => e.includes(pricing.FREE_ALL_OR_NOTHING_ERROR)), JSON.stringify(prices));
    }
  });

  test('free everywhere it is priced is accepted — and an empty currency still means unpriced', () => {
    for (const prices of [{ gbp: 0, ngn: 0, usd: 0 }, { gbp: 0 }, { ngn: 0, usd: 0 }, { gbp: 199, ngn: 180000 }]) {
      assert.deepEqual(errs(prices), [], JSON.stringify(prices));
    }
  });

  test('the form refuses it before saving, in the same words', () => {
    const page = src('app/admin/bookstore/page.js');
    assert.match(page, /if \(isMixedFree\(\{ gbp: majorToMinor\(form\.priceGbp\), ngn: majorToMinor\(form\.priceNgn\), usd: majorToMinor\(form\.priceUsd\) \}\)\) \{\s*local\.push\(FREE_ALL_OR_NOTHING_ERROR\);/);
    // Empty fields are null (unpriced) and so are not "a price that is not 0".
    assert.equal(pricing.isMixedFree({ gbp: pricing.parsePriceField('0'), ngn: pricing.parsePriceField(''), usd: pricing.parsePriceField('') }), false);
    assert.equal(pricing.isMixedFree({ gbp: pricing.parsePriceField('0'), ngn: pricing.parsePriceField('1800') }), true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('245 · the author photo plate', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
  const rule = /\.bd-author-plate\{([^}]*)\}/.exec(AUTHOR_BLOCK_CSS)?.[1] || '';

  test('12px corners', () => {
    assert.match(rule, /border-radius:12px/);
  });

  test('everything else is as it was: size, ratio, crop, tone, hairline, shadow', () => {
    assert.match(rule, /width:124px/);
    assert.match(rule, /aspect-ratio:4\/5/);
    assert.match(rule, /object-fit:cover;object-position:center 30%/);
    assert.match(rule, /filter:grayscale\(\.22\) sepia\(\.1\) contrast\(1\.02\)/);
    assert.match(rule, /border:1px solid rgba\(201,164,76,\.22\)/);
    assert.match(rule, /box-shadow:0 10px 26px rgba\(0,0,0,\.5\)/);
    assert.match(AUTHOR_BLOCK_CSS, /\.bd-author-plate\{width:150px\}/, 'the handset size');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('the Opening Lines frame', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
  test('the quotation marks are their own rows on every line — never inline beside the words', () => {
    const shop = src('app/bookstore/page.js');
    assert.match(shop, /\.rail-mark\{display:block\}/);
    assert.equal(/\.rail-mark\{display:inline\}/.test(shop), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('AGENTS.md', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
  test('Next\'s block, and the pointer to CLAUDE.md outside it', () => {
    const a = src('AGENTS.md');
    const end = a.indexOf('<!-- END:nextjs-agent-rules -->');
    assert.ok(a.startsWith('<!-- BEGIN:nextjs-agent-rules -->') && end > 0);
    assert.match(a.slice(end), /standing rules live in CLAUDE\.md — the release window among them/);
  });
});
