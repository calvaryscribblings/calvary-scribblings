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
