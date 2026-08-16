// STORY ACCESS — the pure half. No React, no Firebase, no network, no imports.
//
// Same discipline as app/lib/membership.js, and for the same reason: `publishedAtMs`
// is derived by the composer in a browser, by the backfill in bare Node, and read by
// a Pages Function that decides whether a reader gets a story. Three copies of that
// arithmetic is how a story is inside the free window on one surface and outside it
// on the next. One module, imported by all three, no imports of its own so
// `node --test` and the static-export build can both take it.
//
// See STORY-SERVING-CONTRACT.md §2 — this file IS that section.
//
// ── WHY THE POLICY CONSTANTS ARE HERE, IN A BROWSER-IMPORTABLE FILE ──────────────
//
// An earlier draft kept FREE_WINDOW_MS out of this module on the theory that the
// window length must not reach a client. That theory was wrong and it is worth
// saying why, because it nearly produced two copies of the same number.
//
// Every 200 from /api/story carries BOTH `publishedAtMs` and `freeUntilMs`. One
// subtraction is the window. There was never anything hidden, so "keeping it off
// the client" would have bought nothing and cost the one property that matters:
// a single definition.
//
// The real rule is a contract term, not a secret (STORY-SERVING-CONTRACT.md §2.1):
// a client MUST NOT decide entitlement itself. It cannot cheat by doing so — the
// body only ever comes from the endpoint, which decides on the SERVER clock — it
// can only drift, and show a lock on a story a reader could actually open.
//
// So: one definition, imported by the Pages Function, by the story page and by the
// tests that assert the two agree. (An earlier draft also had it computing a stored
// `gated` index field; that field was dropped — see the contract §8.)

// ── THE DISPLAY DATE IS FREE TEXT, AND THAT IS WHY THIS PARSER IS TOLERANT ───────
//
// cms_stories/<slug>/date is typed by hand into a bare <input> in the composer whose
// only guidance is a placeholder reading "Mar 29, 2026". It is a DISPLAY string, has
// always been one, and nothing has ever validated it. Measured over all 175 live
// records on 2026-08-08:
//
//     "Mon D, YYYY"   × 159      "Jul 4, 2026"
//     "Mon YYYY"      ×  16      "Jan 2026"      ← dayless; all of them Jan–Mar 2026
//
// So the parser handles both, plus full month names, because the next hand-typed
// value is not bound by what the last 175 happened to be. Anything it cannot read
// becomes null rather than a guess — see publishedAtMsFor.

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/** Month index (0-11) from "Jul", "July", "JULY", or -1. */
function monthIndex(word) {
  const w = String(word || '').toLowerCase().slice(0, 3);
  return MONTHS.indexOf(w);
}

/**
 * A hand-typed display date → epoch ms at UTC midnight, or null.
 *
 * ── EVERYTHING HERE IS UTC, BY CONSTRUCTION ──────────────────────────────────────
 *
 * Date.UTC, never `new Date(str)`. `new Date("Jul 4, 2026")` parses in the runtime's
 * LOCAL zone, so the same story would carry a different publishedAtMs depending on
 * whether it was stamped by the composer in London, by the backfill on a UTC runner,
 * or by a Worker in whatever region Cloudflare picked. An hour of drift is invisible
 * for eleven months and then decides the gate on the one day it matters.
 *
 * ── THE DAYLESS RULE: THE 1st OF THE MONTH ───────────────────────────────────────
 *
 * "Jan 2026" has no day, so one is chosen: the 1st. That is a deliberate imprecision
 * and it is safe BY MEASUREMENT, not by hope. Every dayless record on the node is
 * Jan–Mar 2026 — the oldest content there is, months outside any window we would
 * plausibly set. Day precision only decides anything within one window-length of the
 * boundary; everything older is gated whichever day of the month we picked.
 *
 * The 1st rather than the 15th or the last day because it is the EARLIEST day the
 * string can mean. If the imprecision ever does land near a boundary, it errs toward
 * gating a story a few weeks early rather than leaving one open a few weeks late —
 * and the recoverable failure (a reader asks why a story closed) beats the
 * unrecoverable one (the archive stayed open and we never noticed).
 */
