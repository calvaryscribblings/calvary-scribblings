// READERS' NOTES — THE ADMIN'S PURE HALF (W46 §7).
//
// The instalment screen's "Readers' Notes" section edits three question slots and reviews held
// and reported notes. Everything here is a pure function of plain data, so `node --test`
// (tests/series-notes/admin/model.test.mjs) proves it without a browser. The words and the
// readiness rules are app/lib/series/notes.js, never restated here.
import {
  SIDE_OPTIONS, SIDE_MIN, SIDE_MAX, COUNTER_FROM, QUESTION_KINDS, slotReady, readyCount,
} from '../../lib/series/notes.js';

const str = (v) => (typeof v === 'string' ? v : '');
const clean = (v) => str(v).replace(/\s+/g, ' ').trim();

/** The slots as the form holds them. Options are a list, so add/remove never leaves a gap. */
export const EMPTY_SLOTS = Object.freeze({ sit: '', side: { text: '', options: ['', ''] }, line: '' });

/**
 * series_question_drafts/{inst} (or series_questions/{inst}) → the form's slots. Options are
 * read in key order a..d and only as far as the last one present, so a stored gap (a, b, d)
 * shows as an empty third field for the editor to fill or remove, never as a silent shift.
 */
export function slotsFrom(node) {
  const n = node && typeof node === 'object' ? node : {};
  const o = n.side && typeof n.side.options === 'object' && n.side.options ? n.side.options : {};
  let last = -1;
  SIDE_OPTIONS.forEach((k, i) => { if (typeof o[k] === 'string') last = i; });
  const options = SIDE_OPTIONS.slice(0, Math.max(last + 1, SIDE_MIN)).map((k) => str(o[k]));
  return { sit: str(n.sit), side: { text: str(n.side?.text), options }, line: str(n.line) };
}

/**
 * The form's slots → the fields a draft save writes. Keys stay contiguous a..d whatever the
 * editor removed. The caller writes these with update(), so `side` is replaced whole (a removed
 * option goes with it) and the endpoint's draftedAt / model survive beside them.
 */
export function draftFields(slots) {
  const s = slots || EMPTY_SLOTS;
  const list = Array.isArray(s.side?.options) ? s.side.options.slice(0, SIDE_MAX) : [];
  const options = Object.fromEntries(list.map((v, i) => [SIDE_OPTIONS[i], str(v)]));
  return { sit: str(s.sit), side: { text: str(s.side?.text), options }, line: str(s.line) };
}

/** Readiness through the contract's own rule. */
export const slotsReady = (slots) => readyCount(draftFields(slots));
export const slotIsReady = (kind, slots) => slotReady(kind, draftFields(slots)[kind]);

export function addOption(options) {
  const list = Array.isArray(options) ? options.slice() : [];
  return list.length >= SIDE_MAX ? list : [...list, ''];
}
export function removeOption(options, index) {
  const list = Array.isArray(options) ? options.slice() : [];
  if (list.length <= SIDE_MIN || index < 0 || index >= list.length) return list;
  list.splice(index, 1);
  return list;
}

/** Nothing typed in any slot — "Draft three" can fill without asking. */
export function slotsEmpty(slots) {
  const f = draftFields(slots);
  return !clean(f.sit) && !clean(f.line) && !clean(f.side.text) && Object.values(f.side.options).every((v) => !clean(v));
}

/** Two sets of questions say the same thing (whitespace aside; timestamps ignored). */
export function sameQuestions(a, b) {
  const x = draftFields(slotsFrom(a));
  const y = draftFields(slotsFrom(b));
  const opts = (f) => SIDE_OPTIONS.map((k) => clean(f.side.options[k])).join('\u0001');
  return QUESTION_KINDS.every((k) => (k === 'side'
    ? clean(x.side.text) === clean(y.side.text) && opts(x) === opts(y)
    : clean(x[k]) === clean(y[k])));
}

/**
 * Where the questions stand: 'none' (never published), 'published' (live matches the form),
 * 'changed' (live differs from the form: "Unpublished changes").
 */
export function publishState(slots, live) {
  if (!live || typeof live !== 'object' || !live.publishedAt) return 'none';
  return sameQuestions(draftFields(slots), live) ? 'published' : 'changed';
}

/** The counter shows only near the limit. */
export function counter(text, max) {
  const n = Array.from(str(text)).length;
  if (n < Math.ceil(max * COUNTER_FROM)) return null;
  return { text: `${n} / ${max}`, over: n > max };
}

/**
 * The review list for one instalment. Held notes (screening flagged them) offer Approve and
 * Remove; reported live notes offer Remove and Dismiss. Newest first. The author's name is
 * carried for the admin screen only — it is never written anywhere else.
 */
export function reviewItems({ held = null, reports = null, notes = null } = {}) {
  const out = [];
  for (const [noteId, n] of Object.entries(held || {})) {
    if (!n || typeof n !== 'object') continue;
    out.push({
      key: `held:${noteId}`, noteId, source: 'held', kind: str(n.kind) || 'else', text: str(n.text),
      reason: str(n.reason) || 'other', reportCount: 0, reasons: [], at: Number(n.createdAt) || 0,
      authorName: clean(n.author?.name) || 'Reader', decisions: ['approve', 'remove'],
    });
  }
  for (const [noteId, byUid] of Object.entries(reports || {})) {
    if (!byUid || typeof byUid !== 'object') continue;
    const list = Object.values(byUid).filter((r) => r && typeof r === 'object');
    if (!list.length) continue;
    const n = notes && notes[noteId];
    const latest = list.reduce((m, r) => Math.max(m, Number(r.at) || 0), 0);
    out.push({
      key: `reported:${noteId}`, noteId, source: 'reported', kind: str(n?.kind) || 'else',
      text: n ? str(n.text) : '', gone: !n, reason: null, reportCount: list.length,
      reasons: list.map((r) => clean(r.reason)).filter(Boolean),
      at: Number(n?.createdAt) || latest, reportedAt: latest,
      authorName: clean(n?.author?.name) || 'Reader', decisions: ['remove', 'dismiss'],
    });
  }
  return out.sort((a, b) => (b.source === 'reported' ? b.reportedAt : b.at) - (a.source === 'reported' ? a.reportedAt : a.at)
    || a.key.localeCompare(b.key));
}

/** The reasons screening holds a note for, in the admin's words. */
export const HELD_REASON = Object.freeze({
  abuse: 'Abuse', hate: 'Hate', threat: 'A threat', sexual: 'Sexual content',
  'personal-data': 'Personal data', spam: 'Spam', other: 'Something else',
});
export const DECISION_LABEL = Object.freeze({ approve: 'Approve', remove: 'Remove', dismiss: 'Dismiss' });
