// R10.5 — THE PAYSTACK PLANS RAIL.
//
//   node --test tests/membership/paystack-rail.test.mjs      (npm run test:membership)
//
// THE THING THIS RAIL HAS THAT THE STRIPE ONE DOES NOT is an identity problem. Paystack allows
// ONE webhook URL per account, and a recurring charge carries a reference Paystack generated
// rather than the self-describing one we minted — so from the second payment onward, nothing
// on the event says who it is about. The index closes that, and the chain that seeds it is
// asserted here end to end, because every renewal for every naira member depends on it.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import {
  AMOUNTS, PLAN_BOOK, TIERS, INTERVALS, PAYSTACK_CURRENCY,
  planCodeFor, describePlan, isFoundingPlan, isConfigured, modeOf, domainOf,
  buildMembershipReference, parseMembershipReference, isMembershipReference,
} from '../../functions/api/membership/paystack-plans.js';
import {
  isMembershipEvent, mapStatus, resolveUid, seedIndex, INDEX_PATH, subscriptionOwner,
  planCodeFromEvent, subscriptionCodeFromEvent, customerCodeFromEvent, invoiceRefFromEvent,
  handleMembershipPaystackEvent, PAYSTACK_SUB_REF_FIELDS,
} from '../../functions/api/membership/_paystack.js';
import { validateSelection } from '../../functions/api/membership/paystack-checkout.js';
import { SCALAR_PATH, DETAIL_PATH } from '../../functions/api/membership/_membership.js';
import { parsePaystackReference } from '../../functions/api/bookstore/_lib.js';
import { MEMBERSHIPS_ON_SALE } from '../../app/lib/membershipPrices.js';

const UID = 'readerUid0001';
const NOW = 1786000000000;
const JOINED = 1780000000000;
const CODE = (t, iv) => `PLN_founding_${t}_${iv}`;

