// READERS' NOTES — the room's view model (W46). Pure: no React, no Firebase, no window, so
// `node --test tests/series-notes/ui/room-model.test.mjs` proves it.
//
// The contract (paths, words, the door's rules, sorting) is app/lib/series/notes.js. This file
// is only the glue the screens need on top of it: which instalment the room is showing, which
// of the four states the reader is in, the filter counts, and the bookkeeping for notes that
// arrive mid-read and notes this reader has just posted.
import { NOTE_KINDS, QUESTION_LABEL, NOTES_COPY, sideOptions, sortNotes, instName } from '../../lib/series/notes.js';
import { isReleased } from '../../lib/series/access.js';

/** The opacity of the light under the door, by doorLight()'s level (the approved canvas). */
export const LIGHT_OPACITY = Object.freeze({ bright: 1, soft: 0.6, faint: 0.3, none: 0 });
export const lightOpacity = (level) => LIGHT_OPACITY[level] ?? 0;

/**
 * Which instalment the room shows. Only a RELEASED, published row can be shown: an `i` naming
 * anything else falls back to the summary's lead, then to the latest released instalment.
 * Returns the row, or null when nothing has been released yet.
 */
export function pickInstalment(rows, wanted, summary, now = Date.now()) {
  const released = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.status === 'published' && isReleased(r, now))
    .sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
  if (!released.length) return null;
  return released.find((r) => r.id === wanted)
    || released.find((r) => r.id === summary?.inst)
    || released[released.length - 1];
}

/** The instalment strip: released instalments only, oldest first. */
export function releasedRows(rows, now = Date.now()) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.status === 'published' && isReleased(r, now))
    .sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
}

/**
 * The four states of §4, in the order they are decided:
 *   'sealed'  — signed out, or signed in and not finished. NO gated read is made.
 *   'joining' — finished, not a member: the three questions (readable once finished).
 *   'open'    — finished and a member: everything.
 * `finished`/`member` are the values read from the reader's own nodes (truthy = present).
 */
export function roomPhase({ user, finished, member }) {
  if (!user) return 'sealed';
  if (!finished) return 'sealed';
  if (!member) return 'joining';
  return 'open';
}

/** The object form of a node of notes, as a list with ids. Drops anything malformed. */
export function listOf(node) {
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node)
    .filter(([, v]) => v && typeof v === 'object' && typeof v.text === 'string')
    .map(([id, v]) => ({ ...v, id }));
}

/** Underline counts per note, and the ids this reader underlined. */
export function underlineCounts(node, uid) {
  const counts = {};
  const mine = new Set();
  for (const [noteId, who] of Object.entries(node && typeof node === 'object' ? node : {})) {
    const uids = Object.keys(who && typeof who === 'object' ? who : {});
    counts[noteId] = uids.length;
    if (uid && uids.includes(uid)) mine.add(noteId);
  }
  return { counts, mine };
}

/** The filter chips' counts: { all, side, sit, line, else }. */
export function kindCounts(notes) {
  const out = { all: 0, side: 0, sit: 0, line: 0, else: 0 };
  for (const n of Array.isArray(notes) ? notes : []) {
    if (!NOTE_KINDS.includes(n?.kind)) continue;
    out.all += 1;
    out[n.kind] += 1;
  }
  return out;
}

/** The list a filter and a sort produce. The writer stays pinned first in every view. */
export function visibleNotes(notes, { filter = 'all', sort = 'underlined', counts = {} } = {}) {
  const list = (Array.isArray(notes) ? notes : []).filter((n) => filter === 'all' || n.kind === filter);
  return sortNotes(list, { by: sort, counts });
}

/**
 * The words above a note: the question it answers (§4).
 * Returns { label, question, quote? } — label in Cinzel, question in italic.
 */
