// THE R11.7 SURFACE — the routing a purchase takes, and the billing facts /settings states.
//
// Neither of these can be asserted through the page itself (JSX; bare Node cannot parse it),
// which is the same split app/lib/membership.js already exists to draw. So the two pieces that
// are easy to get quietly wrong live in plain modules and are asserted here:
//
//   routeFor()          which endpoint a selection goes to, and what it sends. A wrong answer
//                       sends a naira purchase to a rail that cannot settle naira.
//   describeMembership  the four billing fields added this round. A wrong answer tells a
//                       paying member their membership is ending when it is not.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { routeFor } from '../../app/lib/membershipCheckout.js';
import { describeMembership, SIGNED_OUT, plansAreKnown } from '../../app/lib/membership.js';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe('routeFor — the rail is chosen by currency, never by anything else', () => {
  test('GBP and USD subscriptions go to Stripe, carrying the currency', () => {
    for (const cur of ['gbp', 'usd']) {
      const r = routeFor({ product: 'subscription', tier: 'gold', interval: 'monthly', currency: cur });
      assert.equal(r.rail, 'stripe');
      assert.equal(r.url, '/api/membership/checkout');
      assert.deepEqual(r.body, { tier: 'gold', interval: 'monthly', currency: cur });
    }
  });

  test('a naira subscription goes to Paystack and sends NO currency', () => {
    const r = routeFor({ product: 'subscription', tier: 'platinum', interval: 'annual', currency: 'ngn' });
    assert.equal(r.rail, 'paystack');
    assert.equal(r.url, '/api/membership/paystack-checkout');
    // The endpoint validates { tier, interval } and is naira by construction. Sending a
    // currency would imply a choice that does not exist.
    assert.deepEqual(r.body, { tier: 'platinum', interval: 'annual' });
    assert.equal('currency' in r.body, false);
  });

  test('passes split the same way', () => {
    const gbp = routeFor({ product: 'pass', kind: 'day', currency: 'gbp' });
    assert.equal(gbp.url, '/api/membership/pass-checkout');
    assert.deepEqual(gbp.body, { kind: 'day', currency: 'gbp' });

    const ngn = routeFor({ product: 'pass', kind: 'week', currency: 'ngn' });
    assert.equal(ngn.url, '/api/membership/paystack-pass-checkout');
    assert.deepEqual(ngn.body, { kind: 'week' });
  });

  test('a currency we do not price routes NOWHERE rather than defaulting to a rail', () => {
    // A default here would hand a purchase to Stripe in a currency Stripe cannot settle.
    assert.equal(routeFor({ product: 'subscription', tier: 'gold', interval: 'monthly', currency: 'eur' }), null);
    assert.equal(routeFor({ product: 'pass', kind: 'day', currency: '' }), null);
    assert.equal(routeFor({ product: 'pass', kind: 'day', currency: undefined }), null);
  });

  test('an unknown product routes nowhere', () => {
    assert.equal(routeFor({ product: 'book', currency: 'gbp' }), null);
  });
});