export function parseDisplayDate(str) {
  const s = String(str || '').trim();
  if (!s) return null;

  // "Mon D, YYYY" — the comma is optional because hand-typing drops it.
  let m = /^([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = monthIndex(m[1]);
    const day = Number(m[2]);
    if (mi >= 0 && day >= 1 && day <= 31) return Date.UTC(Number(m[3]), mi, day);
    return null;
  }

  // "Mon YYYY" — dayless. See the rule above.
  m = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = monthIndex(m[1]);
    if (mi >= 0) return Date.UTC(Number(m[2]), mi, 1);
    return null;
  }

  // "YYYY-MM-DD" — not observed live, but it is what a date <input> would produce if
  // the composer's field is ever upgraded, and reading it costs one regex.
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  return null;
}

/**
 * When was this story published, in epoch MILLISECONDS, UTC?
 *
 * A NUMBER. Never an ISO string. A string compares against Date.now() as a string
 * and would never expire — the exact trap activePass() in app/lib/membership.js
 * already carries a warning about, and one this codebase has been bitten by before.
 *
 * Precedence, and it is not arbitrary:
 *
 *   1. `publishAt` — an ISO instant written by the scheduled-publish path. It is the
 *      real publication MOMENT, to the minute, and the display date is a rendering
 *      of it. Where both exist they agree on the day; where they disagree, the one
 *      that was written by code beats the one that was typed by a person.
 *
 *   2. `date` — the hand-typed display string, parsed as above.
 *
 *   3. null. NOT a guess, and specifically NOT Date.now(): falling back to "now"
 *      would stamp an unparseable 2026 archive story as published today and drop it
 *      straight into the free window. A null is a record that needs a human to look
 *      at it, and the backfill reports them by name for exactly that reason.
 *
 * A publishAt that is present but unparseable falls through to the date rather than
 * failing — a malformed schedule field should not cost the story its display date.
 */
export function publishedAtMsFor(story) {
  const s = story || {};

  if (typeof s.publishAt === 'string' && s.publishAt) {
    const t = Date.parse(s.publishAt);
    if (Number.isFinite(t)) return t;
  }

  return parseDisplayDate(s.date);
}

/**
 * Is this story served as a book rather than as prose? FLAGS ONLY.
 *
 * `readerMode === true || bookReader === true` — the app's own routing test, and as
 * of R11.10 the whole definition on both sides. See readerShapeError() below for the
 * ruling, the measurement behind it, and why the category clauses that used to live
 * here are now an error condition rather than a second way of saying yes.
 */
export function isReaderMode(story) {
  const s = story || {};
  return s.readerMode === true || s.bookReader === true;
}

/**
 * The inconsistent shape: CATEGORY says book, FLAGS say prose.
 *
 * ── THE RULING (R11.10, requested by the app session) ────────────────────────────
 *
 *   READER-MODE IS FLAG-DRIVEN. `readerMode === true || bookReader === true` is the
 *   whole definition. `category: 'novel'` without a flag, or `category: 'poetry'`
 *   with an epubUrl and no flag, is a DATA ERROR — not a supported shape.
 *
 * MEASURED BEFORE RULING, over all 176 live records on 2026-08-08: ZERO carry the
 * category-only shape, so the ruling breaks nothing today. What the data showed
 * instead is the argument FOR it — four published stories are `readerMode: true`
 * with `category: 'short'`, so the category has never been a reliable indicator and
 * the flag has been doing the real work all along.
 *
 * The cost of not ruling was six call sites in the app widening to carry a fallback
 * that no record needs.
 *
 * ── WHY THE SERVER STILL ROUTES IT ANYWAY ────────────────────────────────────────
 *
 * This function DETECTS the shape; it does not bless it. The endpoint logs it as a
 * data error and then answers access:'reader' regardless, because the alternative —
 * serving a novel as prose, finding no HTML body and returning 502 — breaks a reader
 * to make a point about a record they did not write.
 *
 * Server defensiveness is not contract support, and the distinction matters:
 * CLIENTS MUST NOT IMPLEMENT THE CATEGORY FALLBACK. If they do, the shape becomes
 * load-bearing on four codebases and the ruling is dead. The server absorbs it in
 * one place, loudly, where it can be found and repaired.
 */
