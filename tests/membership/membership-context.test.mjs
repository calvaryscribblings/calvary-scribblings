// R11.5 — THE useMembership() PROVIDER.
//
//   node --test tests/membership/membership-context.test.mjs      (npm run test:membership)
//
// There is no React test harness in this repo, so what is asserted here is what can be
// asserted honestly without one: the pure timer arithmetic, the signed-out shape, the path the
// provider subscribes to, and — most importantly — that the value the provider hands out is
// exactly what describeMembership() produces for the same inputs, since the provider is a
// subscription and a clock around that one call.
//
// WHAT IS NOT COVERED, stated rather than implied: the effect wiring itself (that onValue is
// actually subscribed, that the timer is actually cleared on unmount) is not exercised. Those
// are three lines each and visible in review; pretending otherwise with a hand-rolled fake
// React would test the fake.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIGNED_OUT, MEMBERSHIP_DETAIL_PATH as DETAIL_PATH, MAX_TIMEOUT_MS, timerSliceFor,
  describeMembership, effectiveTier,
} from '../../app/lib/membership.js';
import { buildPass, DURATION_MS } from '../../app/lib/membershipPasses.js';
import { PASS_PATH, DETAIL_PATH as WRITER_DETAIL_PATH } from '../../functions/api/membership/_membership.js';

const UID = 'readerUid0001';
const NOW = 1786000000000;
const DAY = DURATION_MS.day;

describe('the node it subscribes to', () => {
  test('is the SAME node the writer writes — one string, two files', () => {
    assert.equal(DETAIL_PATH(UID), `memberships/${UID}`);
    assert.equal(DETAIL_PATH(UID), WRITER_DETAIL_PATH(UID),
      'the provider and the writer must not drift on the path');
    // And the pass is a child of it, which is what makes ONE subscription enough.
    assert.ok(PASS_PATH(UID).startsWith(`${DETAIL_PATH(UID)}/`));
  });

  test('it is NOT the tier scalar — that stays the app\'s contract, not this provider\'s source', () => {
    assert.equal(DETAIL_PATH(UID).startsWith('users/'), false);
  });
});

describe('the expiry timer — the clock moves when the data does not', () => {
  test('a pass inside the 32-bit ceiling is a single final slice', () => {
    assert.deepEqual(timerSliceFor(NOW + DAY, NOW), { delay: DAY, final: true });
    assert.deepEqual(timerSliceFor(NOW + 1, NOW), { delay: 1, final: true });
    assert.deepEqual(timerSliceFor(NOW + MAX_TIMEOUT_MS, NOW), { delay: MAX_TIMEOUT_MS, final: true });
  });

  test('BEYOND THE CEILING IT SLICES rather than overflowing to zero', () => {
    // The bug this prevents: setTimeout stores its delay in a signed 32-bit int, so a delay
    // past the ceiling fires IMMEDIATELY — and an immediate re-arm is an infinite loop that
    // pins a tab at 100% CPU.
    const far = NOW + MAX_TIMEOUT_MS + DAY;
    const slice = timerSliceFor(far, NOW);
    assert.deepEqual(slice, { delay: MAX_TIMEOUT_MS, final: false });
    assert.ok(slice.delay <= MAX_TIMEOUT_MS, 'a delay must never exceed the ceiling');

    // ...and the next slice, taken after the first has elapsed, finishes the job.
    assert.deepEqual(timerSliceFor(far, NOW + MAX_TIMEOUT_MS), { delay: DAY, final: true });
  });

  test('an ALREADY-EXPIRED pass recomputes now, never schedules into the past', () => {
    for (const past of [NOW - 1, NOW - DAY, NOW]) {
      const s = timerSliceFor(past, NOW);
      assert.deepEqual(s, { delay: 0, final: true });
      assert.ok(s.delay >= 0, 'a negative delay would be coerced to 0 and spin');
    }
  });

  test('a nonsense expiry does not arm a runaway timer', () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined]) {
      const s = timerSliceFor(bad, NOW);
      assert.equal(s.delay, 0);
      assert.equal(s.final, true);
    }
  });

  test('the delay is always a safe setTimeout argument, across a wide sweep', () => {
    for (const offset of [-1e12, -1, 0, 1, 1000, DAY, 7 * DAY, MAX_TIMEOUT_MS - 1, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS + 1, 1e15]) {
      const { delay } = timerSliceFor(NOW + offset, NOW);
      assert.ok(Number.isFinite(delay) && delay >= 0 && delay <= MAX_TIMEOUT_MS,
        `offset ${offset} produced an unusable delay ${delay}`);
    }
  });
});

