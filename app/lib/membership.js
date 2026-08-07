// MEMBERSHIP — the pure half. No React, no Firebase, no network.
//
// Importable by the browser, by a Pages Function and by `node --test` alike, which is the
// whole reason it holds no imports: the tier a reader is entitled to must be computed the
// same way on the server that writes it and the client that renders it, and two copies of
// that arithmetic is how a member sees "Gold" on one surface and "Free" on the next.
//
// ── THE SCALAR IS THE CONTRACT, AND IT IS A STRING ───────────────────────────────────────
//
//   users/{uid}/membership = 'free' | 'gold' | 'platinum'
//
// A STRING. Forever. The Story Island app — deployed on both fleets — reads that node
// directly and compares it with STRICT EQUALITY (`raw === 'gold' || raw === 'platinum'`,
// else free). There is no `.tier` anywhere in it. Write an object there and every paying
// member silently becomes free, on a surface this repo cannot deploy a fix to.
//
// Everything else about a membership — interval, currency, rail, period end, the founding
// lock, the payment identifiers — lives in a SIBLING record at top-level `memberships/{uid}`.
// That split is not tidiness. `users/{uid}` is `.read: true`, and an RTDB read grant cannot
// be revoked by a descendant (measured, R10.1), so a billing record under it would publish
// stripeCustomerId to anyone who asked. The two are written in ONE atomic multi-path update
// so they can never disagree — see functions/api/membership/_membership.js.
//
// ── THE SCALAR IS ENTITLEMENT, NOT BILLING STATE ─────────────────────────────────────────
//
// A member whose card just failed is still a member. `status: 'past_due'` goes in the detail
// record and the scalar does not move; only a definitive end of subscription writes 'free'.
// Dunning runs for weeks, and downgrading someone on the first failed retry would take a
// paid-for perk away from somebody who is about to pay.
//
// ── A PASS NEVER TOUCHES THE SCALAR ──────────────────────────────────────────────────────
//
// Day and week passes are one-off purchases with an expiry. They are recorded on the DETAIL
// record and resolved HERE, at read time, by effectiveTier(). They are deliberately not
// written into the scalar, for two reasons: the app's dormant gating would read a pass as a
// subscription, and — worse — an expired pass would need something to come along and write
// the scalar back down. Nothing would. A membership that decays on a timer cannot be stored
// as a fact; it has to be computed from an expiry, which is what this file does.

export const TIERS = ['free', 'gold', 'platinum'];

// ── THE PROVIDER'S PURE HALF ─────────────────────────────────────────────────────────────
//
// app/lib/MembershipContext.js holds the React provider and therefore contains JSX, which
// bare Node cannot parse — so nothing in it can be imported by `node --test`. Everything in
// that file worth asserting lives here instead, which is the same split this module already
// exists to draw. The provider imports these; the test suite imports these; neither has a
// copy of its own.

/** The node the provider subscribes to. One string, so the provider cannot drift from it. */
export const MEMBERSHIP_DETAIL_PATH = (uid) => `memberships/${uid}`;

/**
 * A signed-out reader, and the shape every consumer can rely on existing.
 *
 * `loading` is false on purpose: a signed-out reader is not a reader whose membership is still
 * being fetched, they are a reader who has none. A consumer that renders a spinner while
 * `loading` would otherwise spin forever on the signed-out path.
 */
export const SIGNED_OUT = {
  tier: 'free',
  subscriptionTier: 'free',
  pass: null,
  source: 'none',
  status: null,
  founding: false,
  currentPeriodEnd: null,
  loading: false,
  signedIn: false,
};

// setTimeout stores its delay in a signed 32-bit int; anything larger overflows and fires
// IMMEDIATELY, and an immediate re-arm is an infinite loop that pins a tab at 100% CPU.
export const MAX_TIMEOUT_MS = 2147483647;

/**
 * How long the provider should wait before recomputing entitlement, given when the pass
 * expires. The one piece of the provider with arithmetic worth getting wrong.
 *
 *   { delay, final }  — `final` means the timeout lands ON the expiry and the next wake is the
 *                       real one; otherwise it is a slice and the caller re-arms.
 *
 * `{ delay: 0, final: true }` is the already-expired case: recompute immediately rather than
 * scheduling into the past. A negative delay must never reach setTimeout, which coerces it to
 * 0 and would spin.
 */
export function timerSliceFor(expiresAt, now) {
  const remaining = expiresAt - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return { delay: 0, final: true };
  if (remaining > MAX_TIMEOUT_MS) return { delay: MAX_TIMEOUT_MS, final: false };
  return { delay: remaining, final: true };
}

// Ordering, so "the better of two tiers" is arithmetic rather than a chain of ifs.
const RANK = { free: 0, gold: 1, platinum: 2 };

