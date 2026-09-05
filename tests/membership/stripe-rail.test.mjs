// R10.4 — THE STRIPE SUBSCRIPTION RAIL.
//
//   node --test tests/membership/stripe-rail.test.mjs      (npm run test:membership)
//
// Offline: Stripe and Firebase are both stubbed, and the webhook is driven through a REAL
// HMAC signature so the verification path is exercised rather than bypassed.
//
// THE ACCEPTANCE THIS ROUND WAS COMMISSIONED ON is the upgrade. A founding Gold member who
// moves to Platinum through the billing portal must land on a FOUNDING Platinum price and
// keep `founding: true` with their ORIGINAL `foundingSince`. That failure mode is invisible in
// production — nothing errors, the subscription is valid, and the member only finds out when
// they compare notes with somebody who joined later — so it is asserted here, in the round
// that builds it, rather than discovered in the round that would have to migrate it.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import {
  AMOUNTS, PRICE_BOOK, PORTAL_CONFIGURATION, TIERS, INTERVALS, STRIPE_CURRENCIES,
  priceIdFor, describePrice, isFoundingPrice, isConfigured, priceIdsForGeneration, modeOf,
} from '../../functions/api/membership/prices.js';
import { MEMBERSHIPS_ON_SALE } from '../../app/lib/membershipPrices.js';
import { validateSelection } from '../../functions/api/membership/checkout.js';
import { noCustomerResponse } from '../../functions/api/membership/portal.js';
import {
  detailForSubscription, extractPriceId, extractUid, mapStatus, asId,
  onRequestPost as webhookPost,
} from '../../functions/api/membership/stripe-webhook.js';
import { SCALAR_PATH, DETAIL_PATH } from '../../functions/api/membership/_membership.js';

const UID = 'reader-uid-0001';
const NOW = 1786000000000;
const JOINED = 1780000000000;          // six months before NOW — the founding date
const SECRET = 'whsec_test_secret';

// Fake but structurally real price ids, installed into the exported book so the reverse lookup
// under test is the real one. Restored after every test.
const ID = (t, iv, c) => `price_founding_${t}_${iv}_${c}`;
const CURRENT_ID = (t, iv, c) => `price_current_${t}_${iv}_${c}`;
let snapshot;

beforeEach(() => {
  snapshot = JSON.stringify({ book: PRICE_BOOK, portal: PORTAL_CONFIGURATION });
  for (const tier of TIERS) {
    for (const iv of INTERVALS) {
      for (const c of STRIPE_CURRENCIES) PRICE_BOOK.founding.test[tier][iv][c] = ID(tier, iv, c);
    }
  }
  PORTAL_CONFIGURATION.founding.test = 'bpc_test_founding';
});
afterEach(() => {
  const s = JSON.parse(snapshot);
  for (const tier of TIERS) {
    for (const iv of INTERVALS) {
      for (const c of STRIPE_CURRENCIES) PRICE_BOOK.founding.test[tier][iv][c] = s.book.founding.test[tier][iv][c];
    }
  }
  PORTAL_CONFIGURATION.founding.test = s.portal.founding.test;
});

