// THE ONE STRIPE CLIENT — every Stripe call from a Pages Function goes through here.
//
// NOT A ROUTE (underscore prefix; exports no onRequest*).
//
// ── W3 / MON-06: THE API VERSION IS PINNED ───────────────────────────────────────────────
//
// Until W3 no request sent `Stripe-Version`, so every call — and every webhook payload — took
// the ACCOUNT's default version. Measured 25 Sep 2026 against the sandbox the site uses
// (acct_…0BtuEAyw2t): the default is `2026-03-25.dahlia`, and so is the bookstore endpoint's.
// Dahlia is after basil (2025-03-31), which REMOVED two fields the membership webhook read:
//
//   invoice.subscription                  → invoice.parent.subscription_details.subscription
//   subscription.current_period_end       → subscription.items.data[n].current_period_end
//
// So on the version the account actually runs, every renewal (`invoice.paid`) was ignored as
// "a one-off invoice", and `currentPeriodEnd` was always null. Nothing errored.
//
// Two defences, both needed:
//   1. Every request pins STRIPE_VERSION, and the webhook endpoints are created at the same
//      version, so a dashboard "upgrade API version" click cannot change what the code reads.
//   2. The readers below accept BOTH shapes, so a payload from an endpoint created at an older
//      version (or a live account whose default differs) still reads correctly.
//
// Changing STRIPE_VERSION is a deliberate act: bump it here, recreate both webhook endpoints at
// the new version (docs/live-money-go-live.md), and run tests/membership/stripe-version.test.mjs.

import { PROVIDER_TIMEOUT_MS } from './bookstore/_lib.js';

export const STRIPE_VERSION = '2026-03-25.dahlia';
export const STRIPE_API = 'https://api.stripe.com/v1';

/** Headers for a Stripe request. Every fetch to api.stripe.com uses these, and nothing else. */
export function stripeHeaders(secretKey, extra = {}) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_VERSION,
    ...extra,
  };
}

/**
 * A Stripe call. `form` (URLSearchParams or plain object) makes it a form POST unless `method`
 * says otherwise. Returns { ok, status, body } and NEVER throws for an HTTP error — the caller
 * decides what a 404 means. A network failure or timeout DOES throw: that is the transient
 * case a webhook must answer with a non-2xx so the provider retries.
 */
export async function stripe(env, path, { method, form, query } = {}) {
  const q = query ? `?${new URLSearchParams(query)}` : '';
  const init = {
    method: method || (form ? 'POST' : 'GET'),
    headers: stripeHeaders(env.STRIPE_SECRET_KEY, form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  };
  if (form) init.body = form instanceof URLSearchParams ? form : new URLSearchParams(form);
  const res = await fetch(`${STRIPE_API}${path}${q}`, init);
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

const idOf = (v) => (typeof v === 'string' && v ? v : (typeof v?.id === 'string' ? v.id : null));

/** The subscription an invoice belongs to, on either side of basil. */
export function invoiceSubscriptionId(invoice) {
  return idOf(invoice?.parent?.subscription_details?.subscription)
    || idOf(invoice?.subscription)
    || null;
}

/** The uid an invoice's subscription was created for, when dahlia copies it onto the invoice. */
export function invoiceSubscriptionUid(invoice) {
  const m = invoice?.parent?.subscription_details?.metadata || invoice?.subscription_details?.metadata;
  return typeof m?.uid === 'string' && m.uid ? m.uid : null;
}

/** Period end in SECONDS, on either side of basil (item-level first — that is where dahlia keeps it). */
export function subscriptionPeriodEnd(subscription) {
  const item = subscription?.items?.data?.[0];
  if (typeof item?.current_period_end === 'number') return item.current_period_end;
  if (typeof subscription?.current_period_end === 'number') return subscription.current_period_end;
  return null;
}

/** The first item's id — what a price switch updates. */
export const subscriptionItemId = (subscription) => idOf(subscription?.items?.data?.[0]);
