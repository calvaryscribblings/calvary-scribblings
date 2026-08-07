// R11.3 — THE DAY AND WEEK PASSES.
//
//   node --test tests/membership/passes.test.mjs      (npm run test:membership)
//
// A pass is the first thing this system sells that GRANTS A TIER WITHOUT TOUCHING THE TIER.
// Everything here exists to hold that line and the three that follow from it:
//
//   1. the scalar is never in a pass write — asserted on the update body, not on intent
//   2. stacking EXTENDS, and never shortens what a reader already paid for
//   3. a replayed webhook must not hand out a second day for one payment
//
// The pricing ladder is asserted against the REAL plan book rather than restated, so a later
// edit to either number fails a test instead of quietly making the week pass the cheap way to
// be a member all year.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  PASS_KINDS, DURATION_MS, PASS_TIER, AMOUNTS, RAIL_BY_CURRENCY, PAYSTACK_PASS_CURRENCY,
  passAmount, passesFor, isPassOffered, railFor, nextExpiry, buildPass,
  buildPassReference, parsePassReference, isPassReference,
} from '../../app/lib/membershipPasses.js';
import { AMOUNTS as PLAN_AMOUNTS } from '../../functions/api/membership/paystack-plans.js';
import { effectiveTier, describeMembership, activePass } from '../../app/lib/membership.js';
import {
  PASS_PATH, SCALAR_PATH, DETAIL_PATH, buildPassUpdate, shouldSkipPassGrant, applyPassPurchase,
} from '../../functions/api/membership/_membership.js';
import { isMembershipEvent, handleMembershipPaystackEvent } from '../../functions/api/membership/_paystack.js';
import { isPassSession } from '../../functions/api/membership/stripe-webhook.js';
import { validatePassSelection as validateStripePass } from '../../functions/api/membership/pass-checkout.js';
import { validatePassSelection as validatePaystackPass } from '../../functions/api/membership/paystack-pass-checkout.js';
import { parseMembershipReference } from '../../functions/api/membership/paystack-plans.js';
import { parsePaystackReference } from '../../functions/api/bookstore/_lib.js';

const UID = 'readerUid0001';
const NOW = 1786000000000;
const DAY = DURATION_MS.day;
const WEEK = DURATION_MS.week;

describe('the catalogue — hand-set per currency, no conversion anywhere', () => {
  test('the settled figures', () => {
    assert.equal(AMOUNTS.day.gbp, 100);      // £1.00
    assert.equal(AMOUNTS.day.usd, 149);      // $1.49
    assert.equal(AMOUNTS.day.ngn, 30000);    // ₦300
    assert.equal(AMOUNTS.week.ngn, 50000);   // ₦500
    assert.equal(PASS_TIER, 'gold');
    assert.equal(DURATION_MS.day, 24 * 60 * 60 * 1000);
    assert.equal(DURATION_MS.week, 7 * DURATION_MS.day);
  });

  test('THE WEEK PASS IS NGN-ONLY BECAUSE IT HAS NO OTHER PRICE — not a territory rule', () => {
    // The mechanism, asserted directly: there is no gbp/usd entry to find.
    assert.equal(AMOUNTS.week.gbp, undefined);
    assert.equal(AMOUNTS.week.usd, undefined);
    assert.equal(passAmount('week', 'gbp'), null);
    assert.equal(passAmount('week', 'usd'), null);
    assert.equal(passAmount('week', 'ngn'), 50000);

    // And the consequence every surface actually reads.
    assert.deepEqual(passesFor('gbp').map((p) => p.kind), ['day']);
    assert.deepEqual(passesFor('usd').map((p) => p.kind), ['day']);
    assert.deepEqual(passesFor('ngn').map((p) => p.kind), ['day', 'week']);
    assert.equal(isPassOffered('week', 'gbp'), false);
    assert.equal(isPassOffered('week', 'ngn'), true);
  });

  test('passesFor carries everything a price card needs, and nothing it must recompute', () => {
    const [day, week] = passesFor('ngn');
    assert.deepEqual(day, { kind: 'day', tier: 'gold', currency: 'ngn', amount: 30000, durationMs: DAY, rail: 'paystack' });
    assert.deepEqual(week, { kind: 'week', tier: 'gold', currency: 'ngn', amount: 50000, durationMs: WEEK, rail: 'paystack' });
    assert.equal(passesFor('gbp')[0].rail, 'stripe');
    // An unpriced currency offers nothing rather than throwing — a surface asking about a
    // currency we do not sell in must render an empty list, not an error.
    assert.deepEqual(passesFor('eur'), []);
    assert.deepEqual(passesFor(null), []);
    assert.equal(railFor('EUR'), null);
    assert.equal(RAIL_BY_CURRENCY.ngn, 'paystack');
  });

  test('currency is case-insensitive — a surface may pass NGN or ngn', () => {
    assert.equal(passAmount('day', 'NGN'), 30000);
    assert.equal(passesFor('NGN').length, 2);
    assert.equal(isPassOffered('week', 'NGN'), true);
  });

  test('FOUR WEEKS MUST COST MORE THAN A MONTH — asserted against the real plan book', () => {
    const fourWeeks = AMOUNTS.week.ngn * 4;                 // ₦2,000
    const monthly = PLAN_AMOUNTS.gold.monthly;              // ₦1,500
    assert.equal(fourWeeks, 200000);
    assert.equal(monthly, 150000);
    assert.ok(fourWeeks > monthly,
      `four week passes (${fourWeeks}) must cost more than a month (${monthly}) or the week pass eats the subscription`);

    // The day pass has to sit above the week pass on the same ladder, or nobody would ever
    // buy a week. Seven days at ₦300 is ₦2,100 against ₦500.
    assert.ok(AMOUNTS.day.ngn * 7 > AMOUNTS.week.ngn);
    // And a month of day passes must beat the monthly subscription too.
    assert.ok(AMOUNTS.day.ngn * 30 > monthly);
  });
});

