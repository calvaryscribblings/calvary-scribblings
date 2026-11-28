// CONTINUE READING — the record shapes and the numbers (CR-2). The contract is
// docs/CONTINUE-READING.md; this file is that contract as data. The rules for reading_position are
// GENERATED from these constants by scripts/continue-reading/write-rules.mjs, never typed into
// database.rules.json by hand: change a number here, run the script, commit both.
//
// ── THE NODE ────────────────────────────────────────────────────────────────────────────────
//
//   reading_position/{uid}/stories/{slug}            { fraction 0..1, updatedAt (server time) }
//   reading_position/{uid}/hidden/stories/{slug}     server time of the reader's ✕
//   reading_position/{uid}/hidden/instalments/{id}   server time of the reader's ✕
//
// Owner-only. An INSTALMENT's position is NOT here: it stays in series_reading_progress and
// series_finished, which the Series reader already writes. Only the ✕ on an instalment card is new.
// The app's userProgress node is left alone (ruling, 28 Nov 2026).
//
// No imports beyond the two pattern sources, so the browser, node --test and the rules generator
// all load it.

import { ID_RULES } from '../ids.js';
import { INSTALMENT_ID_RE } from '../series/schema.js';

export const POSITION_PATH = 'reading_position';

/** A story's key: exactly app/lib/ids.js's `slug`, so a slug the site refuses is refused here too. */
export const STORY_SLUG_RE = ID_RULES.slug.re;
export const STORY_SLUG_MAX = ID_RULES.slug.max;
/** An instalment's key: the Series' own pattern (`<seriesSlug>-i<ordinal>`). */
export { INSTALMENT_ID_RE };

// ── WHEN A STORY COUNTS AS STARTED (ruling, 28 Nov 2026) ───────────────────────────────────
// The read counter's own thresholds: 12 seconds of foreground dwell, or 25% of the way through
// the article. Both the counter and the first position write read these two numbers, so the two
// cannot drift. A visit passes them whether or not its read was already counted.
export const STARTED_DWELL_MS = 12000;
export const STARTED_SCROLL = 0.25;

// ── HOW OFTEN A POSITION IS SAVED ──────────────────────────────────────────────────────────
// After the first write: only when the fraction has moved this much AND this long has passed.
// Plus one best-effort write when the tab is hidden or closed.
export const SAVE_MIN_STEP = 0.02;
export const SAVE_MIN_INTERVAL_MS = 15000;

/** The row keeps this many cards, newest first. */
export const ROW_MAX = 10;

/**
 * How a card says "jump to where I stopped". A HASH, not a query string, so the URL a CDN caches
 * and the canonical are untouched. The page removes it from the address bar once read, so a
 * reload or a shared link opens at the top as any other visit does.
 */
export const RESUME_HASH = '#continue-reading';

export const positionPath = (uid, slug) => `${POSITION_PATH}/${uid}/stories/${slug}`;
export const hiddenPath = (uid, kind, id) => `${POSITION_PATH}/${uid}/hidden/${kind === 'instalment' ? 'instalments' : 'stories'}/${id}`;

export const isStorySlug = (v) => typeof v === 'string' && v.length > 0 && v.length <= STORY_SLUG_MAX && STORY_SLUG_RE.test(v);
export const isInstalmentId = (v) => typeof v === 'string' && INSTALMENT_ID_RE.test(v);
