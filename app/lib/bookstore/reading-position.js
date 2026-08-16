// R11.22 — THE READING POSITION AND ITS PIN.
//
// Two pure functions, one for each half of the record at
// bookstore_reading_progress/{uid}/{titleId}: what gets written, and whether what was read
// back may be seeked to. They live here rather than inside ReadingRoom.js so they can be
// asserted directly (tests/bookstore/reading-pin.test.mjs) — the write shape is validated by
// database.rules.json with `$other` closed, so a stray key is a REJECTED WRITE and a lost
// position, not a tolerated extra field.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A POSITION NEEDS A PIN AT ALL
//
// A CFI is not a bookmark in a book. It is coordinates into ONE DOCUMENT'S BYTE LAYOUT — a
// path through the parsed tree plus a character offset into a text node. Give the same
// coordinates to a copy of the "same" book whose bytes differ and they still resolve: no
// error, no throw, just different prose that reads as though it were the right place. The
// app measured this on real cross-surface data at roughly half of attempts.
//
// The parser is not the variable — epubcfi.js is byte-identical on both surfaces. The FILE
// is. So the only question worth asking about a stored position is "was it taken in the
// bytes I am holding?", and that is a question about provenance, which is answerable, rather
// than about whether the landing looks right, which is not: a wrong-content landing can sit
// an order of magnitude closer in fraction terms than two honest devices differ by from
// pagination alone. Any check that measures the landing passes the dangerous case.
//
// THE PIN IS NOT A NEW FACT. It is the Cloud Storage `generation` of the title's master.epub,
// which functions/api/bookstore/stream.js has returned as `version` since R9.10 and the
// native app already keys its download cache by. It changes when and only when the object is
// replaced. Both surfaces are handed it by the same endpoint on the same call that hands over
// the bytes, so neither has to compute, hash, or trust anything about the other.
//
// The contract, and what the app must write for a position to cross: docs/reading-position-pin.md
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The record to write. Exactly the shape database.rules.json accepts and nothing else.
 *
 *   { fraction, updatedAt }                     — always
 *   + cfi                                       — when there is one
 *   + epubVersion                               — only ever alongside a cfi
 *
 * `cfi` is OMITTED rather than written as null: the validator rejects a null-typed child on a
 * closed record, and Firebase strips client nulls anyway, so writing one is two bugs racing.
 *
 * The pin rides with the cfi and never alone. A pin beside no position pins nothing, and an
 * unpinned cfi is exactly the record every surface already knows to read by fraction — so the
 * degraded case is the shipped case, not a new one.
 *
 * @param {object}  o
 * @param {number}  o.fraction  0..1, the position as a share of the book
 * @param {number}  o.updatedAt epoch ms
 * @param {string=} o.cfi       the position itself, if the reader has one
 * @param {string=} o.pin       the version of the FILE this position was taken in
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
 * Three states, and the third is a deliberate asymmetry:
 *
 *   pins match            → true.  Same generation ⇒ same bytes ⇒ the coordinates mean what
 *                                  they said, whichever surface took them.
 *   pins differ, or the
 *   record is pinned and
 *   we never learned our
 *   own version           → false. Covers the copy having been replaced under a reader
 *                                  mid-book, and covers a pin written from some other
 *                                  namespace. Both land on fraction, which is approximate
 *                                  and honest rather than precise and wrong.
 *   no pin on the record  → true.  The status quo, kept ON PURPOSE.
 *
 * That last state is every position stored before this shipped. Discarding them wholesale
 * would demote every returning reader's place to an approximation, once and visibly, to guard
 * a hazard that only bites when the copies actually differ. Each record re-pins itself on its
 * reader's next save, so the unpinned population drains on its own.
 *
 * @param {object|null} record  the value read from bookstore_reading_progress/{uid}/{titleId}
 * @param {string|null} ourPin  the version of the file THIS surface has open
 */
export function cfiIsOurs(record, ourPin) {
  const stored = record?.epubVersion;
  if (typeof stored !== 'string' || !stored) return true;
  return typeof ourPin === 'string' && ourPin === stored;
}