describe('the billing facts /settings reads', () => {
  const sub = {
    tier: 'gold', interval: 'monthly', currency: 'gbp', rail: 'stripe',
    status: 'active', currentPeriodEnd: NOW + 30 * DAY, founding: true,
  };

  test('a subscription reports its interval, currency and rail', () => {
    const d = describeMembership('gold', sub, NOW);
    assert.equal(d.interval, 'monthly');
    assert.equal(d.currency, 'gbp');
    assert.equal(d.rail, 'stripe');
    assert.equal(d.founding, true);
    assert.equal(d.cancelAtPeriodEnd, false);
  });

  test('cancelAtPeriodEnd is STRICT true — absent and false are one answer', () => {
    // RTDB deletes nulls, so this field is absent on most records. Anything that is not
    // literally true must read as "not ending", or a paying member is told their membership
    // is over when it is not.
    assert.equal(describeMembership('gold', sub, NOW).cancelAtPeriodEnd, false);
    assert.equal(describeMembership('gold', { ...sub, cancelAtPeriodEnd: false }, NOW).cancelAtPeriodEnd, false);
    assert.equal(describeMembership('gold', { ...sub, cancelAtPeriodEnd: 'true' }, NOW).cancelAtPeriodEnd, false);
    assert.equal(describeMembership('gold', { ...sub, cancelAtPeriodEnd: 1 }, NOW).cancelAtPeriodEnd, false);
    assert.equal(describeMembership('gold', { ...sub, cancelAtPeriodEnd: true }, NOW).cancelAtPeriodEnd, true);
  });

  test('PAST_DUE KEEPS THE TIER — dunning does not downgrade, and the UI reads tier not status', () => {
    const d = describeMembership('gold', { ...sub, status: 'past_due' }, NOW);
    assert.equal(d.tier, 'gold', 'a past_due member is still Gold');
    assert.equal(d.subscriptionTier, 'gold');
    assert.equal(d.status, 'past_due');
    assert.equal(d.rail, 'stripe', 'and can still reach the portal to fix their card');
  });

  test('A PASS-ONLY READER HAS NO RAIL — there is nothing for them to cancel', () => {
    // A pass is written to ONE deep path (memberships/{uid}/pass) and never sets the top-level
    // billing fields. So `tier: gold` with `rail: null` is exactly right, and it is what stops
    // /settings offering a cancel route to somebody with nothing to cancel.
    const passOnly = { pass: { kind: 'day', tier: 'gold', expiresAt: NOW + DAY, currency: 'gbp', rail: 'stripe' } };
    const d = describeMembership('free', passOnly, NOW);
    assert.equal(d.tier, 'gold');
    assert.equal(d.subscriptionTier, 'free');
    assert.equal(d.source, 'pass');
    assert.equal(d.rail, null);
    assert.equal(d.interval, null);
    assert.equal(d.currency, null);
    assert.equal(d.cancelAtPeriodEnd, false);
  });

  test('an expired pass leaves no rail and no tier behind', () => {
    const expired = { pass: { kind: 'day', tier: 'gold', expiresAt: NOW - 1, currency: 'gbp', rail: 'stripe' } };
    const d = describeMembership('free', expired, NOW);
    assert.equal(d.tier, 'free');
    assert.equal(d.pass, null);
    assert.equal(d.rail, null);
  });

  test('a naira member reports the paystack rail, which is what routes them off the portal', () => {
    const d = describeMembership('platinum', { ...sub, tier: 'platinum', currency: 'ngn', rail: 'paystack' }, NOW);
    assert.equal(d.rail, 'paystack');
    assert.equal(d.currency, 'ngn');
  });

  test('a malformed or absent field is null, never a stray value', () => {
    const d = describeMembership('gold', { tier: 'gold', interval: 42, currency: '', rail: null }, NOW);
    assert.equal(d.interval, null);
    assert.equal(d.currency, null);
    assert.equal(d.rail, null);
    const none = describeMembership('free', null, NOW);
    assert.equal(none.interval, null);
    assert.equal(none.currency, null);
    assert.equal(none.rail, null);
  });

  test('SIGNED_OUT carries the new keys, so a component outside the provider cannot throw', () => {
    for (const k of ['interval', 'currency', 'rail', 'cancelAtPeriodEnd']) {
      assert.ok(k in SIGNED_OUT, `${k} must exist on the signed-out shape`);
    }
    assert.equal(SIGNED_OUT.rail, null);
    assert.equal(SIGNED_OUT.cancelAtPeriodEnd, false);
  });
});

describe('plansAreKnown — the loading beat, and the frame /membership must never render', () => {
  // The provider answers tier 'free' while it is still loading, because 'free' is the default
  // and it has not heard from the database yet. Every assertion below is really one assertion:
  // a marker that claims what a reader HAS must not be printed off that default.
  const PLATINUM_MID_FETCH = { ...SIGNED_OUT, signedIn: true, loading: true };
  const PLATINUM_SETTLED = { ...SIGNED_OUT, signedIn: true, loading: false, tier: 'platinum', subscriptionTier: 'platinum' };

  test('A PLATINUM MEMBER IS NEVER TOLD THEY ARE ON THE FREE PLAN', () => {
    // The beat: signed in, still fetching, tier reads 'free'. This is the exact state in which
    // `known && tier === 'free'` would paint "YOUR PLAN" onto the Free card of a member who
    // pays us every month, and then move it once the fetch lands.
    assert.equal(PLATINUM_MID_FETCH.tier, 'free', 'the default really is free during the beat');
    assert.equal(plansAreKnown(PLATINUM_MID_FETCH), false,
      'no marker may be printed while the membership is still being fetched');
  });

  test('and is told so the moment the fetch lands', () => {
    assert.equal(plansAreKnown(PLATINUM_SETTLED), true);
  });

  test('AUTH STILL RESOLVING IS ALSO UNKNOWN — a settled membership under an unsettled auth is a guess', () => {
    assert.equal(plansAreKnown(PLATINUM_SETTLED, true), false);
    assert.equal(plansAreKnown(PLATINUM_SETTLED, false), true);
  });

  test('A SIGNED-OUT VISITOR IS NOT ON A PLAN — free is their entitlement, not their possession', () => {
    // SIGNED_OUT is loading:false and tier 'free', so a gate that only watched `loading` would
    // pass here and tell somebody with no account that the Free card is "YOUR PLAN".
    assert.equal(SIGNED_OUT.loading, false);
    assert.equal(SIGNED_OUT.tier, 'free');
    assert.equal(plansAreKnown(SIGNED_OUT), false);
  });

  test('a consumer outside the provider gets false rather than a throw', () => {
    assert.equal(plansAreKnown(undefined), false);
    assert.equal(plansAreKnown(null), false);
  });
});
