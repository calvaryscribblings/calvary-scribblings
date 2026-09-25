// Did the payment go through? — Cloudflare Pages Function. W3 / MON-09.
//
// POST /api/membership/return-status
//   credential: Authorization: Bearer <Firebase ID token>
//   body: { sessionId } (Stripe, from ?session_id=) | { reference } (Paystack, from ?reference=)
//   → 200 { state: 'paid' | 'pending' | 'failed' | 'unknown' }
//
// The return banner on /membership used to read "SETTING UP YOUR MEMBERSHIP…" for ever. Whether
// the membership has LANDED is the page's own live read of memberships/{uid}; what the page could
// not know is whether the MONEY moved. This asks the provider, for the reader's own checkout only:
//
//   paid     the provider has the money. If nothing has landed after the deadline, that is our
//            failure, not theirs — and the webhook has already recorded it (ops/money_failures).
//   pending  the provider is still waiting (a bank transfer, 3-D Secure not finished).
//   failed   the checkout ended without payment. Nothing was taken.
//   unknown  not this reader's checkout, or the provider did not answer.

import { json, verifyIdToken, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import { stripe } from '../_stripe.js';
import { parseMembershipReference } from './paystack-plans.js';
import { parsePassReference } from '../../../app/lib/membershipPasses.js';

/** Stripe Checkout Session → state. Pure. */
export function stripeState(session) {
  if (!session) return 'unknown';
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') return 'paid';
  if (session.status === 'expired') return 'failed';
  return 'pending';
}

/** Paystack transaction status → state. Pure. */
export function paystackState(status) {
  if (status === 'success') return 'paid';
  if (status === 'failed' || status === 'abandoned' || status === 'reversed') return 'failed';
  if (typeof status === 'string' && status) return 'pending';
  return 'unknown';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  const idToken = m ? m[1].trim() : (typeof body.idToken === 'string' ? body.idToken : null);
  if (!idToken) return json({ state: 'unknown', code: 'signed_out' }, 401);
  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ state: 'unknown', code: 'signed_out' }, 401);

  try {
    if (typeof body.sessionId === 'string' && /^cs_(test|live)_[A-Za-z0-9]+$/.test(body.sessionId)) {
      const r = await stripe(env, `/checkout/sessions/${body.sessionId}`);
      if (!r.ok || r.body?.client_reference_id !== uid) return json({ state: 'unknown' });
      return json({ state: stripeState(r.body) });
    }
    if (typeof body.reference === 'string' && body.reference) {
      const owner = parseMembershipReference(body.reference)?.uid || parsePassReference(body.reference)?.uid;
      if (owner !== uid) return json({ state: 'unknown' });
      const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(body.reference)}`, {
        headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      const v = await res.json().catch(() => null);
      if (!v?.data) return json({ state: res.status === 400 || res.status === 404 ? 'failed' : 'unknown' });
      return json({ state: paystackState(v.data.status) });
    }
  } catch (e) {
    console.error('[membership/return-status] provider check failed:', e?.message || e);
  }
  return json({ state: 'unknown' });
}