describe('stacking — extends, and never shortens what was paid for', () => {
  test('a FRESH pass runs its full duration from now', () => {
    const p = buildPass({ kind: 'day', currency: 'gbp', rail: 'stripe', ref: 'cs_1', now: NOW });
    assert.equal(p.expiresAt, NOW + DAY);
    assert.equal(p.stacked, false);
    assert.equal(p.tier, 'gold');
    assert.equal(p.kind, 'day');
    assert.equal(p.currency, 'gbp');
    assert.equal(p.rail, 'stripe');
    assert.equal(p.purchasedAt, NOW);
    assert.equal(p.ref, 'cs_1');
  });

  test('buying while one is LIVE extends from the existing expiry, not from now', () => {
    const existing = { kind: 'day', tier: 'gold', expiresAt: NOW + 6 * 3600000 };   // 6h left
    const p = buildPass({ kind: 'day', currency: 'ngn', rail: 'paystack', ref: 'mp_2', existing, now: NOW });
    assert.equal(p.expiresAt, NOW + 6 * 3600000 + DAY, 'the remaining 6h must survive');
    assert.equal(p.stacked, true);
  });

  test('buying after one LAPSED runs from now — never from a date in the past', () => {
    const existing = { kind: 'day', tier: 'gold', expiresAt: NOW - 5 * DAY };
    const p = buildPass({ kind: 'day', currency: 'gbp', rail: 'stripe', ref: 'cs_3', existing, now: NOW });
    assert.equal(p.expiresAt, NOW + DAY, 'a lapsed pass must not absorb the new one');
    assert.equal(p.stacked, false);
  });

  test('a day stacked on a week, and three in a row, accumulate exactly', () => {
    let p = buildPass({ kind: 'week', currency: 'ngn', rail: 'paystack', ref: 'a', now: NOW });
    assert.equal(p.expiresAt, NOW + WEEK);
    p = buildPass({ kind: 'day', currency: 'ngn', rail: 'paystack', ref: 'b', existing: p, now: NOW + 1000 });
    assert.equal(p.expiresAt, NOW + WEEK + DAY);
    p = buildPass({ kind: 'day', currency: 'ngn', rail: 'paystack', ref: 'c', existing: p, now: NOW + 2000 });
    assert.equal(p.expiresAt, NOW + WEEK + 2 * DAY);
    assert.equal(p.kind, 'day', 'the stored kind is the most recent purchase');
  });

  test('a MALFORMED expiry is treated as no pass — the same rule activePass applies', () => {
    // If these disagreed, a reader could hold a pass that grants nothing yet still swallows
    // the time they just bought.
    for (const bad of ['2026-01-01', null, undefined, NaN, Infinity, {}, '999999999999']) {
      const existing = { kind: 'day', tier: 'gold', expiresAt: bad };
      assert.equal(activePass({ pass: existing }, NOW), null, `activePass must reject ${String(bad)}`);
      assert.equal(nextExpiry(existing, DAY, NOW), NOW + DAY, `nextExpiry must ignore ${String(bad)}`);
    }
  });

  test('THE TIER NEVER GOES DOWN ON A STACK', () => {
    const platinum = { kind: 'day', tier: 'platinum', expiresAt: NOW + DAY };
    const p = buildPass({ kind: 'day', currency: 'ngn', rail: 'paystack', ref: 'x', existing: platinum, now: NOW });
    assert.equal(p.tier, 'platinum', 'buying a Gold pass must not downgrade paid-for Platinum time');

    const gold = { kind: 'day', tier: 'gold', expiresAt: NOW + DAY };
    const up = buildPass({ kind: 'day', tier: 'platinum', currency: 'ngn', rail: 'paystack', ref: 'y', existing: gold, now: NOW });
    assert.equal(up.tier, 'platinum');
  });

  test('an unknown kind throws rather than selling an unpriced window', () => {
    assert.throws(() => buildPass({ kind: 'fortnight', currency: 'ngn', ref: 'z', now: NOW }), /unknown pass kind/);
    assert.throws(() => buildPass({ kind: undefined, currency: 'ngn', ref: 'z', now: NOW }), /unknown pass kind/);
  });
});

