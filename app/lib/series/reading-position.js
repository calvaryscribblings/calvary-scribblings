// THE SERIES READING POSITION AND ITS PIN.
//
// A deliberate second copy of the shape at app/lib/bookstore/reading-position.js, on its own
// node — series_reading_progress/{uid}/{instalmentId} — and NOT a reuse of the bookstore's.
//
// ── WHY IT COULD NOT REUSE THE EXISTING NODE ─────────────────────────────────────────────
//
// bookstore_reading_progress/$uid/$titleId ends its rule with `"$other": { ".validate":
// false }`. That is not a style choice: it means any key the rule does not already name is a
// REJECTED WRITE. There is no way to add a `seriesId`, an `instalmentId` or a discriminator
// to that record — the write simply fails and the reader silently loses their place. The
// node structurally refuses to be shared, which is exactly what a closed record is for.
//
// So the Series gets its own, with the same four fields, the same closed `$other`, and the
// same pin discipline. The two nodes are siblings, not a hierarchy, and neither reads the
// other.
//
// ── WHY A POSITION NEEDS A PIN AT ALL ────────────────────────────────────────────────────
//
// Unchanged from R11.22, and worth restating because the Series makes it sharper rather than
// softer. A CFI is coordinates into ONE DOCUMENT'S BYTE LAYOUT — a path through the parsed
// tree plus a character offset. Give those coordinates to a copy whose bytes differ and they
// still resolve: no error, no throw, just different prose that reads as though it were the
// right place. The parser is not the variable; the FILE is.
//
// The Series raises the stakes because an instalment is a SEPARATE, COMPLETE EPUB — not a
// chapter inside one growing book. A reader moving from instalment 2 to instalment 3 changes
// files, and a position that leaked across would land inside the wrong story entirely rather
// than a few paragraphs off. The pin is per-instalment for that reason: keyed by instalmentId
// and stamped with THAT file's generation.
//
// THE PIN IS NOT A NEW FACT. It is the Cloud Storage `generation` of the instalment's
// master.epub, handed to both surfaces by functions/api/series/stream.js on the same call
// that hands over the bytes. Neither surface computes, hashes or trusts anything about the
// other. See docs/reading-position-pin.md.

/**
 * The record to write. Exactly the shape database.rules.json accepts and nothing else.
 *
 *   { fraction, updatedAt }   — always
 *   + cfi                     — when there is one
 *   + epubVersion             — only ever alongside a cfi
 *
 * `cfi` is OMITTED rather than written as null: the validator rejects a null-typed child on a
 * closed record, and Firebase strips client nulls anyway, so writing one is two bugs racing.
 *
 * The pin rides with the cfi and never alone. A pin beside no position pins nothing, and an
 * unpinned cfi is the record every surface already knows to read by fraction — so the
 * degraded case is the shipped case, not a new one.
 */
export function positionRecord({ fraction, updatedAt, cfi, pin }) {
  const record = { fraction, updatedAt };
  if (typeof cfi === 'string' && cfi) record.cfi = cfi;
  if (record.cfi && typeof pin === 'string' && pin) record.epubVersion = pin;
  return record;
}

/**
 * May this stored CFI be seeked to, or must the record be read by fraction alone?
 *
 *   pins match                     → true.  Same generation ⇒ same bytes.
 *   pins differ, or the record is
 *   pinned and we never learned
 *   our own version                → false. Land on fraction: approximate and honest,
 *                                           rather than precise and wrong.
 *   no pin on the record           → true.  The status quo, kept on purpose.
 *
 * That last state exists here on day one even though nothing has written an unpinned Series
 * position yet: `version: null` from the endpoint is a real, reachable state (the GCS
 * metadata read failed), and a reader who saves in it writes a cfi with no pin. Treating that
 * as untrusted would demote a position for a hiccup that has nothing to do with the file
 * having changed.
 */
export function cfiIsOurs(record, ourPin) {
  const stored = record?.epubVersion;
  if (typeof stored !== 'string' || !stored) return true;
  return typeof ourPin === 'string' && ourPin === stored;
}

/** The node path. One definition, so the reader and any future sweep cannot disagree. */
export const positionPath = (uid, instalmentId) => `series_reading_progress/${uid}/${instalmentId}`;
