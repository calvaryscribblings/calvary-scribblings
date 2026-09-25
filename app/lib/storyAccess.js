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
// (W4: the window is now the London calendar week, freeUntilFor(); the point stands.)
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

import { LAUNCH } from './launch.js';
import { londonMidnightUtc, londonWeekEnd } from './londonWeek.js';
import { tierAtLeast } from './membership.js';

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

// ── W4 (Ikenna's rulings, 24–25 Sep 2026): THE FREE WEEK AND THE ARCHIVE ─────────────
//
//   · The free week is Monday 00:00 → Sunday 23:59:59.999 LONDON. A story is free to everyone
//     until the end of the London week it was published in. At Monday 00:00 the whole week
//     goes to the archive together — Sunday night's story included. One clock
//     (app/lib/londonWeek.js); no story calculates its own window.
//   · The archive is open at or above ARCHIVE_MIN_TIER, through the EFFECTIVE tier (passes
//     count).
//   · Poetry stays free. News locks like fiction. The most-recent-5 floor is GONE.
//   · The gate switches on at ONE instant: 30 September 00:00 London, derived from LAUNCH in
//     app/lib/launch.js (the only file allowed a date). No deploy happens at that moment — the
//     endpoint, the static page's own check and the Series all read the same clock. The Series
//     tier gate (app/lib/series/access.js) switches on at the same instant, from the same
//     constant.
//
// ── WHAT THE OLD KILL SWITCH TAUGHT, KEPT ────────────────────────────────────────────────
// GATING_ENABLED (false since R11.11) existed because R11.9 put a reader-visible paywall on
// production that nobody had decided to turn on: both halves of the gate — the static build
// and /api/story — had flipped as a side effect of a phase meant to be invisible. The lesson
// is why this is a DATE both halves read, not a flag one of them might forget: every surface
// asks gatingOn(now), and the static half is covered twice (the build cuts previews for any
// story archived at or soon after its build time, and the story page refuses to show more
// than the preview once the clock says archive — app/stories/[slug]).

export const GATE_ON_MS = londonMidnightUtc(LAUNCH.y, LAUNCH.m, LAUNCH.d);

/** Is the archive gate on at `now`? Before 30 Sept 00:00 London every story reads as today. */
export const gatingOn = (now = Date.now()) => now >= GATE_ON_MS;

/**
 * DEPRECATED name, kept so a stale import fails loudly in review rather than silently: the gate
 * is a date now. It answers for the moment the module was loaded — never branch a request on it;
 * call gatingOn(now).
 */
export const GATING_ENABLED = gatingOn();

/** Gold unlocks the whole archive. A pass confers gold through effectiveTier — which is the
 *  entire point of "24 hours of Gold". */
export const ARCHIVE_MIN_TIER = 'gold';

/** The last millisecond a story is free: Sunday 23:59:59.999 London of its publication week. */
export function freeUntilFor(story) {
  const s = story || {};
  const publishedAtMs = typeof s.publishedAtMs === 'number' && Number.isFinite(s.publishedAtMs)
    ? s.publishedAtMs
    : publishedAtMsFor(s);
  return publishedAtMs === null ? null : londonWeekEnd(publishedAtMs);
}

/**
 * Could this story ever be gated at all?
 *
 * FALSE for reader-mode (its body is an EPUB behind a public URL — this endpoint
 * does not serve it and does not pretend to gate it) and for poetry (14 of the 15
 * live poetry records carry no stanza markup, so a preview stops a poem
 * mid-breath). Also false for anything unpublished.
 *
 * (It was also the set the most-recent-5 floor counted over; the floor was dropped in W4.)
 */
export function isGateable(story) {
  const s = story || {};
  if (s.published === false) return false;
  // servesAsReader, not isReaderMode: a record with the erroneous category-only
  // shape is still routed to /reader, so it is never a prose story that can be gated.
  if (servesAsReader(s)) return false;
  if (s.category === 'poetry') return false;
  return true;
}

