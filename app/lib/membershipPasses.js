// MEMBERSHIP PASSES — the catalogue and the stacking arithmetic. Pure: no React, no Firebase,
// no network, and no imports beyond the tier ordering next door.
//
// It sits in app/lib rather than functions/ because BOTH sides need it and only this direction
// is legal: a Pages Function may import from app/lib (checkout.js and the webhooks already do),
// while app/ must never import from functions/. The pricing page renders from this table and
// the webhook charges from it, so the number a reader is quoted and the number they are
// charged cannot drift apart.
//
// ── WHAT A PASS IS ───────────────────────────────────────────────────────────────────────
//
// A one-off purchase that confers a tier for a fixed window and then stops. It is NOT a
// subscription: nothing renews, no plan or Price object exists for it, and the founding lock
// has no bearing on it. A pass is bought at the price on the day, which is exactly the case
// prices.js says inline pricing is right for.
//
// ── THE PASS NEVER TOUCHES THE TIER SCALAR ───────────────────────────────────────────────
//
// users/{uid}/membership stays 'free' for a day-pass buyer. They are not 'gold'; they are a
// free reader holding a pass, and effectiveTier() is what resolves the two into what they may
// do right now. app/lib/membership.js explains why at length; the short version is that a
// membership which decays on a timer cannot be stored as a fact, because nothing would come
// along to write it back down. The database rule on that node enforces it independently —
// it validates the value against the three tier strings, so a pass object cannot land there
// even by accident.
//
// ── THE WEEK PASS IS NGN-ONLY, AND THAT IS A PRICING FACT ────────────────────────────────
//
// It is not a territory rule, not a rail capability, and not a feature flag. The week pass is
// offered in naira because it has A PRICE IN NAIRA AND IN NOTHING ELSE — see AMOUNTS below,
// where `week` simply has no gbp or usd entry. Every surface asks passesFor(currency) and
// renders what comes back, so the fact lives in one table and is expressed once.
//
// Written this way ON PURPOSE so that nobody can later "harmonise" it into a territory check.
// A territory check would be a different rule with different bugs: a Nigerian reader paying in
// pounds would be offered a week pass we cannot price, and a UK reader paying in naira would
// be refused one we can. Currency is the thing that decides, because currency is the thing
// the price is denominated in.
//
// ── FOUR WEEKS MUST COST MORE THAN A MONTH ───────────────────────────────────────────────
//
// ₦500 a week against ₦1,500 a month is deliberate: four weeks is ₦2,000, a third more than
// the monthly subscription. The week pass serves the reader who wants a fortnight and no
// standing order; it must never become the cheaper way to be a member all year, or it
// cannibalises the subscription it is meant to feed. The relationship is asserted in
// tests/membership/passes.test.mjs against the real plan book rather than left as a comment,
// so a later price edit on either side fails a test instead of quietly inverting the ladder.

import { maxTier } from './membership.js';

export const PASS_KINDS = ['day', 'week'];

// Exact windows, in milliseconds. A day is 24 hours and a week is 7 of them — no calendar
// arithmetic, no timezones, no DST. A pass bought at 23:00 runs to 23:00, which is both what
// "a day pass" means to a reader and the only definition that survives being computed on a
// device whose timezone we do not know.
export const DURATION_MS = { day: 86400000, week: 604800000 };

// What a pass confers. Recorded ON the pass at purchase time by buildPass(), never mapped from
// the kind at read time — app/lib/membership.js:activePass explains why that placement matters
// (a later policy change must not re-price a pass somebody already owns).
export const PASS_TIER = 'gold';

// Minor units — pence, cents, kobo — hand-set per currency, exactly as prices.js and
// paystack-plans.js are. There is no FX rate here or anywhere downstream. £1 / $1.49 / ₦300
// are three decisions, not one decision converted.
//
// `week` has ONE currency. That absence IS the week pass's naira-only rule; see the header.
export const AMOUNTS = {
  day:  { gbp: 100, usd: 149, ngn: 30000 },
  week: { ngn: 50000 },
};

// Which rail settles which currency. Stripe cannot settle naira and Paystack settles nothing
// else, which is the same split prices.js and paystack-plans.js already draw.
export const RAIL_BY_CURRENCY = { gbp: 'stripe', usd: 'stripe', ngn: 'paystack' };

// The currency the Paystack endpoints ARE. Named rather than inlined as 'ngn' in two
// endpoints, so the naira rail has one spelling — the same service paystack-plans.js's
// PAYSTACK_CURRENCY does for subscriptions.
export const PAYSTACK_PASS_CURRENCY = 'ngn';

const lower = (c) => String(c || '').toLowerCase();

export const isPassKind = (k) => typeof k === 'string' && PASS_KINDS.includes(k);

/** The price of a pass in a currency, in minor units — or null if it is not sold there. */
export function passAmount(kind, currency) {
  const row = AMOUNTS[kind];
  if (!row) return null;
  const a = row[lower(currency)];
  return Number.isInteger(a) ? a : null;
}

/** Which rail a currency settles on, or null for a currency we do not price at all. */
export const railFor = (currency) => RAIL_BY_CURRENCY[lower(currency)] || null;

