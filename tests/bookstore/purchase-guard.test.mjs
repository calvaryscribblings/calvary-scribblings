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
  classifyRevocation,
  storedReferences,
  STRIPE_REF_FIELDS,
  PAYSTACK_REF_FIELDS,
} from '../../functions/api/bookstore/_lib.js';
import { revocationCandidates } from '../../functions/api/bookstore/stripe-webhook.js';

// PATCH semantics: sibling fields survive, named fields are replaced — and a `null` DELETES
// the child, which is how RTDB's REST PATCH behaves and what applyPatch models below.
//
// ⚠ R9.1 — THIS COMMENT USED TO END DIFFERENTLY, and the difference is the fix. It said the
// merge "is why a revoke leaves revokedAt/revokedReason lying beside a later grant's
// status:'active', and why the repurchase assertions below check status rather than the
// absence of revoke fields." That was an accurate description of a DEFECT, written up as a
// property to work around. It was found on a live record on 5 Sept 2026 — bought, refunded,
// re-bought five minutes later, and reading `revokedReason: 'refunded'` under an active
// status ever since.
//
// buildGrantPayload() now sends `revokedAt: null, revokedReason: null` on every grant, so the
// stamps are deleted rather than inherited, and the assertions below check exactly what the
// old comment said they could not.
const applyPatch = (record, payload) => {
  const out = { ...(record || {}), ...payload };
  // RTDB deletes a child written as null. Modelling that is what makes these assertions real.
  for (const [k, v] of Object.entries(payload || {})) if (v === null) delete out[k];
  return out;
};

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

    // R9.1 LB-7. The Stripe rail stores TWO identifiers per transaction, because a
    // charge- or dispute-shaped event never carries the Checkout Session id — the
    // PaymentIntent is the only thing that reaches back to it.
    revokeFields: STRIPE_REF_FIELDS,
    extraRefs: { cs_test_a1b2c3: { stripePaymentIntent: 'pi_test_aaa' },
                 cs_test_d4e5f6: { stripePaymentIntent: 'pi_test_bbb' } },
    // What a charge.dispute.created about that transaction actually looks like on the wire:
    // its own dispute id, the PaymentIntent, and the charge. Built through the REAL
    // extractor the webhook uses, so a change to it breaks these tests rather than sliding by.
    disputeFor: (ref) => revocationCandidates({
      id: 'dp_test_zzz',
      payment_intent: ref === 'cs_test_a1b2c3' ? 'pi_test_aaa' : 'pi_test_bbb',
      charge: ref === 'cs_test_a1b2c3' ? 'ch_test_aaa' : 'ch_test_bbb',
    }),
  },
  {
    name: 'paystack',
    refField: 'paystackRef',
    refA: 'cs.XaG6bTGqdDXh7VkBTw4y1H2d2s82.the-rescue.aabbccddeeff',
    refB: 'cs.XaG6bTGqdDXh7VkBTw4y1H2d2s82.the-rescue.112233445566',
    currency: 'NGN',
    amount: 450000,

    revokeFields: PAYSTACK_REF_FIELDS,
    extraRefs: {},
    // Paystack's reference rides on every event about the transaction by construction.
    disputeFor: (ref) => [ref],
  },
];

