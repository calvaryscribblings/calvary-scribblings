'use client';
// THE LIVE DESIDERATA — one listener per signed-in reader, shared by every surface on the page.
//
// W22 §4: "While signed in, keep one listener on desiderata/{uid}, so the shelf, the page, the
// room and a second tab all agree." The shelf's hundred-odd +s, the book page's + and the
// Desiderata room all read this ONE module store; none of them opens a listener of its own.
//
// Beside it sits a second listener, on the reader's own bookstore_purchases/{uid}: "owned" is
// holdsBook (sales and comps alike), and a book bought in another tab must lose its + here too.
//
// THE CHANGE IS OPTIMISTIC. A tap flips the ring at once through an OVERLAY, and the write
// follows. When the write lands, the listener carries the same fact and the overlay entry is
// dropped; when it is refused, the overlay entry is dropped anyway — so the ring changes back
// by itself — and the house toast says so.
//
// The pure rules (which state, which rows, which words) are in ./desiderata.js.

import { useEffect, useSyncExternalStore } from 'react';
import { ref, onValue, set, remove, update, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { holdsBook } from './purchaseSource';
import { showToast, dismissToast } from '../saveToast';
import { DESIDERATA_PATH, DESIDERATA_COPY, PENDING_KEY, readPending } from './desiderata';

const SIGNED_OUT = Object.freeze({ uid: null, status: 'signed-out', entries: Object.freeze({}), owned: new Set() });
const LOADING = Object.freeze({ uid: null, status: 'loading', entries: Object.freeze({}), owned: new Set() });

let uid = null;
let entries = null;        // null until the first answer
let owned = null;          // Set, null until the first answer
let overlay = new Map();   // titleId → { addedAt } (added) | null (removed)
let unsubs = [];
let view = LOADING;
const listeners = new Set();

function recompute() {
  if (!uid) { view = SIGNED_OUT; }
  else if (entries === null || owned === null) { view = { ...LOADING, uid }; }
  else {
    const merged = { ...entries };
    for (const [t, v] of overlay) { if (v === null) delete merged[t]; else merged[t] = v; }
    view = { uid, status: 'ready', entries: merged, owned };
  }
  for (const fn of listeners) fn();
  if (view.status === 'ready') resolvePending();
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const getView = () => view;
const getServerView = () => LOADING;

/** Point the store at a reader (or at nobody). Idempotent; called by every hook's effect. */
export function attachDesiderata(nextUid) {
  if (nextUid === uid && (nextUid === null ? view === SIGNED_OUT : unsubs.length)) return;
  for (const u of unsubs) { try { u(); } catch { /* already gone */ } }
  unsubs = [];
  uid = nextUid || null;
  entries = null; owned = null; overlay = new Map();
  if (!uid) { recompute(); return; }
  const me = uid;
  recompute();
  unsubs.push(onValue(ref(db, `${DESIDERATA_PATH}/${me}`), (snap) => {
    if (uid !== me) return;
    entries = snap.val() || {};
    // An overlay entry the server now agrees with has done its job.
    for (const [t, v] of overlay) if ((v === null) === !(t in entries)) overlay.delete(t);
    recompute();
  }, (err) => {
    console.error('[desiderata] listener failed', err);
    if (uid === me) { entries = {}; recompute(); }
  }));
  unsubs.push(onValue(ref(db, `bookstore_purchases/${me}`), (snap) => {
    if (uid !== me) return;
    const s = new Set();
    for (const [t, rec] of Object.entries(snap.val() || {})) if (holdsBook(rec)) s.add(t);
    owned = s;
    recompute();
  }, (err) => {
    // Unknown ownership draws no + rather than a + on a book the reader may own — an extra
    // tap on a held book adds nothing (see addToDesiderata), but the quieter failure is right.
    console.error('[desiderata] purchases listener failed', err);
    if (uid === me) { owned = new Set(); recompute(); }
  }));
}

/** The store, for a component. `enabled: false` (the CMS preview) attaches nothing. */
export function useDesiderata({ enabled = true } = {}) {
  const { user, loading } = useAuth();
  const nextUid = user?.uid || null;
  useEffect(() => {
    if (!enabled || loading) return;
    attachDesiderata(nextUid);
  }, [enabled, loading, nextUid]);
  const v = useSyncExternalStore(subscribe, getView, getServerView);
  if (!enabled) return { ...SIGNED_OUT, status: 'preview', user: null };
  if (loading) return { ...LOADING, user: null };
  // Between a sign-in and the effect that attaches, the store still describes the old reader.
  if ((v.uid || null) !== nextUid) return { ...(nextUid ? LOADING : SIGNED_OUT), user };
  return { ...v, user };
}

// ── WRITES ─────────────────────────────────────────────────────────────────────────────────

function refused(err) {
  console.error('[desiderata] write refused', err);
  showToast({ message: DESIDERATA_COPY.failed });
}

/** Add, optimistically. A held book is never added (ruling 76). */
export function addToDesiderata(titleId) {
  if (!uid || !titleId || view.status !== 'ready') return;
  if (view.owned.has(titleId) || titleId in view.entries) return;
  const me = uid;
  overlay.set(titleId, { addedAt: Date.now() });
  recompute();
  showToast({ message: DESIDERATA_COPY.added });
  set(ref(db, `${DESIDERATA_PATH}/${me}/${titleId}`), { addedAt: serverTimestamp() })
    .catch((err) => { if (uid === me) { overlay.delete(titleId); recompute(); } refused(err); });
}

/** Remove, optimistically, with Undo — which puts back the ORIGINAL addedAt. */
export function removeFromDesiderata(titleId) {
  if (!uid || !titleId || view.status !== 'ready' || !(titleId in view.entries)) return;
  const me = uid;
  const addedAt = Number(view.entries[titleId]?.addedAt) || null;
  overlay.set(titleId, null);
  recompute();
  const id = showToast({
    message: DESIDERATA_COPY.removed,
    action: {
      label: DESIDERATA_COPY.undo,
      onClick: () => {
        dismissToast(id);
        if (uid !== me || !addedAt) return;
        overlay.set(titleId, { addedAt });
        recompute();
        set(ref(db, `${DESIDERATA_PATH}/${me}/${titleId}`), { addedAt })
          .catch((err) => { if (uid === me) { overlay.delete(titleId); recompute(); } refused(err); });
      },
    },
  });
  remove(ref(db, `${DESIDERATA_PATH}/${me}/${titleId}`))
    .catch((err) => { if (uid === me) { overlay.delete(titleId); recompute(); } refused(err); });
}

/** The room's quiet clean-up: entries for books the reader now holds. No toast, no overlay. */
export function sweepDesiderata(titleIds) {
  if (!uid || !titleIds?.length) return;
  const u = {};
  for (const t of titleIds) u[`${DESIDERATA_PATH}/${uid}/${t}`] = null;
  update(ref(db), u).catch((err) => console.error('[desiderata] sweep failed', err));
}

// ── THE WAITING ADD (signed out → AuthModal → signed in) ───────────────────────────────────

let pendingMemo = null;

/** Remember the book a signed-out reader tapped. */
export function rememberPendingAdd(titleId) {
  pendingMemo = JSON.stringify({ titleId, at: Date.now() });
  try { sessionStorage.setItem(PENDING_KEY, pendingMemo); } catch { /* private mode */ }
}

function takePending() {
  let raw = null;
  try { raw = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch { /* private mode */ }
  // The memo is the same record, for a browser whose storage throws; both carry the TTL.
  const t = readPending(raw, Date.now()) || readPending(pendingMemo, Date.now());
  pendingMemo = null;
  return t;
}

function resolvePending() {
  if (!pendingMemo) {
    let has = false;
    try { has = !!sessionStorage.getItem(PENDING_KEY); } catch { /* private mode */ }
    if (!has) return;
  }
  const t = takePending();
  // In their library already: nothing is added, and nothing is said.
  if (t && !view.owned.has(t) && !(t in view.entries)) addToDesiderata(t);
}
