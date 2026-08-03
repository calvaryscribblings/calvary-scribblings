// The R8.2 naira rail, as executable assertions.
//
//   node --test tests/bookstore/paystack.test.mjs      (npm run test:paystack)
//
// HOST-INDEPENDENT AND OFFLINE. Nothing here talks to Paystack, Firebase or Cloudflare — it
// imports the pure halves of the two endpoints directly and asserts them. That is deliberate:
// the parts of a payment rail that are cheapest to get wrong (a SHA-256 where SHA-512 was
// meant, a guard that resurrects a revoked purchase, a reference that cannot be parsed back)
// are all decidable without a network, and a test that needs test-mode keys is a test nobody
// runs.
//
// The endpoint modules are .js under functions/, and the repo has no "type": "module" — they
// load because Node ≥22.12 detects unambiguous ESM syntax. Same mechanism the newsletter
// suite already relies on for app/lib/*.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  buildPaystackReference,
  parsePaystackReference,
  buildGrantPayload,
  buildRevokePayload,
  denormalisedFields,
  hexToBytes,
  timingSafeEqual,
} from '../../functions/api/bookstore/_lib.js';

import {
  verifyPaystackSignature,
  extractReference,
  extractIdentity,
  shouldSkipGrant,
} from '../../functions/api/bookstore/paystack-webhook.js';

import { selectNgnAmount } from '../../functions/api/bookstore/paystack-checkout.js';

const UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const TITLE_ID = 'the-fire-in-the-flint';
const SECRET = 'sk_test_deadbeefcafe0123456789';

// The scheme, independently implemented from node:crypto so the test is not simply the
// endpoint's own arithmetic played back at it.
const sign = (body, secret = SECRET) =>
  createHmac('sha512', secret).update(body, 'utf8').digest('hex');

// ── Signature verification ───────────────────────────────────────────────────

test('signature: a correctly signed body is accepted', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'cs.a.b.0123abcd' } });
  const res = await verifyPaystackSignature(body, sign(body), SECRET);
  assert.equal(res.ok, true);
});

test('signature: SHA-512, not SHA-256 — a SHA-256 digest is rejected', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: {} });
  const sha256 = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
  const res = await verifyPaystackSignature(body, sha256, SECRET);
  assert.equal(res.ok, false);
});

test('signature: a tampered body is rejected', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: { amount: 450000 } });
  const signature = sign(body);
  const tampered = JSON.stringify({ event: 'charge.success', data: { amount: 1 } });
  const res = await verifyPaystackSignature(tampered, signature, SECRET);
  assert.equal(res.ok, false);
  assert.match(res.reason, /mismatch/);
});

test('signature: the wrong secret is rejected', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: {} });
  const res = await verifyPaystackSignature(body, sign(body, 'sk_test_someone_elses_key'), SECRET);
  assert.equal(res.ok, false);
});

test('signature: a missing or malformed header is rejected, not thrown', async () => {
  const body = '{}';
  assert.equal((await verifyPaystackSignature(body, null, SECRET)).ok, false);
  assert.equal((await verifyPaystackSignature(body, '', SECRET)).ok, false);
  assert.equal((await verifyPaystackSignature(body, 'not-hex-at-all', SECRET)).ok, false);
  assert.equal((await verifyPaystackSignature(body, 'abc', SECRET)).ok, false); // odd length
});

test('signature: verification is over the RAW body, not a re-serialisation', async () => {
  // Same object, different key order and whitespace — Paystack signed one exact string.
  const asSent = '{"event":"charge.success","data":{"reference":"cs.a.b.0123abcd","amount":450000}}';
  const signature = sign(asSent);
  const reserialised = JSON.stringify(JSON.parse(asSent));
  assert.equal((await verifyPaystackSignature(asSent, signature, SECRET)).ok, true);

  const roundTripped = JSON.stringify({ data: JSON.parse(asSent).data, event: 'charge.success' });
  assert.notEqual(roundTripped, asSent);
  assert.equal((await verifyPaystackSignature(roundTripped, signature, SECRET)).ok, false);
  // Guard the premise: if JSON.stringify ever became order-preserving this test would be void.
  assert.equal(reserialised, asSent);
});

test('hex + constant-time compare behave', () => {
  assert.equal(hexToBytes('zz'), null);
  assert.equal(hexToBytes('abc'), null);
  assert.deepEqual([...hexToBytes('00ff10')], [0, 255, 16]);
  assert.equal(timingSafeEqual(hexToBytes('00ff'), hexToBytes('00ff')), true);
  assert.equal(timingSafeEqual(hexToBytes('00ff'), hexToBytes('00fe')), false);
  assert.equal(timingSafeEqual(hexToBytes('00ff'), hexToBytes('00ffaa')), false);
  assert.equal(timingSafeEqual(null, null), false);
});