describe('the price book', () => {
  test('the settled figures, in minor units, per currency — never converted', () => {
    assert.deepEqual(AMOUNTS.gold.monthly, { gbp: 299, usd: 399 });
    assert.deepEqual(AMOUNTS.platinum.monthly, { gbp: 499, usd: 649 });
    assert.deepEqual(AMOUNTS.gold.annual, { gbp: 2999, usd: 3999 });
    assert.deepEqual(AMOUNTS.platinum.annual, { gbp: 4999, usd: 6499 });
    // "Ten months for twelve" is the PITCH, not the arithmetic: £2.99 × 10 is £29.90 and the
    // settled annual is £29.99, rounded to a price that reads properly. The settled figures
    // are the truth — this asserts the discount lands between ten and eleven months so a
    // future edit cannot quietly make the annual a worse deal than paying monthly, without
    // pretending to a formula nobody agreed to.
    for (const tier of TIERS) {
      for (const c of STRIPE_CURRENCIES) {
        const months = AMOUNTS[tier].annual[c] / AMOUNTS[tier].monthly[c];
        assert.ok(months >= 10 && months < 11,
          `${tier}/${c} annual is ${months.toFixed(2)} months of its own currency — expected ~10`);
      }
    }
  });

  test('NGN is absent — Stripe cannot settle naira', () => {
    assert.equal(STRIPE_CURRENCIES.includes('ngn'), false);
    for (const tier of TIERS) for (const iv of INTERVALS) {
      assert.equal('ngn' in AMOUNTS[tier][iv], false);
    }
  });

  test('the reverse lookup names what a price IS', () => {
    assert.deepEqual(describePrice(ID('gold', 'monthly', 'gbp'), 'test'),
      { generation: 'founding', tier: 'gold', interval: 'monthly', currency: 'gbp' });
    assert.deepEqual(describePrice(ID('platinum', 'annual', 'usd'), 'test'),
      { generation: 'founding', tier: 'platinum', interval: 'annual', currency: 'usd' });
  });

  test('an unknown price is null, never guessed', () => {
    for (const junk of [null, undefined, '', 'price_made_up', CURRENT_ID('gold', 'monthly', 'gbp'), 42]) {
      assert.equal(describePrice(junk, 'test'), null);
      assert.equal(isFoundingPrice(junk, 'test'), false);
    }
  });

  test('isConfigured is false until ALL EIGHT ids exist', () => {
    assert.equal(isConfigured('test'), true);
    assert.equal(priceIdsForGeneration('founding', 'test').length, 8);
    PRICE_BOOK.founding.test.platinum.annual.usd = null;
    assert.equal(isConfigured('test'), false, 'one missing id must fail the whole check');
  });

  // ⚠ R9.1 — THIS ASSERTION USED TO READ `assert.equal(isConfigured('live'), false)`, with the
  // message 'live is unconfigured in this build'. That hard-codes TODAY'S ANSWER into a suite
  // that runs on the launch commit: the moment the live ids are pasted this file reddened, for
  // the right reason but with a message that reads like a bug, and the obvious fix under
  // launch-day pressure is to delete the line — which would have removed the only coupling of
  // any kind between the flag and the ids. (There was no other: the interlock
  // app/lib/membershipPrices.js claims is enforced by tests/membership/on-sale.test.mjs did not
  // exist until R9.1 built it.)
  //
  // So it asserts the INVARIANT instead, and passes on both sides of the flip. on-sale.test.mjs
  // holds the same iff across BOTH rails together and owns the failure messages; this is the
  // Stripe half restated where a reader of this file will meet it.
  test('live is configured IFF MEMBERSHIPS_ON_SALE — no hard-coded pre-launch answer', () => {
    assert.equal(
      isConfigured('live'), MEMBERSHIPS_ON_SALE,
      `stripe live=${isConfigured('live')} MEMBERSHIPS_ON_SALE=${MEMBERSHIPS_ON_SALE}. `
      + 'Paste the live ids and flip the flag in the SAME commit — and paste Paystack\'s in it '
      + 'too, or tests/membership/on-sale.test.mjs will redden on the half-pasted state.',
    );
  });

  test('modeOf reads the key prefix, and defaults to test', () => {
    assert.equal(modeOf('sk_live_abc'), 'live');
    assert.equal(modeOf('sk_test_abc'), 'test');
    assert.equal(modeOf(undefined), 'test');
    assert.equal(modeOf(''), 'test');
  });
});