export function readerShapeError(story) {
  const s = story || {};
  if (isReaderMode(s)) return false;
  return s.category === 'novel' || (s.category === 'poetry' && !!s.epubUrl);
}

/** Flags OR the erroneous category shape — what the endpoint actually routes on. */
export function servesAsReader(story) {
  return isReaderMode(story) || readerShapeError(story);
}

// ── THE POLICY ───────────────────────────────────────────────────────────────────
// Settled 2026-08-07. See STORY-SERVING-CONTRACT.md §3.1–§3.4 for the reasoning
// behind each; the short version is recorded here so a reader of this file is not
// left guessing why the numbers are the numbers.

/**
 * ⛔ THE KILL SWITCH. FALSE = NO STORY IS EVER GATED, FOR ANYONE.
 *
 * Set false 2026-08-08 ~20:00, in response to a reader-visible gate on production
 * that was not supposed to be live. R11.9 (8a8b5872) shipped BOTH halves of the
 * paywall at once — the static build stopped inlining full bodies and started
 * inlining `cutPreview()` output, and /api/story began applying grantFor() — and
 * the round's own report described that state as "gating live for nobody". It was
 * live for every signed-out reader on the web, on every prose story older than the
 * free window. See the R11.9 divergence note.
 *
 * WHY A CONSTANT AND NOT AN ENV VAR. Both halves of the gate must flip together and
 * one of them is the STATIC BUILD (app/stories/[slug]/page.js), which bakes its
 * decision into HTML at build time. An env var read at request time could not reach
 * it — the deployed HTML would keep shipping previews no matter what the Function
 * decided. A constant in the module both halves already import is the only thing
 * that flips both with one edit, and it is greppable, diffable and reviewable, which
 * a dashboard toggle is not.
 *
 * TO RE-ENABLE: set true — and understand first that NO PHASE OF THE CONTRACT EVER
 * ASKED FOR THAT AS A STEP, which is the actual defect here and the reason this
 * constant now exists.
 *
 * ── WHAT THIS SWITCH DOES NOT COVER: THE SERIES ─────────────────────────────────
 *
 * This constant governs cms_stories PROSE and nothing else. The Series
 * (app/lib/series/access.js, functions/api/series/stream.js) is deliberately outside
 * it, and saying so here is the point — the switch's contract above is written as
 * "FALSE = NO STORY IS EVER GATED, FOR ANYONE", and the Series is a gated thing on
 * this platform to which that sentence does not apply.
 *
 * THE REASON IS THAT THE TWO SWITCHES WOULD MEAN OPPOSITE THINGS. This one exists to
 * UNDO an accident: R11.9 paywalled 130 archive stories for signed-out readers that
 * nobody had decided to paywall, and flipping it false restores a state the site had
 * always been in. There is no equivalent state for the Series. It has never been
 * ungated, its files have never been public, and "turn the Series gate off" does not
 * restore anything — it gives away a Platinum benefit and, because the bytes leave the
 * bucket, cannot be taken back.
 *
 * The mechanics differ too. This switch has to be a compile-time constant because one
 * of the two halves it governs is the STATIC BUILD. The Series gate has no static half
 * at all: every decision is made by a Pages Function at request time, against the
 * server clock, and there is nothing baked into HTML for a constant to reach.
 *
 * If the Series ever needs a kill switch, it gets its own, in its own module, with its
 * own written reason for existing. It must not be folded into this one.
 *
 * §7 runs T1 (dual-write) → T2 (app adoption) → T3 (the node's bodies cut). Its T1
 * bullet says "Gating is not live for anybody." Three paragraphs later §7.1 puts the
 * preview-only static render in "the same phase as T1". BOTH WERE IMPLEMENTED, and
 * they contradict each other: the first sentence is only ever true of OLD APP
 * INSTALLS reading cms_stories directly, and §7.1 describes the web page, which is
 * a client too — the one client T1 also changed to stop reading the node's body.
 *
 * So there was never a "turn the gate on" step to skip or to perform early. Going
 * live for readers was a SIDE EFFECT of a phase whose stated purpose was to be
 * invisible to them. Before setting this true, give the contract that step
 * explicitly, and decide separately for each surface who it turns on for.
 */
