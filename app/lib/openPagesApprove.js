// LIVE-PATHS-2 — the admin queue's two actions on a pending Open Pages record, Approve and Reject.
//
// THE HOLE. A pending record's key is the key it will be published under. Before this file the
// queue wrote open_pages_pending/<id> wholesale over open_pages/<id> without looking at what was
// there, and "Remove" on a flagged item nulled open_pages/<id> as well as the pending record. A
// reader holds create on open_pages_pending/<their own key>, so a pending record keyed at a live
// piece meant:
//   · Approve wrote it over the live piece. The open_pages/$postId .validate (authorUid must not
//     change) refused this when the authors differ, so this half was already closed by the rules.
//   · Remove deleted the live piece. Nothing refused that: a delete passes every .validate. And
//     the honest case did it too: rejecting a flagged REVISION (moderate.js files an edit that
//     the screen flags under the live piece's own id) deleted the author's original piece.
//
// THE CHOICE: check-before-write, not a server-assigned key.
// A server-assigned key would mean taking create on open_pages_pending away from readers, so
// only moderate.js (which mints push ids) could file a pending record. Nothing on the web writes
// there, but the shipping app might, and its source can't be read from this repo. A client that
// files with push() always gets a fresh key, so the check refuses nothing an honest client
// sends, from either codebase, and still closes the hole at both ends:
//   1. the rules refuse a reader's pending write at a key that is live in open_pages;
//   2. Approve runs as a TRANSACTION on open_pages/<id>, so the check and the write are one
//      compare-and-set: it writes only when nothing is live there and this is a new piece, or
//      the live piece is the same author's and this record is a revision of it;
//   3. Reject removes the pending record and nothing else. A live piece is removed only from
//      the Reported tab, where the row IS the live piece.

export class ApprovalRefused extends Error {}

const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** Why `pending` may not be written over `live` (the value now at open_pages/<id>), or null. */
export function approvalRefusal(live, pending) {
  const author = pending && typeof pending.authorUid === 'string' ? pending.authorUid : '';
  if (!author) return "This record has no author, so it can't be published. Nothing was approved.";
  const isRevision = pending.revision === true;
  if (live === null || live === undefined) {
    return isRevision
      ? 'This is an edit to a piece that is no longer live. Nothing was approved.'
      : null;
  }
  if (live.authorUid !== author) {
    return "Another author's piece is live at this address. Nothing was approved.";
  }
  if (!isRevision) {
    return "A piece is already live at this address, and this record isn't an edit of it. Nothing was approved.";
  }
  return null;
}

/** The record as it will be published: the queue marker dropped, the approval stamped. */
export function approvedRecord(pending, live, approverUid, now) {
  const { revision, id: _storedId, ...rest } = pending; // the key is the id; a stored `id` never is
  const record = { ...rest, status: 'live', approvedBy: approverUid, approvedAt: now };
  // A revision carries the readCount the piece had when it was filed. Reads land on the live
  // piece while it waits, so the live count wins (the counter only goes up).
  if (revision === true && live && typeof live.readCount === 'number') {
    record.readCount = Math.max(live.readCount, typeof record.readCount === 'number' ? record.readCount : 0);
  }
  return record;
}

/**
 * Approve open_pages_pending/<id>. `fb` is { ref, runTransaction, update } from firebase/database.
 * Throws ApprovalRefused (nothing written) when the check fails. Returns { wasRevision }.
 */
export async function approvePending({ db, fb, id, pending, approverUid, now = Date.now() }) {
  if (typeof id !== 'string' || !SAFE_KEY.test(id)) throw new ApprovalRefused('Not a post id. Nothing was approved.');
  if (!pending || typeof pending !== 'object') throw new ApprovalRefused('Nothing to approve.');
  let refusal = null;
  const tx = await fb.runTransaction(fb.ref(db, `open_pages/${id}`), (live) => {
    refusal = approvalRefusal(live, pending);
    // On an EMPTY value never abort (`undefined`): the first pass sees the local cache, which is
    // usually empty, and an abort there would never ask the server. Returning null on null is a
    // no-op the server accepts only if the path is still empty; otherwise it re-runs this with
    // the real value. On a non-empty value a refusal aborts, and nothing is written.
    if (refusal) return live === null || live === undefined ? null : undefined;
    return approvedRecord(pending, live, approverUid, now);
  }, { applyLocally: false });
  if (refusal) throw new ApprovalRefused(refusal);
  if (!tx.committed) throw new ApprovalRefused('The piece changed while this was being approved. Refresh and try again.');
  const written = tx.snapshot.val();
  const tidy = {
    [`open_pages_pending/${id}`]: null,
    // Approving settles any reader reports on the post too; leaving them would re-surface it in
    // the Reported tab just cleared.
    [`open_pages_reports/${id}`]: null,
  };
  if (written && written.authorUid) tidy[`user_open_pages/${written.authorUid}/${id}`] = written;
  await fb.update(fb.ref(db), tidy);
  return { wasRevision: pending.revision === true };
}

/** Reject a pending record: the record goes, and nothing else. A live piece is never touched. */
export async function rejectPending({ db, fb, id }) {
  if (typeof id !== 'string' || !SAFE_KEY.test(id)) throw new ApprovalRefused('Not a post id. Nothing was removed.');
  await fb.update(fb.ref(db), { [`open_pages_pending/${id}`]: null });
}