const { privateKey: TEST_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const ENV = { PAYSTACK_SECRET_KEY: 'sk_test_x', FIREBASE_CLIENT_EMAIL: 'svc@x.com', FIREBASE_PRIVATE_KEY: TEST_PEM };

let snap;
beforeEach(() => {
  snap = JSON.stringify(PLAN_BOOK);
  for (const t of TIERS) for (const iv of INTERVALS) PLAN_BOOK.founding.test[t][iv] = CODE(t, iv);
});
afterEach(() => {
  const s = JSON.parse(snap);
  for (const t of TIERS) for (const iv of INTERVALS) PLAN_BOOK.founding.test[t][iv] = s.founding.test[t][iv];
});

describe('the plan book — naira only, hand-set, in kobo', () => {
  test('the settled figures', () => {
    assert.equal(AMOUNTS.gold.monthly, 150000);       // ₦1,500
    assert.equal(AMOUNTS.platinum.monthly, 250000);   // ₦2,500
    assert.equal(AMOUNTS.gold.annual, 1500000);       // ₦15,000
    assert.equal(AMOUNTS.platinum.annual, 2500000);   // ₦25,000
    // ten months for twelve, and here it IS exact — naira prices round to round numbers
    for (const t of TIERS) assert.equal(AMOUNTS[t].annual, AMOUNTS[t].monthly * 10);
    assert.equal(PAYSTACK_CURRENCY, 'ngn');
  });

  test('the reverse lookup, and an unknown plan is null rather than guessed', () => {
    assert.deepEqual(describePlan(CODE('gold', 'monthly'), 'test'),
      { generation: 'founding', tier: 'gold', interval: 'monthly', currency: 'ngn' });
    assert.equal(isFoundingPlan(CODE('platinum', 'annual'), 'test'), true);
    for (const junk of [null, '', 'PLN_made_up', 42, undefined]) {
      assert.equal(describePlan(junk, 'test'), null);
      assert.equal(isFoundingPlan(junk, 'test'), false);
    }
  });

  test('isConfigured needs all four codes', () => {
    assert.equal(isConfigured('test'), true);
    PLAN_BOOK.founding.test.platinum.annual = null;
    assert.equal(isConfigured('test'), false);
  });

  // ⚠ R9.1 — the `assert.equal(isConfigured('live'), false)` that used to sit in the test above
  // hard-coded today's answer into a suite that runs on the launch commit. See the longer note
  // at the same site in stripe-rail.test.mjs; the invariant, and both rails together, live in
  // tests/membership/on-sale.test.mjs.
  test('live is configured IFF MEMBERSHIPS_ON_SALE — no hard-coded pre-launch answer', () => {
    assert.equal(
      isConfigured('live'), MEMBERSHIPS_ON_SALE,
      `paystack live=${isConfigured('live')} MEMBERSHIPS_ON_SALE=${MEMBERSHIPS_ON_SALE}. `
      + 'Paste the live plan codes and flip the flag in the SAME commit — and paste Stripe\'s '
      + 'in it too, or tests/membership/on-sale.test.mjs will redden on the half-pasted state.',
    );
  });

  test('the event DOMAIN decides mode, not our key — one URL serves test and live', () => {
    assert.equal(modeOf('sk_live_x'), 'live');
    assert.equal(modeOf('sk_test_x'), 'test');
    assert.equal(domainOf({ domain: 'live' }), 'live');
    assert.equal(domainOf({ data: { domain: 'live' } }), 'live');
    assert.equal(domainOf({ domain: 'test' }), 'test');
    assert.equal(domainOf({}), 'test');
  });
});

describe('the membership reference — self-describing, and never confusable with a book', () => {
  test('round-trips', () => {
    const ref = buildMembershipReference(UID, 'gold', 'monthly', 'abcdef123456');
    assert.equal(ref, `ms.${UID}.gold-monthly.abcdef123456`);
    assert.deepEqual(parseMembershipReference(ref),
      { uid: UID, tier: 'gold', interval: 'monthly', nonce: 'abcdef123456' });
  });

  test('THE TWO RAILS CANNOT READ EACH OTHER\'S REFERENCES', () => {
    // The property that makes one shared webhook URL safe.
    const membership = buildMembershipReference(UID, 'platinum', 'annual', 'aaaaaaaaaaaa');
    const book = `cs.${UID}.basil.bbbbbbbbbbbb`;
    assert.equal(parsePaystackReference(membership), null, 'the bookstore must not parse ours');
    assert.equal(parseMembershipReference(book), null, 'we must not parse the bookstore\'s');
    assert.ok(parsePaystackReference(book));
    assert.ok(parseMembershipReference(membership));
  });

  test('a hyphen, because Paystack forbids underscores in a reference', () => {
    const ref = buildMembershipReference(UID, 'gold', 'annual');
    assert.match(ref, /^[A-Za-z0-9.\-=]+$/, 'only alphanumerics and - . = are legal');
    assert.equal(ref.includes('_'), false);
  });

  test('a nonce makes a re-subscribe a distinct transaction', () => {
    const a = buildMembershipReference(UID, 'gold', 'monthly');
    const b = buildMembershipReference(UID, 'gold', 'monthly');
    assert.notEqual(a, b, 'Paystack rejects a duplicate reference');
  });

  test('an unsafe uid or unknown tier throws rather than minting a bad reference', () => {
    assert.throws(() => buildMembershipReference('uid-with-dash', 'gold', 'monthly'), /reference-safe/);
    assert.throws(() => buildMembershipReference(UID, 'silver', 'monthly'), /unknown tier/);
    assert.equal(isMembershipReference('ms.x.gold_monthly.abcdef123456'), false, 'underscore is not the separator');
  });
});

describe('telling the rails apart on a shared webhook URL', () => {
  test('membership events, ms. references and plan objects are ours', () => {
    assert.equal(isMembershipEvent('subscription.create', {}), true);
    assert.equal(isMembershipEvent('invoice.payment_failed', {}), true);
    assert.equal(isMembershipEvent('charge.success', { reference: `ms.${UID}.gold-monthly.aaaaaaaaaaaa` }), true);
    assert.equal(isMembershipEvent('charge.success', { reference: 'PSK_renewal_xyz', plan: { plan_code: CODE('gold', 'monthly') } }), true);
  });

  test('A BOOK PURCHASE IS NEVER OURS — this cannot divert a sale', () => {
    assert.equal(isMembershipEvent('charge.success', { reference: `cs.${UID}.basil.bbbbbbbbbbbb` }), false);
    assert.equal(isMembershipEvent('refund.processed', { transaction: { reference: `cs.${UID}.basil.bbbbbbbbbbbb` } }), false);
    assert.equal(isMembershipEvent('charge.dispute.create', { reference: `cs.${UID}.basil.cccccccccccc` }), false);
  });

  test('extractors cope with Paystack\'s several payload shapes', () => {
    assert.equal(planCodeFromEvent({ plan: { plan_code: 'PLN_a' } }), 'PLN_a');
    assert.equal(planCodeFromEvent({ subscription: { plan: { plan_code: 'PLN_b' } } }), 'PLN_b');
    assert.equal(planCodeFromEvent({ plan: 'PLN_c' }), 'PLN_c');
    assert.equal(subscriptionCodeFromEvent({ subscription_code: 'SUB_a' }), 'SUB_a');
    assert.equal(subscriptionCodeFromEvent({ subscription: { subscription_code: 'SUB_b' } }), 'SUB_b');
    assert.equal(customerCodeFromEvent({ customer: { customer_code: 'CUS_a' } }), 'CUS_a');
    // invoice_code first — it is the identifier that changes per PERIOD
    assert.equal(invoiceRefFromEvent({ invoice_code: 'INV_1', reference: 'PSK_x' }), 'INV_1');
    assert.equal(invoiceRefFromEvent({ reference: 'PSK_x' }), 'PSK_x');
  });

  test('status mapping — attention is dunning, not cancellation', () => {
    assert.equal(mapStatus('active'), 'active');
    assert.equal(mapStatus('attention'), 'past_due');
    assert.equal(mapStatus('non-renewing'), 'cancelled');
    assert.equal(mapStatus('cancelled'), 'cancelled');
    assert.equal(mapStatus('nonsense'), null);
  });
});

describe('checkout', () => {
  test('tier and interval only — no currency parameter, this endpoint IS naira', () => {
    assert.deepEqual(validateSelection({ tier: 'gold', interval: 'annual' }), { ok: true, tier: 'gold', interval: 'annual' });
    assert.equal(validateSelection({ tier: 'silver', interval: 'annual' }).code, 'bad_tier');
    assert.equal(validateSelection({ tier: 'gold', interval: 'weekly' }).code, 'bad_interval');
    const r = validateSelection({ tier: 'gold', interval: 'annual', currency: 'gbp', amount: 1 });
    assert.equal('currency' in r, false, 'a currency must not survive validation');
    assert.equal('amount' in r, false, 'a client amount must never survive validation');
  });

  test('planCodeFor only ever returns a FOUNDING code — the lock, by construction', () => {
    // Paystack has no portal, so an "upgrade" is a NEW subscription we initialize ourselves.
    // The lock therefore holds exactly as long as checkout has nothing else to offer.
    for (const t of TIERS) for (const iv of INTERVALS) {
      assert.equal(isFoundingPlan(planCodeFor({ tier: t, interval: iv, mode: 'test' }), 'test'), true);
    }
  });
});

// ── the host ────────────────────────────────────────────────────────────────

function host({ index = {}, detail = null, scalar = null } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 'tok' });
    if (opts.method === 'PATCH') return ok({});
    const m = /paystack_membership_index\/([^.]+)\.json/.exec(u);
    if (m) return ok(index[decodeURIComponent(m[1])] ?? null);
    if (u.includes('/memberships/')) return ok(detail);
    if (u.includes('/membership.json')) return ok(scalar);
    throw new Error(`unstubbed: ${u}`);
  };
  return {
    calls, restore() { globalThis.fetch = real; },
    patches() { return calls.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(c.body)); },
    membershipWrite() { return this.patches().find((b) => SCALAR_PATH(UID) in b) || null; },
    indexWrite() { return this.patches().find((b) => Object.keys(b).some((k) => k.startsWith('paystack_membership_index/'))) || null; },
  };
}