describe('checkout — what the client may choose, and what it may not', () => {
  test('a valid selection passes through, lowercased', () => {
    assert.deepEqual(validateSelection({ tier: 'gold', interval: 'monthly', currency: 'GBP' }),
      { ok: true, tier: 'gold', interval: 'monthly', currency: 'gbp' });
  });

  test('naira is named as the WRONG RAIL, not as an invalid currency', () => {
    // It is not the reader's mistake; it is a different provider. Copy that says "unsupported"
    // would send them looking for a fault that is not theirs.
    const r = validateSelection({ tier: 'gold', interval: 'monthly', currency: 'ngn' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'wrong_rail');
    assert.match(r.error, /Paystack/);
  });

  test('everything else is refused', () => {
    assert.equal(validateSelection({ tier: 'silver', interval: 'monthly', currency: 'gbp' }).code, 'bad_tier');
    assert.equal(validateSelection({ tier: 'gold', interval: 'weekly', currency: 'gbp' }).code, 'bad_interval');
    assert.equal(validateSelection({ tier: 'gold', interval: 'monthly', currency: 'eur' }).code, 'bad_currency');
    assert.equal(validateSelection({}).code, 'bad_tier');
    // no amount is accepted from the client, in any shape
    const r = validateSelection({ tier: 'gold', interval: 'monthly', currency: 'gbp', amount: 1 });
    assert.equal(r.ok, true);
    assert.equal('amount' in r, false, 'a client amount must never survive validation');
  });

  test('priceIdFor resolves a real shared Price, never an inline one', () => {
    assert.equal(priceIdFor({ tier: 'gold', interval: 'monthly', currency: 'gbp', mode: 'test' }),
      ID('gold', 'monthly', 'gbp'));
    assert.equal(priceIdFor({ tier: 'gold', interval: 'monthly', currency: 'ngn', mode: 'test' }), null);
    assert.equal(priceIdFor({ tier: 'gold', interval: 'monthly', currency: 'gbp', mode: 'live' }), null);
  });
});

describe('the portal — the honest no-customer state', () => {
  test('a reader who never joined is told exactly that, at 200', () => {
    const r = noCustomerResponse(null);
    assert.equal(r.url, null);
    assert.equal(r.code, 'no_customer');
    assert.equal(r.pending, false);
    assert.match(r.error, /do not have a membership/);
  });

  test('a reader mid-webhook is told to wait, and is distinguishable', () => {
    // Subscribed seconds ago; the customer id has not landed yet. Both are ordinary states,
    // and the caller can tell them apart without parsing prose.
    const r = noCustomerResponse({ tier: 'gold', status: 'active' });
    assert.equal(r.url, null);
    assert.equal(r.code, 'no_customer');
    assert.equal(r.pending, true);
    assert.match(r.error, /still setting up/);
  });
});

// ── the subscription reader ─────────────────────────────────────────────────

const sub = ({ price, id = 'sub_LIVE', customer = 'cus_1', status = 'active', periodEnd = NOW + 30 * 86400_000, cancelAtPeriodEnd = false, uid = UID } = {}) => ({
  id, customer, status,
  cancel_at_period_end: cancelAtPeriodEnd,
  current_period_end: Math.floor(periodEnd / 1000),
  items: { data: [{ price: { id: price } }] },
  metadata: { uid, kind: 'membership' },
});

describe('reading a subscription — the tier comes from the PRICE, never from metadata', () => {
  test('extractors', () => {
    assert.equal(extractPriceId(sub({ price: 'price_x' })), 'price_x');
    assert.equal(extractPriceId({ items: { data: [{ price: 'price_str' }] } }), 'price_str');
    assert.equal(extractPriceId({}), null);
    assert.equal(extractUid(sub({ price: 'p' })), UID);
    assert.equal(extractUid({ client_reference_id: 'from-session' }), 'from-session');
    assert.equal(extractUid({}), null);
    assert.equal(asId({ id: 'x' }), 'x');
    assert.equal(asId('y'), 'y');
    assert.equal(asId(null), null);
  });

  test('past_due and unpaid map to past_due; only deletion is cancelled', () => {
    assert.equal(mapStatus('active'), 'active');
    assert.equal(mapStatus('trialing'), 'active');
    assert.equal(mapStatus('past_due'), 'past_due');
    assert.equal(mapStatus('unpaid'), 'past_due');
    assert.equal(mapStatus('canceled'), 'cancelled');
    assert.equal(mapStatus('nonsense'), null);
  });

  test('METADATA IS NOT TRUSTED FOR THE TIER — the price decides', () => {
    // A subscription whose metadata claims platinum but whose PRICE is founding Gold is a Gold
    // membership. Metadata is written once at checkout and never updated by an upgrade; the
    // price is the thing that actually changed.
    const s = sub({ price: ID('gold', 'monthly', 'gbp') });
    s.metadata.tier = 'platinum';
    const { detail } = detailForSubscription({ subscription: s, existing: null, mode: 'test', now: NOW });
    assert.equal(detail.tier, 'gold');
  });

  test('an unknown price yields no description, so the caller can refuse to guess', () => {
    const { described } = detailForSubscription({
      subscription: sub({ price: CURRENT_ID('gold', 'monthly', 'gbp') }), existing: null, mode: 'test', now: NOW,
    });
    assert.equal(described, null);
  });

  test('currentPeriodEnd is epoch MILLISECONDS, from Stripe seconds', () => {
    const end = NOW + 30 * 86400_000;
    const { detail } = detailForSubscription({
      subscription: sub({ price: ID('gold', 'monthly', 'gbp'), periodEnd: end }), existing: null, mode: 'test', now: NOW,
    });
    assert.equal(typeof detail.currentPeriodEnd, 'number');
    assert.equal(detail.currentPeriodEnd, Math.floor(end / 1000) * 1000);
  });
});

// ── THE FOUNDING LOCK ───────────────────────────────────────────────────────

describe('THE FOUNDING LOCK — the acceptance this round was commissioned on', () => {
  const foundingGoldMember = {
    tier: 'gold', founding: true, foundingSince: JOINED,
    stripeSubscriptionId: 'sub_LIVE', stripeCustomerId: 'cus_1',
    stripePriceId: ID('gold', 'monthly', 'gbp'), priceGeneration: 'founding',
  };

  test('a founding join records founding:true and stamps foundingSince', () => {
    const { detail } = detailForSubscription({
      subscription: sub({ price: ID('gold', 'monthly', 'gbp') }), existing: null, mode: 'test', now: NOW,
    });
    assert.equal(detail.founding, true);
    assert.equal(detail.foundingSince, NOW);
    assert.equal(detail.priceGeneration, 'founding');
  });

  test('AN UPGRADE Gold→Platinum LANDS ON A FOUNDING PRICE AND KEEPS THE ORIGINAL DATE', () => {
    // The trap, asserted. Six months after joining, the member upgrades through the portal.
    // Stripe sends customer.subscription.updated carrying the new Price.
    const upgraded = sub({ price: ID('platinum', 'monthly', 'gbp') });
    const { detail } = detailForSubscription({
      subscription: upgraded, existing: foundingGoldMember, mode: 'test', now: NOW,
    });

    assert.equal(detail.tier, 'platinum', 'the upgrade took effect');
    assert.equal(isFoundingPrice(detail.stripePriceId, 'test'), true, 'they landed on a FOUNDING price');
    assert.equal(detail.stripePriceId, ID('platinum', 'monthly', 'gbp'));
    assert.equal(detail.priceGeneration, 'founding');
    assert.equal(detail.founding, true, 'the lock survived the upgrade');
    assert.equal(detail.foundingSince, JOINED, 'the founding date is the day they JOINED, not the day they upgraded');
    assert.notEqual(detail.foundingSince, NOW);
  });

  test('…and the same holds for an interval change and a currency-consistent switch', () => {
    for (const [tier, interval] of [['gold', 'annual'], ['platinum', 'annual'], ['platinum', 'monthly']]) {
      const { detail } = detailForSubscription({
        subscription: sub({ price: ID(tier, interval, 'gbp') }), existing: foundingGoldMember, mode: 'test', now: NOW,
      });
      assert.equal(detail.founding, true, `${tier}/${interval} must stay founding`);
      assert.equal(detail.foundingSince, JOINED, `${tier}/${interval} must keep the original date`);
      assert.equal(detail.tier, tier);
      assert.equal(detail.interval, interval);
    }
  });

  test('IF a member ever landed on a non-founding price, it is recorded HONESTLY as lost', () => {
    // The portal configuration is what prevents this, but the record must not lie if it
    // happens — a silent founding:true on a current price would hide the very bug we are
    // guarding against, and make it unfindable afterwards.
    PRICE_BOOK.current = { test: { platinum: { monthly: { gbp: CURRENT_ID('platinum', 'monthly', 'gbp'), usd: null }, annual: { gbp: null, usd: null } }, gold: { monthly: { gbp: null, usd: null }, annual: { gbp: null, usd: null } } }, live: {} };
    try {
      const { detail } = detailForSubscription({
        subscription: sub({ price: CURRENT_ID('platinum', 'monthly', 'gbp') }),
        existing: foundingGoldMember, mode: 'test', now: NOW,
      });
      assert.equal(detail.tier, 'platinum');
      assert.equal(detail.founding, false, 'the lock is recorded as LOST, not silently kept');
      assert.equal(detail.priceGeneration, 'current');
      // the date survives, so a human can restore the lock without archaeology
      assert.equal(detail.foundingSince, JOINED);
    } finally { delete PRICE_BOOK.current; }
  });

  test('the portal configuration exists and covers all eight founding prices', () => {
    // The other half of the lock. Without the configuration the portal offers whatever the
    // Product currently has, and the upgrade above lands on a current price.
    assert.equal(typeof PORTAL_CONFIGURATION.founding.test, 'string');
    assert.equal(priceIdsForGeneration('founding', 'test').length, 8);
  });

  test('founding facts SURVIVE a cancellation, so a returning member is still founding', () => {
    const { detail } = detailForSubscription({
      subscription: sub({ price: ID('gold', 'monthly', 'gbp'), status: 'canceled' }),
      existing: foundingGoldMember, mode: 'test', now: NOW,
    });
    assert.equal(detail.foundingSince, JOINED);
    assert.equal(detail.status, 'cancelled');
  });
});

// ── the webhook, end to end through a real signature ────────────────────────

async function sign(body, secret = SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

// A REAL key, so mintAccessToken's WebCrypto path actually runs. A placeholder string throws
// inside pemToArrayBuffer, the webhook catches it, returns 200 { degraded: true } — and every
// assertion about what was written then fails for a reason that has nothing to do with the
// behaviour under test. That is exactly how the first run of this file failed.
const { privateKey: TEST_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_MEMBERSHIP_WEBHOOK_SECRET: SECRET,
  FIREBASE_CLIENT_EMAIL: 'svc@example.com',
  FIREBASE_PRIVATE_KEY: TEST_PEM,
};

function host({ subscription = null, detail = null, scalar = null } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 'tok' });
    if (u.includes('api.stripe.com/v1/subscriptions/')) return ok(subscription);
    if (opts.method === 'PATCH') return ok({});
    if (u.includes('/memberships/')) return ok(detail);
    if (u.includes('/membership.json')) return ok(scalar);
    throw new Error(`unstubbed: ${u}`);
  };
  return {
    calls, restore() { globalThis.fetch = real; },
    patchBody() {
      const p = calls.find((c) => c.method === 'PATCH');
      return p ? JSON.parse(p.body) : null;
    },
  };
}