export const GATING_ENABLED = false;

/** 7 days. The floor is the NEWSLETTER CYCLE — a story is free while its issue is
 *  the current issue — not a guess at reader tolerance. */
export const FREE_WINDOW_DAYS = 7;
export const FREE_WINDOW_MS = FREE_WINDOW_DAYS * 86400000;

/** The 5 newest GATEABLE stories are free regardless of age. Dormant at healthy
 *  cadence; simulated over 1 Apr – 8 Aug 2026 it fires on 26 of 130 days, and
 *  across 9 Apr → 2 May it was the only thing keeping any story free at all. */
export const RECENT_FLOOR_COUNT = 5;

/** Gold unlocks the whole archive. Platinum's differentiators are elsewhere (the
 *  Book Reader Collection, unlimited saves, the Series), and a pass confers gold
 *  through effectiveTier — which is the entire point of "24 hours of Gold". */
export const ARCHIVE_MIN_TIER = 'gold';

/**
 * Could this story ever be gated at all?
 *
 * FALSE for reader-mode (its body is an EPUB behind a public URL — this endpoint
 * does not serve it and does not pretend to gate it) and for poetry (14 of the 15
 * live poetry records carry no stanza markup, so a preview stops a poem
 * mid-breath). Also false for anything unpublished.
 *
 * This is the set the most-recent-5 floor counts over. A floor whose slots were
 * spent on stories that are free anyway would protect fewer than five and quietly
 * fail at the one job it has.
 */
export function isGateable(story) {
  const s = story || {};
  if (s.published === false) return false;
  // servesAsReader, not isReaderMode: a record with the erroneous category-only
  // shape is still routed to /reader, so it must not occupy a floor slot either.
  if (servesAsReader(s)) return false;
  if (s.category === 'poetry') return false;
  return true;
}

/**
 * THE ENTITLEMENT DECISION, as one pure function.
 *
 *   grantFor(story, { tier, floorSlugs, slug, now }) → { access, reason, freeUntilMs }
 *
 *     access  'full' | 'preview' | 'reader'
 *     reason  'reader_mode' | 'poetry' | 'free_window' | 'recent_floor' | 'tier' | 'archive'
 *
 * `floorSlugs` is the resolved most-recent-5 set (a Set or array of slugs); pass an
 * empty one where it is not known and the floor simply never fires. `tier` is the
 * reader's EFFECTIVE tier — already resolved through effectiveTier() in
 * app/lib/membership.js, pass included — because this function must not know how
 * memberships work.
 *
 * FOUR GRANTS, ORed. Whichever leaves the story free wins. Written as an ordered
 * chain rather than a boolean only so `reason` can say WHICH one opened it: "free
 * this week", "poetry is always free" and "your Gold membership" are three
 * different true sentences and a single boolean cannot pick between them.
 *
 * Not handled here, deliberately: missing/unpublished stories. Those are a 404 and
 * the endpoint answers them before it gets this far — a function that returns an
 * access level should not also be the thing that says a story does not exist.
 */
