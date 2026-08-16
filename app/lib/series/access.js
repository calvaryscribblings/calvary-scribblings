// THE SERIES ENTITLEMENT DECISION — one pure function, both surfaces.
//
// Same discipline as app/lib/storyAccess.js and for the same reason: the endpoint decides,
// the landing page renders a lock, and if those two derive the answer separately they will
// eventually disagree — a card that says "read now" over a file the server refuses. One
// module, imported by the Pages Function, by the /series pages and by `node --test`. Its only
// import is app/lib/membership.js, which holds no imports of its own.
//
// THE CLIENT MUST NOT DECIDE ENTITLEMENT. Same contract term as STORY-SERVING-CONTRACT.md
// §2.1. Nothing here can be cheated by a browser — the bytes only ever come from
// functions/api/series/stream.js, which runs this against the SERVER clock and its own
// admin-token read of the membership. A client that drifts shows a wrong lock, which is
// recoverable and visible; it cannot open a file.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// TWO GATES, IN THIS ORDER, AND THE ORDER IS THE POINT
//
//   1. HAS IT RELEASED?   releaseAtMs vs now.   Answered for EVERYONE, tier ignored.
//   2. MAY YOU READ IT?   subscription tier.    Only ever asked of a released instalment.
//
// A Platinum member asking for next month's instalment is told "not yet", never "not for
// you". Those are different sentences about different facts and collapsing them would be a
// lie in the direction that costs us most: a paying member reading a tier refusal for
// content nobody can have concludes their membership is broken.
//
// It also closes an information leak. If the tier check ran first, the pair of answers a
// signed-out reader could collect — tier_too_low here, not_released there — would map the
// unreleased schedule for anyone willing to probe. Release first means every unreleased
// instalment answers identically to everybody.
// ─────────────────────────────────────────────────────────────────────────────────────────

import { normaliseTier } from '../membership.js';

/**
 * ⛔ THE TIER GATE. FALSE = THE SERIES IS OPEN AND FREE TO EVERYONE.
 *
 * Same shape as the three flags this platform already runs on — MEMBERSHIPS_ON_SALE
 * (app/lib/membershipPrices.js), BOOKSTORE_LAUNCHED (app/links/page.js) and GATING_ENABLED
 * (app/lib/storyAccess.js): real code, fully built, switched off until its day. Not live data
 * edited to fake a state, which is the thing none of those flags is and the reason all three
 * exist as constants.
 *
 * ── WHY IT IS OFF TODAY ──────────────────────────────────────────────────────────────────
 *
 * MEMBERSHIPS_ON_SALE is false. Nobody can buy Platinum before 30 September — there is no
 * checkout that will take their money. A gate against a tier that cannot be purchased is not
 * a paywall, it is a locked door with no key cut yet, and every reader who met it would be
 * told to upgrade to something the site refuses to sell them.
 *
 * TO TURN THE SERIES ON: set true. It should flip WITH MEMBERSHIPS_ON_SALE or after it, never
 * before — the two are the same event seen from two sides, and this one going true first
 * would recreate the exact situation above.
 *
 * ── WHAT IT RELAXES, AND WHAT IT DOES NOT TOUCH ──────────────────────────────────────────
 *
 * It relaxes the ENTITLEMENT half only: the tier comparison and, with it, the requirement to
 * be signed in at all. "Free to everyone" has to mean everyone, including a reader who has
 * never made an account — a flag that still demanded a sign-in would be a smaller wall, not
 * an open door.
 *
 *   ⚠ IT DOES NOT TOUCH THE RELEASE GATE, AND MUST NEVER BE MADE TO.
 *
 * These are two different gates answering two different questions, and only one of them is
 * about money. `not_released` is a promise to a writer about when their work appears and to a
 * reader about what exists yet; it is not a commercial term and there is no version of "the
 * paywall is down" that also means "next month's instalment is out early". If an instalment
 * ever carries a genuine future date, nobody sees it before that date — not while this flag
 * is false, not while it is true, not ever.
 *
 * That is enforced structurally rather than by care: the release check lives in
 * policyGrantForInstalment() BEFORE this flag is consulted, and the flag below only ever
 * rewrites a grant whose code is 'tier_too_low' or 'signed_out'. A not_released grant passes
 * through it untouched, and tests/ci/series-access.test.mjs asserts exactly that in both
 * positions of the switch.
 *
 * ── WHY A CONSTANT AND NOT AN ENV VAR ────────────────────────────────────────────────────
 *
 * Two consumers must agree: functions/api/series/stream.js, which decides, and the /series
 * pages, which draw the lock. The pages are a STATIC EXPORT — an env var read at request time
 * could not reach them, and the deployed HTML would keep drawing padlocks over content the
 * endpoint was handing out. One constant in the module both halves already import is the only
 * thing that flips both, and it is greppable, diffable and reviewable, which a dashboard
 * toggle is not. Same argument, same words, as GATING_ENABLED's.
 */
