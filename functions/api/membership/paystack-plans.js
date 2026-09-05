// THE PLAN BOOK — Paystack rail, naira only.
//
// CONFIG, NOT ENV, for the same reason prices.js gives: a plan code maps money to entitlement,
// and a wrong one charges the wrong amount or grants the wrong tier. That belongs in a diff
// somebody reviews. The secret key stays in env.
//
// ── NGN ONLY, AND NO CONVERSION ANYWHERE ────────────────────────────────────────────────
//
// Stripe cannot settle naira and Paystack is the naira rail; GBP and USD live in prices.js.
// The figures below are hand-set, in KOBO, exactly as the bookstore's NGN prices are. There is
// no FX rate in this file, in the endpoints or in the webhook.
//
// ── THE FOUNDING LOCK IS ALMOST FREE HERE, AND THE REASON MATTERS ────────────────────────
//
// A Paystack Plan's amount CANNOT be changed once it has subscribers, and a subscription is
// bound to its plan. So grandfathering is automatic provided the founding plan codes are never
// deleted — there is no equivalent of Stripe's "the portal quietly moved them to a new price",
// because Paystack has no portal that can move anybody.
//
// The corollary is where the care goes: an UPGRADE on this rail is not a plan swap, it is a
// NEW SUBSCRIPTION on a different plan code, initialized by us. So the lock holds exactly as
// long as our own checkout only ever offers founding plan codes — which is what
// planCodeFor() guarantees by having nothing else to return.
//
// NEVER DELETE A FOUNDING PLAN. A deleted plan code cannot be recreated with the same code,
// the reverse lookup below would stop recognising existing subscribers, and every renewal for
// every founding member would land in manual review at once.

import { paystackAmounts } from '../../../app/lib/membershipPrices.js';

export const TIERS = ['gold', 'platinum'];
export const INTERVALS = ['monthly', 'annual'];
export const PAYSTACK_CURRENCY = 'ngn';

// Kobo. ₦1,500 / ₦2,500 monthly; ₦15,000 / ₦25,000 annual.
//
// R11.7: the naira column of the one hand-set table in app/lib/membershipPrices.js, not a
// second copy of it. The pricing page shows these figures and this file charges them; when
// those were two tables, nothing in the build would have noticed them disagreeing.
export const AMOUNTS = paystackAmounts();

// Paystack's own interval vocabulary.
export const PAYSTACK_INTERVAL = { monthly: 'monthly', annual: 'annually' };

export const CURRENT_GENERATION = 'founding';

// ─────────────────────────────────────────────────────────────────────────────────────────
// PLAN CODES. Filled by `node scripts/create-founding-plans.mjs --apply`, which creates the
// Plans and prints this block ready to paste. null until then, and every caller refuses
// rather than falling back to a bare amount — a plan-less transaction charges correctly ONCE
// and creates no subscription at all, which is the worst of both worlds: the member pays and
// never renews, and nothing in the system knows they were supposed to.
//
// Paystack has ONE set of plans per mode; test and live plan codes differ.
// ─────────────────────────────────────────────────────────────────────────────────────────
export const PLAN_BOOK = {
  founding: {
    test: {
      gold:     { monthly: 'PLN_8cew7gwzmk85xu5', annual: 'PLN_ay0fmybtffpkyu5' },
      platinum: { monthly: 'PLN_20apb1ehzib9fl6', annual: 'PLN_bclwjduphwzna67' },
    },
    live: { gold: { monthly: null, annual: null }, platinum: { monthly: null, annual: null } },
  },
};

/**
 * Which mode a Paystack secret key belongs to.
 *
 * Paystack keys are sk_test_… / sk_live_…, the same convention Stripe uses. The webhook cannot
 * use this to tell test events from live ones: `domain: 'test' | 'live'` on the PAYLOAD is the
 * honest signal, because it is a property of the event rather than of our key, and it is read
 * separately by domainOf() below.
 *
 * ⚠ R9.1 — THIS NOTE USED TO SAY "Paystack sends BOTH to the one configured URL". That is not
 * established, and it contradicts the signature check in bookstore/paystack-webhook.js, which
 * verifies with this same per-mode key and so cannot verify both modes at one endpoint. The
 * correction is written up in full at the delegation site in that file. Reading `domain` is
 * right regardless — it costs nothing and it is the only field that cannot lie about itself.
 */
export const modeOf = (secretKey) =>
  (typeof secretKey === 'string' && secretKey.startsWith('sk_live')) ? 'live' : 'test';