// ── The reference format ─────────────────────────────────────────────────────

test('reference: round-trips uid and titleId', () => {
  const ref = buildPaystackReference(UID, TITLE_ID, 'a1b2c3d4e5f6');
  assert.equal(ref, `cs.${UID}.${TITLE_ID}.a1b2c3d4e5f6`);
  assert.deepEqual(parsePaystackReference(ref), {
    uid: UID,
    titleId: TITLE_ID,
    nonce: 'a1b2c3d4e5f6',
  });
});

test('reference: hyphenated slugs survive — the separator is "."', () => {
  const parsed = parsePaystackReference(buildPaystackReference(UID, 'a-b-c-d-e', 'aabbccddeeff'));
  assert.equal(parsed.titleId, 'a-b-c-d-e');
});

test('reference: an auto-generated nonce is present and distinct per call', () => {
  const a = buildPaystackReference(UID, TITLE_ID);
  const b = buildPaystackReference(UID, TITLE_ID);
  assert.notEqual(a, b, 'a repeat purchase must not collide with the first');
  assert.equal(parsePaystackReference(a).titleId, TITLE_ID);
  assert.match(parsePaystackReference(a).nonce, /^[a-f0-9]{12}$/);
});

test('reference: foreign and malformed references are rejected, not misparsed', () => {
  assert.equal(parsePaystackReference('T123456789'), null);          // a Paystack-minted ref
  assert.equal(parsePaystackReference(''), null);
  assert.equal(parsePaystackReference(null), null);
  assert.equal(parsePaystackReference(`cs.${UID}.${TITLE_ID}`), null); // no nonce
  assert.equal(parsePaystackReference(`xx.${UID}.${TITLE_ID}.abcd1234`), null);
  assert.equal(parsePaystackReference(`cs.${UID}.bad_slug.abcd1234`), null);
});

test('reference: unsafe ids are refused at build time, before money moves', () => {
  assert.throws(() => buildPaystackReference('uid.with.dots', TITLE_ID), /uid/);
  assert.throws(() => buildPaystackReference(UID, 'has_underscore'), /titleId/);
  assert.throws(() => buildPaystackReference(UID, 'has.dot'), /titleId/);
  assert.throws(() => buildPaystackReference('', TITLE_ID), /uid/);
});

// ── Identity extraction ──────────────────────────────────────────────────────

test('identity: read from the reference, on every payload shape', () => {
  const ref = buildPaystackReference(UID, TITLE_ID, 'aabbccddeeff');
  assert.deepEqual(extractIdentity({ reference: ref }), { uid: UID, titleId: TITLE_ID });
  assert.deepEqual(extractIdentity({ transaction: { reference: ref } }), { uid: UID, titleId: TITLE_ID });
  assert.deepEqual(extractIdentity({ transaction_reference: ref }), { uid: UID, titleId: TITLE_ID });
  assert.equal(extractReference({ transaction: { reference: ref } }), ref);
});

test('identity: metadata is the fallback when the reference will not parse', () => {
  assert.deepEqual(
    extractIdentity({ reference: 'T-paystack-minted', metadata: { uid: UID, titleId: TITLE_ID } }),
    { uid: UID, titleId: TITLE_ID },
  );
  assert.deepEqual(extractIdentity({ reference: 'T-nope' }), { uid: null, titleId: null });
  assert.deepEqual(extractIdentity({}), { uid: null, titleId: null });
});

// ── The grant payload, both rails ────────────────────────────────────────────

const FIELDS = denormalisedFields({
  slug: 'the-fire-in-the-flint',
  title: 'The Fire in the Flint',
  author: 'A Scribbler',
  coverUrl: 'https://example.test/c.jpg',
  prices: { ngn: 450000 },
});

test('grant payload: the naira rail', () => {
  const ref = buildPaystackReference(UID, TITLE_ID, 'aabbccddeeff');
  const p = buildGrantPayload({
    amount: 450000,
    currency: 'NGN',
    refField: 'paystackRef',
    refValue: ref,
    fields: FIELDS,
  });

  assert.equal(p.status, 'active');
  assert.equal(p.amount, 450000);
  assert.equal(p.currency, 'NGN');
  assert.equal(p.paystackRef, ref);
  assert.equal(p.stripeSessionId, undefined, 'the naira rail must not fabricate a Stripe id');
  assert.equal(typeof p.purchasedAt, 'number');
  // The four denormalised fields My Library renders a shelf from.
  assert.equal(p.slug, 'the-fire-in-the-flint');
  assert.equal(p.title, 'The Fire in the Flint');
  assert.equal(p.author, 'A Scribbler');
  assert.equal(p.coverUrl, 'https://example.test/c.jpg');
  assert.equal(p.prices, undefined, 'only the four display fields are denormalised');
});