const getToken = async () => 'tok';

describe('THE RENEWAL IDENTITY CHAIN — the gap this rail had to close', () => {
  test('the FIRST charge identifies itself from OUR reference, and seeds the index', async () => {
    const h = host();
    try {
      await handleMembershipPaystackEvent(ENV, getToken, {
        event: 'charge.success', domain: 'test',
        data: {
          reference: buildMembershipReference(UID, 'gold', 'monthly', 'aaaaaaaaaaaa'),
          status: 'success',
          plan: { plan_code: CODE('gold', 'monthly') },
          customer: { customer_code: 'CUS_1' },
          subscription_code: 'SUB_1',
        },
      }, NOW);

      const idx = h.indexWrite();
      assert.ok(idx, 'the index must be seeded from the one event that can identify itself');
      assert.equal(idx[INDEX_PATH('CUS_1')], UID);
      assert.equal(idx[INDEX_PATH('SUB_1')], UID);
      assert.equal(h.membershipWrite()[SCALAR_PATH(UID)], 'gold');
    } finally { h.restore(); }
  });

  test('A RENEWAL, whose reference is PAYSTACK\'S, resolves through the index', async () => {
    // The whole point. Nothing on this payload says who it is about except SUB_1.
    const h = host({ index: { SUB_1: UID }, detail: { tier: 'gold', founding: true, foundingSince: JOINED, lastInvoiceRef: 'INV_1' } });
    try {
      await handleMembershipPaystackEvent(ENV, getToken, {
        event: 'invoice.update', domain: 'test',
        data: {
          invoice_code: 'INV_2', paid: true,
          subscription: { subscription_code: 'SUB_1', status: 'active', next_payment_date: '2026-10-06T00:00:00.000Z' },
          plan: { plan_code: CODE('gold', 'monthly') },
        },
      }, NOW);
      const w = h.membershipWrite();
      assert.ok(w, 'the renewal must be attributed and written');
      assert.equal(w[SCALAR_PATH(UID)], 'gold');
      assert.equal(w[DETAIL_PATH(UID)].lastInvoiceRef, 'INV_2');
      assert.equal(w[DETAIL_PATH(UID)].foundingSince, JOINED, 'the founding date survives a renewal');
    } finally { h.restore(); }
  });

  test('AN INDEX MISS WRITES NOTHING — an email is never used as a fallback', async () => {
    // Guessing identity from an email does not fail loudly; it silently grants somebody else's
    // membership to the wrong reader. Emails are mutable and can be shared.
    const h = host({ index: {} });
    try {
      const r = await handleMembershipPaystackEvent(ENV, getToken, {
        event: 'invoice.update', domain: 'test',
        data: {
          invoice_code: 'INV_9', paid: true,
          subscription: { subscription_code: 'SUB_UNKNOWN' },
          customer: { customer_code: 'CUS_UNKNOWN', email: 'someone@example.com' },
          plan: { plan_code: CODE('gold', 'monthly') },
        },
      }, NOW);
      assert.equal(r.verdict, 'review');
      assert.equal(h.membershipWrite(), null);
    } finally { h.restore(); }
  });

  test('the customer code resolves too, when only it is present', async () => {
    const h = host({ index: { CUS_1: UID }, detail: { tier: 'gold' } });
    try {
      const { uid, via } = await resolveUid(ENV, 'tok', { customer: { customer_code: 'CUS_1' } });
      assert.equal(uid, UID);
      assert.equal(via, 'customer_code');
    } finally { h.restore(); }
  });

  test('resolveUid prefers OUR reference over the index — it cannot be stale', async () => {
    const h = host({ index: { SUB_1: 'someone-else' } });
    try {
      const { uid, via } = await resolveUid(ENV, 'tok', {
        reference: buildMembershipReference(UID, 'gold', 'monthly', 'aaaaaaaaaaaa'),
        subscription_code: 'SUB_1',
      });
      assert.equal(uid, UID);
      assert.equal(via, 'reference');
    } finally { h.restore(); }
  });

  test('the ORDERING CAVEAT: subscription.create arriving first reviews, and recovers', async () => {
    // Paystack does not guarantee charge.success precedes subscription.create. The early event
    // goes to review; the charge behind it still writes the membership and seeds the index.
    const early = host({ index: {} });
    try {
      const r = await handleMembershipPaystackEvent(ENV, getToken, {
        event: 'subscription.create', domain: 'test',
        data: { subscription_code: 'SUB_1', customer: { customer_code: 'CUS_1' }, plan: { plan_code: CODE('gold', 'monthly') } },
      }, NOW);
      assert.equal(r.verdict, 'review', 'unattributable — but nothing is lost');
    } finally { early.restore(); }

    const then = host();
    try {
      await handleMembershipPaystackEvent(ENV, getToken, {
        event: 'charge.success', domain: 'test',
        data: {
          reference: buildMembershipReference(UID, 'gold', 'monthly', 'aaaaaaaaaaaa'), status: 'success',
          plan: { plan_code: CODE('gold', 'monthly') },
          customer: { customer_code: 'CUS_1' }, subscription_code: 'SUB_1',
        },
      }, NOW);
      assert.equal(then.indexWrite()[INDEX_PATH('SUB_1')], UID, 'the member is never wrong, only a log line is');
      assert.equal(then.membershipWrite()[SCALAR_PATH(UID)], 'gold');
    } finally { then.restore(); }
  });
});

