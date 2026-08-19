// THE GENRE TAXONOMY — one list, and after R13 it lives in the database.
//
// ── WHAT WAS WRONG ───────────────────────────────────────────────────────────────────────
//
// Genre was written down THREE times in this tree, and the third one had already drifted:
//
//   app/bookstore/page.js:31            GENRE_LABELS — the shop's tabs and shelf labels
//   app/bookstore/[slug]/page-detail.js:32  GENRE_LABELS — byte-identical, and separately maintained
//   app/admin/bookstore/page.js:39      GENRE_OPTIONS — labels DERIVED from the slug by
//                                       title-casing its hyphens
//
// The third is not a copy of the first two, it is a different function of the same input, and
// it disagreed with them on four of the twelve. An editor choosing a genre in the CMS read
// "Thriller Suspense", "Sci Fi Fantasy", "Short Story Collection" and "Self Development";
// the shop then printed "Thriller & Suspense", "Sci-Fi & Fantasy", "Short Story Collections"
// and "Self-Development". Nothing broke, nobody was told, and the two screens had been
// naming the same shelf differently for as long as both existed.
//
// ── THE RULE NOW ─────────────────────────────────────────────────────────────────────────
//
// ONE literal in the tree — GENRE_SEED, below — and it is the MIGRATION PAYLOAD, not the
// runtime source. At runtime every label, every ordering and every fiction/non-fiction
// decision comes from `bookstore_genres`, read once by loader.getGenres() and threaded to
// the surfaces as data. Nothing renders a genre from a hard-coded table any more, and
// tests/bookstore/genres.test.mjs fails if a new one appears.
//
// ── WHY A SEED AT ALL, AND WHY IT IS NOT A FALLBACK ──────────────────────────────────────
//
// A seed is the migration's own output, expressed once so that the three things which must
// produce identical records cannot disagree: scripts/migrate-bookstore-taxonomy.mjs, the
// "Seed the taxonomy" button in /admin/bookstore → Genres, and getGenres()'s bootstrap for
// the window between the deploy and the migration. That window is real — a static export
// goes live the moment Pages finishes, and the node is written by a human afterwards — and
// an unseeded node would mean a shop with no tabs and no shelf labels until somebody
// noticed. Compare the sections system next door, which is governed by the opposite rule
// (an unclaimed section renders NOTHING) and for the opposite reason: a missing curator's
// claim is an editorial silence and must stay silent, where a missing genre label is a
// broken screen. Curation may be absent. Vocabulary may not.
//
// The bootstrap dies on its own the moment the node holds one record. It is not consulted
// per-genre and it never fills a gap in a populated node: a genre the curator deleted stays
// deleted.
//
// ── slug IS THE KEY ──────────────────────────────────────────────────────────────────────
//
// bookstore_genres/{slug} rather than a push key, because a title stores its genre AS the
// slug (`genre: 'literary-fiction'`) and has done since v1. A push key would put an
// indirection between the title and its shelf that buys nothing and can go stale. Same
// reasoning as bookstore_publishers/{slug}.

export const GENRE_SCHEMA_VERSION = 1;
export const GENRES_PATH = 'bookstore_genres';

/** The two halves of the shop. A genre belongs to exactly one. */
export const GENRE_GROUPS = ['fiction', 'nonfiction'];

/**
 * THE MIGRATION PAYLOAD. Reproduces, exactly, what the shop rendered before R13:
 *   label  — verbatim from app/bookstore/page.js's GENRE_LABELS (and the detail page's copy
 *            of it, which was byte-identical; both are deleted by this round)
 *   group  — verbatim from FICTION_GENRES / NONFICTION_GENRES
 *   order  — the position each slug held in those two arrays, which is the order the tabs
 *            were rendered in
 *
 * tests/bookstore/genres.test.mjs pins all three against the pre-R13 source, so this cannot
 * be "tidied" into a different shop.
 */