const grant = (rail, ref) => buildGrantPayload({
  amount: rail.amount,
  currency: rail.currency,
  refField: rail.refField,
  refValue: ref,
  extraRefs: rail.extraRefs[ref],
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
    // ⭑ R9.1 — AND THE REFUND IS GONE FROM THE RECORD. It used to survive as sediment, so a
    // repurchased book read `revokedReason: 'refunded'` under `status: 'active'` forever. The
    // entitlement was always right; the record was not, and it is the record a human reads
    // when somebody asks whether they were refunded.
    assert.equal(after.revokedReason, undefined, 'a repurchase must not inherit the old refund');
    assert.equal(after.revokedAt, undefined, 'a repurchase must not inherit the old refund date');
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

  // ── (e) DISPUTE FOR AN OLD REF AFTER A REPURCHASE — R9.1 LB-7, the bug ─────
  test(`${rail.name}: a dispute for the OLD charge leaves a repurchased book alone`, () => {
    // buy → refund → buy again. The shelf now holds transaction B, active.
    let record = applyPatch(null, grant(rail, rail.refA));
    record = applyPatch(record, buildRevokePayload('refunded'));
    record = applyPatch(record, grant(rail, rail.refB));
    assert.equal(record.status, 'active');
    assert.equal(record[rail.refField], rail.refB);

    // The bank raises a dispute on charge A, weeks later. Same uid, same titleId — which is
    // ALL the old code looked at, and why it revoked a book the reader had paid for twice.
    const { verdict, stored, incoming } = classifyRevocation(
      record, rail.revokeFields, rail.disputeFor(rail.refA),
    );

    assert.equal(verdict, 'review', 'an old transaction must not revoke the current one');
    // BOTH references reach the log, which is the whole point of returning them.
    assert.ok(stored.length > 0, 'the stored reference must be reported for manual review');
    assert.ok(incoming.length > 0, 'the event reference must be reported for manual review');
    assert.ok(!incoming.some((c) => stored.includes(c)), 'and they must genuinely not match');

    // The webhook returns before patching, so the record is untouched.
    const after = verdict === 'revoke' ? applyPatch(record, buildRevokePayload('disputed')) : record;
    assert.equal(after.status, 'active', 'the reader keeps the book they paid for');
    // R9.1 — the repurchase cleared the original refund, so there is no revoke on the record
    // at all. The verdict above is the assertion that matters: an old transaction's dispute
    // must not revoke the current one.
    assert.equal(after.revokedReason, undefined, 'the repurchase cleared the original refund');
    assert.equal(after[rail.refField], rail.refB);
  });

  // ── (f) DISPUTE MATCHING THE CURRENT REF — must still revoke ───────────────
  test(`${rail.name}: a dispute matching the CURRENT transaction does revoke`, () => {
    let record = applyPatch(null, grant(rail, rail.refA));
    record = applyPatch(record, buildRevokePayload('refunded'));
    record = applyPatch(record, grant(rail, rail.refB));
    assert.equal(record.status, 'active');

    const { verdict } = classifyRevocation(record, rail.revokeFields, rail.disputeFor(rail.refB));
    assert.equal(verdict, 'revoke', 'this dispute IS about the purchase on the shelf');

    const after = applyPatch(record, buildRevokePayload('disputed'));
    assert.equal(after.status, 'revoked');
    assert.equal(after.revokedReason, 'disputed');
  });

  // A refund for the transaction actually on the shelf — the ordinary case, which the new
  // guard must not have broken. This is (d) seen through classifyRevocation.
  test(`${rail.name}: an ordinary refund for the only transaction revokes`, () => {
    const record = applyPatch(null, grant(rail, rail.refA));
    const { verdict } = classifyRevocation(record, rail.revokeFields, rail.disputeFor(rail.refA));
    assert.equal(verdict, 'revoke');
  });

  test(`${rail.name}: a revoke event for a purchase that was never recorded writes nothing`, () => {
    assert.equal(classifyRevocation(null, rail.revokeFields, rail.disputeFor(rail.refA)).verdict, 'absent');
    assert.equal(classifyRevocation(undefined, rail.revokeFields, rail.disputeFor(rail.refA)).verdict, 'absent');
  });

  test(`${rail.name}: a pre-R9.1 record with no comparable reference goes to review, not revoke`, () => {
    // Records written before LB-7 carry no stripePaymentIntent. On the Stripe rail a charge
    // event about one of them can match nothing, and the safe answer is a human, not a write.
    const legacy = { status: 'active', purchasedAt: 1, slug: 's' };
    assert.equal(classifyRevocation(legacy, rail.revokeFields, rail.disputeFor(rail.refA)).verdict, 'review');
  });

  test(`${rail.name}: an unattributable event cannot revoke an arbitrary purchase`, () => {
    // Empty candidate list vs a record with references. Two empty sets "agree" under a naive
    // implementation; agreeing on nothing must never be a match.
    const record = applyPatch(null, grant(rail, rail.refA));
    assert.equal(classifyRevocation(record, rail.revokeFields, []).verdict, 'review');
    assert.equal(classifyRevocation(record, rail.revokeFields, [null, '', undefined]).verdict, 'review');
    assert.equal(classifyRevocation({ status: 'active' }, rail.revokeFields, []).verdict, 'review');
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

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION TESTING — R9.1 LB-7, the same technique R8.2.1 used on shouldSkipGrant.
//
// The scenarios above pass against the implementation as written. That is necessary and it
// is not sufficient: a table can pass while still failing to DISCRIMINATE, and a guard that
// no test can break is a guard nobody can safely edit. So the plausible wrong versions are
// written out and each one is required to FAIL the table.
//
// Every mutant below is something a reasonable person might actually write — including the
// exact code that shipped before this round.
// ═══════════════════════════════════════════════════════════════════════════════

const STRIPE_A = { status: 'active', stripeSessionId: 'cs_B', stripePaymentIntent: 'pi_B' };
const DISPUTE_OLD = revocationCandidates({ id: 'dp_1', payment_intent: 'pi_A', charge: 'ch_A' });
const DISPUTE_NOW = revocationCandidates({ id: 'dp_1', payment_intent: 'pi_B', charge: 'ch_B' });

// The behaviour contract, as data. Anything claiming to be this guard must satisfy all of it.
const CONTRACT = [
  ['old dispute after a repurchase → review', STRIPE_A, STRIPE_REF_FIELDS, DISPUTE_OLD, 'review'],
  ['current dispute → revoke', STRIPE_A, STRIPE_REF_FIELDS, DISPUTE_NOW, 'revoke'],
  ['no record → absent', null, STRIPE_REF_FIELDS, DISPUTE_NOW, 'absent'],
  ['record with no refs → review', { status: 'active' }, STRIPE_REF_FIELDS, DISPUTE_NOW, 'review'],
  ['no candidates → review', STRIPE_A, STRIPE_REF_FIELDS, [], 'review'],
  ['session-id match (async_payment_failed) → revoke', STRIPE_A, STRIPE_REF_FIELDS, ['cs_B'], 'revoke'],
  ['paystack ref match → revoke',
    { status: 'active', paystackRef: 'cs.u.t.bbb' }, PAYSTACK_REF_FIELDS, ['cs.u.t.bbb'], 'revoke'],
  ['paystack old ref → review',
    { status: 'active', paystackRef: 'cs.u.t.bbb' }, PAYSTACK_REF_FIELDS, ['cs.u.t.aaa'], 'review'],
];

test('contract: the real implementation satisfies every case', () => {
  for (const [label, record, fields, candidates, expected] of CONTRACT) {
    assert.equal(classifyRevocation(record, fields, candidates).verdict, expected, label);
  }
});

const MUTANTS = [
  {
    name: 'THE SHIPPED BUG — revoke on uid/titleId alone, never reading the reference',
    fn: (existing) => ({ verdict: existing ? 'revoke' : 'absent' }),
  },
  {
    name: 'only ever checks the first ref field (misses the PaymentIntent link)',
    fn: (existing, fields, candidates) => {
      if (!existing) return { verdict: 'absent' };
      return { verdict: candidates.includes(existing[fields[0]]) ? 'revoke' : 'review' };
    },
  },
  {
    name: 'treats "nothing stored" as a match (empty sets agree)',
    fn: (existing, fields, candidates) => {
      if (!existing) return { verdict: 'absent' };
      const stored = storedReferences(existing, fields);
      return { verdict: stored.every((s) => !candidates.includes(s)) && stored.length
        ? 'review' : 'revoke' };
    },
  },
  {
    name: 'lets status decide instead of the reference',
    fn: (existing) => {
      if (!existing) return { verdict: 'absent' };
      return { verdict: existing.status === 'active' ? 'revoke' : 'review' };
    },
  },
  {
    name: 'falls back to revoking when it cannot match (fail-open)',
    fn: (existing, fields, candidates) => {
      if (!existing) return { verdict: 'absent' };
      const stored = storedReferences(existing, fields);
      if (!stored.length || !candidates.length) return { verdict: 'revoke' };
      return { verdict: candidates.some((c) => stored.includes(c)) ? 'revoke' : 'review' };
    },
  },
  {
    name: 'matches on any substring rather than equality',
    fn: (existing, fields, candidates) => {
      if (!existing) return { verdict: 'absent' };
      const stored = storedReferences(existing, fields);
      const hit = stored.some((s) => candidates.some((c) => c.includes(s.slice(0, 2))));
      return { verdict: hit ? 'revoke' : 'review' };
    },
  },
];

for (const mutant of MUTANTS) {
  test(`mutation: the table CATCHES — ${mutant.name}`, () => {
    const survived = CONTRACT.every(([, record, fields, candidates, expected]) => {
      let got;
      try { got = mutant.fn(record, fields, candidates).verdict; } catch { return false; }
      return got === expected;
    });
    assert.equal(
      survived, false,
      'this broken implementation passes every assertion above — the suite does not ' +
      'actually pin the behaviour it claims to. Add the scenario that separates them.',
    );
  });
}