test('grant payload: the Stripe rail is unchanged', () => {
  const p = buildGrantPayload({
    amount: 199,
    currency: 'gbp',
    refField: 'stripeSessionId',
    refValue: 'cs_test_123',
    fields: FIELDS,
  });
  assert.deepEqual(Object.keys(p).sort(), [
    'amount', 'author', 'coverUrl', 'currency', 'purchasedAt', 'slug', 'status',
    'stripeSessionId', 'title',
  ]);
  assert.equal(p.stripeSessionId, 'cs_test_123');
  assert.equal(p.paystackRef, undefined);
  assert.equal(p.currency, 'gbp');
});

test('grant payload: absent amount/currency/fields degrade to null, never to undefined keys', () => {
  const p = buildGrantPayload({ refField: 'paystackRef', refValue: 'cs.a.b.0123abcd' });
  assert.equal(p.amount, null);
  assert.equal(p.currency, null);
  assert.equal(p.status, 'active');
  assert.equal(denormalisedFields(null), null);
});

test('revoke payload', () => {
  const p = buildRevokePayload('refunded');
  assert.equal(p.status, 'revoked');
  assert.equal(p.revokedReason, 'refunded');
  assert.equal(typeof p.revokedAt, 'number');
});

// ── Idempotency ──────────────────────────────────────────────────────────────

const REF = buildPaystackReference(UID, TITLE_ID, 'aabbccddeeff');
const OTHER_REF = buildPaystackReference(UID, TITLE_ID, '112233445566');

test('idempotency: a replayed event for the same reference is skipped', () => {
  assert.equal(shouldSkipGrant({ paystackRef: REF, status: 'active' }, REF), true);
});

test('idempotency: a replay must NOT resurrect a revoked purchase', () => {
  assert.equal(
    shouldSkipGrant({ paystackRef: REF, status: 'revoked', revokedReason: 'refunded' }, REF),
    true,
    'same reference, revoked record — the grant must be skipped, not re-applied',
  );
});

test('idempotency: a genuine repurchase after a refund is NOT skipped', () => {
  assert.equal(shouldSkipGrant({ paystackRef: REF, status: 'revoked' }, OTHER_REF), false);
  assert.equal(shouldSkipGrant({ paystackRef: REF, status: 'active' }, OTHER_REF), false);
});

test('idempotency: no prior record, or a Stripe-only record, is not skipped', () => {
  assert.equal(shouldSkipGrant(null, REF), false);
  assert.equal(shouldSkipGrant(undefined, REF), false);
  assert.equal(shouldSkipGrant({}, REF), false);
  assert.equal(shouldSkipGrant({ stripeSessionId: 'cs_test_1', status: 'active' }, REF), false);
});

// ── Pricing ──────────────────────────────────────────────────────────────────

test('price: a stored kobo amount is used verbatim — no conversion', () => {
  assert.deepEqual(selectNgnAmount({ prices: { ngn: 450000, gbp: 499, usd: 649 } }), {
    ok: true,
    amount: 450000,
  });
});

test('price: no NGN price yields the 409 not_priced_in_ngn contract', () => {
  // This is the live shape of every published title as of R8.2 — GBP only.
  const res = selectNgnAmount({ prices: { gbp: 199 } });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.code, 'not_priced_in_ngn');
  assert.match(res.error, /naira/i);
});

test('price: a GBP price is never converted into a naira one', () => {
  const gbpOnly = { prices: { gbp: 199 } };
  const res = selectNgnAmount(gbpOnly);
  assert.equal(res.ok, false);
  assert.equal(res.amount, undefined, 'no FX rate may appear anywhere on this rail');
});

test('price: junk NGN values are refused rather than charged', () => {
  for (const ngn of [0, -1, 1.5, '450000', null, undefined, NaN, Infinity]) {
    const res = selectNgnAmount({ prices: { ngn } });
    assert.equal(res.ok, false, `prices.ngn = ${String(ngn)} must not be chargeable`);
    assert.equal(res.code, 'not_priced_in_ngn');
  }
  assert.equal(selectNgnAmount({}).ok, false);
  assert.equal(selectNgnAmount(null).ok, false);
});
