// Cancel a naira membership — Cloudflare Pages Function. W3 / MON-13, ruled by Ikenna 24 Sep 2026.
//
// POST /api/membership/paystack-cancel
//   credential: Authorization: Bearer <Firebase ID token>  (or body { idToken })
//   → 200 { ok: true, status: 'non-renewing', accessUntil: <ms|null>, already?: true }
//   → 401 { code: 'signed_out' }
//   → 409 { code: 'nothing_to_cancel' }      no live naira membership on the record
//   → 502 { code: 'cancel_failed' }          Paystack or the database did not answer; retry
//
// Paystack has no customer portal, so naira members had only an email address. This endpoint
// calls Paystack's own /subscription/disable for the reader's subscription. What that does was
// MEASURED (25 Sep 2026, test mode): the subscription becomes `non-renewing`, cancelledAt is the
// next payment date, nothing more is charged, and Paystack sends subscription.not_renew now and
// subscription.disable when the paid period runs out. So the reader keeps everything until then,
// and the webhook does the downgrade on the day — nothing here writes a tier.
//
// What it DOES write is the two display facts the settings page shows (cancelAtPeriodEnd and
// currentPeriodEnd), so "cancelled, with access until <date>" is true the moment this answers,
// not whenever the webhook lands. The not_renew webhook writes the same two facts.
//
// The reader can also cancel from the "Manage subscription" link in Paystack's own emails; that
// arrives here as the same not_renew webhook.

import { json, dbBase, verifyIdToken, mintAccessToken, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { DETAIL_PATH } from './_membership.js';
import { disablePaystackSubscription } from './_paystack.js';

const LABEL = 'membership/paystack-cancel';

function readIdToken(request, body) {
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  if (m && m[1].trim()) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

/** Is there a naira membership here that a cancel applies to? Pure. */
export function cancellable(detail) {
  if (!detail || typeof detail !== 'object') return null;
  if (detail.rail !== 'paystack') return null;
  if (detail.status !== 'active' && detail.status !== 'past_due') return null;
  const code = typeof detail.paystackSubscriptionCode === 'string' && detail.paystackSubscriptionCode ? detail.paystackSubscriptionCode : null;
  return code ? { code } : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.PAYSTACK_SECRET_KEY || !env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] not configured`);
    return json({ error: 'Cancelling is unavailable right now. Please try again later.', code: 'cancel_failed' }, 502);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) { try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request body.' }, 400); } }
  const idToken = readIdToken(request, body);
  if (!idToken) return json({ error: 'Sign in to manage your membership.', code: 'signed_out' }, 401);
  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);

  let token;
  let detail;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    const res = await fetch(`${dbBase(env)}/${DETAIL_PATH(encodeURIComponent(uid))}.json`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    detail = await res.json();
  } catch (e) {
    console.error(`[${LABEL}] membership read failed for ${uid}:`, e.message || e);
    return json({ error: 'We couldn’t reach your membership just now. Please try again.', code: 'cancel_failed' }, 502);
  }

  const target = cancellable(detail);
  if (!target) return json({ error: 'There is no naira membership to cancel.', code: 'nothing_to_cancel' }, 409);

  let out;
  try {
    out = await disablePaystackSubscription(env, target.code);
  } catch (e) {
    console.error(`[${LABEL}] disable failed for ${uid} ${target.code}:`, e.message || e);
    return json({ error: 'Paystack didn’t confirm the cancellation. Nothing has changed — please try again.', code: 'cancel_failed' }, 502);
  }
  // Belt and braces on ownership: the subscription Paystack returned must be this reader's customer.
  if (out.customer && detail.paystackCustomerCode && out.customer !== detail.paystackCustomerCode) {
    console.error(`[${LABEL}] ${target.code} belongs to ${out.customer}, not ${detail.paystackCustomerCode} (${uid})`);
  }

  const until = out.nextPaymentDate ? Date.parse(out.nextPaymentDate) : NaN;
  const accessUntil = Number.isFinite(until) ? until : (typeof detail.currentPeriodEnd === 'number' ? detail.currentPeriodEnd : null);
  try {
    const res = await fetch(`${dbBase(env)}/.json`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        [`${DETAIL_PATH(uid)}/cancelAtPeriodEnd`]: true,
        ...(accessUntil ? { [`${DETAIL_PATH(uid)}/currentPeriodEnd`]: accessUntil } : {}),
        [`${DETAIL_PATH(uid)}/updatedAt`]: Date.now(),
      }),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    // The cancel HAPPENED at Paystack; only our display copy lags, and not_renew will write it.
    console.error(`[${LABEL}] display write failed for ${uid} (the cancel stands):`, e.message || e);
  }
  console.log(`[${LABEL}] ${uid} cancelled ${target.code} → ${out.status}, access until ${accessUntil ? new Date(accessUntil).toISOString() : '—'}`);
  return json({ ok: true, status: out.status || 'non-renewing', accessUntil, ...(out.already ? { already: true } : {}) });
}