describe('the lifecycle — same postures as the Stripe rail', () => {
  const base = { index: { SUB_1: UID }, detail: { tier: 'gold', founding: true, foundingSince: JOINED, paystackSubscriptionCode: 'SUB_1', paystackCustomerCode: 'CUS_1', paystackPlanCode: CODE('gold', 'monthly') } };
  const ev = (event, data) => ({ event, domain: 'test', data: { subscription: { subscription_code: 'SUB_1' }, subscription_code: 'SUB_1', ...data } });

  test('DUNNING DOES NOT DOWNGRADE — invoice.payment_failed keeps the tier', async () => {
    const h = host(base);
    try {
      await handleMembershipPaystackEvent(ENV, getToken, ev('invoice.payment_failed', { plan: { plan_code: CODE('gold', 'monthly') } }), NOW);
      const w = h.membershipWrite();
      assert.equal(w[SCALAR_PATH(UID)], 'gold', 'a failed card must not take the tier away');
      assert.equal(w[DETAIL_PATH(UID)].status, 'past_due');
    } finally { h.restore(); }
  });

  test('subscription.not_renew is NOT a downgrade — they keep what they paid for', async () => {
    const h = host(base);
    try {
      await handleMembershipPaystackEvent(ENV, getToken, ev('subscription.not_renew', { plan: { plan_code: CODE('gold', 'monthly') } }), NOW);
      const w = h.membershipWrite();
      assert.equal(w[SCALAR_PATH(UID)], 'gold');
      assert.equal(w[DETAIL_PATH(UID)].cancelAtPeriodEnd, true);
      assert.equal(w[DETAIL_PATH(UID)].status, 'active');
    } finally { h.restore(); }
  });

  test('subscription.disable IS the downgrade, and writes free as a string', async () => {
    const h = host(base);
    try {
      await handleMembershipPaystackEvent(ENV, getToken, ev('subscription.disable', {}), NOW);
      const w = h.membershipWrite();
      assert.equal(w[SCALAR_PATH(UID)], 'free');
      assert.equal(typeof w[SCALAR_PATH(UID)], 'string');
      assert.equal(w[DETAIL_PATH(UID)].founding, true, 'founding survives cancellation');
      assert.equal(w[DETAIL_PATH(UID)].foundingSince, JOINED);
    } finally { h.restore(); }
  });

  test('a STALE subscription.disable writes nothing', async () => {
    const h = host({ index: { SUB_OLD: UID }, detail: { tier: 'platinum', paystackSubscriptionCode: 'SUB_NEW', paystackCustomerCode: 'CUS_NEW' } });
    try {
      const r = await handleMembershipPaystackEvent(ENV, getToken, {
        event: 'subscription.disable', domain: 'test',
        data: { subscription_code: 'SUB_OLD' },
      }, NOW);
      assert.equal(r.verdict, 'review');
      assert.equal(h.membershipWrite(), null);
    } finally { h.restore(); }
  });

  test('AN UNRECOGNISED PLAN writes nothing and asks for a human', async () => {
    const h = host({ index: { SUB_1: UID } });
    try {
      const r = await handleMembershipPaystackEvent(ENV, getToken, ev('invoice.update', { paid: true, invoice_code: 'INV_3', plan: { plan_code: 'PLN_made_in_the_dashboard' } }), NOW);
      assert.equal(r.verdict, 'review');
      assert.equal(h.membershipWrite(), null);
    } finally { h.restore(); }
  });

  test('THE TIER COMES FROM THE PLAN, never from metadata', async () => {
    const h = host({ index: { SUB_1: UID } });
    try {
      await handleMembershipPaystackEvent(ENV, getToken, ev('invoice.update', {
        paid: true, invoice_code: 'INV_4',
        plan: { plan_code: CODE('platinum', 'annual') },
        metadata: { tier: 'gold' },
      }), NOW);
      const w = h.membershipWrite();
      assert.equal(w[SCALAR_PATH(UID)], 'platinum');
      assert.equal(w[DETAIL_PATH(UID)].interval, 'annual');
    } finally { h.restore(); }
  });

  test('an UNPAID invoice does not consume the replay key', async () => {
    // invoice.create for a period that has not been paid yet is not a payment. Consuming the
    // key here would make the genuine payment behind it look like a duplicate.
    const h = host({ index: { SUB_1: UID } });
    try {
      await handleMembershipPaystackEvent(ENV, getToken, ev('invoice.create', { paid: false, invoice_code: 'INV_5', plan: { plan_code: CODE('gold', 'monthly') } }), NOW);
      assert.equal(h.membershipWrite()[DETAIL_PATH(UID)].lastInvoiceRef, null);
    } finally { h.restore(); }
  });

  test('a replayed invoice writes nothing the second time', async () => {
    const h = host({ index: { SUB_1: UID }, detail: { tier: 'gold', lastInvoiceRef: 'INV_6' } });
    try {
      const r = await handleMembershipPaystackEvent(ENV, getToken, ev('invoice.update', { paid: true, invoice_code: 'INV_6', plan: { plan_code: CODE('gold', 'monthly') } }), NOW);
      assert.equal(r.verdict, 'skipped');
      assert.equal(h.membershipWrite(), null);
    } finally { h.restore(); }
  });

  test('the membership write is still ONE atomic pair', async () => {
    const h = host({ index: { SUB_1: UID } });
    try {
      await handleMembershipPaystackEvent(ENV, getToken, ev('invoice.update', { paid: true, invoice_code: 'INV_7', plan: { plan_code: CODE('gold', 'monthly') } }), NOW);
      assert.deepEqual(Object.keys(h.membershipWrite()).sort(), [DETAIL_PATH(UID), SCALAR_PATH(UID)].sort());
    } finally { h.restore(); }
  });
});

