// DELETING AN INSTALMENT — the plan, as a pure function.
//
// Deliberately the shape of app/lib/bookstore/withdrawal.js:deletionPlan(): the DECISION about
// what is removed is a pure function over a record, and the WRITER (admin-writes.js) only
// executes what this returns. The bookstore's reason was that "the master is not deleted if
// anyone owns the book" is a ruling, and a ruling that lives inside an async function that
// also talks to Storage cannot be tested without mocking the bucket. The same holds here, and
// the Series adds a second reason: the interesting half of this plan is what it REFUSES to
// touch, and a refusal is only ever provable against a function you can call.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE FOUR RULINGS THIS FUNCTION ENCODES (R31, 31 Aug 2026)
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// 1. NOTHING IS HELD BACK, BECAUSE NOBODY OWNS AN INSTALMENT.
//
//    The bookstore holds the master when a purchase exists — deletionPlan() never puts an
//    owned master in a delete list, and its suite fails if it ever does. That precedent has
//    no analogue here and the absence is the answer rather than an oversight: there is no
//    series_purchases node, nothing durable is ever handed to a reader (the only path to the
//    bytes is a ~300-second signed URL from functions/api/series/stream.js), and a Platinum
//    membership is a subscription to a shelf, not a title someone bought. So the EPUB goes.
//    If instalments are ever sold individually, THIS is the function that has to learn about
//    it, and the bookstore's is the shape to copy.
//
// 2. THE ORDINAL GAP IS PERMANENT, AND NOT-RENUMBERING IS NOT ENOUGH TO HOLD IT.
//
//    Deleting instalment 3 leaves 4 as 4 — the same principle as the shop's catalogue
//    numbers, which are accession marks and are expected to have gaps. But an instalment's
//    KEY is derived from its ordinal (instalmentId(slug, ordinal) → 'beta-princess-i3') and
//    the admin's next-ordinal is max(existing) + 1. Delete the highest instalment and the very
//    next create silently reissues the same id. That is a reuse wearing a gap's clothes.
//
//    So the plan writes a TOMBSTONE. createInstalment() refuses a tombstoned id and the admin
//    counts tombstones when it proposes the next ordinal. A number that has been issued is
//    never issued twice.
//
// 3. A READER'S SAVED POSITION IS NOT TOUCHED — IT CANNOT BE, AND THE TOMBSTONE IS WHY THAT
//    IS SAFE RATHER THAN MERELY UNAVOIDABLE.
//
//    series_reading_progress/{uid}/{instalmentId} is `auth.uid == $uid` for BOTH read and
//    write. An admin has no permission to that node, for anyone but themselves, and granting
//    one to service a delete would be a far larger change than a delete button. So an orphaned
//    position is a fact of the design, not a choice this function is making.
//
//    On its own an orphan is inert: nothing lists it and the page it indexes no longer exists.
//    It stops being inert the moment an id is reused, and the damage would be quiet. The pin
//    defends the CFI — a replacement file has a new GCS generation, cfiIsOurs() returns false,
//    the reader falls back to fraction — but NOTHING DEFENDS THE FRACTION. A reader 60% through
//    the old instalment 3 would open the new instalment 3 and be dropped 60% into a story they
//    have never read, with no error and nothing in the record to say so. Ruling 2 is what makes
//    that unreachable.
//
//    ⚠ This is NOT the lapse ruling (30 Aug) inherited. That one says progress survives a loss
//    of access, and it presumes the work still exists to come back to. Deletion is the case
//    where it does not, and its answer is its own: the position stays where it is, and the key
//    it points at is burned so nothing can ever occupy it again.
//
// 4. THE COVERS ARE LISTED, NOT DERIVED, AND THE PLAN SAYS SO.
//
//    uploadSeriesImage() writes `series_covers/{key}/{Date.now()}-{file.name}`. The object
//    name is not recoverable from the record — detail.coverUrl is a tokenised download URL,
//    not a path — so the plan returns PREFIXES for the caller to enumerate, and a single
//    exact objectPath only for the EPUB, whose path epubObjectPath() defines. Returning a
//    guessed cover path would delete nothing and report success.

import { epubObjectPath, instalmentImageKey } from './schema.js';

/**
 * What deleting `id` removes.
 *
 *   deletionPlan({ id, seriesId, ordinal })
 *     → { dbPaths, epubPath, storagePrefixes, tombstonePath, tombstone, spared }
 *
 * `dbPaths` are RTDB paths to null out, `epubPath` is one exact object, `storagePrefixes` are
 * folders to enumerate and empty, and `spared` names what is deliberately left alone so a
 * reader of a log — or of a test — can see the refusal rather than infer it from an absence.
 *
 * PURE. It reads nothing, writes nothing and takes no clock it was not handed, so the suite
 * can assert the whole shape including the negative half.
 */
export function deletionPlan({ id, seriesId, ordinal, now = Date.now() } = {}) {
  if (!id || typeof id !== 'string') throw new Error('deletionPlan: id is required');
  if (!seriesId || typeof seriesId !== 'string') throw new Error('deletionPlan: seriesId is required');
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error('deletionPlan: ordinal must be a positive integer');

  return {
    // The row and the detail, together — the same pairing createInstalment() and
    // updateInstalment() write, and for the same reason: they are two visibilities of one
    // thing and a half-deleted instalment is worse than either state. RTDB applies a
    // multi-path update atomically, so nulling both in one call is all-or-nothing.
    dbPaths: [
      `series_instalments/${id}`,
      `series_instalments_detail/${id}`,
    ],

    // Exactly one object, at the path epubObjectPath() defines. Not read from detail.epubPath:
    // that field is RECORDED, never authoritative (see the schema note), and a delete that
    // trusted it would miss a file whenever the record and the bucket had drifted — which is
    // the one moment a delete is most needed.
    epubPath: epubObjectPath(id),

    // Enumerate-and-empty. See ruling 4.
    storagePrefixes: [
      `series_covers/${instalmentImageKey(id, 'cover')}`,
      `series_covers/${instalmentImageKey(id, 'sponsor')}`,
    ],

    tombstonePath: `series_instalments_deleted/${id}`,
    tombstone: { seriesId, ordinal, deletedAt: now },

    // Named, not merely absent. See rulings 1 and 3.
    spared: [
      'series_reading_progress/{uid}/' + id,
      `series/${seriesId}`,
    ],
  };
}

/**
 * The next free ordinal for a series, counting the dead.
 *
 * `max(live, tombstoned) + 1`, and the tombstoned half is the whole point. Without it,
 * deleting the highest instalment hands the next create the id that was just burned — see
 * ruling 2. Takes rows and tombstones in any shape a caller has them, so the admin can pass
 * an RTDB snapshot's `{ id: row }` object straight in.
 */
export function nextFreeOrdinal(rows, tombstones) {
  const ords = [...toList(rows), ...toList(tombstones)]
    .map((r) => (Number.isInteger(r?.ordinal) ? r.ordinal : 0));
  return Math.max(0, ...ords) + 1;
}

/** Is this id burned? A create must refuse it whatever ordinal the editor typed. */
export function isTombstoned(tombstones, id) {
  if (!id) return false;
  if (Array.isArray(tombstones)) return tombstones.some((t) => t?.id === id);
  return !!(tombstones && Object.prototype.hasOwnProperty.call(tombstones, id));
}

function toList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return Object.entries(v || {}).map(([id, r]) => ({ id, ...(r || {}) }));
}
