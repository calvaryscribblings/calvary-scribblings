// WHERE A BOOK ON A SHELF CAME FROM — a sale, or a complimentary copy. W3b, 25 Sep 2026.
//
// Ikenna's ruling: complimentary founder copies of the catalogue, so the Books design in My
// Library can be walked with real books before launch. **They are comps, never sales.**
//
// A comp is an ordinary entitlement — bookstore_purchases/{uid}/{titleId} with
// status: 'active', exactly what the web shelf, the app's shelf and /api/bookstore/stream read
// — marked `source: 'comp'`, with no amount, no currency and no provider reference. Everything
// that turns purchase records into a NUMBER asks this module first:
//
//   countsForReadership()   the public "IN N READERS' LIBRARIES" line, and any popularity
//                           signal built on library adds
//   isSale()                revenue, sales figures, publisher and royalty statements
//   holdersOf()             NOT a readership figure: who HOLDS the book, sales and comps alike.
//                           The admin's title delete asks this, because a comp opens the same
//                           master EPUB a sale does (see below).
//
// tests/bookstore/comps.test.mjs holds every aggregation of bookstore_purchases in the tree to
// importing this module; a new report that reads the node without it fails CI.
//
// ⚠ W6 CLOSED THE HOLE THAT WAS NOTED HERE. The admin's title DELETE used to decide whether
// anyone owned a book from bookstore_readership, which counts through countsForReadership — so
// it did not see comps, a title held ONLY as a comp read as unowned, and deleting it removed the
// master the comp opens. It now counts holders directly from bookstore_purchases through
// holdersOf() (functions/api/bookstore/holders.js — the browser cannot enumerate the node), and a
// comp holds the master exactly as a sale does.
//
// Pure and money-free (no prices, no currencies), so any platform can carry it.

export const COMP_SOURCE = 'comp';

/** Is this record a complimentary copy? */
export const isComp = (rec) => !!rec && typeof rec === 'object' && rec.source === COMP_SOURCE;

/** Does this record put the book in a reader's library for the public count? Live sales only. */
export const countsForReadership = (rec) =>
  !!rec && typeof rec === 'object' && !Array.isArray(rec) && rec.status === 'active' && !isComp(rec);

/**
 * Is this record a SALE — money that moved through a provider? A comp never is, and neither is
 * a record that names no provider reference (there was no transaction to count).
 */
export const isSale = (rec) => !!rec && typeof rec === 'object' && !isComp(rec)
  && ((typeof rec.stripeSessionId === 'string' && !!rec.stripeSessionId)
    || (typeof rec.paystackRef === 'string' && !!rec.paystackRef));

/**
 * Does this record put the book in its holder's library — whatever its source?
 *
 * The same test functions/api/bookstore/stream.js makes before it signs a URL for the master:
 * `status === 'active'`, and nothing else. A comp passes it; so does a sale. This is the
 * question "would deleting the master take a book from someone", which is a different question
 * from "how many readers bought it" (countsForReadership) and must never borrow its answer.
 */
export const holdsBook = (rec) =>
  !!rec && typeof rec === 'object' && !Array.isArray(rec) && rec.status === 'active';

/**
 * THE HOLDER COUNT for one title, over the WHOLE bookstore_purchases node ({uid: {titleId: rec}}).
 *
 *   count  every active entitlement, sales and comps alike
 *   comps  how many of those are complimentary copies (a subset of count, never added to it)
 *
 * Deliberately NOT a readership or sales figure — see holdsBook. tests/bookstore/comps.test.mjs
 * lets a whole-node reader through only if it imports this module; this is the export such a
 * reader uses when what it needs is holders rather than buyers.
 */
export function holdersOf(purchases, titleId) {
  let count = 0;
  let comps = 0;
  if (!purchases || typeof purchases !== 'object' || !titleId) return { count, comps };
  for (const uid of Object.keys(purchases)) {
    const shelf = purchases[uid];
    const rec = shelf && typeof shelf === 'object' ? shelf[titleId] : null;
    if (!holdsBook(rec)) continue;
    count += 1;
    if (isComp(rec)) comps += 1;
  }
  return { count, comps };
}
