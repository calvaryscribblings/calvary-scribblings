// A HELD BOOK — a book on a reader's shelf, whatever the catalogue says about it today. W33.
//
// My Library and the held-book reader (/my-library/book?t=<titleId>) both draw a shelf row from
// the same two records, and must draw it the same way:
//
//   bookstore_purchases/{uid}/{titleId}   what the reader holds — the authority on ownership
//   bookstore_titles/{titleId}            the catalogue record, WHERE ONE EXISTS. It may not:
//                                         a title can be withdrawn (status changes), and a book
//                                         can be held with no catalogue record at all (an author
//                                         copy — see scripts/bookstore/author-copy.mjs).
//
// THE DOOR. /reader/<slug> is exported only for PUBLISHED titles (app/reader/[slug]/page.js) and
// its gate opens only a published one (reader-gate.js). Every other held book — withdrawn, or
// never listed — would 404 there, which takes back a book the reader still owns. So the shelf
// links /reader/<slug> only when the catalogue says published, and every other held book opens at
// /my-library/book, one static page that holds nothing per title.
//
// Pure: no Firebase, no React. tests/bookstore/held-book.test.mjs drives it.

/** The same shape functions/api/bookstore/stream.js accepts. Anything else is not an id. */
export const HELD_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const HELD_PATH = '/my-library/book';

/** The titleId in a query string (`?t=`), or null when absent or malformed. */
export function parseHeldId(search) {
  let t = null;
  try { t = new URLSearchParams(search || '').get('t'); } catch { return null; }
  return typeof t === 'string' && HELD_ID_RE.test(t) ? t : null;
}

/** Does this purchase record open the book? The exact test stream.js makes. */
export const isActiveHold = (rec) => !!rec && typeof rec === 'object' && !Array.isArray(rec) && rec.status === 'active';

/** Is this catalogue record one /reader/<slug> was exported for? Positively, on published. */
export const isPublishedTitle = (doc) => !!doc && typeof doc === 'object' && doc.status === 'published';

const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * One shelf row from a purchase and its catalogue record (or null). The fallbacks My Library has
 * always used — the catalogue first, the purchase's denormalised fields after — plus `published`,
 * which decides the door.
 */
export function heldBookView(id, purchase, titleDoc) {
  const p = purchase && typeof purchase === 'object' ? purchase : {};
  const t = titleDoc && typeof titleDoc === 'object' ? titleDoc : null;
  return {
    id,
    slug: str(t?.slug) || str(p.slug) || id,
    title: str(t?.title) || str(p.title) || 'Untitled',
    author: str(t?.author) || str(p.author) || '',
    coverUrl: str(t?.coverUrl) || str(p.coverUrl),
    purchasedAt: typeof p.purchasedAt === 'number' ? p.purchasedAt : 0,
    active: isActiveHold(p),
    published: isPublishedTitle(t),
  };
}

/** Where a held book opens. Published → its reader page; anything else → the held page. */
export function heldBookHref(view) {
  if (view.published) return `/reader/${view.slug}`;
  return `${HELD_PATH}?t=${encodeURIComponent(view.id)}`;
}

/**
 * The title object BookstoreReaderClient's purchased path reads. Only what that path uses: the id
 * (the stream selector and the progress key), the slug (the room's meta), the display fields, and
 * — where a catalogue record exists — its catalogue mark and glossary. Never a price, a sample
 * path or a genre: the held path offers no sale and no sample.
 */
export function heldReaderTitle(view, titleDoc) {
  const t = titleDoc && typeof titleDoc === 'object' ? titleDoc : null;
  return {
    id: view.id,
    slug: view.slug,
    title: view.title,
    author: view.author,
    coverUrl: view.coverUrl,
    catalogueNumber: t && typeof t.catalogueNumber === 'number' ? t.catalogueNumber : null,
    glossary: t?.glossary && typeof t.glossary === 'object' ? t.glossary : null,
  };
}