export const isTier = (v) => typeof v === 'string' && TIERS.includes(v);

/**
 * Whatever is at users/{uid}/membership, reduced to a tier we can act on.
 *
 * DELIBERATELY TOTAL: absent, null, an object, a number, 'PLATINUM', a tier we have never
 * heard of — all of it becomes 'free'. This mirrors the app's own strict-equality read, so
 * the two agree on every malformed value rather than only on the well-formed ones. A reader
 * whose record is broken sees Free and can be fixed; a reader whose record is broken and
 * whom we guessed upward gets perks nobody paid for.
 */
export function normaliseTier(raw) {
  return isTier(raw) ? raw : 'free';
}

/**
 * Does this value need the writer to repair it in place?
 *
 * TRUE only for a value that is PRESENT and WRONG — not for an absent one. A reader who has
 * never subscribed has no membership node at all and needs no repair; a reader carrying
 * `{ tier: 'free' }` (the Stage 3C test-account shape) has a value the app cannot read and
 * does. Kept separate from normaliseTier because the two answer different questions: what do
 * we show this reader now, versus what needs writing back.
 */
export function needsScalarRepair(raw) {
  if (raw === null || raw === undefined) return false;
  return !isTier(raw);
}

/** The better of two tiers. */
export function maxTier(a, b) {
  return (RANK[normaliseTier(a)] >= RANK[normaliseTier(b)]) ? normaliseTier(a) : normaliseTier(b);
}

export const tierAtLeast = (tier, floor) => RANK[normaliseTier(tier)] >= RANK[normaliseTier(floor)];

/**
 * The pass on a detail record, if it has not expired.
 *
 * `expiresAt` is epoch MILLISECONDS, a number. Not an ISO string — a string compares against
 * Date.now() as a string and would never expire, which is the exact trap that has bitten this
 * codebase before. A non-numeric expiry is therefore treated as no pass at all rather than as
 * an unbounded one: the failure that costs a reader a perk they paid £1 for is recoverable,
 * and the one that hands out perks forever is not.
 *
 * The tier a pass confers is recorded ON the pass at purchase time rather than mapped from
 * its kind here. That keeps the pass→tier decision where it belongs — the moment money
 * changes hands, in the round that sells them — and means a later change of policy does not
 * silently re-price passes somebody has already bought.
 */
export function activePass(detail, now = Date.now()) {
  const pass = detail && typeof detail === 'object' ? detail.pass : null;
  if (!pass || typeof pass !== 'object') return null;
  if (typeof pass.expiresAt !== 'number' || !Number.isFinite(pass.expiresAt)) return null;
  if (pass.expiresAt <= now) return null;
  return pass;
}

/**
 * What this reader is entitled to RIGHT NOW: their subscription tier, or their pass, whichever
 * is better. The single question every gate asks.
 *
 * ONE READ ANSWERS IT. The scalar and the detail record are two nodes, but a gate needs only
 * the values — and the detail record is already on screen wherever a member's billing is. The
 * shape of this function is what stops each gate re-deriving expiry logic of its own.
 *
 * `now` is injected so tests are not at the mercy of the clock. In the browser it defaults to
 * the device clock, which a reader could set forward to extend a pass. That is accepted at
 * launch and stated rather than hidden: nothing is paywalled, the caps are shelf slots on the
 * reader's own device, and a server round-trip to police a £1 pass would cost more than the
 * pass. Revisit it the day a tier gates something that costs us money to serve.
 */
export function effectiveTier(scalar, detail, now = Date.now()) {
  const base = normaliseTier(scalar);
  const pass = activePass(detail, now);
  return pass ? maxTier(base, pass.tier) : base;
}

/**
 * The whole membership picture for a UI, in one object, so a component destructures rather
 * than recomputing. `source` is what a surface needs to word itself honestly — "your Gold
 * membership" and "your day pass" are not the same sentence.
 */
export function describeMembership(scalar, detail, now = Date.now()) {
  const base = normaliseTier(scalar);
  const pass = activePass(detail, now);
  const tier = effectiveTier(scalar, detail, now);
  return {
    tier,
    subscriptionTier: base,
    pass: pass || null,
    // 'pass' only when the pass is what lifted them — a Platinum member holding a Gold day
    // pass is a Platinum member, and telling them otherwise would read as a downgrade.
    source: pass && RANK[normaliseTier(pass.tier)] > RANK[base] ? 'pass' : (base === 'free' ? 'none' : 'subscription'),
    status: detail && typeof detail === 'object' && typeof detail.status === 'string' ? detail.status : null,
    founding: !!(detail && typeof detail === 'object' && detail.founding === true),
    currentPeriodEnd: detail && typeof detail === 'object' && typeof detail.currentPeriodEnd === 'number'
      ? detail.currentPeriodEnd : null,
  };
}