const post = async (event) => {
  const body = JSON.stringify(event);
  return webhookPost({
    env: ENV,
    request: new Request('https://x/api/membership/stripe-webhook', {
      method: 'POST', headers: { 'Stripe-Signature': await sign(body) }, body,
    }),
  });
};

describe('the webhook — signed, end to end', () => {
  test('an unsigned or wrongly-signed request is refused before anything is read', async () => {
    const body = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
    const unsigned = await webhookPost({ env: ENV, request: new Request('https://x/', { method: 'POST', body }) });
    assert.equal(unsigned.status, 400);
    const wrong = await webhookPost({
      env: ENV,
      request: new Request('https://x/', { method: 'POST', headers: { 'Stripe-Signature': await sign(body, 'whsec_wrong') }, body }),
    });
    assert.equal(wrong.status, 400);
  });

  test('THE UPGRADE, through the whole pipeline: founding platinum, original date, ONE atomic write', async () => {
    const h = host({
      subscription: sub({ price: ID('platinum', 'monthly', 'gbp') }),
      detail: { tier: 'gold', founding: true, foundingSince: JOINED, stripeSubscriptionId: 'sub_LIVE', stripeCustomerId: 'cus_1' },
    });
    try {
      const res = await post({ type: 'customer.subscription.updated', data: { object: sub({ price: ID('platinum', 'monthly', 'gbp') }) } });
      assert.equal(res.status, 200);
      const body = h.patchBody();
      assert.ok(body, 'a write must have happened');
      assert.deepEqual(Object.keys(body).sort(), [DETAIL_PATH(UID), SCALAR_PATH(UID)].sort());
      assert.equal(body[SCALAR_PATH(UID)], 'platinum');
      assert.equal(typeof body[SCALAR_PATH(UID)], 'string');
      const d = body[DETAIL_PATH(UID)];
      assert.equal(d.founding, true);
      assert.equal(d.foundingSince, JOINED);
      assert.equal(isFoundingPrice(d.stripePriceId, 'test'), true);
    } finally { h.restore(); }
  });

  test('DUNNING DOES NOT DOWNGRADE — past_due keeps the tier', async () => {
    const h = host({
      subscription: sub({ price: ID('gold', 'monthly', 'gbp'), status: 'past_due' }),
      detail: { tier: 'gold', founding: true, foundingSince: JOINED, stripeSubscriptionId: 'sub_LIVE' },
    });
    try {
      await post({ type: 'invoice.payment_failed', data: { object: { id: 'in_fail', subscription: 'sub_LIVE' } } });
      const body = h.patchBody();
      assert.equal(body[SCALAR_PATH(UID)], 'gold', 'a failed card must NOT take the tier away');
      assert.equal(body[DETAIL_PATH(UID)].status, 'past_due');
      assert.equal(body[DETAIL_PATH(UID)].founding, true);
    } finally { h.restore(); }
  });

  test('subscription.deleted IS the downgrade, and writes free as a string', async () => {
    const h = host({
      detail: { tier: 'gold', founding: true, foundingSince: JOINED, stripeSubscriptionId: 'sub_LIVE', stripeCustomerId: 'cus_1' },
    });
    try {
      await post({ type: 'customer.subscription.deleted', data: { object: sub({ price: ID('gold', 'monthly', 'gbp'), status: 'canceled' }) } });
      const body = h.patchBody();
      assert.equal(body[SCALAR_PATH(UID)], 'free');
      assert.equal(typeof body[SCALAR_PATH(UID)], 'string');
      // the founding facts survive, so a returning member is still founding
      assert.equal(body[DETAIL_PATH(UID)].founding, true);
      assert.equal(body[DETAIL_PATH(UID)].foundingSince, JOINED);
    } finally { h.restore(); }
  });

  test('a STALE subscription.deleted writes NOTHING — the resubscribe case', async () => {
    const h = host({
      detail: { tier: 'platinum', founding: true, foundingSince: JOINED, stripeSubscriptionId: 'sub_NEW', stripeCustomerId: 'cus_1' },
    });
    try {
      // A deletion for the subscription they already replaced must not take away the one they
      // are currently paying for.
      const stale = sub({ price: ID('gold', 'monthly', 'gbp'), id: 'sub_OLD', customer: 'cus_OTHER', status: 'canceled' });
      await post({ type: 'customer.subscription.deleted', data: { object: stale } });
      assert.equal(h.patchBody(), null, 'nothing may be written when the match cannot be proven');
    } finally { h.restore(); }
  });

  test('the customer id is captured on checkout.session.completed', async () => {
    const h = host({ subscription: sub({ price: ID('gold', 'monthly', 'gbp'), customer: 'cus_BORN_HERE' }) });
    try {
      await post({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_LIVE', invoice: 'in_first', client_reference_id: UID, metadata: { uid: UID } } },
      });
      const d = h.patchBody()[DETAIL_PATH(UID)];
      assert.equal(d.stripeCustomerId, 'cus_BORN_HERE', 'the portal cannot work until this is stored');
      assert.equal(d.lastInvoiceRef, 'in_first');
    } finally { h.restore(); }
  });

  test('a PAYMENT-mode session is ignored — that one belongs to the bookstore', async () => {
    const h = host();
    try {
      const res = await post({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_book', mode: 'payment', client_reference_id: UID, metadata: { uid: UID, titleId: 'basil' } } },
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).verdict, 'ignored');
      assert.equal(h.patchBody(), null);
    } finally { h.restore(); }
  });

  test('an UNKNOWN price writes nothing rather than guessing a tier', async () => {
    const h = host({ subscription: sub({ price: 'price_made_in_the_dashboard' }) });
    try {
      const res = await post({ type: 'customer.subscription.updated', data: { object: sub({ price: 'price_made_in_the_dashboard' }) } });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).verdict, 'review');
      assert.equal(h.patchBody(), null, 'guessing up hands out Platinum; guessing down takes away Gold');
    } finally { h.restore(); }
  });

  test('a renewal advances the period; a replay of the same invoice does not write twice', async () => {
    const end = NOW + 60 * 86400_000;
    const first = host({ subscription: sub({ price: ID('gold', 'monthly', 'gbp'), periodEnd: end }), detail: { lastInvoiceRef: 'in_001' } });
    try {
      await post({ type: 'invoice.paid', data: { object: { id: 'in_002', subscription: 'sub_LIVE' } } });
      assert.equal(first.patchBody()[DETAIL_PATH(UID)].currentPeriodEnd, Math.floor(end / 1000) * 1000);
    } finally { first.restore(); }

    const replay = host({ subscription: sub({ price: ID('gold', 'monthly', 'gbp') }), detail: { lastInvoiceRef: 'in_002' } });
    try {
      await post({ type: 'invoice.paid', data: { object: { id: 'in_002', subscription: 'sub_LIVE' } } });
      assert.equal(replay.patchBody(), null, 'the same invoice twice is a replay');
    } finally { replay.restore(); }
  });

  test('an update does NOT consume the invoice replay key', async () => {
    // Passing the last invoice on a non-payment event would make the next genuine renewal
    // look like a duplicate and freeze the member's period end.
    const h = host({ subscription: sub({ price: ID('gold', 'monthly', 'gbp') }), detail: { lastInvoiceRef: 'in_001' } });
    try {
      await post({ type: 'customer.subscription.updated', data: { object: sub({ price: ID('gold', 'monthly', 'gbp') }) } });
      assert.equal(h.patchBody()[DETAIL_PATH(UID)].lastInvoiceRef, null);
    } finally { h.restore(); }
  });

  test('an unrelated event type is acknowledged and ignored', async () => {
    const h = host();
    try {
      const res = await post({ type: 'customer.created', data: { object: { id: 'cus_x' } } });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).ignored, 'customer.created');
    } finally { h.restore(); }
  });
});