export function noteHeading(note, questions, ordinal) {
  const N = instName(ordinal);
  const q = questions || {};
  switch (note?.kind) {
    case 'side': {
      const opts = Object.fromEntries(sideOptions(q.side));
      const sideText = opts[note.side] || String(note.side || '').toUpperCase();
      return { label: NOTES_COPY.tookASide(sideText), question: q.side?.text || '' };
    }
    case 'sit': return { label: QUESTION_LABEL.sit.toUpperCase(), question: q.sit || '' };
    case 'line': return { label: QUESTION_LABEL.line.toUpperCase(), question: q.line || '', quote: note.line || null };
    default: return { label: QUESTION_LABEL.else.toUpperCase(), question: NOTES_COPY.elseQuestion(N) };
  }
}

/**
 * Notes that arrived since the reader last looked, held back behind the "{n} new notes" pill
 * so nothing moves under their eye. `shownIds` is what is on screen; the reader's own notes are
 * never held back (they appear at once, §6).
 */
export function arrivals(fresh, shownIds, uid) {
  const shown = shownIds instanceof Set ? shownIds : new Set(shownIds || []);
  return (Array.isArray(fresh) ? fresh : []).filter((n) => !shown.has(n.id) && n.uid !== uid);
}

/**
 * The reader's optimistic entries, merged into what the server returned. A pending or failed
 * entry has a temp id (`tmp-…`); once the server answers with the real id it is dropped here,
 * because the real note is in the fresh list (or in the held list, if it was held).
 */
export function mergeLocal(serverNotes, local, heldIds = new Set()) {
  const ids = new Set((serverNotes || []).map((n) => n.id));
  const extra = (local || []).filter((l) => !ids.has(l.id) && !(l.realId && (ids.has(l.realId) || heldIds.has(l.realId))));
  return [...extra, ...(serverNotes || [])];
}

/** The light poll interval while the room is visible (§ experience standards). */
export const POLL_MS = 30_000;

/** The share a reader's side holds, for "You're with {p}% of {n} readers." */
export function shareOf(shares, side) {
  return Number(shares?.[side]) || 0;
}

/** Counts for the sealed room's three questions, from the public summary only. */
export function sealedCounts(summary, inst) {
  const b = summary?.byInst?.[inst] || {};
  const k = b.kinds || {};
  return {
    notes: Number(b.notes) || 0,
    readers: Number(b.readers) || 0,
    side: Number(k.side) || 0,
    sit: Number(k.sit) || 0,
    line: Number(k.line) || 0,
    else: Number(k.else) || 0,
  };
}

/** Whole-series totals for the hero's "{n} notes · {m} readers". */
export function seriesTotals(summary) {
  let notes = 0;
  let readers = 0;
  for (const b of Object.values(summary?.byInst || {})) {
    notes += Number(b?.notes) || 0;
    readers += Number(b?.readers) || 0;
  }
  return { notes, readers };
}

/** A note's author as squareIdentity.identityOf() expects a post, from the stored snapshot. */
export function asPost(note) {
  const a = note?.author || {};
  return {
    authorUid: note?.uid,
    authorName: a.name || null,
    authorHandle: a.handle || null,
    authorAvatarUrl: a.photoURL || null,
    authorReadCount: Number(a.badge) || 0,
    // W49 §7 — the snapshot's own isAuthor (the endpoint stores it since W49), so a writer whose
    // record is gone falls back to the Writer badge.
    isAuthor: note?.writer === true || a.isAuthor === true,
  };
}

/**
 * W48 §2 — what follows the name on a note's or a reply's author line. The series' own writer, on
 * their own series, keeps the room's WRITER mark (ruling 163). Everyone else gets the Square's
 * UserBadge, fed exactly what the Square feeds it: the identity's live read count and its own
 * isAuthor, so a writer shows the Square's Writer badge here too. `id` is identityOf()'s result.
 */
export function authorMark(note, id) {
  if (note?.writer === true) return { mark: 'writer' };
  return { mark: 'badge', readCount: id?.readCount || 0, isAuthor: id?.isAuthor === true };
}

/** The progress rule's percent: floored, never 100 while unfinished (the house bar's rule). */
export function progressPercent(fraction) {
  const f = Number(fraction);
  if (!Number.isFinite(f) || f <= 0) return 0;
  return Math.min(99, Math.max(1, Math.floor(f * 100)));
}
