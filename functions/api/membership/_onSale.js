// THE ON-SALE GATE — the one condition every membership checkout opens on.
//
// Four endpoints create membership checkouts: checkout.js and paystack-checkout.js
// (subscriptions), pass-checkout.js and paystack-pass-checkout.js (day and week passes). All
// four ask THIS function, and nothing else, whether they may open one. The condition is written
// here once and nowhere else.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────
//
// The live-money preflight (23 Sep 2026) STOPPED on the two pass endpoints. Their header said
// "passes need NO setup script and no created Stripe objects. The rail works the moment the
// secret key is present, in test and in live" — and that was true, so a live secret key sold
// real passes a week before memberships opened. On Paystack those passes were also GRANTED.
// All that kept readers out was /membership hiding its buttons, and nothing stops a signed-in
// reader POSTing to the endpoint directly.
//
// Only the subscription endpoints had a gate, and it was isConfigured(mode) alone, restated at
// each call site. Ikenna's ruling: all four close on the same condition, imported and not
// restated:
//
//   OPEN  ⇔  MEMBERSHIPS_ON_SALE  AND  isConfigured(modeOf(secretKey))
//
// The flag is the switch a person flips. isConfigured is the proof the rail can actually serve
// that mode. tests/membership/on-sale.test.mjs holds the flag equal to live-configured on both
// rails, so in live mode the two halves agree by construction. The flag half is what closes a
// TEST key too. Before this file, a direct POST opened a test-mode subscription checkout on
// production while the page said "opens 30 September". Harmless money, but a door the page
// denied.
//
// ── 30 SEPTEMBER ─────────────────────────────────────────────────────────────────────────
//
// Paste the live ids and flip MEMBERSHIPS_ON_SALE in the same commit (the interlock enforces
// that), deploy, and all four open together. Passes have no step of their own.
//
// ── ⚠ CHECKOUT CREATION ONLY. NEVER AT GRANT. ───────────────────────────────────────────
//
// Nothing on the webhook side imports this, and nothing should. If a payment ever does arrive
// (a session opened before a rollback, a checkout left open across a flag change, anything),
// the reader gets what they paid for. Taking money and delivering nothing is worse than a pass
// sold a day early. That is written at both grant sites too.

import { MEMBERSHIPS_ON_SALE, LAUNCH_NOTICE } from '../../../app/lib/membershipPrices.js';
import { isConfigured as stripeIsConfigured, modeOf as stripeModeOf } from './prices.js';
import { isConfigured as paystackIsConfigured, modeOf as paystackModeOf } from './paystack-plans.js';

const RAILS = {
  stripe: { modeOf: stripeModeOf, isConfigured: stripeIsConfigured },
  paystack: { modeOf: paystackModeOf, isConfigured: paystackIsConfigured },
};

/**
 * May this rail open a membership checkout with this secret key?
 *
 * `onSale` defaults to the shipped flag. Pass it only in a test, to prove what the flip does
 * without editing the constant.
 *
 * Returns { open, mode }. The endpoints answer a closed gate with closedResponse() below.
 */
export function saleGate(rail, secretKey, { onSale = MEMBERSHIPS_ON_SALE } = {}) {
  const r = RAILS[rail];
  if (!r) throw new Error(`saleGate: unknown rail ${rail}`);
  const mode = r.modeOf(secretKey);
  return { open: onSale === true && r.isConfigured(mode), mode };
}

/** The one refusal: 409, LAUNCH_NOTICE, code not_configured — as the subscriptions always said. */
export const CLOSED_BODY = Object.freeze({ error: LAUNCH_NOTICE, code: 'not_configured' });
export const CLOSED_STATUS = 409;
