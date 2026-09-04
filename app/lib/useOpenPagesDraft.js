'use client';

// Open Pages — the drafts hook (R37). Device first, synced when signed in.
//
// The composer hands this its live content and gets back a slot, a status, and any
// notice the writer has to be told about. Everything it decides lives in
// openPagesDrafts.js (pure) and openPagesDraftStore.js (mechanics); this file is the
// timing and the React.
//
// ⚠ IT NEVER CALLS THE MODERATION FUNCTION. A draft is not published. Screening happens
// at publish, and R36's rate limiter counts submissions, not saves.

import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from './firebase';
import {
  LOCAL_DEBOUNCE_MS, REMOTE_DEBOUNCE_MS, REMOTE_MAX_WAIT_MS,
  buildDraft, draftIsEmpty, draftLabel, capNotice, forkNotice, oversizeNotice,
} from './openPagesDrafts';
import {
  readLocal, writeLocal, readSyncedRevs, writeSyncedRevs, deviceId,
  oversizeReason, planSync, allocateSlot, pruneEmpty, draftPath,
} from './openPagesDraftStore';

const NO_STORAGE = 'This browser is not storing anything, so your work is only in this tab. Copy it somewhere before you close it.';

export function useOpenPagesDraft({ uid, title, body, genre, coverImage, enabled = true }) {
  const [slot, setSlot] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [status, setStatus] = useState('idle');   // idle | saving | saved | local-only
  const [notice, setNotice] = useState(null);
  const [ready, setReady] = useState(false);

  const localTimer = useRef(null);
  const remoteTimer = useRef(null);
  const remoteFloor = useRef(0);       // when the forced sync is due
  const content = useRef({ title, body, genre, coverImage });
  const slotRef = useRef(null);
  const revRef = useRef(0);
  const createdRef = useRef(null);
  const device = useRef('nodevice');

  content.current = { title, body, genre, coverImage };
  slotRef.current = slot;

  // ---- Load: read the device copy, then reconcile with the database. ----------
  useEffect(() => {
    if (!enabled) return;
    device.current = deviceId();
    const local = pruneEmpty(readLocal(uid));
    setDrafts(local);
    setReady(true);
    if (!uid) return;

    let cancelled = false;
    (async () => {
      try {
        const { ref, get, set } = await import('firebase/database');
        const snap = await get(ref(db, `open_pages_drafts/${uid}`));
        if (cancelled) return;
        const remote = snap.exists() ? (snap.val() || {}) : {};
        const plan = planSync(local, remote, readSyncedRevs(uid));

        // Push whatever the database is missing or behind on, forks included.
        for (const s of new Set(plan.pushed)) {
          const d = plan.merged[s];
          if (d && !oversizeReason(d)) {
            try { await set(ref(db, draftPath(uid, s)), d); } catch { /* best effort */ }
          }
        }
        if (cancelled) return;
        writeLocal(uid, plan.merged);
        writeSyncedRevs(uid, plan.revs);
        setDrafts(plan.merged);

        // ⚠ NEVER SILENT. A fork is words the writer might not know still exist.
        if (plan.forks.length) {
          const f = plan.forks[0];
          setNotice({ kind: 'fork', message: forkNotice(draftLabel(f.draft)), slot: f.to });
        } else if (plan.capReached) {
          setNotice({ kind: 'cap', message: capNotice() });
        }
      } catch (e) {
        console.warn('[open-pages/drafts] sync failed; the device copy stands:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, enabled]);

  // ---- The two writes. Local is the guarantee; remote is the convenience. ------
  const saveLocal = useCallback((targetSlot) => {
    if (!targetSlot) return;
    const d = buildDraft(content.current, {
      now: Date.now(), deviceId: device.current,
      rev: ++revRef.current, createdAt: createdRef.current ?? Date.now(),
    });
    createdRef.current = d.createdAt;
    setDrafts((cur) => {
      const next = draftIsEmpty(d) ? (() => { const c = { ...cur }; delete c[targetSlot]; return c; })()
                                   : { ...cur, [targetSlot]: d };
      const ok = writeLocal(uid, next);
      setStatus(ok ? 'saved' : 'local-only');
      if (!ok) setNotice({ kind: 'nostorage', message: NO_STORAGE });
      return next;
    });
  }, [uid]);

  const saveRemote = useCallback(async (targetSlot) => {
    if (!uid || !targetSlot) return;
    const d = readLocal(uid)[targetSlot];
    try {
      const { ref, set, remove } = await import('firebase/database');
      if (!d || draftIsEmpty(d)) { await remove(ref(db, draftPath(uid, targetSlot))); return; }
      const why = oversizeReason(d);
      if (why) { setNotice({ kind: 'oversize', message: oversizeNotice() }); return; }
      setStatus('saving');
      await set(ref(db, draftPath(uid, targetSlot)), d);
      const revs = readSyncedRevs(uid); revs[targetSlot] = d.rev || 0; writeSyncedRevs(uid, revs);
      setStatus('saved');
    } catch (e) {
      // The device copy already has it, so this is not a data-loss event.
      console.warn('[open-pages/drafts] remote save failed; the device copy stands:', e);
      setStatus('local-only');
    }
  }, [uid]);

  // ---- Cadence. Local on a short debounce; remote lazily, with a forced floor. --
  useEffect(() => {
    if (!enabled || !ready) return;
    const empty = !String(title || '').trim() && !String(body || '').trim();
    let s = slotRef.current;
    if (!s) {
      if (empty) return;                       // an untouched composer claims no slot
      s = allocateSlot(drafts);
      if (!s) { setNotice({ kind: 'cap', message: capNotice() }); return; }
      setSlot(s); slotRef.current = s;
    }

    clearTimeout(localTimer.current);
    localTimer.current = setTimeout(() => saveLocal(s), LOCAL_DEBOUNCE_MS);

    clearTimeout(remoteTimer.current);
    const now = Date.now();
    if (!remoteFloor.current) remoteFloor.current = now + REMOTE_MAX_WAIT_MS;
    // A writer typing without pause would otherwise never sync, so the debounce is
    // capped by the floor rather than being rescheduled indefinitely.
    const wait = Math.max(0, Math.min(REMOTE_DEBOUNCE_MS, remoteFloor.current - now));
    remoteTimer.current = setTimeout(() => { remoteFloor.current = 0; saveRemote(s); }, wait);

    return () => { clearTimeout(localTimer.current); clearTimeout(remoteTimer.current); };
  }, [title, body, genre, coverImage, enabled, ready, drafts, saveLocal, saveRemote]);

  // ---- On the way out. ⚠ pagehide + visibilitychange, NOT beforeunload, which is
  //      unreliable on mobile — which is precisely where a writer loses a piece.
  //      The local write is synchronous and guaranteed; the remote one is best-effort.
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      const s = slotRef.current;
      if (!s) return;
      clearTimeout(localTimer.current);
      saveLocal(s);
      saveRemote(s);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', flush);
    };
  }, [enabled, saveLocal, saveRemote]);

  // ---- Opening an existing draft, and discarding one. --------------------------
  const openDraft = useCallback((s) => {
    const d = readLocal(uid)[s];
    if (!d) return null;
    setSlot(s); slotRef.current = s;
    revRef.current = d.rev || 0;
    createdRef.current = d.createdAt || Date.now();
    remoteFloor.current = 0;
    return d;
  }, [uid]);

  const deleteDraft = useCallback(async (s) => {
    const next = { ...readLocal(uid) }; delete next[s];
    writeLocal(uid, next);
    setDrafts(next);
    if (slotRef.current === s) { setSlot(null); slotRef.current = null; revRef.current = 0; createdRef.current = null; }
    if (!uid) return;
    try {
      const { ref, remove } = await import('firebase/database');
      await remove(ref(db, draftPath(uid, s)));
    } catch (e) { console.warn('[open-pages/drafts] remote delete failed:', e); }
  }, [uid]);

  // ---- ⭐ RULING 3: A DRAFT IS DELETED WHEN ITS PIECE PUBLISHES. ----------------
  // A kept draft and a published piece diverge, and then nobody knows which is the
  // work. The published piece is the record. Called by the composer on a `published`
  // verdict only — a `pending` or `rejected` verdict leaves the draft exactly where it
  // is, because in those cases nothing was published and the writing is all there is.
  const discardOnPublish = useCallback(async () => {
    const s = slotRef.current;
    clearTimeout(localTimer.current);
    clearTimeout(remoteTimer.current);
    if (s) await deleteDraft(s);
  }, [deleteDraft]);

  return { slot, drafts, status, notice, ready, dismissNotice: () => setNotice(null), openDraft, deleteDraft, discardOnPublish };
}
