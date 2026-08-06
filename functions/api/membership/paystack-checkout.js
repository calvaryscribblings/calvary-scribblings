// Membership checkout, Paystack rail (NGN) — Cloudflare Pages Function.
//
// POST /api/membership/paystack-checkout
//   credential: Authorization: Bearer <Firebase ID token>  (or body { idToken })
//   body: { tier: 'gold'|'platinum', interval: 'monthly'|'annual' }
//   → 200 { url, reference }
//   → 401 { code: 'signed_out' }  · 409 { code: 'not_configured' } · 400 { code: … }
//
// The twin of functions/api/membership/checkout.js, and it exists for the same reason
// paystack-checkout.js exists next door in the bookstore: Stripe cannot settle naira.
//
// NO CURRENCY PARAMETER, exactly as the bookstore's naira endpoint takes none. This endpoint
// IS the naira rail — the currency is a property of which endpoint you called, not something
// to negotiate. Do not "harmonise" it with the Stripe one; the asymmetry is the design.
//
// A `plan` IS SENT, and that is the whole difference from a one-off. A transaction initialized
// without a plan charges correctly ONCE and creates no subscription — the worst of both
// worlds, because the member pays and never renews and nothing in the system knows they were
// meant to. So an unconfigured plan book REFUSES rather than falling back to a bare amount.
//
// THE REFERENCE IS SELF-DESCRIBING, and on this rail that is load-bearing rather than tidy:
// it is the ONLY event in a subscription's life whose reference we control, and it is what
// seeds the index that every later renewal resolves its identity through. See _paystack.js.

import { json, lookupUser, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import {
  TIERS, INTERVALS, CURRENT_GENERATION,
  planCodeFor, amountFor, isConfigured, modeOf, buildMembershipReference, REF_SAFE_UID,
} from './paystack-plans.js';

const LABEL = 'membership/paystack-checkout';
export const PAYSTACK_INITIALIZE_API = 'https://api.paystack.co/transaction/initialize';
const DEFAULT_ORIGIN = 'https://calvaryscribblings.co.uk';

export function readIdToken(request, body) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m && m[1].trim()) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

/** Pure, so the 400 contract is assertable without a network. */
export function validateSelection({ tier, interval }) {
  if (!TIERS.includes(tier)) return { ok: false, code: 'bad_tier', error: 'Choose Gold or Platinum.' };
  if (!INTERVALS.includes(interval)) return { ok: false, code: 'bad_interval', error: 'Choose monthly or annual.' };
  return { ok: true, tier, interval };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

  if (!env.PAYSTACK_SECRET_KEY || !env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error(`[${LABEL}] PAYSTACK_SECRET_KEY or NEXT_PUBLIC_FIREBASE_API_KEY is not set`);
    return json({ error: 'Naira memberships are not available yet.', code: 'not_configured' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request body.' }, 400); }
  }

  const idToken = readIdToken(request, body);
  if (!idToken) return json({ error: 'Sign in to become a member.', code: 'signed_out' }, 401);

  const selection = validateSelection(body || {});
  if (!selection.ok) return json({ error: selection.error, code: selection.code }, 400);
  const { tier, interval } = selection;

  const mode = modeOf(env.PAYSTACK_SECRET_KEY);
  if (!isConfigured(mode)) {
    console.error(`[${LABEL}] plan book has no ${mode} codes for generation ${CURRENT_GENERATION}`);
    return json({ error: 'Memberships open on 30 September.', code: 'not_configured' }, 409);
  }
  const planCode = planCodeFor({ tier, interval, mode });
  if (!planCode) return json({ error: 'That membership is not available in naira.', code: 'not_priced' }, 409);

  // ── identity, and the email Paystack requires ──────────────────────────────
  const user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const uid = user?.localId;
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);
  const email = typeof user.email === 'string' && user.email ? user.email : null;
  if (!email) {
    // Paystack's initialize REQUIRES an email and it must be the one Firebase holds, never one
    // the browser typed — the same rule the bookstore's naira rail follows.
    return json({ error: 'Add an email address to your account to pay in naira.', code: 'no_email' }, 400);
  }
  if (!REF_SAFE_UID.test(uid)) {
    console.error(`[${LABEL}] uid ${uid} cannot be encoded in a Paystack reference`);
    return json({ error: 'This account cannot pay in naira.', code: 'unsupported_uid' }, 400);
  }

  const reference = buildMembershipReference(uid, tier, interval);

  const payload = {
    email,
    // The amount is sent AND the plan is sent. Paystack takes the plan's amount as
    // authoritative for a subscription; sending ours too means a mismatch is visible in the
    // dashboard rather than silent, and costs nothing.
    amount: amountFor({ tier, interval }),
    currency: 'NGN',
    plan: planCode,
    reference,
    callback_url: `${origin}/membership?join=success`,
    // A convenience copy only. Nothing downstream depends on it — Paystack makes no promise
    // metadata survives onto a recurring charge, which is exactly why the reference is
    // self-describing and why the index in _paystack.js exists.
    metadata: { uid, kind: 'membership', tier, interval },
  };

  let result;
  try {
    const res = await fetch(PAYSTACK_INITIALIZE_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    result = await res.json();
    if (!res.ok || result?.status !== true) {
      console.error(`[${LABEL}] initialize failed for ${uid} ${tier}/${interval}:`, result?.message || res.status);
      return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
    }
  } catch (e) {
    console.error(`[${LABEL}] Paystack request failed:`, e.message || e);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  const url = result?.data?.authorization_url;
  if (!url) {
    console.error(`[${LABEL}] no authorization_url for ${reference}`);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  console.log(`[${LABEL}] initialized ${reference} uid=${uid} plan=${planCode} ${tier}/${interval}`);
  return json({ url, reference });
}
