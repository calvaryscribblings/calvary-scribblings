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
// So: one definition, imported by the Pages Function, by the index projection that
// computes the `gated` badge, and by the tests that assert those two agree.

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
 * Is this story served as a book rather than as prose?
 *
 * Lifted verbatim from the four places that already ask it — the story page's
 * redirect, its build-time twin, reader-gate.js and the app's storyHref — so the
 * fifth caller (the serving endpoint, which must answer access:'reader' for these)
 * does not become a fifth spelling of the same condition.
 *
 * `bookReader === true || readerMode === true` is the app's own routing test; the
 * two category clauses are this repo's. Both are included because a story that
 * routes to /reader on ANY surface has its body in an EPUB, and the endpoint's
 * answer must not depend on which surface asked.
 */
export function isReaderMode(story) {
  const s = story || {};
  return s.readerMode === true
    || s.bookReader === true
    || s.category === 'novel'
    || (s.category === 'poetry' && !!s.epubUrl);
}

// ── THE POLICY ───────────────────────────────────────────────────────────────────
// Settled 2026-08-07. See STORY-SERVING-CONTRACT.md §3.1–§3.4 for the reasoning
// behind each; the short version is recorded here so a reader of this file is not
// left guessing why the numbers are the numbers.

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
  if (isReaderMode(s)) return false;
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
export function grantFor(story, { tier = 'free', floorSlugs = [], slug = '', now = Date.now() } = {}) {
  const s = story || {};
  const publishedAtMs = typeof s.publishedAtMs === 'number' && Number.isFinite(s.publishedAtMs)
    ? s.publishedAtMs
    : publishedAtMsFor(s);
  const freeUntilMs = publishedAtMs === null ? null : publishedAtMs + FREE_WINDOW_MS;

  if (isReaderMode(s)) return { access: 'reader', reason: 'reader_mode', freeUntilMs };
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
