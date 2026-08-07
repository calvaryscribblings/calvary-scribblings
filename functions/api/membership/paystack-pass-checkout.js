// Pass checkout, Paystack rail (NGN) — Cloudflare Pages Function.
//
// POST /api/membership/paystack-pass-checkout
//   credential: Authorization: Bearer <Firebase ID token>  (or body { idToken })
//   body: { kind: 'day' | 'week' }
//   → 200 { url, reference }
//   → 401 { code: 'signed_out' } · 400 { code: 'bad_kind' } · 409 { code: 'not_offered' }
//
// NO CURRENCY PARAMETER, exactly as paystack-checkout.js takes none. This endpoint IS the
// naira rail; the currency is a property of which endpoint you called. Do not harmonise it
// with the Stripe one — the asymmetry is the design.
//
// ── NO PLAN IS SENT, AND THAT IS THE WHOLE DIFFERENCE ────────────────────────────────────
//
// paystack-checkout.js says a plan is always sent, and refuses without one, because a
// transaction initialized without a plan charges correctly ONCE and creates no subscription —
// "the worst of both worlds". For a PASS that outcome is not the worst of both worlds; it is
// precisely and only what we want. Charge once, no subscription, no renewal, no plan code, no
// founding lock. So this is a separate endpoint rather than a flag on that one: the invariant
// it enforces is the exact opposite of the invariant this needs, and a single endpoint holding
// both would be one `if` away from selling a subscription as a pass or a pass as a
// subscription.
//
// ── THE WEEK PASS LIVES HERE AND ONLY HERE, BECAUSE OF THE PRICE ─────────────────────────
//
// Not because Nigerian readers get different products, and not because Paystack can do
// something Stripe cannot. The week pass has a price in naira and no price in anything else
// (app/lib/membershipPasses.js:AMOUNTS), so isPassOffered() is true here and false on the
// Stripe endpoint, and that single table is the whole rule. Nothing in this file names a
// country.
//
// ── THE REFERENCE IS THE ROUTING ─────────────────────────────────────────────────────────
//
// Paystack allows ONE webhook URL per account, so this transaction lands at the same door as
// book purchases (`cs.`) and membership subscriptions (`ms.`). An `mp.` reference is what
// tells them apart, and it is the only signal available on a plan-less charge — there is no
// plan object and no subscription code to recognise it by. See _paystack.js:isMembershipEvent.

import { json, lookupUser, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import {
  PASS_KINDS, PASS_TIER, PAYSTACK_PASS_CURRENCY,
  passAmount, isPassOffered, buildPassReference, REF_SAFE_UID,
} from '../../../app/lib/membershipPasses.js';

const LABEL = 'membership/paystack-pass-checkout';
export const PAYSTACK_INITIALIZE_API = 'https://api.paystack.co/transaction/initialize';
const DEFAULT_ORIGIN = 'https://calvaryscribblings.co.uk';

export function readIdToken(request, body) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m && m[1].trim()) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

/** Pure, so the 400/409 contract is assertable without a network. */
export function validatePassSelection({ kind }) {
  if (!PASS_KINDS.includes(kind)) return { ok: false, status: 400, code: 'bad_kind', error: 'Choose a day or week pass.' };
  if (!isPassOffered(kind, PAYSTACK_PASS_CURRENCY)) {
    return { ok: false, status: 409, code: 'not_offered', error: 'That pass is not sold in naira.' };
  }
  return { ok: true, kind };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

  if (!env.PAYSTACK_SECRET_KEY || !env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error(`[${LABEL}] PAYSTACK_SECRET_KEY or NEXT_PUBLIC_FIREBASE_API_KEY is not set`);
    return json({ error: 'Naira passes are not available yet.', code: 'not_configured' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request body.' }, 400); }
  }

  const idToken = readIdToken(request, body);
  if (!idToken) return json({ error: 'Sign in to buy a pass.', code: 'signed_out' }, 401);

  const selection = validatePassSelection(body || {});
  if (!selection.ok) return json({ error: selection.error, code: selection.code }, selection.status);
  const { kind } = selection;

  const user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const uid = user?.localId;
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);
  // Paystack's initialize REQUIRES an email and it must be the one Firebase holds, never one
  // from the body — the same rule paystack-checkout.js follows.
  const email = typeof user.email === 'string' && user.email ? user.email : null;
  if (!email) return json({ error: 'Your account needs an email address to pay in naira.', code: 'no_email' }, 400);

  if (!REF_SAFE_UID.test(uid)) {
    console.error(`[${LABEL}] uid ${uid} cannot be encoded in a Paystack reference`);
    return json({ error: 'Passes could not be opened for this account.', code: 'bad_uid' }, 500);
  }

  const reference = buildPassReference(uid, kind);
  const amount = passAmount(kind, PAYSTACK_PASS_CURRENCY);

  const payload = {
    email,
    amount,
    currency: PAYSTACK_PASS_CURRENCY.toUpperCase(),
    reference,
    callback_url: `${origin}/membership?pass=success&reference=${encodeURIComponent(reference)}`,
    // No `plan` key. Its absence is what makes this a one-off charge rather than a
    // subscription — see the header.
    metadata: { uid, kind: 'pass', passKind: kind, tier: PASS_TIER },
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
      console.error(`[${LABEL}] initialize failed for ${uid} ${kind}:`, result?.message || res.status);
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

  console.log(`[${LABEL}] initialized ${reference} uid=${uid} ${kind} ${amount} kobo`);
  return json({ url, reference });
}
