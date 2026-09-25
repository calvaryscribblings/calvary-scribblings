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
//   countsForReadership()   the public "IN N READERS' LIBRARIES" line, the admin's removal
//                           owner count, and any popularity signal built on library adds
//   isSale()                revenue, sales figures, publisher and royalty statements
//
// tests/bookstore/comps.test.mjs holds every aggregation of bookstore_purchases in the tree to
// importing this module; a new report that reads the node without it fails CI.
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
