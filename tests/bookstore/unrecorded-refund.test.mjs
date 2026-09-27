// W22 §0 — A REFUND FOR A PAYMENT THE SHOP NEVER RECORDED.
//
// Dead End's one sale (21 May 2026) went through the retired Payment Link. Its endpoint and its
// worker are gone (W20), so when that charge is refunded by hand, charge.refunded reaches only
// the two live endpoints: the bookstore's and the memberships'. Read live (read-only, W22): the
// Charge, its PaymentIntent and its Checkout Session carry NO metadata at all — the Payment Link
// set only the session's client_reference_id, which a Charge never carries. No invoice either.
//
// Both endpoints must answer 200, write nothing (not even ops/money_failures), send no [money]
// mail, and leave nothing for Stripe to retry. This file drives both, end to end, with that
// exact shape.
//
// NOTE the deliberate contrast at the bottom: a charge that DOES carry a book's uid + titleId
// and has no record is money this ledger cannot see, and the bookstore endpoint flags it for a
// human. That is the W3 design and stays; only the unattributable shape is silent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { onRequestPost as bookHook } from '../../functions/api/bookstore/stripe-webhook.js';
import { onRequestPost as memberHook } from '../../functions/api/membership/stripe-webhook.js';

const SECRET = 'whsec_w22';
const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_w22', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_MEMBERSHIP_WEBHOOK_SECRET: SECRET,
  FIREBASE_CLIENT_EMAIL: 'svc@example.com', FIREBASE_PRIVATE_KEY: PEM,
  RESEND_API_KEY: 're_w22', MONEY_ALERT_EMAIL: 'alerts@example.com',
};

/** Every outbound request, answered from a tiny in-memory world. Writes are recorded, not applied. */
function world({ db = {} } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ u, method, body: opts.body });
    if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 'tok', expires_in: 3600 });
    if (u.startsWith('https://api.resend.com/')) return ok({ id: 'em' });
    if (u.includes('firebasedatabase.app')) {
      const path = decodeURIComponent(new URL(u).pathname.replace(/\.json$/, ''));
      return ok(path.split('/').filter(Boolean).reduce((o, k) => (o == null ? null : (o[k] ?? null)), db));
    }
    if (u.startsWith('https://api.stripe.com/v1/invoice_payments')) return ok({ object: 'list', data: [] });
    throw new Error(`unstubbed ${method} ${u}`);
  };
  return {
    calls,
    restore() { globalThis.fetch = real; },
    writes: () => calls.filter((c) => c.u.includes('firebasedatabase.app') && c.method !== 'GET'),
    mails: () => calls.filter((c) => c.u.startsWith('https://api.resend.com/')),
  };
}

async function sign(body) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
async function deliver(hook, object) {
  const body = JSON.stringify({ id: 'evt_w22', type: 'charge.refunded', data: { object } });
  return hook({ env: ENV, request: new Request('https://x/', { method: 'POST', headers: { 'Stripe-Signature': await sign(body) }, body }) });
}

// The Payment Link charge as it reads live: no metadata, no invoice, a PaymentIntent.
const paymentLinkCharge = () => ({
  id: 'ch_w22', object: 'charge', amount: 150, amount_refunded: 150, currency: 'gbp',
  refunded: true, status: 'succeeded', payment_intent: 'pi_w22', invoice: null, metadata: {},
});

describe('W22 §0 — refunding the Payment Link charge (Dead End)', () => {
  test('bookstore endpoint: 200, nothing written, no mail, nothing to retry', async () => {
    const w = world();
    try {
      const res = await deliver(bookHook, paymentLinkCharge());
      assert.equal(res.status, 200);
      assert.equal((await res.json()).verdict, 'ignored');
      assert.deepEqual(w.writes(), [], 'no database write — not even ops/money_failures');
      assert.deepEqual(w.mails(), [], 'no [money] mail');
    } finally { w.restore(); }
  });

  test('memberships endpoint: 200, nothing written, no mail, nothing to retry', async () => {
    const w = world();
    try {
      const res = await deliver(memberHook, paymentLinkCharge());
      assert.equal(res.status, 200);
      assert.equal((await res.json()).verdict, 'ignored');
      assert.deepEqual(w.writes(), [], 'no database write — not even ops/money_failures');
      assert.deepEqual(w.mails(), [], 'no [money] mail');
      // The one Stripe read it makes is the invoice-payment lookup that proves it is not a
      // subscription payment. A GET, never a write to Stripe.
      assert.ok(w.calls.filter((c) => c.u.startsWith('https://api.stripe.com')).every((c) => c.method === 'GET'));
    } finally { w.restore(); }
  });

  test('contrast: a BOOK-shaped charge with no record is still flagged for a human (W3, unchanged)', async () => {
    const w = world();
    try {
      const res = await deliver(bookHook, { ...paymentLinkCharge(), metadata: { uid: 'w22Reader', titleId: 'some-book' } });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).verdict, 'review');
      assert.ok(w.writes().length > 0, 'the failure is recorded');
      const paths = w.writes().flatMap((c) => Object.keys(JSON.parse(c.body)));
      assert.ok(paths.every((k) => k.startsWith('ops/money_failures/')), 'and nothing else is written');
      assert.equal(w.mails().length, 1, 'one [money] mail');
    } finally { w.restore(); }
  });
});
