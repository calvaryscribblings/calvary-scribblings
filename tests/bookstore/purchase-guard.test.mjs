// R8.2.1 — THE REPLAY/REPURCHASE GUARD, on both rails.
//
//   node --test tests/bookstore/purchase-guard.test.mjs      (npm run test:purchases)
//
// THE BUG THIS FILE EXISTS TO KEEP FIXED. Both webhooks used to skip a duplicate grant only
// when the stored record read `status === 'active'`. That inverted the guard in precisely the
// case it was written for: a replayed grant arriving after a refund FAILED the condition,
// fell through, and rewrote status:'revoked' back to 'active' — handing back a book that had
// been paid back for. Stripe and Paystack both retry for up to 72 hours, so this was not
// theoretical; it needed only a refund inside the retry window.
//
// The correct rule turns on the REFERENCE ALONE, and the two cases it separates look
// identical from a distance:
//
//   REPLAY      same reference  → no new money   → never write
//   REPURCHASE  different ref   → new money      → write, even over 'revoked'
//
// Both must be asserted together. A guard that fixes the replay by refusing to write over any
// revoked record breaks the repurchase path — taking payment for a book it never delivers —
// and that path is proven working on glass. Every scenario below is therefore run against
// BOTH rails from the same table: the two webhooks now share one implementation, and this is
// the file that says what it must do.
//
// Offline and host-independent. RTDB PATCH is a shallow merge over the existing object, which
// is what applyPatch models — enough to play a real event sequence through and assert on the
// record that would be left behind.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldSkipGrant,
  buildGrantPayload,
  buildRevokePayload,
} from '../../functions/api/bookstore/_lib.js';

// PATCH semantics: sibling fields survive, named fields are replaced. This is why a revoke
// leaves revokedAt/revokedReason lying beside a later grant's status:'active', and why the
// repurchase assertions below check status rather than the absence of revoke fields.
const applyPatch = (record, payload) => ({ ...(record || {}), ...payload });

const FIELDS = { slug: 's', title: 'T', author: 'A', coverUrl: null };

// The two rails, as data. Same scenarios, same expectations — only the field name and the
// shape of a transaction identifier differ.
const RAILS = [
  {
    name: 'stripe',
    refField: 'stripeSessionId',
    refA: 'cs_test_a1b2c3',
    refB: 'cs_test_d4e5f6',
    currency: 'gbp',
    amount: 199,
  },
  {
    name: 'paystack',
    refField: 'paystackRef',
    refA: 'cs.XaG6bTGqdDXh7VkBTw4y1H2d2s82.the-rescue.aabbccddeeff',
    refB: 'cs.XaG6bTGqdDXh7VkBTw4y1H2d2s82.the-rescue.112233445566',
    currency: 'NGN',
    amount: 450000,
  },
];

const grant = (rail, ref) => buildGrantPayload({
  amount: rail.amount,
  currency: rail.currency,
  refField: rail.refField,
  refValue: ref,
  fields: FIELDS,
});

