// THE CLIENT SIDE OF THE FIVE ENDPOINTS. One place that knows which URL a selection goes to.
//
// All five share one contract — POST { idToken, … } → { url }, errors as { error, code } — so
// the only thing that actually varies is the route and which fields the body carries. That is
// a table, not five functions, and writing it as a table is what stops the pricing page and
// the settings section growing two different ideas of how to reach the same rail.
//
// ── THE RAIL IS NOT A GUESS ──────────────────────────────────────────────────────────────
//
// Which endpoint a purchase goes to is decided by railFor(currency) in membershipPasses.js —
// gbp/usd → stripe, ngn → paystack — and never by a country, a locale or a territory check.
// Territory does NOT apply to membership: it governs a publisher's licence on a title, and a
// membership has no publisher. A reader in Lagos paying in pounds is a Stripe customer.
//
// ── THE NAIRA ENDPOINTS TAKE NO CURRENCY ─────────────────────────────────────────────────
//
// paystack-checkout and paystack-pass-checkout are naira BY CONSTRUCTION — they have no other
// currency to be — so they validate { tier, interval } and { kind } and would ignore a
// currency field. Sending one anyway would imply a choice that does not exist. The table below
// therefore builds a DIFFERENT body per rail rather than one body with an unused field.

// Explicit .js: this module is imported by `node --test` as well as by the bundler, and bare
// Node does not do extensionless resolution. Same reason functions/ spells it out.
import { railFor } from './membershipPasses.js';

/** Thrown for any non-2xx answer, carrying the endpoint's own `code` so callers can branch. */
export class MembershipCheckoutError extends Error {
  constructor(message, code, status) {
    super(message || 'Checkout could not be opened. Please try again.');
    this.name = 'MembershipCheckoutError';
    this.code = code || null;
    this.status = status || 0;
  }
}

// product × rail → [route, bodyFor]. The one table.
const ROUTES = {
  subscription: {
    stripe: ['/api/membership/checkout', ({ tier, interval, currency }) => ({ tier, interval, currency })],
    paystack: ['/api/membership/paystack-checkout', ({ tier, interval }) => ({ tier, interval })],
  },
  pass: {
    stripe: ['/api/membership/pass-checkout', ({ kind, currency }) => ({ kind, currency })],
    paystack: ['/api/membership/paystack-pass-checkout', ({ kind }) => ({ kind })],
  },
};

/**
 * Where a selection goes, and what it sends. Pure, so the routing can be asserted without a
 * network — this is the part that is easy to get quietly wrong and impossible to notice.
 *
 * Returns null for a currency we do not price at all, rather than defaulting to a rail. A
 * default here would send a purchase to Stripe in a currency Stripe cannot settle.
 */
export function routeFor({ product, currency, ...rest }) {
  const rail = railFor(currency);
  const byRail = ROUTES[product];
  if (!rail || !byRail || !byRail[rail]) return null;
  const [url, bodyFor] = byRail[rail];
  return { url, rail, body: bodyFor({ currency, ...rest }) };
}

async function postJson(url, body, idToken) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ ...body, idToken }),
    });
  } catch {
    // A dead network is not a rail failure and must not read as one.
    throw new MembershipCheckoutError('Could not reach the checkout. Check your connection and try again.', 'network', 0);
  }

  let data = null;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) throw new MembershipCheckoutError(data?.error, data?.code, res.status);
  return data || {};
}

/**
 * Open a checkout and hand back the URL to send the browser to.
 *
 * Deliberately does NOT navigate. The caller owns that, because the caller is the one that
 * knows whether it still wants to — a component unmounted mid-request should not be able to
 * throw a reader at Stripe.
 */
export async function startMembershipCheckout({ product, tier, interval, kind, currency, idToken }) {
  if (!idToken) throw new MembershipCheckoutError('Sign in to continue.', 'signed_out', 401);

  const route = routeFor({ product, tier, interval, kind, currency });
  if (!route) throw new MembershipCheckoutError('That is not available in this currency.', 'bad_currency', 0);

  const data = await postJson(route.url, route.body, idToken);
  if (!data.url) throw new MembershipCheckoutError(null, 'no_url', 200);
  return data.url;
}

/**
 * The Stripe customer portal.
 *
 * THE NO-CUSTOMER ANSWER IS A 200, NOT AN ERROR, and it carries `pending` to separate two
 * states that look identical and mean opposite things:
 *
 *   pending: true   they have a membership record but the customer id has not landed yet —
 *                   they joined moments ago and the webhook is still running. Try again.
 *   pending: false  they have no membership at all. There is nothing to manage.
 *
 * Returned rather than thrown, so a caller cannot accidentally render either one as a failure.
 */
export async function openMembershipPortal(idToken) {
  if (!idToken) throw new MembershipCheckoutError('Sign in to manage your membership.', 'signed_out', 401);
  const data = await postJson('/api/membership/portal', {}, idToken);
  if (data.url) return { url: data.url, code: null, pending: false, error: null };
  return {
    url: null,
    code: data.code || 'no_customer',
    pending: data.pending === true,
    error: data.error || null,
  };
}

/** The reader's current Firebase ID token, or null. Every endpoint verifies it server-side. */
export async function idTokenFor(user) {
  if (!user || typeof user.getIdToken !== 'function') return null;
  try { return await user.getIdToken(); } catch { return null; }
}