describe('the pass resolves to a tier WITHOUT the scalar ever moving', () => {
  test('a free reader holding a live day pass is gold — and free again when it lapses', () => {
    const detail = { tier: 'free', pass: buildPass({ kind: 'day', currency: 'gbp', rail: 'stripe', ref: 'r', now: NOW }) };
    assert.equal(effectiveTier('free', detail, NOW + 1000), 'gold');
    assert.equal(effectiveTier('free', detail, NOW + DAY - 1), 'gold');
    assert.equal(effectiveTier('free', detail, NOW + DAY), 'free', 'expiry is exclusive at the boundary');
    assert.equal(effectiveTier('free', detail, NOW + DAY + 1), 'free');
    // Nothing had to write anything for that transition to happen. That is the point.
  });

  test('a Platinum member holding a Gold pass is still Platinum, and is told so', () => {
    const detail = { tier: 'platinum', pass: buildPass({ kind: 'day', currency: 'gbp', rail: 'stripe', ref: 'r', now: NOW }) };
    assert.equal(effectiveTier('platinum', detail, NOW + 1000), 'platinum');
    const d = describeMembership('platinum', detail, NOW + 1000);
    assert.equal(d.source, 'subscription', 'a pass must not be reported as the source of a higher tier');
    assert.equal(d.tier, 'platinum');
  });

  test('describeMembership names the pass as the source when the pass is what lifted them', () => {
    const detail = { tier: 'free', pass: buildPass({ kind: 'week', currency: 'ngn', rail: 'paystack', ref: 'r', now: NOW }) };
    const d = describeMembership('free', detail, NOW + 1000);
    assert.equal(d.tier, 'gold');
    assert.equal(d.subscriptionTier, 'free');
    assert.equal(d.source, 'pass');
    assert.equal(d.pass.kind, 'week');
  });
});

