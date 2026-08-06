// Billing portal session — Cloudflare Pages Function.
//
// POST /api/membership/portal
//   credential: Authorization: Bearer <Firebase ID token>  (or body { idToken })
//   → 200 { url }
//   → 200 { url: null, code: 'no_customer' }   NOT an error — see below
//   → 401 { code: 'signed_out' }
//   → 409 { code: 'not_configured' }
//
// Self-serve cancel, plan change and card update, without any of it passing through this
// codebase. Stripe hosts the pages; this endpoint only mints a one-time session URL for the
// Customer the reader already has.
//
// ── THE ORDERING PROBLEM, AND WHY no_customer IS A 200 ───────────────────────────────────
//
// A Stripe Customer does not exist until somebody checks out. The id is born on
// checkout.session.completed and stored on memberships/{uid} by the webhook. So there is a
// real, ordinary, non-exceptional state in which a signed-in reader has no customer id:
//
//   • they have never subscribed — most readers, most of the time;
//   • they subscribed seconds ago and the webhook has not landed yet.
//
// Neither is an error, and answering 500 would be a lie about both. A 404 would be little
// better — it says "this endpoint is wrong" when the endpoint is fine and the reader simply
// has nothing to manage yet. So this returns 200 with `url: null` and `code: 'no_customer'`,
// which a UI can render as "You don't have a membership to manage" or "Just a moment — we're
// still setting things up", and which a caller can distinguish from a failure without parsing
// prose.
//
// The `pending` flag separates the two cases where we can tell them apart: a reader with a
// membership record but no customer id is mid-webhook and should be told to wait; a reader
// with no record at all has simply never joined.
//
// ── THE PORTAL IS RESTRICTED TO FOUNDING PRICES ──────────────────────────────────────────
//
// `configuration` is passed on every session, and it is the second half of the founding lock.
// A portal with no configuration offers whatever prices the Product currently has, so a
// founding member upgrading Gold → Platinum would land on the CURRENT Platinum price and lose
// their lock at the exact moment they gave us more money — silently, with no error anywhere.
// The configuration created by scripts/create-founding-prices.mjs lists only the founding
// generation's prices, so an upgrade can only land on a founding one.
//
// If the configuration id is missing this endpoint REFUSES rather than opening an
// unrestricted portal. An unrestricted portal works perfectly and quietly breaks the promise;
// that is precisely the kind of failure worth being loud about.

import { json, dbBase, verifyIdToken, PROVIDER_TIMEOUT_MS, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { DETAIL_PATH } from './_membership.js';
import { PORTAL_CONFIGURATION, CURRENT_GENERATION, modeOf } from './prices.js';

const LABEL = 'membership/portal';
const PORTAL_API = 'https://api.stripe.com/v1/billing_portal/sessions';
const DEFAULT_ORIGIN = 'https://calvaryscribblings.co.uk';

export function readIdToken(request, body) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m && m[1].trim()) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

/**
 * What to answer when there is no customer id. Pure, so the honest-state contract is asserted
 * without a network — this is the branch most likely to be "fixed" into a 500 by someone who
 * has not read the ordering note above.
 */
export function noCustomerResponse(detail) {
  const hasRecord = !!detail && typeof detail === 'object';
  return {
    url: null,
    code: 'no_customer',
    // Mid-webhook: they have a membership record but the customer id has not landed yet.
    pending: hasRecord,
    error: hasRecord
      ? 'We are still setting up your membership. Try again in a moment.'
      : 'You do not have a membership to manage yet.',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

  if (!env.STRIPE_SECRET_KEY || !env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error(`[${LABEL}] STRIPE_SECRET_KEY or NEXT_PUBLIC_FIREBASE_API_KEY is not set`);
    return json({ error: 'Membership management is not available yet.', code: 'not_configured' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request body.' }, 400); }
  }

  const idToken = readIdToken(request, body);
  if (!idToken) return json({ error: 'Sign in to manage your membership.', code: 'signed_out' }, 401);

  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);

  const mode = modeOf(env.STRIPE_SECRET_KEY);
  const configuration = PORTAL_CONFIGURATION[CURRENT_GENERATION]?.[mode] || null;
  if (!configuration) {
    // Refuse rather than open an unrestricted portal. See the header: an unrestricted portal
    // works, and silently ends the founding lock on the first upgrade.
    console.error(`[${LABEL}] no ${mode} portal configuration for generation ${CURRENT_GENERATION}`);
    return json({ error: 'Membership management is not available yet.', code: 'not_configured' }, 409);
  }

  // The reader's own record, read with the reader's own token — memberships/{uid} is
  // owner-readable, so no admin credential is needed to answer a question about oneself.
  let detail = null;
  try {
    const res = await fetch(`${dbBase(env)}/${DETAIL_PATH(encodeURIComponent(uid))}.json?auth=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    detail = await res.json();
  } catch (e) {
    // Fail CLOSED, but honestly: we cannot prove they have a customer, so we do not open a
    // portal — and we do not claim they have no membership either.
    console.error(`[${LABEL}] membership read failed for ${uid}:`, e.message || e);
    return json({ error: 'Could not reach your membership just now. Please try again.' }, 502);
  }

  const customerId = detail && typeof detail.stripeCustomerId === 'string' && detail.stripeCustomerId
    ? detail.stripeCustomerId : null;

  if (!customerId) {
    console.log(`[${LABEL}] ${uid} has no stripeCustomerId yet (record ${detail ? 'exists' : 'absent'})`);
    return json(noCustomerResponse(detail), 200);
  }

  const form = new URLSearchParams();
  form.set('customer', customerId);
  form.set('return_url', `${origin}/membership`);
  form.set('configuration', configuration);

  let session;
  try {
    const res = await fetch(PORTAL_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    session = await res.json();
    if (!res.ok) {
      console.error(`[${LABEL}] portal session failed for ${uid}/${customerId}:`, session?.error?.message || res.status);
      return json({ error: 'Could not open membership management. Please try again.' }, 502);
    }
  } catch (e) {
    console.error(`[${LABEL}] Stripe request failed:`, e.message || e);
    return json({ error: 'Could not open membership management. Please try again.' }, 502);
  }

  if (!session?.url) {
    console.error(`[${LABEL}] Stripe returned a portal session with no url for ${uid}`);
    return json({ error: 'Could not open membership management. Please try again.' }, 502);
  }

  console.log(`[${LABEL}] opened ${uid} customer=${customerId} configuration=${configuration}`);
  return json({ url: session.url });
}
