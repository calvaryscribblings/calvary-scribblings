// THE LIBRARY'S TAXONOMY — one list, and until R44 there wasn't one.
//
// ── WHAT WAS WRONG ───────────────────────────────────────────────────────────────────────
//
// The library's subcategories were written down NINE times, and no test looked at any of
// them:
//
//   app/admin/page.js           SUBCATEGORY_MAP — all six categories, the CMS picker
//   app/flash/page.js           SUBCATEGORIES  — the filter tabs
//   app/short/page.js           SUBCATEGORIES
//   app/poetry/page.js          SUBCATEGORIES
//   app/news/page.js            SUBCATEGORIES
//   app/inspiring/page.js       SUBCATEGORIES
//   app/book-reader/page.js     SUBCATEGORIES
//   scripts/classify-subcategories.mjs    SUBCATEGORY_MAP — the classifier's vocabulary
//   scripts/reclassify-short-stories.mjs  SUBCATEGORIES  — short's, again
//
// Eight agreed. The ninth had already drifted: classify-subcategories.mjs's `inspiring` list
// was missing 'Essay', so the classifier could not suggest a subcategory that three published
// stories already carry and that both the picker and the tab row offer. Nobody was told,
// because each copy only ever answered its own question.
//
// This is the same failure the shop had in R13 — three spellings of twelve genres, one of
// them derived and disagreeing on four — and it is fixed the same way: ONE literal, imported
// by every reader, with tests/ci/taxonomy.test.mjs failing if a label reappears as a literal
// anywhere else.
//
// ── THE LABEL IS THE KEY. THERE IS NO SLUG ───────────────────────────────────────────────
//
// A story stores its subcategory as the DISPLAY STRING — `subcategory: 'Elegy'` — on both
// cms_stories and cms_stories_index, and every surface matches it with `===`. That is
// deliberately unlike bookstore_genres next door, where a title stores a slug and the label
// is looked up, so the shop can rename a shelf without touching a title.
//
// The consequence is worth stating plainly rather than discovering later: RENAMING A LIBRARY
// SUBCATEGORY IS A DATA MIGRATION, not a redirect. There is no indirection to change. A
// rename means rewriting the field on every story filed under it, and until that write
// finishes the old name is orphaned — its stories match no tab and its tab holds no stories.
// Choose the word once.
//
// ── THE HOUSE RULE: AN EMPTY SUBCATEGORY IS ABSENT, NOT AN EMPTY TAB ─────────────────────
//
// Before R44 only /news filtered its tab row to the subcategories that actually held a story.
// The other five rendered every tab unconditionally, so an unused subcategory drew a live
// button that led to a bare grid and the words "0 stories". Two were doing it in production:
// FAITH on /inspiring, and all three of NOVEL / NOVELLA / SERIAL on /book-reader, whose five
// records are drafts.
//
// That is the opposite of the rule this codebase states everywhere else — an unclaimed
// bookstore section renders nothing, and app/lib/bookstore/genres.js's genresPresentIn() puts
// it as "an empty genre is ABSENT, not an empty tab". A section absent when unclaimed beats
// an empty-state guard, because an empty state is a promise the library has not kept.
//
// So tabsPresentIn() is now how every category page builds its row, and the vocabulary above
// is free to run ahead of the shelf. Adding a word here costs nothing on screen until a story
// is filed under it — which is exactly what let Elegy ship the day it was ruled, with nothing
// under it yet.

/** The CMS's top-level categories. `value` is what a story stores in `category`. */
export const CATEGORIES = [
  { value: 'flash', label: 'Flash Fiction' },
  { value: 'short', label: 'Short Story' },
  { value: 'poetry', label: 'Poetry' },
  { value: 'news', label: 'News & Updates' },
  { value: 'inspiring', label: 'Inspiring' },
  { value: 'novel', label: 'Novel' },
];