export const SERIES_TIER_GATE_ENABLED = false;

/** Reason code a grant carries when the flag above opened it. */
export const TIER_GATE_OFF = 'tier_gate_off';

/** HTTP status per refusal code. The endpoint reads this rather than hand-mapping. */
export const REFUSAL_STATUS = {
  signed_out: 401,
  not_released: 403,
  tier_too_low: 403,
  not_found: 404,
  // ── THE 502-vs-503 RULING, SETTLED HERE ────────────────────────────────────────────────
  // The two existing endpoints answer the same situation differently: bookstore/stream.js
  // returns 502 when the entitlement read fails, functions/api/story.js returns 503 with
  // code 'entitlement_unavailable'. One situation, two codes, two files. The Series takes
  // 502, because 502 is the code on the endpoint this one is a transplant of, and because
  // the failure genuinely is a bad answer from an upstream we called rather than this
  // service being unavailable — which is what 503 asserts. Not revisited per-caller.
  unavailable: 502,
};

/**
 * Has this instalment released, on the clock we were handed?
 *
 * `status` is checked alongside the date because they answer different questions and a
 * record can fail either: a draft has not been finished, an unpublished one has been pulled.
 * Neither is readable, and both report as not_released rather than as their own code — an
 * instalment that was withdrawn should not announce that it once existed.
 */
export function isReleased(row, now = Date.now()) {
  const r = row || {};
  if (r.status !== 'published') return false;
  if (typeof r.releaseAtMs !== 'number' || !Number.isFinite(r.releaseAtMs)) return false;
  return r.releaseAtMs <= now;
}

/**
 * How many instalments of this series have released — DERIVED, never stored.
 *
 * See the note in schema.js on why there is no counter field. Takes the rows in any shape a
 * caller has them: an array, or the `{ id: row }` object an RTDB snapshot yields.
 */
export function releasedCount(rows, now = Date.now()) {
  return toRows(rows).filter((r) => isReleased(r, now)).length;
}

/**
 * Every LISTED instalment of a series, released or not, in ordinal order.
 *
 * `status === 'published'` and nothing looser. A draft is one an editor has not finished and
 * has never promised; an 'unpublished' one has been withdrawn. Neither belongs on a shelf —
 * and the second is the sharper case, because it would otherwise render forever as a locked
 * row reading "Arrives 14 October" about a date that has already gone by.
 */
export function instalmentsOf(rows, seriesId, now = Date.now()) {
  return toRows(rows)
    .filter((r) => r.seriesId === seriesId && r.status === 'published')
    .sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0))
    .map((r) => ({ ...r, released: isReleased(r, now) }));
}

function toRows(rows) {
  if (Array.isArray(rows)) return rows.filter(Boolean);
  return Object.entries(rows || {}).map(([id, r]) => ({ id, ...(r || {}) }));
}

/**
 * THE DECISION.
 *
 *   grantForInstalment(row, { subscriptionTier, effectiveTier, signedIn, now })
 *     → { access: 'granted' | 'locked', reason, code, status }
 *
 * `row` is the PUBLIC row (series_instalments/{id}) — releaseAtMs, status, freeForGold. The
 * detail record is not consulted and must not be: whether you may read a thing cannot depend
 * on a node you are only allowed to read once you may.
 *
 * ── WHY TWO TIERS ARE PASSED, AND WHICH ONE DECIDES ────────────────────────────────────
 *
 * `subscriptionTier` DECIDES. It is normaliseTier(users/{uid}/membership) — the tier someone
 * actually subscribes to, never lifted by a pass.
 *
 * `effectiveTier` is advisory and is used for ONE thing: wording the refusal. It is
 * effectiveTier(scalar, detail, now) from app/lib/membership.js, which takes the better of
 * the subscription and any live day/week pass.
 *
 * THE £1 DAY PASS IS EXCLUDED FROM THE SERIES, INCLUDING THE GOLD TASTE, AND THIS WILL NOT
 * FALL OUT OF COPYING ANYTHING. app/lib/membershipPasses.js sets `PASS_TIER = 'gold'`, and
 * effectiveTier() folds an active pass into the same string a real Gold membership produces
 * — by design, because every other gate on the platform is supposed to treat them alike.
 * A gate written the obvious way (`tierAtLeast(effectiveTier(...), 'gold')`) would therefore
 * hand every freeForGold instalment of EVERY series to anyone holding a £1 day pass, for
 * twenty-four hours, and nothing in the code would look wrong.
 *
 * So the comparison is against the subscription, and when a pass WOULD have qualified the
 * refusal says so ('pass_excluded') instead of the generic one — a reader who has just paid
 * for a pass and been refused is owed the actual reason.
 *
 * A second, quieter benefit: app/lib/membership.js:effectiveTier warns that in a browser it
 * defaults to the device clock, "which a reader could set forward to extend a pass", and
 * closes by saying to revisit that "the day a tier gates something that costs us money to
 * serve". This is that day, and the answer is that the Series never reads a pass at all.
 */
