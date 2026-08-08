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
// ── WHAT THIS FILE DELIBERATELY DOES NOT HOLD ────────────────────────────────────
//
// The free-window LENGTH is not here. It is a server constant living in the Pages
// Function, and it is never shipped to a client — not as a number, not as a
// duration, not in a bundle. Anything importable by the browser is published by the
// browser, and a window length in the client bundle is an invitation to reimplement
// the gate on the device clock, which is settable. What the client gets is
// `freeUntilMs`, an absolute instant it can render but not reason from.
//
// This module answers exactly one question: WHEN was this story published?

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