/**
 * THE VOCABULARY, keyed by category. Order is display order.
 *
 * Book Reader content is authored under 'novel'; 'serial' is an alias kept from the original
 * map in case a dedicated category is ever added, and is intentionally the same array.
 *
 * ELEGY (R44, Ikenna's ruling) sits immediately after GRIEF rather than at the end. The two
 * are neighbours in sense — an elegy is a formal grief poem — and the row reads as a pair.
 * Nothing is filed under it yet, so by the rule above it draws no tab until something is.
 */
const POETRY = ['Love', 'Grief', 'Elegy', 'Political', 'Nature', 'Spiritual', 'Spoken Word'];
const NOVEL = ['Novel', 'Novella', 'Serial'];

export const SUBCATEGORIES = {
  news: ['Op-Ed', 'Essay', 'Music', 'Film', 'Tech', 'Science', 'Business', 'Finance', 'Sport', 'Politics', 'Culture'],
  flash: ['Romance', 'Horror', 'Humour', 'Drama', 'Thriller', 'Slice of Life'],
  short: ['Romance', 'Horror', 'Humour', 'Drama', 'Thriller', 'Slice of Life', 'Mystery', 'Sci-Fi', 'Historical', 'Fantasy'],
  poetry: POETRY,
  inspiring: ['Personal Essay', 'Essay', 'Overcoming', 'Faith', 'Ambition', 'Loss & Recovery'],
  novel: NOVEL,
  serial: NOVEL,
};

/** The label every tab row opens with. Not a subcategory — a category page's own "no filter". */
export const ALL_TAB = { value: 'all', label: 'All' };

/** The vocabulary for one category, or [] for a category that has none. */
export function subcategoriesFor(category) {
  return SUBCATEGORIES[category] || [];
}

/**
 * The full tab row for a category, unfiltered: All, then every subcategory in the vocabulary.
 *
 * This is the CMS's view — the picker offers the whole vocabulary, because filing the FIRST
 * story under a subcategory is the only way one ever stops being empty. A reader's view is
 * tabsPresentIn(), below.
 */
export function tabsFor(category) {
  return [ALL_TAB, ...subcategoriesFor(category).map((label) => ({ value: label, label }))];
}

/**
 * THE ONE PREDICATE. Every surface asks the same question of a story, so no page can drift
 * into a slightly different idea of what "filed under X" means.
 *
 * /news used to add `|| story.categoryName === value`. It was dead: categoryName holds a
 * CATEGORY's display name — the index carries exactly five, "Short Story", "Flash Fiction",
 * "Poetry", "Inspiring" and "News & Updates" — and none of them is a subcategory label, so
 * the clause could never have matched. Verified against the live index on 9 Sep 2026 (0 of
 * 207 records) and asserted in both directions by the suite, which is what makes removing it
 * a no-op rather than a guess.
 *
 * An EMPTY value never matches. A story with no subcategory carries `''` (storyIndex.js and
 * shelf.js both normalise a missing field to the empty string), so a bare `===` would file
 * every unclassified story under a tab whose value happened to be empty. No tab has an empty
 * value today, which is exactly why the hole would have sat here unnoticed.
 */
export function inSubcategory(story, value) {
  return !!story && !!value && story.subcategory === value;
}

/**
 * THE READER'S TAB ROW — the house rule. A subcategory earns a tab by holding at least one of
 * the stories it is shown beside; 'All' is always present because it is not a subcategory.
 *
 * Same grammar as genresPresentIn() in the shop and as an unclaimed section rendering
 * nothing. Pass the stories the page has ALREADY narrowed to its own shelf (published, past
 * their publishAt) — this function does not filter for visibility, only for occupancy.
 */
export function tabsPresentIn(category, stories) {
  const list = stories || [];
  return tabsFor(category).filter(
    (tab) => tab.value === ALL_TAB.value || list.some((s) => inSubcategory(s, tab.value)),
  );
}