describe('the write — one deep path, and the scalar is not among them', () => {
  test('buildPassUpdate touches memberships/{uid}/pass and NOTHING else', () => {
    const pass = buildPass({ kind: 'day', currency: 'gbp', rail: 'stripe', ref: 'r', now: NOW });
    const body = buildPassUpdate(UID, pass);
    assert.deepEqual(Object.keys(body), [PASS_PATH(UID)]);
    assert.equal(PASS_PATH(UID), `memberships/${UID}/pass`);
    assert.equal(SCALAR_PATH(UID) in body, false, 'THE TIER SCALAR MUST NEVER BE IN A PASS WRITE');
    assert.equal(DETAIL_PATH(UID) in body, false, 'a wholesale detail write would delete the billing row');
    assert.deepEqual(body[PASS_PATH(UID)], pass);
  });

  test('the path is a CHILD, so a pass cannot clobber the subscription record', () => {
    // The R11.1 failure mode, asserted structurally: the written path must be strictly deeper
    // than the detail node, never equal to it.
    assert.ok(PASS_PATH(UID).startsWith(`${DETAIL_PATH(UID)}/`));
    assert.notEqual(PASS_PATH(UID), DETAIL_PATH(UID));
  });

  test('buildPassUpdate refuses a missing uid or pass rather than writing a hole', () => {
    assert.throws(() => buildPassUpdate('', { expiresAt: 1 }), /uid is required/);
    assert.throws(() => buildPassUpdate(UID, null), /pass is required/);
  });
});