describe('R10.5b · the ordering hole a LIVE test card exposed', () => {
  // MEASURED, not reasoned about. R10.5 claimed that if subscription.create arrived before
  // charge.success, "the charge behind it recovers". A real Paystack transaction says
  // otherwise: charge.success carries the customer code and the plan, and NO subscription
  // code. So the first charge can only ever seed CUS_…; SUB_… arrives on a subscription-shaped
  // event and nowhere else. A cancellation carrying only a subscription code, before that code
  // was indexed, was therefore unattributable — and a cancelled member would keep their tier.

  test('a first charge cannot seed the subscription code — it does not carry one', () => {
    // The real payload shape, from the live run.
    const firstCharge = {
      reference: 'ms.readerUid0001.gold-monthly.3649e36fcfa1',
      status: 'success',
      plan: 'PLN_founding_gold_monthly',
      customer: { customer_code: 'CUS_live', email: 'x@example.com' },
    };
    assert.equal(customerCodeFromEvent(firstCharge), 'CUS_live');
    assert.equal(subscriptionCodeFromEvent(firstCharge), null,
      'charge.success carries NO subscription code — this is what broke the original claim');
  });

  test('an unindexed subscription code resolves by ASKING PAYSTACK, not by guessing', async () => {
    const real = globalThis.fetch;
    let asked = null;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith('https://api.paystack.co/subscription/')) {
        asked = u;
        return new Response(JSON.stringify({ status: true, data: { customer: { customer_code: 'CUS_live' } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const m = /paystack_membership_index\/([^.]+)\.json/.exec(u);
      if (m) {
        const code = decodeURIComponent(m[1]);
        // ONLY the customer code is indexed — the subscription code never was.
        return new Response(JSON.stringify(code === 'CUS_live' ? UID : null),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unstubbed: ${u}`);
    };
    try {
      const { uid, via } = await resolveUid(ENV, 'tok', { subscription_code: 'SUB_never_indexed' });
      assert.equal(uid, UID, 'the cancelled member must still be identifiable');
      assert.equal(via, 'subscription_lookup');
      assert.match(asked, /SUB_never_indexed/);
    } finally { globalThis.fetch = real; }
  });

  test('and if Paystack cannot say either, it STILL writes nothing', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('https://api.paystack.co/subscription/')) {
        return new Response(JSON.stringify({ status: false, message: 'not found' }), { status: 404 });
      }
      return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const { uid } = await resolveUid(ENV, 'tok', { subscription_code: 'SUB_ghost' });
      assert.equal(uid, null, 'unattributable stays unattributable — never a guess');
    } finally { globalThis.fetch = real; }
  });
});