for (const rail of RAILS) {
  // ── (a) REPLAY against a revoked record — the bug ──────────────────────────
  test(`${rail.name}: a replayed grant does NOT resurrect a revoked purchase`, () => {
    // grant → refund → the same event delivered again inside the retry window
    let record = applyPatch(null, grant(rail, rail.refA));
    record = applyPatch(record, buildRevokePayload('refunded'));
    assert.equal(record.status, 'revoked');

    const skipped = shouldSkipGrant(record, rail.refField, rail.refA);
    assert.equal(skipped, true, 'same reference — the replay must be skipped');

    // The webhook returns before patching, so the record is untouched.
    const after = skipped ? record : applyPatch(record, grant(rail, rail.refA));
    assert.equal(after.status, 'revoked', 'the purchase must still be revoked');
    assert.equal(after.revokedReason, 'refunded');
    assert.equal(after.revokedAt, record.revokedAt, 'no write happened at all');
  });

  // ── (b) REPURCHASE against a revoked record — must still work ──────────────
  test(`${rail.name}: a NEW grant after a refund is a repurchase and does grant`, () => {
    let record = applyPatch(null, grant(rail, rail.refA));
    record = applyPatch(record, buildRevokePayload('refunded'));

    const skipped = shouldSkipGrant(record, rail.refField, rail.refB);
    assert.equal(skipped, false, 'a different reference is new money, not a replay');

    const after = applyPatch(record, grant(rail, rail.refB));
    assert.equal(after.status, 'active', 'the reader owns the book again');
    assert.equal(after[rail.refField], rail.refB, 'the record names the NEW transaction');
    assert.equal(after.amount, rail.amount);
    assert.equal(after.currency, rail.currency);
    // PATCH leaves the old revoke fields as sediment; status is what the reader gate reads
    // (functions/api/bookstore/stream.js checks purchase.status !== 'active').
    assert.equal(after.revokedReason, 'refunded');
  });

  // ── (c) REPLAY against an active record — unchanged behaviour ──────────────
  test(`${rail.name}: a replayed grant against an active record is skipped`, () => {
    const record = applyPatch(null, grant(rail, rail.refA));
    assert.equal(record.status, 'active');
    assert.equal(shouldSkipGrant(record, rail.refField, rail.refA), true);
  });

  // ── (d) REFUND after a grant — unchanged behaviour ─────────────────────────
  test(`${rail.name}: a refund after a grant revokes, and the reader gate closes`, () => {
    let record = applyPatch(null, grant(rail, rail.refA));
    assert.equal(record.status, 'active');

    record = applyPatch(record, buildRevokePayload('refunded'));
    assert.equal(record.status, 'revoked');
    assert.equal(record.revokedReason, 'refunded');
    assert.equal(typeof record.revokedAt, 'number');
    // The transaction reference and display fields survive the revoke — an admin can still
    // tell which purchase this was.
    assert.equal(record[rail.refField], rail.refA);
    assert.equal(record.slug, 's');
  });

  // ── First purchase, and cross-rail isolation ───────────────────────────────
  test(`${rail.name}: a first purchase is never skipped`, () => {
    assert.equal(shouldSkipGrant(null, rail.refField, rail.refA), false);
    assert.equal(shouldSkipGrant(undefined, rail.refField, rail.refA), false);
    assert.equal(shouldSkipGrant({}, rail.refField, rail.refA), false);
  });

  test(`${rail.name}: the other rail's record does not satisfy this rail's guard`, () => {
    const other = RAILS.find((r) => r.name !== rail.name);
    const otherRecord = applyPatch(null, grant(other, other.refA));
    assert.equal(
      shouldSkipGrant(otherRecord, rail.refField, rail.refA),
      false,
      'a purchase bought on the other rail must not block a grant on this one',
    );
  });
}

// ── The guard's own edges ────────────────────────────────────────────────────

test('guard: a missing reference can never compare equal to a missing field', () => {
  // Both undefined would be `===` in a naive implementation, silently skipping a write that
  // should have happened. An unattributable event must fall through, not be swallowed.
  assert.equal(shouldSkipGrant({ status: 'active' }, 'paystackRef', undefined), false);
  assert.equal(shouldSkipGrant({ status: 'active' }, 'paystackRef', null), false);
  assert.equal(shouldSkipGrant({ status: 'active' }, 'paystackRef', ''), false);
  assert.equal(shouldSkipGrant({ paystackRef: null }, 'paystackRef', null), false);
});

test('guard: status plays no part in the decision', () => {
  // The regression, stated directly: the verdict for a given reference is identical whatever
  // the record's status. Any future edit that reintroduces a status clause fails here.
  for (const status of ['active', 'revoked', 'pending', undefined]) {
    assert.equal(
      shouldSkipGrant({ stripeSessionId: 'cs_test_a1b2c3', status }, 'stripeSessionId', 'cs_test_a1b2c3'),
      true,
      `same reference, status=${String(status)} — must skip`,
    );
    assert.equal(
      shouldSkipGrant({ stripeSessionId: 'cs_test_a1b2c3', status }, 'stripeSessionId', 'cs_test_OTHER'),
      false,
      `different reference, status=${String(status)} — must write`,
    );
  }
});

test('guard: a non-object record is not a match', () => {
  assert.equal(shouldSkipGrant('revoked', 'paystackRef', 'x'), false);
  assert.equal(shouldSkipGrant(0, 'paystackRef', 'x'), false);
  assert.equal(shouldSkipGrant(false, 'paystackRef', 'x'), false);
});
