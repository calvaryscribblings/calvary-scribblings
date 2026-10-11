// W38, RULING 131 — WHICH BOOK STORE PAGES THE SITEMAP LISTS. Pure, so tests/ci can hold it.
//
// The published catalogue and nothing else: a title whose status is 'published', shown by the
// same rule the storefront uses (app/lib/bookstore/loader.js filterByActivePublisher — a title
// whose publisher is known and not active is off the shop; an unknown publisher passes, as it
// does there). Withdrawn, draft and held titles are not 'published'. The rooms (Desiderata,
// Search) and every admin or preview page are simply not in this list; they carry noindex too.

export const BOOKSTORE_PATH = '/bookstore';

/** bookstore_titles + bookstore_publishers values → the title slugs, sorted. */
export function sitemapTitleSlugs(titles, publishers) {
  const pubs = publishers || {};
  return Object.values(titles || {})
    .filter((t) => t && t.status === 'published' && typeof t.slug === 'string' && t.slug)
    .filter((t) => { const p = pubs[t.publisherId]; return !p || p.status === 'active'; })
    .map((t) => t.slug)
    .sort();
}