/**
 * THE ONE QUESTION EVERY SURFACE ASKS: which passes exist in this currency?
 *
 * Derived from the price table, so "the week pass is naira-only" is not encoded anywhere as a
 * condition — it falls out of the week pass having no other price. A pricing page renders
 * passesFor(currency) and is correct by construction; add a gbp week price to AMOUNTS one day
 * and the pricing page starts offering it with no code change anywhere.
 */
export function passesFor(currency) {
  const cur = lower(currency);
  return PASS_KINDS
    .filter((kind) => passAmount(kind, cur) !== null)
    .map((kind) => ({
      kind,
      tier: PASS_TIER,
      currency: cur,
      amount: passAmount(kind, cur),
      durationMs: DURATION_MS[kind],
      rail: railFor(cur),
    }));
}

/** Is this kind sold in this currency? The guard every checkout endpoint runs first. */
export const isPassOffered = (kind, currency) => isPassKind(kind) && passAmount(kind, currency) !== null;

// ─────────────────────────────────────────────────────────────────────────────────────────
// STACKING
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * When does a pass bought NOW expire, given whatever the reader already holds?
 *
 *   expiresAt = max(now, currentExpiry) + duration
 *
 * The max() is the whole point. Buying a second day pass on Tuesday when Monday's has already
 * lapsed must give a full day from Tuesday, not a day from Monday that expired yesterday —
 * without the max, a reader who let one lapse would pay for a window already in the past. And
 * buying while one is still live must EXTEND rather than replace, or the reader is charged for
 * time they already own.
 *
 * An unparseable or expired stored expiry is treated as "no pass", which is the same rule
 * activePass() applies at read time. The two must agree: if activePass ignores a malformed
 * expiry but this one extended from it, a reader could hold a pass that grants nothing yet
 * still absorbs the time they just bought.
 */
export function nextExpiry(existingPass, durationMs, now = Date.now()) {
  const current = existingPass && typeof existingPass.expiresAt === 'number' && Number.isFinite(existingPass.expiresAt)
    ? existingPass.expiresAt
    : 0;
  return Math.max(now, current) + durationMs;
}

/**
 * The stored pass object, ready to be written at memberships/{uid}/pass.
 *
 * `ref` is the CHARGE reference and doubles as the replay guard — see shouldSkipPassGrant in
 * functions/api/membership/_membership.js. It is stored rather than kept in a side node so the
 * idempotency key and the thing it protects are read in the same fetch.
 *
 * THE TIER NEVER GOES DOWN ON A STACK. Only Gold passes are sold today, so the case is
 * theoretical — but if a reader holding a Platinum pass bought a Gold one, taking the incoming
 * tier would DOWNGRADE time they had already paid for, while taking the better of the two
 * over-grants a little. This codebase's settled posture on that trade is everywhere: the error
 * that costs a reader something they bought is the one to avoid. maxTier makes it arithmetic.
 */
export function buildPass({ kind, currency, rail, ref, tier = PASS_TIER, existing = null, now = Date.now() }) {
  if (!isPassKind(kind)) throw new Error(`buildPass: unknown pass kind ${kind}`);
  const durationMs = DURATION_MS[kind];
  const stacked = !!(existing && typeof existing.expiresAt === 'number' && Number.isFinite(existing.expiresAt) && existing.expiresAt > now);
  return {
    kind,
    tier: existing ? maxTier(tier, existing.tier) : tier,
    currency: lower(currency) || null,
    rail: rail || railFor(currency),
    expiresAt: nextExpiry(existing, durationMs, now),
    purchasedAt: now,
    ref: typeof ref === 'string' && ref ? ref : null,
    // Whether this purchase extended a live pass. Support reads it; it also makes the
    // stacking visible in a record rather than only inferable from two timestamps.
    stacked,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE PAYSTACK REFERENCE
// ─────────────────────────────────────────────────────────────────────────────────────────
//
//   mp.<uid>.<kind>.<nonce>
//
// A THIRD prefix, beside the bookstore's `cs.` and the membership subscription's `ms.`, and it
// has to be third rather than a widened `ms.` grammar. Paystack allows ONE webhook URL per
// account, so all three land at the same door and are told apart by reference alone. `ms.`
// parses as <tier>-<interval> and a pass has neither; stretching that grammar would make a
// malformed subscription reference parse as a pass, and the two take different write paths —
// one moves the tier scalar, one must never touch it.
//
// Same character rules as `ms.`: Paystack permits only alphanumerics and `-`, `.` and `=`.

const PASS_REF_RE = /^mp\.([A-Za-z0-9]{1,64})\.([a-z]+)\.([a-f0-9]{8,32})$/;
export const REF_SAFE_UID = /^[A-Za-z0-9]{1,64}$/;

export function buildPassReference(uid, kind, nonce) {
  if (!REF_SAFE_UID.test(uid || '')) throw new Error('uid is not reference-safe');
  if (!isPassKind(kind)) throw new Error(`unknown pass kind ${kind}`);
  const n = nonce || [...crypto.getRandomValues(new Uint8Array(6))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return `mp.${uid}.${kind}.${n}`;
}

export function parsePassReference(ref) {
  const m = PASS_REF_RE.exec(typeof ref === 'string' ? ref : '');
  if (!m) return null;
  if (!isPassKind(m[2])) return null;
  return { uid: m[1], kind: m[2], nonce: m[3] };
}

export const isPassReference = (ref) => parsePassReference(ref) !== null;