export function grantFor(story, opts = {}) {
  const grant = policyGrantFor(story, opts);

  // ⛔ THE KILL SWITCH, and note WHERE it sits: AFTER the policy has run, and it
  // spares the 'reader' answer. A reader-mode record must still answer 'reader'
  // with the switch off — its body is an EPUB, /api/story has no HTML to send for
  // it, and forcing 'full' would make the endpoint read a body that isn't there and
  // return 502 on every novel on the site. Turning the gate off must not break a
  // surface that was never gated in the first place.
  //
  // Applied HERE rather than inside policyGrantFor so the policy stays testable
  // while it is switched off — tests/ci/story-access.test.mjs asserts the policy
  // through policyGrantFor and the switch through this function. A kill switch
  // that also blinds the suite guarding what it kills is how you discover, on the
  // day you flip it back, that the policy rotted while nobody was looking.
  if (!GATING_ENABLED && grant.access !== 'reader') {
    return { access: 'full', reason: 'gating_off', freeUntilMs: grant.freeUntilMs };
  }
  return grant;
}

/** The policy itself, with no kill switch. Exported for the tests; every PRODUCTION
 *  caller wants grantFor above, which is this plus the switch. */
export function policyGrantFor(story, { tier = 'free', floorSlugs = [], slug = '', now = Date.now() } = {}) {
  const s = story || {};
  const publishedAtMs = typeof s.publishedAtMs === 'number' && Number.isFinite(s.publishedAtMs)
    ? s.publishedAtMs
    : publishedAtMsFor(s);
  const freeUntilMs = publishedAtMs === null ? null : publishedAtMs + FREE_WINDOW_MS;

  if (servesAsReader(s)) return { access: 'reader', reason: 'reader_mode', freeUntilMs };
  if (s.category === 'poetry') return { access: 'full', reason: 'poetry', freeUntilMs };

  // An unparseable publication date CANNOT open the window. Treating null as "just
  // published" would hand the archive to every record whose date the composer could
  // not read — the same reasoning as publishedAtMsFor's refusal to guess.
  if (freeUntilMs !== null && now <= freeUntilMs) {
    return { access: 'full', reason: 'free_window', freeUntilMs };
  }

  const floor = floorSlugs instanceof Set ? floorSlugs : new Set(floorSlugs || []);
  if (slug && floor.has(slug)) return { access: 'full', reason: 'recent_floor', freeUntilMs };

  if (tierAtLeastGold(tier)) return { access: 'full', reason: 'tier', freeUntilMs };

  return { access: 'preview', reason: 'archive', freeUntilMs };
}

// Local, tiny, and NOT a second copy of membership.js's tierAtLeast: this module is
// imported by scripts and by a Worker, and pulling in the membership module for one
// comparison would drag its whole surface along. The caller resolves the effective
// tier with the real thing; this only asks whether the answer clears the bar.
function tierAtLeastGold(tier) {
  return tier === 'gold' || tier === 'platinum';
}

/**
 * The most-recent-5 floor, from a set of index records.
 *
 * Takes `{ slug: record }` (or an array of `{ slug, ... }`) and returns the slugs of
 * the RECENT_FLOOR_COUNT newest GATEABLE ones. Shared by the endpoint, which reads a
 * limitToLast query off cms_stories_index, and by the tests, which build the set by
 * hand — so "newest five" means one thing.
 */
export function resolveRecentFloor(records) {
  const rows = Array.isArray(records)
    ? records.filter(Boolean)
    : Object.entries(records || {}).map(([slug, rec]) => ({ slug, ...(rec || {}) }));

  return rows
    .filter((r) => isGateable(r) && typeof r.publishedAtMs === 'number')
    .sort((a, b) => b.publishedAtMs - a.publishedAtMs)
    .slice(0, RECENT_FLOOR_COUNT)
    .map((r) => r.slug);
}