export function grantForInstalment(row, opts = {}) {
  const grant = policyGrantForInstalment(row, opts);

  // ⛔ THE TIER GATE, and note WHERE it sits: AFTER the policy has run, and it touches only
  // the two entitlement refusals. A 'not_released' grant is returned untouched — see the
  // constant's own note on why that is structural and not a matter of remembering.
  //
  // Applied HERE rather than inside policyGrantForInstalment so the policy stays fully
  // testable while it is switched off. The suite asserts the POLICY through
  // policyGrantForInstalment and the SWITCH through this function; a flag that also blinds
  // the tests guarding what it disables is how you discover, on the day you flip it back,
  // that the policy rotted while nobody was looking. That lesson is GATING_ENABLED's, learned
  // the expensive way, and it is copied here deliberately.
  if (!SERIES_TIER_GATE_ENABLED && (grant.code === 'tier_too_low' || grant.code === 'signed_out')) {
    return { access: 'granted', reason: TIER_GATE_OFF, code: null, status: 200 };
  }
  return grant;
}

/**
 * The policy itself, with no flag. Exported for the tests and for anything that needs to know
 * what the answer WOULD be — every production caller wants grantForInstalment above, which is
 * this plus the switch.
 */
export function policyGrantForInstalment(row, {
  subscriptionTier = 'free',
  effectiveTier = null,
  signedIn = true,
  now = Date.now(),
} = {}) {
  const r = row || {};

  // GATE 1 — release. Before identity, before tier, before anything.
  if (!isReleased(r, now)) {
    return {
      access: 'locked',
      reason: 'not_released',
      code: 'not_released',
      status: REFUSAL_STATUS.not_released,
      releaseAtMs: typeof r.releaseAtMs === 'number' ? r.releaseAtMs : null,
    };
  }

  // Identity. Deliberately AFTER release so a signed-out reader browsing the landing page
  // sees "arrives 14 October" on a future instalment rather than "sign in" — the sign-in
  // would not have helped.
  if (!signedIn) {
    return { access: 'locked', reason: 'signed_out', code: 'signed_out', status: REFUSAL_STATUS.signed_out };
  }

  // GATE 2 — tier. Subscription only.
  const sub = normaliseTier(subscriptionTier);
  if (sub === 'platinum') {
    return { access: 'granted', reason: 'platinum', code: null, status: 200 };
  }
  if (sub === 'gold' && r.freeForGold === true) {
    return { access: 'granted', reason: 'gold_taste', code: null, status: 200 };
  }

  // Refused. Word it honestly.
  const eff = effectiveTier === null ? sub : normaliseTier(effectiveTier);
  const passWouldHaveQualified = eff !== sub && (eff === 'platinum' || (eff === 'gold' && r.freeForGold === true));

  return {
    access: 'locked',
    reason: passWouldHaveQualified ? 'pass_excluded' : (r.freeForGold === true ? 'needs_gold' : 'needs_platinum'),
    code: 'tier_too_low',
    status: REFUSAL_STATUS.tier_too_low,
    requiredTier: r.freeForGold === true ? 'gold' : 'platinum',
  };
}

/**
 * Reader-facing copy for a grant. Kept here so the landing page, the instalment list and the
 * endpoint's error body cannot drift into three different sentences about one state.
 *
 * 'pass_excluded' is the one that earns its place: without it a day-pass holder is told
 * "Platinum members read the Series", which is true, unhelpful, and reads as though we had
 * not noticed they just paid us.
 */
export const REFUSAL_COPY = {
  not_released: 'This instalment has not arrived yet.',
  // Never shown as a refusal — tier_gate_off is a GRANT. It is here so refusalCopy() cannot
  // fall through to the generic "could not open" line if a caller passes a granted reason in.
  [TIER_GATE_OFF]: 'The Series is free to read while memberships are not yet on sale.',
  signed_out: 'Sign in to read this instalment.',
  needs_platinum: 'The Series is a Platinum membership benefit.',
  needs_gold: 'This instalment is open to Gold and Platinum members.',
  pass_excluded: 'Day and week passes do not include the Series — it comes with a Gold or Platinum membership.',
  unavailable: 'Could not open this instalment just now. Please try again.',
};

export function refusalCopy(grant) {
  return REFUSAL_COPY[grant?.reason] || REFUSAL_COPY.unavailable;
}