/**
 * Should the static export build a page for this record at all?
 *
 * ── THE HOLE THIS CLOSES (R12.1) ─────────────────────────────────────────────────
 *
 * `generateStaticParams` in app/stories/[slug]/page.js, app/stories/[slug]/layout.js
 * and app/reader/[slug]/page.js all enumerated EVERY KEY of cms_stories with no
 * published filter. So hiding a story removed it from every index-fed surface —
 * library, search, category pages, /quizzes, Voices — and left its page standing at
 * a URL anyone could still type or had already bookmarked.
 *
 * Measured on the deploy that found it: 182 static story pages against 158 published
 * records. Twenty-four hidden stories had live pages carrying their real title, their
 * trailer quote and, for reader-mode records, a client redirect to /reader/<slug>
 * that resolved a still-public epubUrl. "Unpublished" meant "delisted", not "gone".
 *
 * ── WHY NOT JUST `published !== false` ───────────────────────────────────────────
 *
 * Because that would break SCHEDULED PUBLISHING, and quietly. A scheduled story sits
 * at published:false with a future publishAt until the external calvary-newsletter
 * Worker flips it — and the Worker writes a database record, not a deploy. Today the
 * flip works without a rebuild precisely BECAUSE the page was already built. Filter
 * on published alone and a scheduled story goes live to a 404 until someone happens
 * to deploy.
 *
 * So a page is built when the story is published OR when it is waiting on a clock.
 * `publishAt` is tested for PRESENCE, not for being in the future: a schedule that
 * has just fired is momentarily still published:false with a past publishAt, and the
 * page must exist across that boundary rather than only up to it.
 *
 * Measured at the time of writing: all 24 unpublished records carry no publishAt at
 * all, so this drops exactly the hidden ones and nothing else.
 */
export function hasStaticPage(story) {
  const s = story || {};
  if (s.published !== false) return true;
  // W6 (ADM-04): a story an editor HID keeps no page, even with a publishAt. Before hiddenAt
  // existed, "unpublished with a publishAt" could only mean "scheduled"; now a Hide says so.
  if (s.hiddenAt) return false;
  return typeof s.publishAt === 'string' && !!s.publishAt;
}

/**
 * THE ENTITLEMENT DECISION, as one pure function.
 *
 *   grantFor(story, { tier, now, forceGate }) → { access, reason, freeUntilMs }
 *
 *     access  'full' | 'preview' | 'reader'
 *     reason  'reader_mode' | 'poetry' | 'gating_off' | 'free_week' | 'tier' | 'archive'
 *
 * `tier` is the reader's EFFECTIVE tier (effectiveTier() in app/lib/membership.js, pass
 * included). `forceGate` applies the gate before its date — the founder-only preview, and
 * nothing else; every caller that is not that preview leaves it false.
 *
 * Not handled here: missing/unpublished stories. The endpoint answers those as 404 first.
 */
export function grantFor(story, { tier = 'free', now = Date.now(), forceGate = false } = {}) {
  const grant = policyGrantFor(story, { tier, now });
  if (!forceGate && !gatingOn(now) && grant.access !== 'reader') {
    return { access: 'full', reason: 'gating_off', freeUntilMs: grant.freeUntilMs };
  }
  return grant;
}

/** The policy as it stands once the gate is on, whatever the date. Tests and parity use it. */
export function policyGrantFor(story, { tier = 'free', now = Date.now() } = {}) {
  const s = story || {};
  const freeUntilMs = freeUntilFor(s);

  if (servesAsReader(s)) return { access: 'reader', reason: 'reader_mode', freeUntilMs };
  if (s.category === 'poetry') return { access: 'full', reason: 'poetry', freeUntilMs };
  if (freeUntilMs !== null && now <= freeUntilMs) return { access: 'full', reason: 'free_week', freeUntilMs };
  if (tierAtLeast(tier, ARCHIVE_MIN_TIER)) return { access: 'full', reason: 'tier', freeUntilMs };
  return { access: 'preview', reason: 'archive', freeUntilMs };
}
