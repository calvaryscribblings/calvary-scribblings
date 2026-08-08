// MEMBERSHIP SUBSCRIPTION PRICES — the one hand-set table, and the only place a figure lives.
//
// ── WHY THIS FILE EXISTS, AND WHY IT IS IN app/lib ───────────────────────────────────────
//
// Until R11.7 the settled subscription figures lived in TWO server modules that could not see
// each other: GBP and USD in functions/api/membership/prices.js, NGN in
// functions/api/membership/paystack-plans.js. That was fine while only the rails read them —
// each rail wanted its own half and neither needed the other's.
//
// The pricing page wants all three at once, and it runs in the browser. Copying the figures a
// third time, into a client module, would mean the price a reader is SHOWN and the price they
// are CHARGED had no common source — and the failure is silent: a table drifts, the page
// advertises £2.99, Stripe charges £3.99, and nothing in the build says a word. Prices are the
// one thing in this system where being quietly wrong is worse than being loudly broken.
//
// So the table moves HERE and the rails import their slice. Same direction as
// app/lib/membershipPasses.js, which three endpoints already read for exactly this reason:
// pure data with no secrets belongs on the app side, and functions/ reaches up for it. The
// SECRETS and the PRICE IDS stay in functions/ — an id maps money to entitlement and belongs
// in a diff somebody reviews, which is the argument prices.js already makes for itself.
//
// ── HAND-SET. NEVER DERIVED, CONVERTED OR COMPUTED ───────────────────────────────────────
//
// There is no FX rate in this file, in the rails, or in the webhook. £2.99, $3.99 and ₦1,500
// are THREE DECISIONS, not one decision converted twice. A reader in Lagos is not paying a
// converted London price; they are paying a naira price we chose. If you ever find yourself
// writing a multiplier here, the answer is no.
//
// The annuals hold a "ten months for twelve" SHAPE in every currency, and that is the pitch
// rather than the arithmetic — £2.99 × 10 = £29.90 and the settled annual is £29.99. Do not
// compute an annual from a monthly anywhere, and do not print an exact "×10" claim in the UI.
//
// Minor units throughout — pence, cents, KOBO — because that is what both providers charge in
// and what formatPrice() renders from. ₦1,500 is 150000 kobo, not 1500.

export const TIERS = ['gold', 'platinum'];
export const INTERVALS = ['monthly', 'annual'];

// The currencies a SUBSCRIPTION is sold in. All three, unlike passes — the week pass is naira
// only, and that asymmetry lives in membershipPasses.js where it belongs.
export const SUBSCRIPTION_CURRENCIES = ['gbp', 'usd', 'ngn'];

// ── THE SETTLED FIGURES ──────────────────────────────────────────────────────────────────
//                     GBP        USD        NGN
//   Gold monthly      £2.99      $3.99      ₦1,500
//   Platinum monthly  £4.99      $6.49      ₦2,500
//   Gold annual       £29.99     $39.99     ₦15,000
//   Platinum annual   £49.99     $64.99     ₦25,000
export const SUBSCRIPTION_AMOUNTS = {
  gold: {
    monthly: { gbp: 299, usd: 399, ngn: 150000 },
    annual: { gbp: 2999, usd: 3999, ngn: 1500000 },
  },
  platinum: {
    monthly: { gbp: 499, usd: 649, ngn: 250000 },
    annual: { gbp: 4999, usd: 6499, ngn: 2500000 },
  },
};

const lower = (c) => String(c || '').toLowerCase();

/**
 * The price of a tier/interval in a currency, in minor units — or null if it is not sold there.
 *
 * Total, like passAmount(). A currency we do not price is not an error to throw on; it is a
 * row the pricing page omits.
 */
export function subscriptionAmount(tier, interval, currency) {
  const t = SUBSCRIPTION_AMOUNTS[tier];
  if (!t || !t[interval]) return null;
  const a = t[interval][lower(currency)];
  return Number.isInteger(a) ? a : null;
}

/**
 * Which subscriptions exist in this currency, as rows a pricing page can render directly.
 *
 * Derived from the amounts table exactly as passesFor() is, so "which plans are sold here" is
 * never a country check and never a hardcoded condition. Today every tier/interval exists in
 * every currency; if that ever stops being true, this stops returning the missing row and the
 * page is correct with no code change.
 */
export function subscriptionsFor(currency) {
  const cur = lower(currency);
  const out = [];
  for (const tier of TIERS) {
    for (const interval of INTERVALS) {
      const amount = subscriptionAmount(tier, interval, cur);
      if (amount !== null) out.push({ tier, interval, currency: cur, amount });
    }
  }
  return out;
}

// ── THE SLICES THE RAILS TAKE ────────────────────────────────────────────────────────────
// Shaped to match what each rail module already exported, so importing these was a drop-in
// and no call site downstream had to change.

/** { gold: { monthly: {gbp,usd}, annual: {…} }, platinum: {…} } — Stripe's half. */
export function stripeAmounts() {
  const out = {};
  for (const tier of TIERS) {
    out[tier] = {};
    for (const interval of INTERVALS) {
      const row = SUBSCRIPTION_AMOUNTS[tier][interval];
      out[tier][interval] = { gbp: row.gbp, usd: row.usd };
    }
  }
  return out;
}

/** { gold: { monthly, annual }, platinum: {…} } in KOBO — Paystack's half. */
export function paystackAmounts() {
  const out = {};
  for (const tier of TIERS) {
    out[tier] = {};
    for (const interval of INTERVALS) out[tier][interval] = SUBSCRIPTION_AMOUNTS[tier][interval].ngn;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// WHETHER MEMBERSHIPS ARE ON SALE — and why this is a constant rather than a date.
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// THERE IS NO DATE CHECK ANYWHERE IN THIS CODEBASE, and adding one here would be the wrong
// kind of fix. What actually stops a reader buying today is that the LIVE price ids do not
// exist: PRICE_BOOK.founding.live and PLAN_BOOK.founding.live are null, so isConfigured('live')
// is false on both rails and every live checkout answers 409 not_configured. Creating those
// ids IS opening the store. A date constant would be a second, softer opinion about the same
// fact, and the two would disagree the first time a launch moved.
//
// So this flag is not "has the date passed" — it is "do the live ids exist yet", asserted
// against the real price books by tests/membership/on-sale.test.mjs. That test imports both
// rail modules and fails the moment this constant and isConfigured('live') disagree in either
// direction, which is what makes a single boolean safe: it CANNOT silently drift, because the
// build stops.
//
// FLIP IT IN THE SAME COMMIT that pastes the live PRICE_BOOK and PLAN_BOOK blocks. Not before
// — a true flag with null ids puts buttons on the page that 409 — and not after, or the store
// is open and the page still says it is not.
//
// CONSERVATIVE ACROSS RAILS, deliberately: this is one boolean for both, so if Stripe's live
// prices existed and Paystack's did not, this stays false and nobody is offered anything. The
// alternative — on sale in GBP and USD, "opens 30 September" in NGN, on the same page, on the
// same day — is a worse thing to ship than waiting for the second rail.
export const MEMBERSHIPS_ON_SALE = false;

// The launch sentence, in ONE place. Both rails answer 409 with it and the pricing page prints
// it; before R11.7 it was typed out separately in checkout.js and paystack-checkout.js, which
// is exactly the drift this export exists to prevent.
export const LAUNCH_NOTICE = 'Memberships open on 30 September.';

/** Just the date, for copy that puts it in a sentence of its own shape. */
export const LAUNCH_DATE_LABEL = '30 September';