export const GENRE_SEED = [
  { slug: 'literary-fiction',       label: 'Literary Fiction',        group: 'fiction',    order: 1 },
  { slug: 'romance',                label: 'Romance',                 group: 'fiction',    order: 2 },
  { slug: 'thriller-suspense',      label: 'Thriller & Suspense',     group: 'fiction',    order: 3 },
  { slug: 'sci-fi-fantasy',         label: 'Sci-Fi & Fantasy',        group: 'fiction',    order: 4 },
  { slug: 'historical',             label: 'Historical',              group: 'fiction',    order: 5 },
  { slug: 'short-story-collection', label: 'Short Story Collections', group: 'fiction',    order: 6 },
  { slug: 'poetry',                 label: 'Poetry',                  group: 'fiction',    order: 7 },
  { slug: 'memoir-biography',       label: 'Memoir & Biography',      group: 'nonfiction', order: 8 },
  { slug: 'essays',                 label: 'Essays',                  group: 'nonfiction', order: 9 },
  { slug: 'self-development',       label: 'Self-Development',        group: 'nonfiction', order: 10 },
  { slug: 'business-finance',       label: 'Business & Finance',      group: 'nonfiction', order: 11 },
  { slug: 'politics-society',       label: 'Politics & Society',      group: 'nonfiction', order: 12 },
];

/** The assignable vocabulary, as slugs. schema.js's GENRES is this list — see its import. */
export const GENRE_SEED_SLUGS = GENRE_SEED.map((g) => g.slug);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

/**
 * Shape only, in the house style: referential questions ("does any title use this?") belong
 * to the writer, not here.
 */
export function validateGenre(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { valid: false, errors: ['doc is not an object'] };
  if (!isInt(doc.schemaVersion) || doc.schemaVersion < 1) errors.push('schemaVersion must be a positive integer');
  if (!isStr(doc.slug)) errors.push('slug is required');
  else if (!SLUG_RE.test(doc.slug)) errors.push('slug must be kebab-case (lowercase, digits, hyphens)');
  if (!isStr(doc.label)) errors.push('label is required');
  else if (doc.label.length > 60) errors.push('label must be 60 characters or fewer');
  if (!GENRE_GROUPS.includes(doc.group)) errors.push(`group must be one of: ${GENRE_GROUPS.join(', ')}`);
  if (!isInt(doc.order) || doc.order < 0) errors.push('order must be a non-negative integer');
  return { valid: errors.length === 0, errors };
}

/** Ascending by `order`, then by slug so two genres sharing an order still sort stably. */
export function sortGenres(genres) {
  return [...(genres || [])].sort((a, b) => (a.order - b.order) || String(a.slug).localeCompare(String(b.slug)));
}

/**
 * The label for a slug. Falls back to the slug ITSELF, never to a derived title-case — a
 * genre missing from the taxonomy should look wrong on screen, because it is wrong in the
 * data, and a plausible auto-label is exactly how the CMS's old GENRE_OPTIONS hid its
 * disagreement with the shop for months.
 */
export function genreLabel(genres, slug) {
  const hit = (genres || []).find((g) => g.slug === slug);
  return hit ? hit.label : String(slug || '');
}

/** 'fiction' | 'nonfiction' | null — null means "this slug is not in the taxonomy". */
export function groupOf(genres, slug) {
  const hit = (genres || []).find((g) => g.slug === slug);
  return hit ? hit.group : null;
}

/** Every genre in a group, in display order. */
export function genresInGroup(genres, group) {
  return sortGenres((genres || []).filter((g) => g.group === group));
}

/**
 * THE TAB RULE, unchanged from R2 and now stated in one place: a genre earns a tab by
 * holding at least one of the titles it is shown beside. An empty genre is ABSENT, not an
 * empty tab — same grammar as an unclaimed section rendering nothing.
 */
export function genresPresentIn(genres, titles, group) {
  const slugs = new Set((titles || []).map((t) => t.genre));
  return genresInGroup(genres, group).filter((g) => slugs.has(g.slug));
}

/** Titles belonging to one half of the shop, in the order they were given. */
export function titlesInGroup(genres, titles, group) {
  return (titles || []).filter((t) => groupOf(genres, t.genre) === group);
}