describe('the signed-out shape', () => {
  test('is free, and NOT loading — a signed-out reader is not a pending fetch', () => {
    assert.equal(SIGNED_OUT.tier, 'free');
    assert.equal(SIGNED_OUT.signedIn, false);
    assert.equal(SIGNED_OUT.loading, false,
      'a consumer that spins while loading would spin forever when signed out');
    assert.equal(SIGNED_OUT.pass, null);
    assert.equal(SIGNED_OUT.source, 'none');
  });

  test('carries every key a consumer reads, so no surface needs an optional chain', () => {
    // The same key set describeMembership produces, plus the two the provider adds.
    const fromPure = Object.keys(describeMembership('free', null, NOW)).sort();
    const fromShape = Object.keys(SIGNED_OUT).filter((k) => k !== 'loading' && k !== 'signedIn').sort();
    assert.deepEqual(fromShape, fromPure);
  });
});

describe('what the provider hands out is describeMembership, unmodified', () => {
  // The provider is a subscription and a clock around this one call. If these drift, a gate
  // reading the hook and a server reading the record would disagree about the same reader.
  const withPass = { tier: 'free', pass: buildPass({ kind: 'day', currency: 'gbp', rail: 'stripe', ref: 'r', now: NOW }) };

  test('a live pass reads as gold, sourced from the pass', () => {
    const v = describeMembership(withPass.tier, withPass, NOW + 1000);
    assert.equal(v.tier, 'gold');
    assert.equal(v.subscriptionTier, 'free');
    assert.equal(v.source, 'pass');
    assert.equal(effectiveTier(withPass.tier, withPass, NOW + 1000), 'gold');
  });

  test('THE SAME RECORD reads as free once the clock passes expiresAt — nothing was written', () => {
    // This is the entire reason the timer exists: identical input, different `now`.
    const before = describeMembership(withPass.tier, withPass, NOW + DAY - 1);
    const after = describeMembership(withPass.tier, withPass, NOW + DAY);
    assert.equal(before.tier, 'gold');
    assert.equal(after.tier, 'free');
    assert.equal(after.source, 'none');
    assert.equal(after.pass, null);
    // And the timer would have fired at exactly that boundary.
    assert.deepEqual(timerSliceFor(withPass.pass.expiresAt, NOW), { delay: DAY, final: true });
  });

  test('a missing record is free rather than an error — the common case, not a failure', () => {
    const v = describeMembership(undefined, null, NOW);
    assert.equal(v.tier, 'free');
    assert.equal(v.source, 'none');
    assert.equal(v.founding, false);
  });

  test('a subscriber holding a pass is reported by the subscription, not the pass', () => {
    const platinum = { tier: 'platinum', pass: withPass.pass };
    const v = describeMembership(platinum.tier, platinum, NOW + 1000);
    assert.equal(v.tier, 'platinum');
    assert.equal(v.source, 'subscription', 'copy must not call a Platinum member a pass holder');
  });

  test('the MIRRORED tier is what the provider reads, and it matches the scalar contract', () => {
    // One onValue is only sufficient because buildDetail mirrors the tier onto the detail
    // record. If that mirror were dropped, this provider would report free for every paying
    // member — so the dependency is pinned here rather than left implicit.
    for (const tier of ['free', 'gold', 'platinum']) {
      assert.equal(describeMembership(tier, { tier }, NOW).tier, tier);
      assert.equal(effectiveTier(tier, { tier }, NOW), tier);
    }
  });
});