describe('idempotency — a replay must not hand out a second day', () => {
  test('shouldSkipPassGrant matches on the charge reference alone', () => {
    const pass = buildPass({ kind: 'day', currency: 'gbp', rail: 'stripe', ref: 'cs_test_123', now: NOW });
    assert.equal(shouldSkipPassGrant(pass, 'cs_test_123'), true);
    assert.equal(shouldSkipPassGrant(pass, 'cs_test_999'), false, 'a different purchase must extend');
    assert.equal(shouldSkipPassGrant(null, 'cs_test_123'), false);
    assert.equal(shouldSkipPassGrant(pass, ''), false);
    assert.equal(shouldSkipPassGrant(pass, null), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The reference, and the three-way routing one Paystack webhook URL has to do.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('the pass reference — a THIRD prefix that no other rail can read', () => {
  test('round-trips', () => {
    const ref = buildPassReference(UID, 'week', 'abcdef123456');
    assert.equal(ref, `mp.${UID}.week.abcdef123456`);
    assert.deepEqual(parsePassReference(ref), { uid: UID, kind: 'week', nonce: 'abcdef123456' });
    assert.equal(isPassReference(ref), true);
  });

  test('NONE OF THE THREE RAILS CAN READ ANOTHER\'S REFERENCE', () => {
    const pass = buildPassReference(UID, 'day', 'aaaaaaaaaaaa');
    const subscription = `ms.${UID}.gold-monthly.bbbbbbbbbbbb`;
    const book = `cs.${UID}.basil.cccccccccccc`;

    assert.equal(parsePaystackReference(pass), null, 'the bookstore must not parse a pass');
    assert.equal(parseMembershipReference(pass), null, 'the subscription rail must not parse a pass');
    assert.equal(parsePassReference(subscription), null, 'we must not parse a subscription');
    assert.equal(parsePassReference(book), null, 'we must not parse a book');
    // The one that would actually bite: a pass reference must not be mistaken for a
    // subscription, because the two take different write paths and only one may move the tier.
    assert.equal(parseMembershipReference(`mp.${UID}.gold-monthly.bbbbbbbbbbbb`), null);
  });

  test('a kind we do not sell does not parse, even when the shape is right', () => {
    assert.equal(parsePassReference(`mp.${UID}.fortnight.aaaaaaaaaaaa`), null);
    assert.throws(() => buildPassReference(UID, 'fortnight'), /unknown pass kind/);
    assert.throws(() => buildPassReference('bad uid!', 'day'), /reference-safe/);
  });

  test('isMembershipEvent claims a plan-less pass charge — the only signal is the reference', () => {
    const passCharge = { reference: buildPassReference(UID, 'day', 'aaaaaaaaaaaa'), status: 'success' };
    assert.equal(isMembershipEvent('charge.success', passCharge), true);
    // ...and still refuses a book, which is what makes the shared URL safe.
    assert.equal(isMembershipEvent('charge.success', { reference: `cs.${UID}.basil.cccccccccccc` }), false);
  });
});

describe('the Stripe routing marker — mode alone cannot tell a pass from a book', () => {
  test('isPassSession claims payment-mode sessions marked as a pass, and nothing else', () => {
    assert.equal(isPassSession({ mode: 'payment', metadata: { kind: 'pass' } }), true);
    assert.equal(isPassSession({ mode: 'payment', metadata: { kind: 'book' } }), false);
    assert.equal(isPassSession({ mode: 'payment', metadata: {} }), false, 'a broken book purchase must stay a broken book purchase');
    assert.equal(isPassSession({ mode: 'payment' }), false);
    assert.equal(isPassSession({ mode: 'subscription', metadata: { kind: 'pass' } }), false);
    assert.equal(isPassSession({}), false);
  });
});

describe('the checkout contracts — the price is never the client\'s to choose', () => {
  test('Stripe: the day pass in gbp/usd, naira sent to the other rail', () => {
    assert.deepEqual(validateStripePass({ kind: 'day', currency: 'gbp' }), { ok: true, kind: 'day', currency: 'gbp' });
    assert.deepEqual(validateStripePass({ kind: 'day', currency: 'USD' }), { ok: true, kind: 'day', currency: 'usd' });

    const ngn = validateStripePass({ kind: 'day', currency: 'ngn' });
    assert.equal(ngn.ok, false);
    assert.equal(ngn.code, 'wrong_rail');
    assert.equal(ngn.status, 400);

    // THE WEEK PASS IS REFUSED HERE, and as a 409 — the request is well-formed, the product
    // simply is not sold at that price.
    const week = validateStripePass({ kind: 'week', currency: 'gbp' });
    assert.equal(week.ok, false);
    assert.equal(week.code, 'not_offered');
    assert.equal(week.status, 409);

    for (const bad of [{ kind: 'year', currency: 'gbp' }, { kind: undefined, currency: 'gbp' }]) {
      assert.equal(validateStripePass(bad).code, 'bad_kind');
    }
    assert.equal(validateStripePass({ kind: 'day', currency: 'eur' }).code, 'bad_currency');
  });

  test('Paystack: both kinds, and no currency parameter to negotiate', () => {
    assert.deepEqual(validatePaystackPass({ kind: 'day' }), { ok: true, kind: 'day' });
    assert.deepEqual(validatePaystackPass({ kind: 'week' }), { ok: true, kind: 'week' });
    assert.equal(validatePaystackPass({ kind: 'month' }).code, 'bad_kind');
    assert.equal(PAYSTACK_PASS_CURRENCY, 'ngn');
  });

  test('every kind in the catalogue is sellable on exactly the rails that price it', () => {
    for (const kind of PASS_KINDS) {
      for (const cur of ['gbp', 'usd', 'ngn']) {
        const offered = isPassOffered(kind, cur);
        const viaStripe = validateStripePass({ kind, currency: cur }).ok;
        const viaPaystack = cur === 'ngn' ? validatePaystackPass({ kind }).ok : false;
        assert.equal(offered, viaStripe || viaPaystack,
          `${kind}/${cur}: the catalogue and the endpoints must agree on what is for sale`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// End to end, against a stubbed database.
// ─────────────────────────────────────────────────────────────────────────────────────────

function host({ pass = null, failRead = false } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 'tok' });
    if (opts.method === 'PATCH') return ok({});
    if (u.includes('/pass.json')) {
      if (failRead) return new Response('boom', { status: 500 });
      return ok(pass);
    }
    if (u.includes('paystack_membership_index/')) return ok(null);
    if (u.includes('/memberships/')) return ok(null);
    throw new Error(`unstubbed: ${u}`);
  };
  return {
    calls, restore() { globalThis.fetch = real; },
    patches() { return calls.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(c.body)); },
  };
}

const ENV = { PAYSTACK_SECRET_KEY: 'sk_test_x', FIREBASE_DB_URL: 'https://x.firebaseio.com' };
const getToken = async () => 'tok';

describe('a naira pass charge, end to end', () => {
  test('writes the pass, and writes NOTHING to the tier scalar', async () => {
    const h = host();
    try {
      const ref = buildPassReference(UID, 'week', 'aaaaaaaaaaaa');
      const r = await handleMembershipPaystackEvent(
        ENV, getToken, { event: 'charge.success', domain: 'test', data: { reference: ref, status: 'success' } }, NOW,
      );
      assert.equal(r.verdict, 'written');
      const body = h.patches().find((b) => PASS_PATH(UID) in b);
      assert.ok(body, 'the pass must be written');
      assert.deepEqual(Object.keys(body), [PASS_PATH(UID)]);
      assert.equal(body[PASS_PATH(UID)].expiresAt, NOW + WEEK);
      assert.equal(body[PASS_PATH(UID)].tier, 'gold');
      assert.equal(body[PASS_PATH(UID)].rail, 'paystack');
      assert.equal(body[PASS_PATH(UID)].currency, 'ngn');

      // The load-bearing negative: nothing anywhere in this flow wrote the scalar.
      for (const b of h.patches()) {
        assert.equal(SCALAR_PATH(UID) in b, false, 'a pass purchase must never write users/{uid}/membership');
      }
    } finally { h.restore(); }
  });

  test('a REPLAY of the same reference writes nothing at all', async () => {
    const existing = buildPass({ kind: 'day', currency: 'ngn', rail: 'paystack', ref: `mp.${UID}.day.aaaaaaaaaaaa`, now: NOW });
    const h = host({ pass: existing });
    try {
      const r = await handleMembershipPaystackEvent(
        ENV, getToken,
        { event: 'charge.success', domain: 'test', data: { reference: `mp.${UID}.day.aaaaaaaaaaaa`, status: 'success' } },
        NOW + 3600000,
      );
      assert.equal(r.verdict, 'skipped');
      assert.equal(h.patches().length, 0, 'a replay must not extend the pass');
    } finally { h.restore(); }
  });

  test('a SECOND, different purchase extends rather than replacing', async () => {
    const existing = buildPass({ kind: 'day', currency: 'ngn', rail: 'paystack', ref: `mp.${UID}.day.aaaaaaaaaaaa`, now: NOW });
    const h = host({ pass: existing });
    try {
      await handleMembershipPaystackEvent(
        ENV, getToken,
        { event: 'charge.success', domain: 'test', data: { reference: `mp.${UID}.day.bbbbbbbbbbbb`, status: 'success' } },
        NOW + 3600000,
      );
      const body = h.patches().find((b) => PASS_PATH(UID) in b);
      assert.equal(body[PASS_PATH(UID)].expiresAt, NOW + DAY + DAY, 'the unused remainder must carry over');
      assert.equal(body[PASS_PATH(UID)].stacked, true);
    } finally { h.restore(); }
  });

  test('a FAILED charge grants nothing', async () => {
    const h = host();
    try {
      const r = await handleMembershipPaystackEvent(
        ENV, getToken,
        { event: 'charge.success', domain: 'test', data: { reference: buildPassReference(UID, 'day', 'aaaaaaaaaaaa'), status: 'failed' } },
        NOW,
      );
      assert.equal(r.verdict, 'ignored');
      assert.equal(h.patches().length, 0);
    } finally { h.restore(); }
  });

  test('a non-charge event about a pass does nothing automatically', async () => {
    const h = host();
    try {
      const r = await handleMembershipPaystackEvent(
        ENV, getToken,
        { event: 'refund.processed', domain: 'test', data: { reference: buildPassReference(UID, 'day', 'aaaaaaaaaaaa') } },
        NOW,
      );
      assert.equal(r.verdict, 'ignored');
      assert.equal(h.patches().length, 0);
    } finally { h.restore(); }
  });

  test('an unreadable pass node still grants — bounded loss beats taking money for nothing', async () => {
    const h = host({ failRead: true });
    try {
      const r = await applyPassPurchase(ENV, 'tok', UID, {
        ref: 'mp.x.day.aaaaaaaaaaaa',
        buildPassFor: (existing) => buildPass({ kind: 'day', currency: 'ngn', rail: 'paystack', ref: 'mp.x.day.aaaaaaaaaaaa', existing, now: NOW }),
      });
      assert.equal(r.verdict, 'written');
      assert.equal(r.pass.expiresAt, NOW + DAY);
      assert.equal(r.pass.stacked, false);
    } finally { h.restore(); }
  });
});
