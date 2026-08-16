// Reader-facing strings for the Series. Pure — no React, no Firebase — so the copy a reader
// actually sees can be asserted by `node --test` rather than by opening the page and looking.
//
// This file exists because the same two sentences are needed in three places (the landing
// grid, the series detail header, the instalment row) and three hand-written copies of "3
// instalments · next 14 October" is how one of them ends up saying "episodes".

import { isReleased } from './access.js';

/**
 * A release date as a reader reads it: "14 October", or "14 October 2027" when it is not the
 * current year.
 *
 * UTC, deliberately. releaseAtMs is a UTC instant and the rule that gates on it compares
 * against the RTDB server clock; rendering it in the device's zone would show "13 October" to
 * a reader in Los Angeles for an instalment that releases on the 14th, and they would be
 * right to call that wrong.
 */
export function formatRelease(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/**
 * The line under a poster: what is readable now, and when the next one lands.
 *
 * "3 instalments · next 14 October". Singular at one, because "1 instalments" is the kind of
 * detail that makes a paid product look unfinished.
 *
 * Counts are DERIVED from the rows on every call — see app/lib/series/schema.js for why no
 * counter is stored.
 */
export function shelfLine(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const released = list.filter((r) => isReleased(r, now));
  const upcoming = list
    .filter((r) => r.status === 'published' && !isReleased(r, now))
    .sort((a, b) => (a.releaseAtMs || 0) - (b.releaseAtMs || 0));

  const have = released.length === 0
    ? 'Arriving soon'
    : `${released.length} instalment${released.length === 1 ? '' : 's'}`;

  const when = upcoming.length ? formatRelease(upcoming[0].releaseAtMs, now) : null;
  return when ? `${have} · next ${when}` : have;
}

/** "Instalment 3" — the row label. One place, so the word cannot drift. */
export function instalmentLabel(ordinal) {
  return `Instalment ${ordinal}`;
}

/** "Beta Princess · Instalment 3" — the eyebrow over an instalment page. */
export function instalmentEyebrow(seriesTitle, ordinal) {
  return `${seriesTitle} · ${instalmentLabel(ordinal)}`;
}

/** "Read Instalment 3" — the one action on the instalment page. */
export function readActionLabel(ordinal) {
  return `Read ${instalmentLabel(ordinal)}`;
}

/**
 * The word over a release date: "released" once the date has passed, "releases" before.
 *
 * A credit reading "releases · 14 October" over a date four months gone is a small lie in the
 * present tense, and it is the one credit on the page a reader can check against a calendar.
 *
 * DERIVED FROM THE DATE, not passed in as a boolean by the caller. The instalment page only
 * draws its credits after the release gate has opened, so a hardcoded "released" would be
 * correct today and would quietly become the wrong word the first time this label is reused
 * anywhere that can see an unreleased row. Same clock as formatRelease(), which renders the
 * date beneath it — the two must not be able to disagree about which side of it we are on.
 *
 * A missing or non-numeric date takes the FUTURE tense. It is the safer of the two: nothing
 * renders the credit at all without a date (Credit drops on a falsy value), and of the two
 * possible slips, claiming something has come out when it has not is the worse one.
 */
export function releaseCreditLabel(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'releases';
  return ms <= now ? 'released' : 'releases';
}

/**
 * The line above a sponsor's name. Lowercase, and that is the design, not a slip.
 *
 * Sentence case throughout the credits block — see app/series/instalment/[instalmentId]/
 * page-instalment.js on why the eyebrow is the only small-caps element on that page.
 */
export const SPONSOR_PREAMBLE = 'this instalment made possible by';

// ── READING TIME ─────────────────────────────────────────────────────────────────────────
//
// 220 words per minute, matching app/lib/storyIndex.js:indexReadTime — the number the app,
// the story page, the index and the story endpoint all already show a reader. One platform,
// one pace.
//
// ⚠ WHAT IS NOT COPIED IS THAT FUNCTION'S QUIRK. indexReadTime counts RAW HTML TOKENS, so
// `<a href="…">` scores two words and a heavily-tagged story reads longer than it is. Its own
// comment forbids fixing that, because the number is in cross-platform parity with
// lib/storyDerived.ts in the app and "parity outranks correctness" there. THE SERIES HAS NO
// SUCH COUNTERPART. Nothing in the app renders an instalment's reading time, so there is
// nothing to be in parity with, and there is no reason to import a known-wrong count into a
// surface that can simply be right. wordCount arrives already stripped of markup — see
// countEpubWords() in app/lib/epubExtract.js — so this is prose per minute, as advertised.
export const WORDS_PER_MINUTE = 220;

/**
 * Whole minutes for a stored word count, or NULL when there is no count.
 *
 * Null is the honest answer and the page drops the credit for it. The alternative — falling
 * back to 0, or to some default — would print "0 min read" under a real instalment, which is
 * a confident statement of something false. An uncounted instalment is one whose EPUB has not
 * been uploaded through the counter yet, and saying nothing is exactly right until it has.
 */
export function readingMinutes(wordCount) {
  if (typeof wordCount !== 'number' || !Number.isFinite(wordCount) || wordCount <= 0) return null;
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

/** "12 min", or null. The credit value beside the "reading time" label. */
export function readingTimeLabel(wordCount) {
  const m = readingMinutes(wordCount);
  return m === null ? null : `${m} min`;
}