/** The event's own mode, which is the only honest signal for an inbound webhook. */
export const domainOf = (event) =>
  (event && (event.domain === 'live' || event?.data?.domain === 'live')) ? 'live' : 'test';

export function planCodeFor({ tier, interval, generation = CURRENT_GENERATION, mode = 'test' }) {
  const gen = PLAN_BOOK[generation];
  if (!gen || !gen[mode] || !gen[mode][tier]) return null;
  return gen[mode][tier][interval] || null;
}

export function amountFor({ tier, interval }) {
  const a = AMOUNTS[tier] && AMOUNTS[tier][interval];
  return Number.isInteger(a) ? a : null;
}

/**
 * THE REVERSE LOOKUP — plan code → what it confers.
 *
 * The tier comes from HERE and never from event metadata, for the reason the Stripe rail
 * gives: metadata is written once at initialize and is not updated by anything afterwards,
 * while the plan is what the member is actually being charged for. Paystack is the stricter
 * case, because its own docs make no promise that metadata survives onto a recurring charge at
 * all — the existing bookstore webhook already says so in its header.
 *
 * null for an unknown code. The webhook treats that as "cannot attribute" and writes nothing.
 */
export function describePlan(planCode, mode = 'test') {
  if (typeof planCode !== 'string' || !planCode) return null;
  for (const [generation, byMode] of Object.entries(PLAN_BOOK)) {
    const book = byMode[mode];
    if (!book) continue;
    for (const tier of Object.keys(book)) {
      for (const [interval, code] of Object.entries(book[tier])) {
        if (code && code === planCode) {
          return { generation, tier, interval, currency: PAYSTACK_CURRENCY };
        }
      }
    }
  }
  return null;
}

export function isFoundingPlan(planCode, mode = 'test') {
  const d = describePlan(planCode, mode);
  return !!d && d.generation === 'founding';
}

export function planCodesForGeneration(generation = CURRENT_GENERATION, mode = 'test') {
  const book = PLAN_BOOK[generation] && PLAN_BOOK[generation][mode];
  if (!book) return [];
  const out = [];
  for (const tier of Object.keys(book)) for (const code of Object.values(book[tier])) if (code) out.push(code);
  return out;
}

export function isConfigured(mode = 'test', generation = CURRENT_GENERATION) {
  return planCodesForGeneration(generation, mode).length === TIERS.length * INTERVALS.length;
}

// ──────────────────────────────────────────────────────────────────────────
// THE MEMBERSHIP REFERENCE.
//
// Self-describing, exactly as the bookstore's `cs.` reference is and for the same reason: the
// FIRST charge must be reconcilable from the reference alone, because it is the only event in
// a subscription's life whose reference we control.
//
//   ms.<uid>.<tier>-<interval>.<nonce>
//
// `ms.` rather than `cs.`, so the two rails can never mistake one another's transactions —
// parsePaystackReference() in _lib.js rejects an ms. reference outright, and this rejects a
// cs. one, which is what lets a single shared webhook URL route them apart safely.
//
// HYPHEN, not underscore, between tier and interval: Paystack permits only alphanumerics and
// `-`, `.` and `=` in a reference. `.` is already the field separator and `_` is illegal, so
// the hyphen is the only option left — and tier/interval are both [a-z]+, so it is unambiguous.
// ──────────────────────────────────────────────────────────────────────────

const MEMBERSHIP_REF_RE = /^ms\.([A-Za-z0-9]{1,64})\.([a-z]+)-([a-z]+)\.([a-f0-9]{8,32})$/;
export const REF_SAFE_UID = /^[A-Za-z0-9]{1,64}$/;

export function buildMembershipReference(uid, tier, interval, nonce) {
  if (!REF_SAFE_UID.test(uid || '')) throw new Error('uid is not reference-safe');
  if (!TIERS.includes(tier)) throw new Error(`unknown tier ${tier}`);
  if (!INTERVALS.includes(interval)) throw new Error(`unknown interval ${interval}`);
  const n = nonce || [...crypto.getRandomValues(new Uint8Array(6))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return `ms.${uid}.${tier}-${interval}.${n}`;
}

export function parseMembershipReference(ref) {
  const m = MEMBERSHIP_REF_RE.exec(typeof ref === 'string' ? ref : '');
  if (!m) return null;
  if (!TIERS.includes(m[2]) || !INTERVALS.includes(m[3])) return null;
  return { uid: m[1], tier: m[2], interval: m[3], nonce: m[4] };
}

export const isMembershipReference = (ref) => parseMembershipReference(ref) !== null;
