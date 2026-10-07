// RETIRED STORIES — W35. A cms_stories record that may never be published again from any
// control, robot or client.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
//
// The Book Reader collection was pulled on 16 Aug 2026 (R12.1): two Beta Princess parts moved
// into the Series behind Platinum, and eight more were unpublished. The pull wrote only
// `published: false`. On 30 Sep a CMS save of beta-princess-part-two with "published" ticked
// held it for a cover (coverHold), and the covers reconciler published it with that cover
// fifteen minutes later — exactly as designed for an ordinary story. The Book Reader row came
// back on Home with a route into a members-only series. W34 unpublished it again.
//
// `published: false` is a STATE, and every publish path in this system exists to change that
// state. `readerMode` cannot be the guard either: it is a form checkbox. So retirement is a
// separate fact, in a separate node, that NOTHING ON A CLIENT CAN WRITE:
//
//   cms_stories_retired/{slug} = { retiredAt, reason, retiredOn, note }
//
//   database.rules.json  `.write: false` on the node. And while a slug is listed there, a
//                        client write to cms_stories/{slug} must leave it published:false,
//                        unheld and carrying hiddenAt, and cms_stories_index/{slug} cannot be
//                        written at all. A founder session is refused like any other.
//   app/admin/page.js    opens the record read-only: no save, no Unhide, no delete, no hold.
//   scripts/covers/      the reconciler drops a retired slug before it selects anything,
//                        including its held-for-cover queue (store.mjs: storiesInScope).
//   the Worker           unchanged. Its tick skips any record with hiddenAt, which every
//                        retired record carries and no client can clear.
//
// Public read, on purpose: the node holds slugs, a date and a reason — nothing a reader cannot
// already infer from cms_stories, which is itself public — and the reconciler reads it without
// credentials, in plan mode as well as apply.
//
// ── BRINGING ONE BACK ─────────────────────────────────────────────────────────────────────
//
// One deliberate step, from this Codespace, with the admin key:
//
//   node scripts/stories/retire.mjs --unretire <slug>            # dry run
//   node scripts/stories/retire.mjs --unretire <slug> --apply    # backs up, then removes the marker
//
// It removes the marker and nothing else. The record stays hidden; an editor then unhides it in
// the CMS like any hidden story. There is deliberately no button for the first half.

export const RETIRED_PATH = 'cms_stories_retired';

/** The reason code for the 16 Aug 2026 pull. */
export const BOOK_READER_REASON = 'book-reader-collection';

/**
 * The line the CMS shows on a retired record. Keyed by reason so a later retirement can say
 * its own sentence; an unknown reason still says the record cannot be published.
 */
export const RETIRED_NOTICE = {
  [BOOK_READER_REASON]: 'Retired with the Book Reader collection on 16 August. It can’t be published from here.',
};
export const RETIRED_NOTICE_FALLBACK = 'This story is retired. It can’t be published from here.';

export function retiredNotice(marker) {
  if (!marker) return null;
  return RETIRED_NOTICE[marker.reason] || RETIRED_NOTICE_FALLBACK;
}

/**
 * Is this slug retired? `retired` is the cms_stories_retired snapshot value ({ slug: marker }),
 * or null/undefined when nothing is retired.
 */
export function isRetired(retired, slug) {
  return !!(retired && slug && Object.prototype.hasOwnProperty.call(retired, slug) && retired[slug]);
}

/**
 * The ten records the 16 Aug 2026 pull took down, from evidence rather than readerMode: the
 * R12.1 commit (43082886 — "Beta Princess migrated … Collection pulled: 8 records"), the
 * migration's own pair, and the 8 Sep 2026 backup, the oldest that survives, in which exactly
 * these ten carried readerMode/bookReader and an epubUrl, all unpublished.
 *
 * The two Halfway Around the Moon records were later DELETED (between the 8 and 29 Sep
 * backups), so they have no record to mark; retire.mjs reports them and skips them.
 */
export const BOOK_READER_PULLED = Object.freeze([
  'beta-princess',
  'beta-princess-part-two',
  'diary-of-a-lagos-9-5er-1',
  'afterglow',
  'almost-together',
  'an-appetite-for-love',
  'filtered-reality',
  'the-man-who-was-two-men',
  'halfway-around-the-moon-prologue',
  'halfway-around-the-moon-part-i-dawn',
]);
