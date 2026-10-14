// READERS' NOTES — the browser's half of the contract (W46). Every read and write a web surface
// makes goes through here, so the door, the room, the sheet and the admin cannot each invent a
// path. The paths and the words are app/lib/series/notes.js; the rules that judge these calls
// are database.rules.json; the written contract is docs/series-notes.md.
//
// Two kinds of call:
//   · DIRECT, judged by the rules: finished, margin, underline, report, and every read.
//   · ENDPOINT, POST /api/series/notes with the reader's ID token: side, note, reply, remove,
//     and the founders' review / draft-questions / publish-questions.
import { ref, get, set, remove, serverTimestamp, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '../firebase';
import { NOTES_PATHS as P, NOTES_ERRORS } from './notes.js';

export class NotesError extends Error {
  constructor(message, code, status = 0, extra = {}) {
    super(message);
    this.name = 'NotesError';
    this.code = code || 'unavailable';
    this.status = status;
    this.retryAfter = typeof extra.retryAfter === 'number' ? extra.retryAfter : null;
  }
}

/** One endpoint call. Throws NotesError with words a reader can act on. */
export async function notesAction(user, body) {
  if (!user) throw new NotesError('Sign in first.', 'signed_out', 401);
  let idToken;
  try { idToken = await user.getIdToken(); }
  catch { throw new NotesError('Your session has expired. Please sign in again.', 'signed_out', 401); }
  let res;
  try {
    res = await fetch('/api/series/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NotesError('No connection. Please check your network and try again.', 'offline', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const code = data?.code || (res.status === 401 ? 'signed_out' : 'unavailable');
    throw new NotesError(data?.error || NOTES_ERRORS[code] || NOTES_ERRORS.unavailable, code, res.status, data || {});
  }
  return data;
}

const val = async (path) => {
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
};
/** A read the rules may refuse: null instead of a throw, so a sealed room renders sealed. */
const maybe = async (path) => {
  try { return await val(path); } catch { return null; }
};

// ── public ──────────────────────────────────────────────────────────────────────────────────
export const readSummary = (sid) => val(`${P.summary}/${sid}`);
export const readPublicQuestion = (inst) => val(`${P.questionsPublic}/${inst}`);
export async function readPublicQuestions(insts) {
  const out = {};
  await Promise.all((insts || []).map(async (i) => {
    const q = await readPublicQuestion(i).catch(() => null);
    if (q?.sit) out[i] = q.sit;
  }));
  return out;
}

// ── the reader's own ────────────────────────────────────────────────────────────────────────
export const readFinished = (uid, inst) => maybe(`${P.finished}/${uid}/${inst}`);
export const readMember = (uid, inst) => maybe(`${P.members}/${inst}/${uid}`);
export const readMySide = (uid, inst) => maybe(`${P.sides}/${inst}/${uid}`);
export const readMargin = (uid, inst) => maybe(`${P.margin}/${uid}/${inst}`);

/** Written on reaching the last page, before the sheet rises (§5). Server clock. */
export function markFinished(uid, inst) {
  return set(ref(db, `${P.finished}/${uid}/${inst}`), serverTimestamp());
}

/** "This is my line" — private until posted. */
export function saveMargin(uid, inst, { text, cfi, epubVersion }) {
  return set(ref(db, `${P.margin}/${uid}/${inst}`), { text, cfi, epubVersion, savedAt: serverTimestamp() });
}

// ── gated (finished; and for notes, a member) ───────────────────────────────────────────────
export const readQuestions = (inst) => maybe(`${P.questions}/${inst}`);
export const readTallies = (inst) => maybe(`${P.tallies}/${inst}`);
export const readNotes = (inst) => maybe(`${P.notes}/${inst}`);
export const readReplies = (inst) => maybe(`${P.replies}/${inst}`);
export const readUnderlines = (inst) => maybe(`${P.underlines}/${inst}`);

/** The reader's own held notes — the rules allow exactly this query and no other. */
export async function readMyHeld(uid, inst) {
  try {
    const snap = await get(query(ref(db, `${P.held}/${inst}`), orderByChild('uid'), equalTo(uid)));
    return snap.exists() ? snap.val() : {};
  } catch { return {}; }
}

export function setUnderline(uid, inst, noteId, on) {
  const r = ref(db, `${P.underlines}/${inst}/${noteId}/${uid}`);
  return on ? set(r, true) : remove(r);
}

export function reportNote(uid, inst, noteId, reason) {
  const body = { at: Date.now() };
  if (typeof reason === 'string' && reason.trim()) body.reason = reason.trim().slice(0, 200);
  return set(ref(db, `${P.reports}/${inst}/${noteId}/${uid}`), body);
}

// ── device-kept: drafts per question, the last visit per series ─────────────────────────────
const store = () => { try { return window.localStorage; } catch { return null; } };
export const draftKey = (inst, kind) => `cs_note_draft_${inst}_${kind}`;
export function loadDraft(inst, kind) { try { return store()?.getItem(draftKey(inst, kind)) || ''; } catch { return ''; } }
export function saveDraft(inst, kind, text) {
  try { if (text) store()?.setItem(draftKey(inst, kind), text); else store()?.removeItem(draftKey(inst, kind)); } catch { /* private window */ }
}
export function readLocal(key) { try { const v = store()?.getItem(key); return v == null ? null : v; } catch { return null; } }
export function writeLocal(key, v) { try { store()?.setItem(key, String(v)); } catch { /* private window */ } }
